/**
 * FX FIFO engine — tracks currency lots per Art. 37.1.l LIRPF.
 *
 * Each EUR→FCY conversion creates a lot; each FCY disposal (conversion
 * back to EUR, or spending FCY on stock purchases) consumes lots via FIFO.
 * DGT V2324-10 confirms FIFO applies to foreign currency holdings.
 */

import Decimal from "decimal.js";
import type { FxLot, FxDisposal, FxTrigger, TaxMessage } from "../types/tax.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

export interface FxEvent {
  date: string;
  currency: string;
  /** Positive = acquiring FCY (EUR→FCY), Negative = disposing FCY (FCY→EUR or FCY spent) */
  quantity: Decimal;
  /** EUR rate at event time (EUR per 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
  brokerSource?: string;
}

export class FxFifoEngine {
  private lots: Map<string, FxLot[]> = new Map();
  private disposals: FxDisposal[] = [];
  private nextLotId = 1;
  warnings: string[] = [];
  /** Structured messages with severity, hint, and context */
  messages: TaxMessage[] = [];

  private emit(msg: TaxMessage): void {
    this.messages.push(msg);
    this.warnings.push(msg.message);
  }

  private fxMissing: Map<string, { count: number; totalQty: Decimal }> = new Map();

  /**
   * Process FX events extracted from trades.
   * CASH trades with assetCategory="CASH" that represent actual forex conversions
   * (not automatic FXCONV) generate FX lots and disposals.
   */
  processEvents(events: FxEvent[]): FxDisposal[] {
    this.fxMissing.clear();
    const sorted = [...events].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      // Same date: acquisitions (positive qty) before disposals (negative qty)
      const aPhase = a.quantity.greaterThan(0) ? 0 : 1;
      const bPhase = b.quantity.greaterThan(0) ? 0 : 1;
      return aPhase - bPhase;
    });

    for (const event of sorted) {
      if (event.currency === "EUR") continue;

      if (event.quantity.greaterThan(0)) {
        this.addLot(event);
      } else if (event.quantity.lessThan(0)) {
        this.consumeLots(event);
      }
    }

    for (const [currency, { count, totalQty }] of this.fxMissing) {
      this.emit({ id: "fx.missing_prior_lots", severity: "info", message: `⚠ ${count} disposiciones de ${currency} sin lotes previos suficientes (total: ${totalQty.toFixed(2)} ${currency}). Posible adquisición anterior al período declarado — ganancia FX asumida = 0.`, hint: "La adquisición de esta divisa fue anterior al periodo del Flex Query. Se asume ganancia FX = 0 (tratamiento conservador).", context: { currency, count: count.toString(), totalQuantity: totalQty.toFixed(2) } });
    }

    return this.disposals;
  }

  /**
   * Extract FX events from trades.
   *
   * Two sources of FX events:
   * 1. CASH trades (assetCategory=CASH): direct forex conversions
   *    - BUY CASH in USD = acquiring USD (add lot)
   *    - SELL CASH in USD = disposing USD (consume lots)
   * 2. Securities trades in non-EUR (ONLY in multi-currency accounts):
   *    - BUY stock in USD = spending USD (dispose FCY lots)
   *    - SELL stock in USD = receiving USD (add FCY lot)
   *
   * Auto-convert accounts: only manual CASH conversions generate FX events.
   * Stock trades are settled instantly via FXCONV — no FX exposure.
   */
  static extractFxEvents(trades: Trade[], rateMap: EcbRateMap): FxEvent[] {
    //const autoConvert = FxFifoEngine.detectAutoConvert(trades);
    const autoConvert = false;
    const events: FxEvent[] = [];

    for (const trade of trades) {
      if (trade.currency === "EUR") continue;
      //      if (trade.assetCategory === "CASH" && FxFifoEngine.isFxconv(trade)) continue;
      // Use settlement date for FX events: stock purchases and their corresponding
      // forex conversions settle on the same date (T+2/T+1), eliminating false
      // "missing lots" warnings caused by trade-date ordering mismatches.
      const date = normalizeDate(trade.settlementDate || trade.tradeDate);
      const ecbRate = getEcbRate(rateMap, date, trade.currency);

      if (trade.assetCategory === "CASH") {
        // Direct forex trade — skip FXCONV (automatic conversions)
        // Desactivada la detección de Fxconv
        //if (FxFifoEngine.isFxconv(trade)) continue;

        const quantity = new Decimal(trade.quantity).abs();
        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity, ecbRate, trigger: "conversion", brokerSource: trade.brokerSource });
        } else {
          events.push({ date, currency: trade.currency, quantity: quantity.negated(), ecbRate, trigger: "conversion", brokerSource: trade.brokerSource});
        }
      } else if (!autoConvert && trade.assetCategory !== "WAR") {
        // Multi-currency account: securities trade = implicit FX event
        const tradeMoney = new Decimal(trade.tradeMoney).abs();
        if (tradeMoney.isZero()) continue;

        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity: tradeMoney.negated(), ecbRate, trigger: "stock_purchase", brokerSource: trade.brokerSource });
        } else {
          events.push({ date, currency: trade.currency, quantity: tradeMoney, ecbRate, trigger: "stock_sale", brokerSource: trade.brokerSource });
        }

        // Commission also consumes FCY (paid in commissionCurrency)
        const commission = new Decimal(trade.commission).abs();
        if (commission.greaterThan(0) && trade.commissionCurrency !== "EUR") {
          const commRate = getEcbRate(rateMap, date, trade.commissionCurrency);
          events.push({ date, currency: trade.commissionCurrency, quantity: commission.negated(), ecbRate: commRate, trigger: "commission", brokerSource: trade.brokerSource });
        }
      }
    }

    return events;
  }

  /**
   * Extract FX events from cash transactions (dividends, interest).
   *
   * Only relevant for multi-currency accounts where FCY is held.
   * Auto-convert accounts don't hold FCY — dividends/interest are
   * converted instantly, so no FX lots are created.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap, autoConvert: boolean): FxEvent[] {
    if (autoConvert) return [];

    const events: FxEvent[] = [];

    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;

      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;

      const date = normalizeDate(tx.settleDate || tx.dateTime);
      const ecbRate = getEcbRate(rateMap, date, tx.currency);

      if (tx.type === "Dividends" || tx.type === "Payment In Lieu Of Dividends") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "dividend", });
      } else if (tx.type === "Withholding Tax") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "dividend", brokerSource: tx.description });
      } else if (tx.type === "Broker Interest Received" || tx.type === "Bond Interest Received") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "interest", brokerSource: tx.description });
      } else if (tx.type === "Broker Interest Paid" || tx.type === "Bond Interest Paid") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "interest", brokerSource: tx.description });
      } else if (tx.type === "Other Fees" || tx.type === "Commission Adjustments") {
        if (amount.lessThan(0)) {
          events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "commission", brokerSource: tx.description });
        } else {
          events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "commission", brokerSource: tx.description });
        }
      }
    }

    return events;
  }

  /** Detect FXCONV (automatic broker conversions for settlement) */
  private static isFxconv(trade: Trade): boolean {
    const desc = (trade.description || "").toUpperCase();
    const exch = (trade.exchange || "").toUpperCase();
    const notes = (trade.notes || "").toUpperCase().split(";");
    return desc.includes("FXCONV") || desc.includes("CASH RECEIPTS") || desc.includes("CASH DISBURSEMENTS")
      || exch === "FXCONV" || notes.includes("AFX");
  }

  private addLot(event: FxEvent): void {
    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency: event.currency,
      acquireDate: event.date,
      quantity: event.quantity,
      costPerUnit: event.ecbRate,
      costInEur: event.quantity.mul(event.ecbRate),

      // Convert commission separately if its currency differs from the trade currency
      // const commissionEcbRate = !commission.isZero() && trade.commissionCurrency && trade.commissionCurrency !== trade.currency
      //   ? getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency)
      //   : ecbRate;
      // const costInEur = baseAmount.mul(ecbRate).plus(commission.mul(commissionEcbRate));
    };

    if (!this.lots.has(event.currency)) {
      this.lots.set(event.currency, []);
    }

    this.lots.get(event.currency)!.push(lot);
    console.log(`Add ${lot.id} ${lot.quantity.toFixed(2)} ${lot.costPerUnit.toFixed(2)} ${event.currency} N.lotes: ${this.lots.get(event.currency)!.length} total$ ${this.lots.get(event.currency)!.reduce((sum, l) => sum.plus(l.quantity), new Decimal(0)).toFixed(2)}, ${event.currency}, ${event.date}, ${event.brokerSource}`);
  }
  private consumeLots(event: FxEvent): void {
    let remaining = event.quantity.abs();
    const lots = this.lots.get(event.currency);
    console.log(`Con ${remaining.toFixed(2)} ${event.currency} event ${event.date}. N.Lotes: ${lots ? lots.length : 0}`);
    if (!lots || lots.length === 0) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      // No lots = prior-year acquisition. Record with zero gain (cost = proceeds)
      // to avoid fabricating phantom profits from missing historical data.
      const proceedsEur = remaining.mul(event.ecbRate);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: proceedsEur,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
      });
      console.log(`ATENCION No lots available for ${event.currency} disposal on ${event.date}. Recorded as missing with quantity ${remaining.toFixed(2)} ${event.currency}.`);
      return;
    }

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);

      const proceedsEur = consumed.mul(event.ecbRate);
      const costBasisEur = consumed.mul(lot.costPerUnit);
      const holdingDays = daysBetween(lot.acquireDate, event.date);
      console.log(`Consumo ${consumed.toFixed(2)} ${event.currency} de lote ${lot.id} f.adqu ${lot.acquireDate} cost ${costBasisEur.toFixed(2)} EUR, proceeds ${proceedsEur.toFixed(2)} EUR, holding period ${holdingDays} days, trigger ${event.trigger}`);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: lot.acquireDate,
        quantity: consumed,
        proceedsEur,
        costBasisEur,
        gainLossEur: proceedsEur.minus(costBasisEur),
        trigger: event.trigger,
        holdingPeriodDays: holdingDays,
        lotId: lot.id,
      });

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInEur = lot.costInEur.minus(costBasisEur);
      console.log(`Queda en  ${lot.id}: \x1b[32m${lot.quantity.toFixed(2)} \x1b[0m${event.currency}, \x1b[32m${lot.costInEur.toFixed(2)} \x1b[0mEUR`);
      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
    }
    console.log(`Resta por consumir ${event.date}: ${remaining.toFixed(2)} ${event.currency}`);
    if (remaining.greaterThan(0)) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      // Without prior-year lots we cannot determine cost basis.
      // Use current rate as cost (zero gain) to avoid fabricating phantom profits.
      const proceedsEur = remaining.mul(event.ecbRate);
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: proceedsEur,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
      });
      console.log(`\x1b[31mATENCION!!!!!\x1b[0m No lots available for ${event.currency} disposal on ${event.date}. Recorded as missing with quantity ${remaining.toFixed(2)} ${event.currency}.`);
    }
    console.log(`Fin evento ${event.date} for ${event.quantity.toFixed(2)} ${event.currency}. Total disposals so far: \x1b[32m${this.disposals.length}\x1b[0m`);
    console.log('--------------------------------------------------------');
    console.log('Lotes abiertos: \x1b[32m' + (lots ? lots.length : 0) + '\x1b[0m Total C Lots: \x1b[32m' + Array.from(this.lots.values()).flat().reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0)).toFixed(2) + '\x1b[0m , \x1b[32m' + Array.from(this.lots.values()).flat().reduce((sum, lot) => sum.plus(lot.costInEur), new Decimal(0)).toFixed(2) + '\x1b[0m EUR');
  }

  getDisposals(): FxDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, FxLot[]> {
    return this.lots;
  }
}
