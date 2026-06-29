//ARCHIVO DE UTILIDADES PARA LOGGING DE OPERACIONES EN EL MOTOR FX FIFO
//JMG. FORKED FROM THE OFFICIAL VERSION
// Utilidad separada de la versión oficial


import Decimal from "decimal.js";
import type { FxDisposal, FxLot } from "../types/tax.js";

export let printFxDisposalsEnabled = true; // Controla si se imprimen todos los FX disposals
export let printFxLotsClosedEnabled = true; // Controla si se imprimen todos los FX disposals
export let printFxRemainingLotsEnabled = true; // Controla si se imprimen los lotes restantes de FX FIFO

export interface Colores {
  z: string; // Reset color
  b: string; // Bold
  g: string; // Green
  y: string; // Yellow
  c: string; // cyan
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
  m: "\x1b[35m"
};

// 1. ESTRUCTURA DE PARES: Nombre de Etiqueta -> Color Ansi
// Aquí puedes centralizar y cambiar los colores de tus etiquetas fácilmente
export const colorEtiq: Record<string, string> = {
  FXAdd: colores.g,
  FXCons: colores.r,
  STKPark: colores.y,
  BUYSTK: colores.c,

};

// Lista de elementos permitidos si está vacío [] los admite todos.
export const brokersPerm: string[] = []; //["Binance", "IBKR", "LY"]; // Ejemplo de cómo filtrar por brokers específicos

export interface LogOperacionParams {
  etiqueta: string;
  colorEtiqueta?: string; // Sigue sirviendo por si quieres forzar un color manual en un log específico
  lotId?: string;
  symbol?: string;
  brokerSource?: string;
  trigger?: string;
  FAdq?: string;
  FTrans?: string;
  quantity?: Decimal;
  moneda?: string;
  costInEur?: number | null;
  ratio?: Decimal | null;
  copyTXT?: string;
  colorNum?: string;
  costFcy?: Decimal;
  realEurAmount?: Decimal | null;
}

export function printFxRemainingLots(remainingFxLots: Map<string, FxLot[]>): void {
  if (!printFxRemainingLotsEnabled) return;
  if (remainingFxLots.size > 0) {
    console.log("\n=== FX FIFO remaining lots ===");
    for (const [currency, lots] of remainingFxLots.entries()) {
      console.log(`--- ${currency} ---`);
      for (const lot of lots) {
        console.log(
          `${colores.g}${lot.id}${colores.z}` +
          ` | ${lot.trigger}` +
          ` | Fadq${colores.g}=${date(lot.acquireDate)}${colores.z}` +
          ` | qty=${colores.g}${lot.quantity.toFixed(2)}${colores.z}` +
          ` | cost/Ud=${colores.g}${lot.costPerUnit.toFixed(6)}${colores.z}` +
          ` | costInEur=${colores.g}${lot.costInEur.toFixed(2)}${colores.z}` +
          (lot.brokerSource ? ` | broker=${lot.brokerSource}` : "")
        );
      }
    }
  } else {
    console.log("\n=== FX FIFO remaining lots: none ===");
  }
}
export function printFxLotsClosed(FxClosedLots: Map<string, FxLot[]>): void {
  if (!printFxLotsClosedEnabled) return;
  if (FxClosedLots.size > 0) {
    console.log("\n=== FX FIFO closed lots ===");
    for (const [currency, lots] of FxClosedLots.entries()) {
      console.log(`--- ${currency} ---`);
      for (const lot of lots) {
        console.log(
          `lot ${colores.g}${lot.id}${colores.z}` +
          ` | Fadq${colores.g}=${date(lot.acquireDate)}${colores.z}` +
          ` | qty=${colores.g}${lot.quantity.toFixed(2)}${colores.z}` +
          ` | cost/Ud=${colores.g}${lot.costPerUnit.toFixed(6)}${colores.z}` +
          ` | costInEur=${colores.g}${lot.costInEur.toFixed(2)}${colores.z}` +
          (lot.brokerSource ? ` | broker=${lot.brokerSource}` : "")
        );
      }
    }
  } else {
    console.log("\n=== FX FIFO closed lots: none ===");
  }
}
export function printFxDisposals(allFxDisposals: FxDisposal[]): void {
  if (!printFxDisposalsEnabled) return;
  if (allFxDisposals.length > 0) {
    console.log("\n=== FX FIFO all disposals ===");
    for (const d of allFxDisposals) {
      console.log(
        `${colores.g}${d.lotId}${colores.z}` +
        ` | ${d.currency}` +
        ` | ${d.trigger}` +
        ` | FAdq=${date(d.acquireDate)}` +
        ` | FDisp=${date(d.disposeDate)}` +
        ` | qty=${colores.g}${d.quantity.toFixed(2)}${colores.z}` +
        ` | costEur=${colores.g}${d.costBasisEur.toFixed(2)}${colores.z}` +
        ` | proceedsEur=${colores.g}${d.proceedsEur.toFixed(2)}${colores.z}` +
        ` | gainEur=${colores.g}${d.gainLossEur.toFixed(2)}${colores.z}` +
        (d.brokerSource ? ` | broker=${d.brokerSource}` : "")
      );
    }
  } else {
    console.log("\n=== FX FIFO all disposals: none ===");
  }
}

export function logO({
  etiqueta,
  colorEtiqueta,
  lotId,
  symbol,
  brokerSource: brokerSource = "",
  trigger,
  FAdq: FAdq,
  FTrans: FTrans,

  quantity = undefined,
  costFcy = undefined,
  moneda = "USD",
  realEurAmount = null,
  ratio = null,
  copyTXT = "",
  colorNum = colores.g
}: LogOperacionParams): void {
  // Filtro de brokers
  if (brokersPerm.length > 0 && !brokersPerm.includes(brokerSource)) {
    return;
  }

  const { z: z, b: bold } = colores;

  // 2. ASIGNACIÓN AUTOMÁTICA DE COLOR:
  // Prioridad: 1. El color que pases por parámetro / 2. El color de la estructura de pares / 3. Blanco por defecto
  const colorFinalEtiqueta = colorEtiqueta || colorEtiq[etiqueta] || colores.w;

  const cn = (valor: string | number): string => `${colorNum}${valor}${z}`;

  // Usamos colorFinalEtiqueta para pintar la etiqueta
  let msg = `[${colorFinalEtiqueta}${etiqueta}${z}] `;

  FAdq = FAdq ? date(FAdq) : "";
  FTrans = FTrans ? date(FTrans) : "";

  if (lotId) msg += `${lotId} | `;
  if (brokerSource) msg += `${brokerSource} | `;
  if (trigger) msg += `${bold}${trigger}${z} | `;
  if (symbol) msg += `${symbol.toUpperCase()} | `;
  if (FAdq) msg += `FAdq:${cn(FAdq)} | `;
  if (FTrans) msg += `FTrans:${cn(FTrans)} | `;
  if (quantity !== undefined) msg += `Cant: ${cn(Number(quantity).toFixed(5))} ${moneda} | `;
  if (costFcy !== undefined) msg += `CostFcy: ${cn(Number(costFcy).toFixed(3))} ${moneda} | `;
  if (realEurAmount !== null) msg += `CostEur: ${cn(realEurAmount.toFixed(3))} EUR | `;
  if (ratio !== null) msg += `Ratio: ${cn(ratio.toFixed(5))} `;
  if (copyTXT) msg += copyTXT;

  console.log(msg.trim());
}
function date(string: string): string {
  const d = new Date(string);
  const dFmat: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  };
  return d.toLocaleDateString("es-ES", dFmat)
}
