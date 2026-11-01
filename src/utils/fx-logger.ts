/**
 * FX FIFO Logging and Visual Terminal Utilities (Capa 3).
 *
 * Provides ANSI colored terminal output for FX events, remaining/closed lot inspection,
 * and broker filtering. Works decoupled from the core mathematical engine via FxTraceListener.
 */

import type Decimal from "decimal.js";
import type { FxDisposal, FxLot, FxTraceEvent, FxTraceKind } from "../types/tax.js";

export let printFxDisposalsEnabled = true;
export let printFxLotsClosedEnabled = true;
export let printFxRemainingLotsEnabled = true;

export interface Colores {
  z: string; // Reset
  b: string; // Bold
  g: string; // Green
  y: string; // Yellow
  c: string; // Cyan
  w: string; // White
  r: string; // Red
  m: string; // Magenta
}

export const colores: Colores = {
  z: "\x1b[0m",
  b: "\x1b[1m",
  g: "\x1b[32m",
  y: "\x1b[33m",
  c: "\x1b[36m",
  w: "\x1b[37m",
  r: "\x1b[31m",
  m: "\x1b[35m",
};

export const colorEtiq: Record<string, string> = {
  FXAdd: colores.g,
  FXCons: colores.r,
  STKPark: colores.y,
  STKReAdd: colores.c,
  BUYSTK: colores.c,
  FXProfit: colores.g,
  FXLoss: colores.m,
  FXDiscard: colores.m,
};

/** Filter active brokers in console output. When empty `[]`, all brokers are logged. */
export const brokersPerm: string[] = [];

/** Format ISO date yyyy-mm-dd to dd/mm/yy for visual brevity. */
export function formatDateVisual(isoDate?: string | null): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

const cn = (valor: string | number, color: string = colores.g): string => `${color}${valor}${colores.z}`;

/** Maps an engine trace kind to a visual label and ANSI color. */
function mapKindToTag(kind: FxTraceKind): { tag: string; color: string } {
  switch (kind) {
    case "acquire":
      return { tag: "FXAdd", color: colorEtiq.FXAdd ?? colores.g };
    case "dispose":
      return { tag: "FXCons", color: colorEtiq.FXCons ?? colores.r };
    case "park":
      return { tag: "STKPark", color: colorEtiq.STKPark ?? colores.y };
    case "unpark":
      return { tag: "STKReAdd", color: colorEtiq.STKReAdd ?? colores.c };
    case "profit":
      return { tag: "FXProfit", color: colorEtiq.FXProfit ?? colores.g };
    case "discard":
      return { tag: "FXLoss", color: colorEtiq.FXLoss ?? colores.m };
    default:
      return { tag: kind, color: colores.w };
  }
}

/** Formats an FxTraceEvent into an ANSI colored single-line message. Returns null if filtered out. */
export function formatFxTraceEvent(ev: FxTraceEvent): string | null {
  if (brokersPerm.length > 0 && ev.brokerSource && !brokersPerm.includes(ev.brokerSource)) {
    return null;
  }

  const { tag, color } = mapKindToTag(ev.kind);
  let msg = `[${color}${tag}${colores.z}] `;

  if (ev.lotId) msg += `${ev.lotId} | `;
  if (ev.brokerSource) msg += `${ev.brokerSource} | `;
  if (ev.trigger) msg += `${colores.b}${ev.trigger.toUpperCase()}${colores.z} | `;
  if (ev.positionKey) msg += `${ev.positionKey} | `;
  if (ev.lotAcquireDate) msg += `FAdq:${cn(formatDateVisual(ev.lotAcquireDate))} | `;
  msg += `FTrans:${cn(formatDateVisual(ev.date))} | `;
  if (ev.quantityFcy) msg += `Cant: ${cn(Number(ev.quantityFcy).toFixed(2))} ${ev.currency} | `;
  if (ev.rate !== null && ev.rate !== undefined) msg += `Rate: ${cn(Number(ev.rate).toFixed(5))} | `;
  if (ev.costBasisEur !== undefined) msg += `CostEur: ${cn(Number(ev.costBasisEur).toFixed(2))} EUR | `;
  if (ev.proceedsEur !== undefined) msg += `ProcEur: ${cn(Number(ev.proceedsEur).toFixed(2))} EUR | `;
  if (ev.gainLossEur !== undefined) msg += `GainEur: ${cn(Number(ev.gainLossEur).toFixed(2))} EUR | `;
  msg += `PoolBal: ${cn(Number(ev.poolBalanceFcy).toFixed(2))} | `;
  if (Number(ev.parkedBalanceFcy) > 0) {
    msg += `ParkedBal: ${cn(Number(ev.parkedBalanceFcy).toFixed(2), colores.y)} | `;
  }
  if (ev.note) msg += `${ev.note} | `;

  return msg.trim().replace(/\s*\|\s*$/, "");
}

/** FxTraceListener consumer that logs formatted events to console. */
export function logFxTraceEvent(ev: FxTraceEvent): void {
  const line = formatFxTraceEvent(ev);
  if (line !== null) {
    console.log(line);
  }
}

/** Backward compatible logO parameter interface from original fork. */
export interface LogOperacionParams {
  etiqueta: string;
  colorEtiqueta?: string;
  lotId?: string;
  symbol?: string;
  brokerSource?: string;
  trigger?: string;
  FAdq?: string;
  FTrans?: string;
  quantity?: Decimal | number;
  moneda?: string;
  costInEur?: number | null;
  ratio?: Decimal | number | null;
  copyTXT?: string;
  colorNum?: string;
  costFcy?: Decimal | number;
  realEurAmount?: Decimal | number | null;
}

