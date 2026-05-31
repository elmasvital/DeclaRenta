/**
 * Motor FX FIFO — realiza el seguimiento de lotes de divisas según el Art. 37.1.l LIRPF.
 *
 * Cada conversión EUR→divisa extranjera (FCY) crea un lote; cada disposición de FCY
 * (conversión de vuelta a EUR o gasto de FCY en compras de acciones) consume lotes mediante FIFO.
 * La DGT V2324-10 confirma que el FIFO se aplica a las tenencias de moneda extranjera.
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
  /** Positivo = adquisición de FCY (EUR→FCY), Negativo = disposición de FCY (FCY→EUR o gasto de FCY) */
  quantity: Decimal;
  /** Tipo de cambio EUR en el momento del evento (EUR por 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
  /** Comisión en EUR (positivo = coste pagado). Aumenta la base imponible en COMPRA, reduce los ingresos en VENTA. */
  commissionEur?: Decimal;
  brokerSource?: string;
  realTotalPriceEUR?: Decimal;
}


export class FxFifoEngine {
  private lots: Map<string, FxLot[]> = new Map();
  private disposals: FxDisposal[] = [];
  private nextLotId = 1;
  warnings: string[] = [];
  /** Mensajes estructurados con severidad, sugerencia y contexto */
  messages: TaxMessage[] = [];


  private emit(msg: TaxMessage): void {
    this.messages.push(msg);
    this.warnings.push(msg.message);
  }


  private fxMissing: Map<string, { count: number; totalQty: Decimal }> = new Map();


