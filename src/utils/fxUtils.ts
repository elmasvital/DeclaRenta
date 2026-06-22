// fxUtils.ts
// Archivo de funciones de fxFifo separdas de la versión oficial

import Decimal from "decimal.js";
import { FxEvent, FxFifoEngine } from "@/engine/fx-fifo.js";
import { daysBetween } from "../engine/dates.js";
import { logO } from "@/utils/log.js";



export function lossFxFifo(event: FxEvent): string | undefined {
  let remaining = event.quantity.abs();
  const totalQty = remaining;
  const lots = this.lots.get(event.currency);

  if (!lots || lots.length === 0) {
    const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
    entry.count++;
    entry.totalQty = entry.totalQty.plus(remaining);
    this.fxMissing.set(event.currency, entry);
    const effRate = FxFifoEngine.effectiveRate(event);
    const proceedsEur = remaining.mul(effRate);
    const netProceeds = event.commissionEur ? proceedsEur.minus(event.commissionEur) : proceedsEur;
    // this.disposals.push({
    //   currency: event.currency,
    //   disposeDate: event.date,
    //   acquireDate: event.date,
    //   quantity: remaining,
    //   proceedsEur: netProceeds,
    //   costBasisEur: netProceeds,
    //   gainLossEur: new Decimal(0),
    //   trigger: event.trigger,
    //   holdingPeriodDays: 0,
    //   lotId: "UNKNOWN",
    // });
    this.record("dispose", event, { quantityFcy: remaining, rate: effRate, costBasisEur: netProceeds, proceedsEur: netProceeds, gainLossEur: new Decimal(0), lotId: "UNKNOWN", note: "sin lotes previos → ganancia FX = 0" });
    logO({ etiqueta: "FXCons", lotId: "UNKOWN", brokerSource: event.brokerSource, trigger: event.trigger.toUpperCase(), quantity: event.quantity.toString() });
    return "UNKNOWN";
  }

  const effRate = FxFifoEngine.effectiveRate(event);
  while (remaining.greaterThan(0) && lots.length > 0) {
    const lot = lots[0]!;
    const consumed = Decimal.min(remaining, lot.quantity);

    // Commission reduces proceeds, distributed proportionally across consumed lots
    let proceedsEur = consumed.mul(effRate);
    if (event.commissionEur) {
      const proportion = consumed.div(totalQty);
      proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
    }
    const costBasisEur = consumed.mul(lot.costPerUnit);
    const holdingDays = daysBetween(lot.acquireDate, event.date);

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

    const lotIdConsumed = lot.id;
    console.log(
      `[${y}STKCons${z}] ${lot.id} |${event.date} | f.Crea ${lot.acquireDate}: ${consumed.toFixed(2)} ${event.currency} costInEur ${costBasisEur.toFixed(2)} EUR and proceeds ${proceedsEur.toFixed(2)} EUR (gain/loss: ${proceedsEur.minus(costBasisEur).toFixed(2)} EUR), quedan en el lote ${lot.quantity.minus(consumed).toFixed(2)} ${event.currency} con costInEur ${lot.costInEur.minus(costBasisEur).toFixed(2)} EUR`);

    lot.quantity = lot.quantity.minus(consumed);
    lot.costInEur = lot.costInEur.minus(costBasisEur);

    if (lot.quantity.isZero()) {
      lots.shift();
    }

    remaining = remaining.minus(consumed);
    this.record("dispose", event, { quantityFcy: consumed, rate: effRate, costBasisEur, proceedsEur, gainLossEur: proceedsEur.minus(costBasisEur), lotId: lotIdConsumed, lotAcquireDate: lot.acquireDate });
    logO({ etiqueta: "FXConsDispose", lotId: lot.id, brokerSource: event.brokerSource, trigger: event.trigger.toUpperCase(), quantity: consumed.toString() });
  }

  if (remaining.greaterThan(0)) {
    const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
    entry.count++;
    entry.totalQty = entry.totalQty.plus(remaining);
    this.fxMissing.set(event.currency, entry);
    let proceedsEur = remaining.mul(effRate);
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
    this.record("dispose", event, { quantityFcy: remaining, rate: effRate, costBasisEur: proceedsEur, proceedsEur, gainLossEur: new Decimal(0), lotId: "UNKNOWN", note: "lotes insuficientes → ganancia FX = 0" });
  }

}
