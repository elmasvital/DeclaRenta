/**
 * Anti-churning rule detector for foreign currencies (Art. 33.5.e LIRPF / DGT V1613-25).
 *
 * The DGT confirmed in binding consultation V1613-25 (15 September 2025) that
 * foreign currency (moneda extranjera) is an ordinary patrimonial element (Art. 33.1)
 * and therefore subject to the 1-year anti-churning rule of Art. 33.5.e LIRPF:
 *
 *  - "No se computarán como pérdidas patrimoniales: e) Las derivadas de las transmisiones
 *     de elementos patrimoniales, cuando el obligado tributario vuelva a adquirirlos
 *     dentro del año siguiente a la fecha de dicha transmisión. Estas pérdidas
 *     patrimoniales se integrarán a medida que se transmitan los elementos patrimoniales
 *     que permanezcan en el patrimonio del contribuyente."
 *
 * Key criteria:
 *  1. Only 1 year SUBSEQUENT (no 2-month window, no prior window — divisas are not "valores").
 *  2. Proportional blocking ("por paquetes", DGT V0913-08 / V2481-20): sell 1,000 USD at a loss,
 *     rebuy 400 USD within 1 year -> 40% of the loss is deferred, 60% is deductible now.
 *  3. Repurchases are voluntary currency acquisitions (EUR->FCY conversions, external deposits).
 *     Dividends and interest received in FCY (Rendimientos del Capital Mobiliario, Art. 25)
 *     and returned stock principal (desaparcado, DGT V2422-20) are NOT repurchases of divisa.
 *  4. Deferred losses are released (reintegrated) when the repurchased currency is subsequently
 *     converted to EUR.
 */

import Decimal from "decimal.js";
import type { FxDisposal, TaxMessage } from "../types/tax.js";
import type { FxEvent } from "./fx-fifo.js";
import { addMonths } from "./wash-sale.js";
import { parseDate, normalizeDate } from "./dates.js";

/** A repurchase event available to absorb an FX loss, with a consumable quantity budget. */
interface FxRepurchaseBudget {
  date: string;
  time: number;
  remainingQty: Decimal;
}

/** A deferred FX loss attached to repurchased currency, released when that currency is converted. */
interface FxDeferredLot {
  qty: Decimal;
  deferredEur: Decimal;
  availableAfterTime: number;
}

export interface FxWashSaleResult {
  disposals: FxDisposal[];
  messages: TaxMessage[];
  totalBlockedEur: Decimal;
  totalReintegratedEur: Decimal;
  /** Losses that would be deferred under V1613-25 if --fx-wash-sale were active */
  potentialBlockedEur: Decimal;
}

export interface DetectFxWashSalesOptions {
  /** If true, apply strict deferral and blocking. If false, detect potential wash sales and emit info notices. */
  enabled?: boolean;
}

/**
 * Check whether an FX event is a qualifying currency repurchase under Art. 33.5.e.
 *
 * Excludes:
 * - Dividends and interest (frutos civiles / capital mobiliario, not acquisition of currency)
 * - Returning stock principal (unparking existing basis per DGT V2422-20)
 * - Negative cash movements (fees, taxes paid, currency sales)
 */
export function isFxRepurchase(event: FxEvent): boolean {
  if (event.kind === "stock_buy" || event.kind === "stock_sell") return false;
  if (event.trigger === "dividend" || event.trigger === "interest") return false;
  if (event.trigger === "stock_purchase" || event.trigger === "stock_sale") return false;
  return event.quantity.greaterThan(0);
}

/**
 * Detect FX wash sales per DGT V1613-25 / Art. 33.5.e LIRPF.
 *
 * @param allDisposals - All FX disposals across all years (for cross-year tracking)
 * @param allEvents - All FX events (to find in-window repurchases)
 * @param options - Enable strict blocking mode
 */