  /**
   * Procesa eventos FX extraídos de las operaciones.
   * Las operaciones CASH con assetCategory="CASH" que representan conversiones de divisas reales
   * (no FXCONV automáticas) generan lotes y disposiciones de FX.
   */
  processEvents(events: FxEvent[]): FxDisposal[] {
    this.fxMissing.clear();
    const sorted = [...events].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      // Misma fecha: adquisiciones (cantidad positiva) antes que disposiciones (cantidad negativa)
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
     * Extrae eventos FX de las operaciones.
     *
     * Dos fuentes de eventos FX:
     * 1. Operaciones CASH (assetCategory=CASH): conversiones directas de divisas
     *    - COMPRA CASH en USD = adquisición de USD (añadir lote)
     *    - VENTA CASH en USD = disposición de USD (consumir lotes)
     * 2. Operaciones de valores en divisa distinta a EUR (SOLO en cuentas multidivisa):
     *    - COMPRA acciones en USD = gasto de USD (disponer lotes de FCY)
     *    - VENTA acciones en USD = recepción de USD (añadir lote de FCY)
     *
     * Cuentas con conversión automática: solo las conversiones CASH manuales generan eventos FX.
     * Las operaciones de acciones se liquidan al instante mediante FXCONV — sin exposición FX.
     */


  static extractFxEvents(trades: Trade[], rateMap: EcbRateMap): FxEvent[] {
    const events: FxEvent[] = [];


    for (const trade of trades) {
      if (trade.currency === "EUR") continue;
      //if (trade.assetCategory !== "CASH") continue;
      //if (FxFifoEngine.isFxconv(trade)) continue;


      const date = normalizeDate(trade.settlementDate || trade.tradeDate);
      const ecbRate = getEcbRate(rateMap, date, trade.currency);
      // const quantity = new Decimal(trade.quantity).abs();
      const realPriceEUR = trade.realPriceEUR ? new Decimal(trade.realPriceEUR).abs() : undefined;




      // La comisión aumenta la base de coste (COMPRA) o reduce los ingresos (VENTA)
      let commissionEur: Decimal | undefined;
      const commAbs = new Decimal(trade.commission).abs();
      if (commAbs.greaterThan(0)) {
        const commCcy = trade.commissionCurrency || trade.currency;
        if (commCcy === "EUR") {
          commissionEur = commAbs;
        } else {
          const commRate = getEcbRate(rateMap, date, commCcy);
          commissionEur = commAbs.mul(commRate);
        }
      }


      let realTotalPriceEUR: Decimal | undefined;
      if (realPriceEUR) {
        realTotalPriceEUR = realPriceEUR.plus(commissionEur || 0);
      }


      if (trade.assetCategory === "CASH") {
        // Operación de divisa directa — saltar FXCONV (conversiones automáticas)
        // Desactivada la detección de Fxconv
        //if (FxFifoEngine.isFxconv(trade)) continue;


        const quantity = new Decimal(trade.quantity).abs();
        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity, ecbRate, trigger: "conversion", brokerSource: trade.brokerSource, commissionEur: commissionEur, realTotalPriceEUR: realTotalPriceEUR });
        } else {
          events.push({ date, currency: trade.currency, quantity: quantity.negated(), ecbRate, trigger: "conversion", brokerSource: trade.brokerSource, commissionEur: commissionEur, realTotalPriceEUR: realTotalPriceEUR });
        }
      } else if (trade.assetCategory !== "WAR") {
        // Cuenta multidivisa: operación de valores = evento FX implícito
        const tradeMoney = new Decimal(trade.tradeMoney).abs();
        if (tradeMoney.isZero()) continue;


        if (trade.buySell === "BUY") {
          events.push({ date, currency: trade.currency, quantity: tradeMoney.negated(), ecbRate, trigger: "stock_purchase", brokerSource: trade.brokerSource });
        }
        else {
          events.push({ date, currency: trade.currency, quantity: tradeMoney, ecbRate, trigger: "stock_sale", brokerSource: trade.brokerSource });
        }


        // La comisión también consume FCY (pagada en commissionCurrency)
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
   * Extrae eventos FX de transacciones de efectivo (dividendos, intereses).
   *
   * Los dividendos/intereses recibidos en FCY crean lotes de adquisición;
   * la retención de impuestos y comisiones pagadas en FCY consumen lotes.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap): FxEvent[] {


    const events: FxEvent[] = [];


    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;


      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;


      const date = normalizeDate(tx.settleDate || tx.dateTime);
      const ecbRate = getEcbRate(rateMap, date, tx.currency);


      if (tx.type === "Dividends" || tx.type === "Payment In Lieu Of Dividends") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "dividend" });
      }
      else if (tx.type === "Withholding Tax") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "dividend" });
      }
      else if (tx.type === "Broker Interest Received" || tx.type === "Bond Interest Received") {
        events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "interest" });
      }
      else if (tx.type === "Broker Interest Paid" || tx.type === "Bond Interest Paid") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "interest" });
      }
      else if (tx.type === "Other Fees" || tx.type === "Commission Adjustments") {
        if (amount.lessThan(0)) {
          events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "commission" });
        } else {
          events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "commission" });
        }
      }
    }


    return events;
  }


  //DESACTIVADO
  // /** Detecta FXCONV (conversiones automáticas del bróker para liquidación) */
  // private static isFxconv(trade: Trade): boolean {
  //   const desc = (trade.description || "").toUpperCase();
  //   const exch = (trade.exchange || "").toUpperCase();
  //   const notes = (trade.notes || "").toUpperCase().split(";");
  //   return desc.includes("FXCONV") || desc.includes("CASH RECEIPTS") || desc.includes("CASH DISBURSEMENTS")
  //     || exch === "FXCONV" || notes.includes("AFX");
  // }


  private addLot(event: FxEvent): void {
    // // La comisión aumenta el coste en EUR de adquirir el lote
    // const baseCost = event.quantity.mul(event.ecbRate);
    // const totalCost = event.commissionEur ? baseCost.plus(event.commissionEur) : baseCost;
    const totalCost = event.realTotalPriceEUR ? event.realTotalPriceEUR : (event.quantity.mul(event.ecbRate).plus(event.commissionEur || 0));
    const costPerUnit = totalCost.div(event.quantity);




    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency: event.currency,
      acquireDate: event.date,
      quantity: event.quantity,
      costPerUnit,
      costInEur: totalCost,
      brokerSource: event.brokerSource,
      realTotalPriceEUR: event.realTotalPriceEUR,
    };


    if (!this.lots.has(event.currency)) {
      this.lots.set(event.currency, []);
    }
    this.lots.get(event.currency)!.push(lot);
    console.log(`Add ${lot.id} ${lot.quantity.toFixed(3)} ${event.currency} ${lot.costPerUnit.toFixed(3)} ${totalCost.toFixed(3)} EUR N.lotes: ${this.lots.get(event.currency)!.length} total$ ${this.lots.get(event.currency)!.reduce((sum, l) => sum.plus(l.quantity), new Decimal(0)).toFixed(2)}, ${event.currency}, ${event.date}, ${event.brokerSource}`);
  }


  private consumeLots(event: FxEvent): void {
    let remaining = event.quantity.abs();
    const totalQty = remaining;
    const lots = this.lots.get(event.currency);
    console.log(`Con ${remaining.toFixed(2)} ${event.currency} event ${event.date}. N.Lotes: ${lots ? lots.length : 0}`);
    if (!lots || lots.length === 0) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      const proceedsEur = remaining.mul(event.ecbRate);
      const netProceeds = event.commissionEur ? proceedsEur.minus(event.commissionEur) : proceedsEur;
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur: netProceeds,
        costBasisEur: netProceeds,
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

      // Commission reduces proceeds, distributed proportionally across consumed lots
      let proceedsEur = consumed.mul(event.ecbRate);
      if (event.commissionEur) {
        const proportion = consumed.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
      const costBasisEur = consumed.mul(lot.costPerUnit);
      const holdingDays = daysBetween(lot.acquireDate, event.date);
      console.log(`Consumo ${consumed.toFixed(3)} ${event.currency} de lote ${lot.id} ` +
                  `f.adqu ${lot.acquireDate} cost ${costBasisEur.toFixed(3)} EUR, proceeds ` +
                  `${proceedsEur.toFixed(3)} EUR, hold ${holdingDays} days, ${event.trigger}`);
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
      let proceedsEur = remaining.mul(event.ecbRate);
      if (event.commissionEur) {
        const proportion = remaining.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
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