/** Original logO function preserved for direct/custom usage. */
export function logO({
  etiqueta,
  colorEtiqueta,
  lotId,
  symbol,
  brokerSource = "",
  trigger,
  FAdq,
  FTrans,
  quantity = undefined,
  costFcy = undefined,
  moneda = "USD",
  realEurAmount = null,
  ratio = null,
  copyTXT = "",
  colorNum = colores.g,
}: LogOperacionParams): void {
  if (brokersPerm.length > 0 && !brokersPerm.includes(brokerSource)) {
    return;
  }

  const { z, b: bold } = colores;
  const colorFinalEtiqueta = colorEtiqueta || colorEtiq[etiqueta] || colores.w;
  const cnLocal = (valor: string | number): string => `${colorNum}${valor}${z}`;

  let msg = `[${colorFinalEtiqueta}${etiqueta}${z}] `;

  const fAdqVisual = FAdq ? formatDateVisual(FAdq) : "";
  const fTransVisual = FTrans ? formatDateVisual(FTrans) : "";

  if (lotId) msg += `${lotId} | `;
  if (brokerSource) msg += `${brokerSource} | `;
  if (trigger) msg += `${bold}${trigger}${z} | `;
  if (symbol) msg += `${symbol.toUpperCase()} | `;
  if (fAdqVisual) msg += `FAdq:${cnLocal(fAdqVisual)} | `;
  if (fTransVisual) msg += `FTrans:${cnLocal(fTransVisual)} | `;
  if (quantity !== undefined) msg += `Cant: ${cnLocal(Number(quantity).toFixed(5))} ${moneda} | `;
  if (costFcy !== undefined) msg += `CostFcy: ${cnLocal(Number(costFcy).toFixed(3))} ${moneda} | `;
  if (realEurAmount !== null) msg += `CostEur: ${cnLocal(Number(realEurAmount).toFixed(3))} EUR | `;
  if (ratio !== null) msg += `Ratio: ${cnLocal(Number(ratio).toFixed(5))} `;
  if (copyTXT) msg += copyTXT;

  console.log(msg.trim().replace(/\s*\|\s*$/, ""));
}

/** Prints table of open lots remaining in the FX FIFO pool. */
export function printFxRemainingLots(remainingFxLots: Map<string, FxLot[]>): void {
  if (!printFxRemainingLotsEnabled) return;
  if (remainingFxLots.size > 0) {
    console.log("\n=== FX FIFO remaining lots ===");
    for (const [currency, lots] of remainingFxLots.entries()) {
      console.log(`--- ${currency} ---`);
      for (const lot of lots) {
        console.log(
          `${colores.g}${lot.id}${colores.z}` +
            ` | ${(lot as { trigger?: string }).trigger ?? ""}` +
            ` | Fadq${colores.g}=${formatDateVisual(lot.acquireDate)}${colores.z}` +
            ` | qty=${colores.g}${lot.quantity.toFixed(2)}${colores.z}` +
            ` | cost/Ud=${colores.g}${lot.costPerUnit.toFixed(6)}${colores.z}` +
            ` | costInEur=${colores.g}${lot.costInEur.toFixed(2)}${colores.z}` +
            (lot.brokerSource ? ` | broker=${lot.brokerSource}` : ""),
        );
      }
    }
  } else {
    console.log("\n=== FX FIFO remaining lots: none ===");
  }
}

/** Prints table of closed lots. */
export function printFxLotsClosed(fxClosedLots: Map<string, FxLot[]>): void {
  if (!printFxLotsClosedEnabled) return;
  if (fxClosedLots.size > 0) {
    console.log("\n=== FX FIFO closed lots ===");
    for (const [currency, lots] of fxClosedLots.entries()) {
      console.log(`--- ${currency} ---`);
      for (const lot of lots) {
        console.log(
          `lot ${colores.g}${lot.id}${colores.z}` +
            ` | Fadq${colores.g}=${formatDateVisual(lot.acquireDate)}${colores.z}` +
            ` | qty=${colores.g}${lot.quantity.toFixed(2)}${colores.z}` +
            ` | cost/Ud=${colores.g}${lot.costPerUnit.toFixed(6)}${colores.z}` +
            ` | costInEur=${colores.g}${lot.costInEur.toFixed(2)}${colores.z}` +
            (lot.brokerSource ? ` | broker=${lot.brokerSource}` : ""),
        );
      }
    }
  } else {
    console.log("\n=== FX FIFO closed lots: none ===");
  }
}

/** Prints all generated FX disposals. */
export function printFxDisposals(allFxDisposals: FxDisposal[]): void {
  if (!printFxDisposalsEnabled) return;
  if (allFxDisposals.length > 0) {
    console.log("\n=== FX FIFO all disposals ===");
    for (const d of allFxDisposals) {
      console.log(
        `${colores.g}${d.lotId}${colores.z}` +
          ` | ${d.currency}` +
          ` | ${d.trigger}` +
          ` | FAdq=${formatDateVisual(d.acquireDate)}` +
          ` | FDisp=${formatDateVisual(d.disposeDate)}` +
          ` | qty=${colores.g}${d.quantity.toFixed(2)}${colores.z}` +
          ` | costEur=${colores.g}${d.costBasisEur.toFixed(2)}${colores.z}` +
          ` | proceedsEur=${colores.g}${d.proceedsEur.toFixed(2)}${colores.z}` +
          ` | gainEur=${colores.g}${d.gainLossEur.toFixed(2)}${colores.z}` +
          (d.brokerSource ? ` | broker=${d.brokerSource}` : ""),
      );
    }
  } else {
    console.log("\n=== FX FIFO all disposals: none ===");
  }
}