export function detectFxWashSales(
  allDisposals: FxDisposal[],
  allEvents: FxEvent[],
  options?: DetectFxWashSalesOptions,
): FxWashSaleResult {
  const enabled = Boolean(options?.enabled);
  const messages: TaxMessage[] = [];
  let totalBlockedEur = new Decimal(0);
  let totalReintegratedEur = new Decimal(0);
  let potentialBlockedEur = new Decimal(0);
  const potentialAffectedCurrencies = new Set<string>();

  // Group repurchases by currency
  const repurchasesByCurrency = new Map<string, FxRepurchaseBudget[]>();
  for (const event of allEvents) {
    if (!isFxRepurchase(event)) continue;
    const date = normalizeDate(event.date);
    const time = parseDate(event.date).getTime();
    let list = repurchasesByCurrency.get(event.currency);
    if (!list) {
      list = [];
      repurchasesByCurrency.set(event.currency, list);
    }
    list.push({
      date,
      time,
      remainingQty: new Decimal(event.quantity),
    });
  }

  // Sort repurchases ascending by time
  for (const list of repurchasesByCurrency.values()) {
    list.sort((a, b) => a.time - b.time);
  }

  // Group disposals by currency
  const disposalsByCurrency = new Map<string, FxDisposal[]>();
  for (const d of allDisposals) {
    let list = disposalsByCurrency.get(d.currency);
    if (!list) {
      list = [];
      disposalsByCurrency.set(d.currency, list);
    }
    list.push(d);
  }

  // Process each currency chronologically
  for (const [currency, disposals] of disposalsByCurrency.entries()) {
    disposals.sort((a, b) => parseDate(a.disposeDate).getTime() - parseDate(b.disposeDate).getTime());
    const repurchases = repurchasesByCurrency.get(currency) ?? [];
    const deferredLots = new Map<string, FxDeferredLot[]>();

    for (const disposal of disposals) {
      const dQty = disposal.quantity.abs();
      const disposeParsed = parseDate(disposal.disposeDate);
      const disposeTime = disposeParsed.getTime();

      // 1. RELEASE (Reintegration): Check if this disposal sells currency acquired on a date
      //    carrying a deferred loss.
      if (enabled) {
        const acquireDate = normalizeDate(disposal.acquireDate);
        const lots = deferredLots.get(acquireDate);
        if (lots && lots.length > 0) {
          let remainingReleaseQty = dQty;
          for (const lot of lots) {
            if (remainingReleaseQty.lessThanOrEqualTo(0)) break;
            if (disposeTime <= lot.availableAfterTime) continue; // Only release on sales AFTER the blocking disposal
            if (lot.qty.lessThanOrEqualTo(0)) continue;

            const releasedQty = Decimal.min(remainingReleaseQty, lot.qty);
            const releasedEur = lot.qty.isZero()
              ? new Decimal(0)
              : lot.deferredEur.mul(releasedQty).div(lot.qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

            disposal.reintegratedLossEur = (disposal.reintegratedLossEur ?? new Decimal(0)).plus(releasedEur);
            totalReintegratedEur = totalReintegratedEur.plus(releasedEur);

            lot.qty = lot.qty.minus(releasedQty);
            lot.deferredEur = lot.deferredEur.minus(releasedEur);
            remainingReleaseQty = remainingReleaseQty.minus(releasedQty);
          }
          const activeLots = lots.filter((l) => l.qty.greaterThan(0));
          if (activeLots.length > 0) {
            deferredLots.set(acquireDate, activeLots);
          } else {
            deferredLots.delete(acquireDate);
          }
        }
      }

      // Ensure release field is initialized
      disposal.reintegratedLossEur = disposal.reintegratedLossEur ?? new Decimal(0);
      disposal.blockedLossEur = disposal.blockedLossEur ?? new Decimal(0);
      disposal.washSaleBlocked = disposal.washSaleBlocked ?? false;

      // 2. BLOCK (Deferral): Check losses for repurchases in [disposeDate + 1 day, disposeDate + 1 year]
      if (disposal.gainLossEur.greaterThanOrEqualTo(0)) continue;

      const lossEur = disposal.gainLossEur.abs();
      const windowEnd = addMonths(disposeParsed, 12);
      const windowEndTime = windowEnd.getTime();

      let absorbedQty = new Decimal(0);
      const matchedDates: string[] = [];

      for (const rep of repurchases) {
        if (absorbedQty.greaterThanOrEqualTo(dQty)) break;
        // Strictly within 1 year AFTER the disposal date:
        // Art. 33.5.e: "dentro del año siguiente a la fecha de dicha transmisión"
        if (rep.time <= disposeTime) continue;
        if (rep.time > windowEndTime) continue;
        if (rep.remainingQty.lessThanOrEqualTo(0)) continue;

        const needed = dQty.minus(absorbedQty);
        const take = Decimal.min(needed, rep.remainingQty);
        absorbedQty = absorbedQty.plus(take);
        matchedDates.push(rep.date);

        if (enabled) {
          rep.remainingQty = rep.remainingQty.minus(take);
          const blockedShareEur = lossEur.mul(take).div(dQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          let lots = deferredLots.get(rep.date);
          if (!lots) {
            lots = [];
            deferredLots.set(rep.date, lots);
          }
          lots.push({
            qty: take,
            deferredEur: blockedShareEur,
            availableAfterTime: disposeTime,
          });
        }
      }

      if (absorbedQty.greaterThan(0)) {
        const blockedEur = lossEur.mul(absorbedQty).div(dQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        if (enabled) {
          disposal.blockedLossEur = blockedEur;
          disposal.washSaleBlocked = true;
          disposal.washSaleMatchDates = [...new Set(matchedDates)].sort();
          totalBlockedEur = totalBlockedEur.plus(blockedEur);
        } else {
          potentialBlockedEur = potentialBlockedEur.plus(blockedEur);
          potentialAffectedCurrencies.add(currency);
        }
      }
    }
  }

  // Generate diagnostic and informational messages
  if (enabled) {
    if (totalBlockedEur.greaterThan(0) || totalReintegratedEur.greaterThan(0)) {
      messages.push({
        id: "fx.wash_sale_applied",
        severity: "info",
        message: `[DGT V1613-25] Regla de diferimiento de pérdidas en divisas aplicada (Art. 33.5.e LIRPF): ${totalBlockedEur.toFixed(2)} € bloqueados/diferidos${totalReintegratedEur.greaterThan(0) ? `, ${totalReintegratedEur.toFixed(2)} € reintegrados` : ""}.`,
        hint: "Las pérdidas patrimoniales en moneda extranjera quedan diferidas cuando se vuelve a adquirir la misma divisa en el año posterior, integrándose al transmitir la divisa recomprada.",
      });
    }
  } else if (potentialBlockedEur.greaterThan(0)) {
    const currStr = [...potentialAffectedCurrencies].join(", ");
    messages.push({
      id: "fx.wash_sale_dgt_v1613_25_notice",
      severity: "info",
      message: `[Aviso Fiscal DGT V1613-25] Se han computado ${potentialBlockedEur.toFixed(2)} € de pérdidas en ${currStr}, habiéndose detectado recompras en el plazo de 1 año posterior.`,
      hint: "Según la consulta vinculante DGT V1613-25 (Art. 33.5.e LIRPF), las pérdidas en divisas no son deducibles si se adquiere la misma divisa en el año siguiente. Activa --fx-wash-sale para diferirlas conforme al criterio estricto de la DGT.",
    });
  }

  return {
    disposals: allDisposals,
    messages,
    totalBlockedEur,
    totalReintegratedEur,
    potentialBlockedEur,
  };
}
