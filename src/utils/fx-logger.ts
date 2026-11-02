/**
 * FX FIFO Logging and Visual Terminal Utilities (Capa 3).
 *
 * Provides ANSI colored terminal output for FX events, remaining/closed lot inspection,
 * and broker filtering. Works decoupled from the core mathematical engine via FxTraceListener.
 */

import Decimal from "decimal.js";
import type { FxDisposal, FxLot, FxTraceEvent, FxTraceKind } from "../types/tax.js";

export let printFxDisposalsEnabled = true;
export let printFxLotsClosedEnabled = true;
export let printFxRemainingLotsEnabled = true;
export let printFxLotsOverviewEnabled = true;

export interface Colores {
  z: string; // Reset
  b: string; // Bold
  d: string; // Dim
  g: string; // Green
  y: string; // Yellow
  c: string; // Cyan
  w: string; // White
  r: string; // Red
  m: string; // Magenta
  gray: string; // Dark Gray (Separators)
}

export const colores: Colores = {
  z: "\x1b[0m",
  b: "\x1b[1m",
  d: "\x1b[2m",
  g: "\x1b[32m",
  y: "\x1b[33m",
  c: "\x1b[36m",
  w: "\x1b[37m",
  r: "\x1b[31m",
  m: "\x1b[35m",
  gray: "\x1b[90m",
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

/**
 * Known broker aliases for FX logging display and filtering:
 * - "Interactive Brokers" / "ibkr" -> "IBKR"
 * - "Lightyear" / "Light Year" / "ly" -> "LY"
 */
export const BROKER_ALIASES: Record<string, string> = {
  "interactive brokers": "IBKR",
  ibkr: "IBKR",
  lightyear: "LY",
  "light year": "LY",
  ly: "LY",
};

/** Metadata for security identification (symbol and description). */
export interface SecurityMeta {
  symbol?: string;
  description?: string;
}

const securityRegistry = new Map<string, SecurityMeta>();

/**
 * Registers asset descriptions and symbols by ISIN or ticker symbol for visual display in FX trace logs.
 * Accepts an array/iterable of items, or a container like FlexStatement ({ trades, securitiesInfo, openPositions }).
 */
export function registerSecurityInfo(
  source:
    | Iterable<{ isin?: string; symbol?: string; description?: string }>
    | {
        trades?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
        securitiesInfo?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
        openPositions?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
      }
): void {
  if (!source) return;

  const registerItem = (item: { isin?: string; symbol?: string; description?: string }) => {
    const symbol = item.symbol?.trim();
    const description = item.description?.trim();
    const isin = item.isin?.trim();

    if (isin) {
      const existing = securityRegistry.get(isin.toUpperCase());
      securityRegistry.set(isin.toUpperCase(), {
        symbol: symbol || existing?.symbol,
        description: description || existing?.description,
      });
    }
    if (symbol) {
      const existing = securityRegistry.get(symbol.toUpperCase());
      securityRegistry.set(symbol.toUpperCase(), {
        symbol: symbol,
        description: description || existing?.description,
      });
    }
  };

  if (Symbol.iterator in Object(source)) {
    for (const item of source as Iterable<{ isin?: string; symbol?: string; description?: string }>) {
      registerItem(item);
    }
  } else {
    const s = source as {
      trades?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
      securitiesInfo?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
      openPositions?: Iterable<{ isin?: string; symbol?: string; description?: string }>;
    };
    if (s.trades) for (const item of s.trades) registerItem(item);
    if (s.securitiesInfo) for (const item of s.securitiesInfo) registerItem(item);
    if (s.openPositions) for (const item of s.openPositions) registerItem(item);
  }
}

/** Clears registered security descriptions. */
export function resetSecurityDescriptions(): void {
  securityRegistry.clear();
}

/**
 * Returns formatted security info (e.g. "INTC · INTEL CORP" or "INTEL CORP") for an ISIN or symbol key.
 */
export function getSecurityDescription(key?: string | null): string | undefined {
  if (!key) return undefined;
  const meta = securityRegistry.get(key.trim().toUpperCase());
  if (!meta) return undefined;

  const parts: string[] = [];
  const keyUpper = key.trim().toUpperCase();
  if (meta.symbol && meta.symbol.toUpperCase() !== keyUpper) {
    parts.push(meta.symbol.toUpperCase());
  }
  if (meta.description) {
    const descUpper = meta.description.toUpperCase();
    if (descUpper !== keyUpper && (!meta.symbol || descUpper !== meta.symbol.toUpperCase())) {
      parts.push(meta.description);
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

/**
 * Returns the short/aliased display name for a broker in FX logs.
 * Specifically converts "Interactive Brokers" to "IBKR", and "Lightyear" / "Light Year" to "LY".
 */
export function formatBrokerAlias(broker?: string | null): string {
  if (!broker) return "";
  const key = broker.trim().toLowerCase();
  return BROKER_ALIASES[key] ?? broker;
}

/** Filter active brokers in console output. When empty `[]`, all brokers are logged. */
export const brokersPerm: string[] = [];

/**
 * Checks whether a broker matches the active brokersPerm filter list,
 * taking aliases into account (e.g. filter "IBKR" matches "Interactive Brokers",
 * filter "LY" matches "Lightyear" and vice versa).
 */
export function isBrokerPermitted(brokerSource?: string | null): boolean {
  if (brokersPerm.length === 0) return true;
  if (!brokerSource) return false;

  const targetAlias = formatBrokerAlias(brokerSource).toLowerCase();
  const targetRaw = brokerSource.trim().toLowerCase();

  return brokersPerm.some((filterEntry) => {
    const filterAlias = formatBrokerAlias(filterEntry).toLowerCase();
    const filterRaw = filterEntry.trim().toLowerCase();
    return (
      filterAlias === targetAlias ||
      filterRaw === targetRaw ||
      filterRaw === targetAlias ||
      filterAlias === targetRaw
    );
  });
}

/** Strips ANSI escape sequences to compute true visible character length for alignment. */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pads end of string taking into account hidden ANSI escape sequences. */
export function padEndVisible(str: string, targetWidth: number): string {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen >= targetWidth) return str;
  return str + " ".repeat(targetWidth - visibleLen);
}

/** Pads start of string taking into account hidden ANSI escape sequences. */
export function padStartVisible(str: string, targetWidth: number): string {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen >= targetWidth) return str;
  return " ".repeat(targetWidth - visibleLen) + str;
}

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

/** Prints a tabular header for the real-time event trace. */
export function printFxTraceHeader(): void {
  const sep = `${colores.gray}│${colores.z}`;
  const hTag = padEndVisible("TIPO", 10);
  const hLot = padEndVisible("LOTE", 8);
  const hBroker = padEndVisible("BROKER", 10);
  const hMotivo = padEndVisible("MOTIVO", 16);
  const hAdq = padEndVisible("F.ADQ", 8);
  const hTrans = padEndVisible("F.OP", 8);
  const hCant = padStartVisible("CANTIDAD", 15);
  const hRate = padEndVisible("TIPO CAMBIO", 13);
  const hGain = padEndVisible("GAINEUR (RESULTADO)", 20);
  const hBal = "SALDO POOL";

  const header = `${colores.b}${hTag} ${sep} ${hLot} ${sep} ${hBroker} ${sep} ${hMotivo} ${sep} ${hAdq} ${sep} ${hTrans} ${sep} ${hCant} ${sep} ${hRate} ${sep} ${hGain} ${sep} ${hBal}${colores.z}`;
  const border = `${colores.gray}${stripAnsi(header).replace(/[^│]/g, "─").replace(/│/g, "┼")}${colores.z}`;
  console.log(`\n${header}\n${border}`);
}

/** Formats an FxTraceEvent into an ANSI colored, columnar aligned single-line message. */
export function formatFxTraceEvent(ev: FxTraceEvent): string | null {
  if (!isBrokerPermitted(ev.brokerSource)) {
    return null;
  }

  const { tag, color } = mapKindToTag(ev.kind);
  const sep = `${colores.gray}│${colores.z}`;

  // 1. Tag (width 10)
  const tagStr = `[${color}${tag}${colores.z}]`;
  const tagPadded = padEndVisible(tagStr, 10);

  // 2. Lot ID (width 8)
  const lotStr = ev.lotId ? `${colores.b}${ev.lotId}${colores.z}` : `${colores.gray}—${colores.z}`;
  const lotPadded = padEndVisible(lotStr, 8);

  // 3. Broker with alias formatting (width 10)
  const brokerDisplay = ev.brokerSource ? formatBrokerAlias(ev.brokerSource) : `${colores.gray}—${colores.z}`;
  const brokerPadded = padEndVisible(brokerDisplay, 10);

  // 4. Motivo / Trigger (width 16)
  const motivo = ev.trigger ? ev.trigger.toUpperCase() : "—";
  const motivoPadded = padEndVisible(motivo, 16);

  // 5 & 6. Fechas (F.Adq y F.Trans / F.Op)
  const fAdq = ev.lotAcquireDate ? formatDateVisual(ev.lotAcquireDate) : `${colores.gray}—${colores.z}`;
  const fAdqPadded = padEndVisible(fAdq, 8);
  const fTrans = formatDateVisual(ev.date);
  const fTransPadded = padEndVisible(fTrans, 8);

  // 7. Cantidad con signo (+ / -) y divisa (width 15, right aligned)
  let cantFormatted = "—";
  if (ev.quantityFcy) {
    const qNum = Number(ev.quantityFcy);
    const isIncome = ev.kind === "acquire" || ev.kind === "unpark" || ev.kind === "profit";
    const sign = isIncome ? "+" : "-";
    const qColor = isIncome ? colores.g : colores.r;
    cantFormatted = `${qColor}${sign}${qNum.toFixed(2)} ${ev.currency}${colores.z}`;
  }
  const cantPadded = padStartVisible(cantFormatted, 15);

  // 8. Tipo / Rate (width 13)
  let rateFormatted = `${colores.gray}—${colores.z}`;
  if (ev.rate !== null && ev.rate !== undefined) {
    rateFormatted = `@ ${cn(Number(ev.rate).toFixed(5), colores.c)}`;
  }
  const ratePadded = padEndVisible(rateFormatted, 13);

  // 9. Ganancia EUR / GainEur (width 20)
  let gainFormatted = `${colores.gray}—${colores.z}`;
  if (ev.gainLossEur !== undefined) {
    const gNum = Number(ev.gainLossEur);
    const sign = gNum > 0 ? "+" : gNum < 0 ? "-" : "";
    const gColor = gNum > 0 ? colores.g : gNum < 0 ? colores.r : colores.w;
    gainFormatted = `GainEur: ${gColor}${sign}${Math.abs(gNum).toFixed(2)} €${colores.z}`;
  }
  const gainPadded = padEndVisible(gainFormatted, 20);

  // 10. Saldo Pool y Parked
  const poolNum = Number(ev.poolBalanceFcy);
  let balFormatted = `PoolBal: ${cn(poolNum.toFixed(2), colores.w)}`;
  const parkedNum = Number(ev.parkedBalanceFcy);
  if (parkedNum > 0) {
    balFormatted += ` ${sep} Parked: ${cn(parkedNum.toFixed(2), colores.y)}`;
  }

  // 11. Posición (ISIN / símbolo) y descripción si existe
  let posStr = "";
  if (ev.positionKey) {
    const desc = getSecurityDescription(ev.positionKey);
    const posDisplay = desc
      ? `${colores.c}${ev.positionKey}${colores.z} ${colores.d}(${desc})${colores.z}`
      : `${colores.c}${ev.positionKey}${colores.z}`;
    posStr = ` ${sep} ${posDisplay}`;
  }

  // 12. Nota si existe
  const noteStr = ev.note ? ` ${sep} ${colores.d}${ev.note}${colores.z}` : "";

  return `${tagPadded} ${sep} ${lotPadded} ${sep} ${brokerPadded} ${sep} ${motivoPadded} ${sep} ${fAdqPadded} ${sep} ${fTransPadded} ${sep} ${cantPadded} ${sep} ${ratePadded} ${sep} ${gainPadded} ${sep} ${balFormatted}${posStr}${noteStr}`;
}

/** FxTraceListener consumer that logs formatted events to console. */
export function logFxTraceEvent(ev: FxTraceEvent): void {
  trackFxLotEvent(ev);
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
  if (!isBrokerPermitted(brokerSource)) {
    return;
  }

  const { z, b: bold } = colores;
  const colorFinalEtiqueta = colorEtiqueta || colorEtiq[etiqueta] || colores.w;
  const cnLocal = (valor: string | number): string => `${colorNum}${valor}${z}`;

  let msg = `[${colorFinalEtiqueta}${etiqueta}${z}] `;

  const fAdqVisual = FAdq ? formatDateVisual(FAdq) : "";
  const fTransVisual = FTrans ? formatDateVisual(FTrans) : "";

  if (lotId) msg += `${lotId} | `;
  const brokerDisplay = brokerSource ? formatBrokerAlias(brokerSource) : "";
  if (brokerDisplay) msg += `${brokerDisplay} | `;
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

/** Prints an aligned table of open lots remaining in the FX FIFO pool. */
export function printFxRemainingLots(remainingFxLots: Map<string, FxLot[]>): void {
  if (!printFxRemainingLotsEnabled) return;
  const sep = `${colores.gray}│${colores.z}`;
  let totalLots = 0;
  for (const lots of remainingFxLots.values()) {
    for (const lot of lots) {
      if (isBrokerPermitted(lot.brokerSource)) totalLots++;
    }
  }

  if (totalLots > 0) {
    console.log(`\n${colores.b}=== LOTES FX REMANENTES EN EL POOL (${totalLots} abiertos) ===${colores.z}`);
    const hLot = padEndVisible("LOTE", 8);
    const hDiv = padEndVisible("DIV", 5);
    const hTrig = padEndVisible("ORIGEN", 14);
    const hAdq = padEndVisible("F.ADQ", 8);
    const hCant = padStartVisible("CANTIDAD FCY", 14);
    const hCostUd = padStartVisible("COSTE / UD", 12);
    const hCostEur = padStartVisible("COSTE EUR", 12);
    const hBroker = "BROKER";

    const header = `${colores.b}${hLot} ${sep} ${hDiv} ${sep} ${hTrig} ${sep} ${hAdq} ${sep} ${hCant} ${sep} ${hCostUd} ${sep} ${hCostEur} ${sep} ${hBroker}${colores.z}`;
    const border = `${colores.gray}${stripAnsi(header).replace(/[^│]/g, "─").replace(/│/g, "┼")}${colores.z}`;
    console.log(header);
    console.log(border);

    for (const [currency, lots] of remainingFxLots.entries()) {
      for (const lot of lots) {
        if (!isBrokerPermitted(lot.brokerSource)) continue;
        const lotIdStr = padEndVisible(`${colores.g}${lot.id}${colores.z}`, 8);
        const divStr = padEndVisible(currency, 5);
        const trig = (lot as { trigger?: string }).trigger ?? "—";
        const trigStr = padEndVisible(trig, 14);
        const adqStr = padEndVisible(formatDateVisual(lot.acquireDate), 8);
        const cantStr = padStartVisible(Number(lot.quantity).toFixed(2), 14);
        const costUdStr = padStartVisible(Number(lot.costPerUnit).toFixed(6), 12);
        const costEurStr = padStartVisible(`${Number(lot.costInEur).toFixed(2)} €`, 12);
        const brokerStr = lot.brokerSource ? formatBrokerAlias(lot.brokerSource) : "—";
        console.log(`${lotIdStr} ${sep} ${divStr} ${sep} ${trigStr} ${sep} ${adqStr} ${sep} ${cantStr} ${sep} ${costUdStr} ${sep} ${costEurStr} ${sep} ${brokerStr}`);
      }
    }
  } else {
    console.log(`\n${colores.b}=== LOTES FX REMANENTES EN EL POOL: Ninguno (0 lotes) ===${colores.z}`);
  }
}

/** Prints an aligned table of closed lots. */
export function printFxLotsClosed(fxClosedLots: Map<string, FxLot[]>): void {
  if (!printFxLotsClosedEnabled) return;
  const sep = `${colores.gray}│${colores.z}`;
  let totalLots = 0;
  for (const lots of fxClosedLots.values()) {
    for (const lot of lots) {
      if (isBrokerPermitted(lot.brokerSource)) totalLots++;
    }
  }

  if (totalLots > 0) {
    console.log(`\n${colores.b}=== LOTES FX CERRADOS (${totalLots} cerrados) ===${colores.z}`);
    const hLot = padEndVisible("LOTE", 8);
    const hDiv = padEndVisible("DIV", 5);
    const hTrig = padEndVisible("ORIGEN", 14);
    const hAdq = padEndVisible("F.ADQ", 8);
    const hCant = padStartVisible("CANTIDAD FCY", 14);
    const hCostUd = padStartVisible("COSTE / UD", 12);
    const hCostEur = padStartVisible("COSTE EUR", 12);
    const hBroker = "BROKER";

    const header = `${colores.b}${hLot} ${sep} ${hDiv} ${sep} ${hTrig} ${sep} ${hAdq} ${sep} ${hCant} ${sep} ${hCostUd} ${sep} ${hCostEur} ${sep} ${hBroker}${colores.z}`;
    const border = `${colores.gray}${stripAnsi(header).replace(/[^│]/g, "─").replace(/│/g, "┼")}${colores.z}`;
    console.log(header);
    console.log(border);

    for (const [currency, lots] of fxClosedLots.entries()) {
      for (const lot of lots) {
        if (!isBrokerPermitted(lot.brokerSource)) continue;
        const lotIdStr = padEndVisible(`${colores.g}${lot.id}${colores.z}`, 8);
        const divStr = padEndVisible(currency, 5);
        const trig = (lot as { trigger?: string }).trigger ?? "—";
        const trigStr = padEndVisible(trig, 14);
        const adqStr = padEndVisible(formatDateVisual(lot.acquireDate), 8);
        const cantStr = padStartVisible(Number(lot.quantity).toFixed(2), 14);
        const costUdStr = padStartVisible(Number(lot.costPerUnit).toFixed(6), 12);
        const costEurStr = padStartVisible(`${Number(lot.costInEur).toFixed(2)} €`, 12);
        const brokerStr = lot.brokerSource ? formatBrokerAlias(lot.brokerSource) : "—";
        console.log(`${lotIdStr} ${sep} ${divStr} ${sep} ${trigStr} ${sep} ${adqStr} ${sep} ${cantStr} ${sep} ${costUdStr} ${sep} ${costEurStr} ${sep} ${brokerStr}`);
      }
    }
  } else {
    console.log(`\n${colores.b}=== LOTES FX CERRADOS: Ninguno (0 lotes) ===${colores.z}`);
  }
}

/** Prints an aligned table of all generated FX disposals. */
export function printFxDisposals(allFxDisposals: FxDisposal[]): void {
  if (!printFxDisposalsEnabled) return;
  const sep = `${colores.gray}│${colores.z}`;
  const filteredDisposals = allFxDisposals.filter((d) => isBrokerPermitted(d.brokerSource));

  if (filteredDisposals.length > 0) {
    console.log(`\n${colores.b}=== ENAJENACIONES DE DIVISA / FX DISPOSALS (${filteredDisposals.length} operaciones) ===${colores.z}`);
    const hLot = padEndVisible("LOTE", 8);
    const hDiv = padEndVisible("DIV", 5);
    const hTrig = padEndVisible("MOTIVO", 14);
    const hAdq = padEndVisible("F.ADQ", 8);
    const hDisp = padEndVisible("F.DISP", 8);
    const hCant = padStartVisible("CANTIDAD FCY", 14);
    const hCost = padStartVisible("COSTE EUR", 12);
    const hProc = padStartVisible("INGRESOS EUR", 12);
    const hGain = padStartVisible("GANANCIA EUR", 14);
    const hBroker = "BROKER";

    const header = `${colores.b}${hLot} ${sep} ${hDiv} ${sep} ${hTrig} ${sep} ${hAdq} ${sep} ${hDisp} ${sep} ${hCant} ${sep} ${hCost} ${sep} ${hProc} ${sep} ${hGain} ${sep} ${hBroker}${colores.z}`;
    const border = `${colores.gray}${stripAnsi(header).replace(/[^│]/g, "─").replace(/│/g, "┼")}${colores.z}`;
    console.log(header);
    console.log(border);

    let totalGain = new Decimal(0);
    for (const d of filteredDisposals) {
      const gNum = Number(d.gainLossEur);
      totalGain = totalGain.plus(d.gainLossEur);
      const sign = gNum > 0 ? "+" : gNum < 0 ? "-" : "";
      const gColor = gNum > 0 ? colores.g : gNum < 0 ? colores.r : colores.w;
      const gainText = `${gColor}${sign}${Math.abs(gNum).toFixed(2)} €${colores.z}`;

      const lotIdStr = padEndVisible(`${colores.g}${d.lotId}${colores.z}`, 8);
      const divStr = padEndVisible(d.currency, 5);
      const trigStr = padEndVisible(d.trigger ?? "—", 14);
      const adqStr = padEndVisible(formatDateVisual(d.acquireDate), 8);
      const dispStr = padEndVisible(formatDateVisual(d.disposeDate), 8);
      const cantStr = padStartVisible(Number(d.quantity).toFixed(2), 14);
      const costStr = padStartVisible(`${Number(d.costBasisEur).toFixed(2)} €`, 12);
      const procStr = padStartVisible(`${Number(d.proceedsEur).toFixed(2)} €`, 12);
      const gainStr = padStartVisible(gainText, 14);
      const brokerStr = d.brokerSource ? formatBrokerAlias(d.brokerSource) : "—";

      console.log(`${lotIdStr} ${sep} ${divStr} ${sep} ${trigStr} ${sep} ${adqStr} ${sep} ${dispStr} ${sep} ${cantStr} ${sep} ${costStr} ${sep} ${procStr} ${sep} ${gainStr} ${sep} ${brokerStr}`);
    }
    const totalGNum = totalGain.toNumber();
    const totSign = totalGNum > 0 ? "+" : totalGNum < 0 ? "-" : "";
    const totColor = totalGNum > 0 ? colores.g : totalGNum < 0 ? colores.r : colores.w;
    console.log(`${colores.gray}${"─".repeat(stripAnsi(header).length)}${colores.z}`);
    console.log(`TOTAL RESULTADO NETO FX: ${totColor}${colores.b}${totSign}${Math.abs(totalGNum).toFixed(2)} EUR${colores.z}\n`);
  } else {
    console.log(`\n${colores.b}=== ENAJENACIONES DE DIVISA / FX DISPOSALS: Ninguna (0) ===${colores.z}`);
  }
}

/** Detailed status and tracking information for an FX lot. */
export interface FxLotStatus {
  id: string;
  currency: string;
  acquireDate?: string | null;
  isOpen?: boolean;
  remainingQuantity?: Decimal | number;
  originalQuantity?: Decimal | number;
  parkedQuantity?: Decimal | number;
  costPerUnit?: Decimal | number;
  costInEur?: Decimal | number;
  brokerSource?: string | null;
  trigger?: string | null;
}

export type FxLotsInput =
  | FxLotStatus[]
  | Map<string, FxLotStatus[]>
  | Map<string, FxLot[]>
  | FxLot[];

/** Internal registry of lots tracked across real-time trace events. */
export const trackedFxLots: Map<string, FxLotStatus> = new Map();

/** Clears all tracked lots in the internal registry. */
export function resetFxLotTracker(): void {
  trackedFxLots.clear();
}

/** Returns an array of all currently tracked lots in registration order. */
export function getTrackedFxLots(): FxLotStatus[] {
  return Array.from(trackedFxLots.values());
}

/**
 * Updates the internal lot tracker with movements from an FxTraceEvent.
 * Tracks creation (originalQuantity), parking, unparking, disposals, and remaining balances.
 */
export function trackFxLotEvent(ev: FxTraceEvent): void {
  const EPS = 1e-9;
  const qty = ev.quantityFcy ? new Decimal(ev.quantityFcy) : new Decimal(0);

  // 1. Lot creation in pool: acquire, profit, or unpark re-add
  if (ev.lotId && !trackedFxLots.has(ev.lotId) && (ev.kind === "acquire" || ev.kind === "profit" || ev.kind === "unpark")) {
    trackedFxLots.set(ev.lotId, {
      id: ev.lotId,
      currency: ev.currency,
      acquireDate: ev.lotAcquireDate || ev.date,
      originalQuantity: qty,
      remainingQuantity: qty,
      parkedQuantity: new Decimal(0),
      costPerUnit: ev.rate !== null && ev.rate !== undefined ? new Decimal(ev.rate) : undefined,
      brokerSource: ev.brokerSource,
      trigger: ev.trigger,
      isOpen: true,
    });
  }

  // 2. Park: consumes spent FCY from pool lot and parks it under the open position
  if (ev.kind === "park" && ev.lotId && trackedFxLots.has(ev.lotId)) {
    const lot = trackedFxLots.get(ev.lotId)!;
    const rem = new Decimal(lot.remainingQuantity ?? 0);
    const consumed = Decimal.min(rem, qty);
    lot.remainingQuantity = Decimal.max(0, rem.minus(consumed));
    lot.parkedQuantity = new Decimal(lot.parkedQuantity ?? 0).plus(consumed);
    lot.isOpen = new Decimal(lot.remainingQuantity).greaterThan(EPS) || new Decimal(lot.parkedQuantity).greaterThan(EPS);
  }

  // 3. Unpark: reduces parked balance on oldest parked lots of this currency
  if (ev.kind === "unpark") {
    let toUnpark = qty;
    for (const lot of trackedFxLots.values()) {
      if (lot.currency === ev.currency && new Decimal(lot.parkedQuantity ?? 0).greaterThan(EPS)) {
        const currentParked = new Decimal(lot.parkedQuantity ?? 0);
        const unparkFromLot = Decimal.min(toUnpark, currentParked);
        lot.parkedQuantity = currentParked.minus(unparkFromLot);
        toUnpark = toUnpark.minus(unparkFromLot);
        lot.isOpen = new Decimal(lot.remainingQuantity ?? 0).greaterThan(EPS) || new Decimal(lot.parkedQuantity ?? 0).greaterThan(EPS);
        if (toUnpark.lessThanOrEqualTo(EPS)) break;
      }
    }
  }

  // 4. Discard: stock loss drops parked principal without returning
  if (ev.kind === "discard") {
    let toDiscard = qty;
    for (const lot of trackedFxLots.values()) {
      if (lot.currency === ev.currency && new Decimal(lot.parkedQuantity ?? 0).greaterThan(EPS)) {
        const currentParked = new Decimal(lot.parkedQuantity ?? 0);
        const discardFromLot = Decimal.min(toDiscard, currentParked);
        lot.parkedQuantity = currentParked.minus(discardFromLot);
        toDiscard = toDiscard.minus(discardFromLot);
        lot.isOpen = new Decimal(lot.remainingQuantity ?? 0).greaterThan(EPS) || new Decimal(lot.parkedQuantity ?? 0).greaterThan(EPS);
        if (toDiscard.lessThanOrEqualTo(EPS)) break;
      }
    }
  }

  // 5. Dispose: conversion or fee consumes FCY from pool lot
  if (ev.kind === "dispose" && ev.lotId && trackedFxLots.has(ev.lotId)) {
    const lot = trackedFxLots.get(ev.lotId)!;
    const rem = new Decimal(lot.remainingQuantity ?? 0);
    lot.remainingQuantity = Decimal.max(0, rem.minus(qty));
    lot.isOpen = new Decimal(lot.remainingQuantity).greaterThan(EPS) || new Decimal(lot.parkedQuantity ?? 0).greaterThan(EPS);
  }
}

/**
 * Prints an aligned, colored ledger table of FX lots showing:
 * - Total number of open and closed lots.
 * - For each lot: status (ABIERTO / CERRADO), remaining quantity, original quantity, and parked quantity.
 * - Currency breakdown and active balance totals.
 */
export function printFxLotsOverview(inputLots?: FxLotsInput): void {
  if (!printFxLotsOverviewEnabled) return;

  let lots: FxLotStatus[] = [];
  if (!inputLots) {
    lots = getTrackedFxLots();
  } else if (Array.isArray(inputLots)) {
    lots = inputLots as FxLotStatus[];
  } else if (inputLots instanceof Map) {
    for (const lotList of inputLots.values()) {
      lots.push(...(lotList as FxLotStatus[]));
    }
  }

  // Apply broker filtering
  const filtered = lots.filter((l) => isBrokerPermitted(l.brokerSource));

  const totalLots = filtered.length;
  if (totalLots === 0) {
    console.log(`\n${colores.b}=== ESTADO DE LOTES FX: Ninguno (0 lotes) ===${colores.z}`);
    return;
  }

  const EPS = 1e-9;
  const normalized = filtered.map((l) => {
    const orig = new Decimal(l.originalQuantity ?? (l as { quantity?: Decimal | number }).quantity ?? 0);
    const rem = new Decimal(l.remainingQuantity ?? ((l as { quantity?: Decimal | number }).quantity !== undefined ? (l as { quantity?: Decimal | number }).quantity! : 0));
    const parked = new Decimal(l.parkedQuantity ?? 0);
    const isOpen = l.isOpen !== undefined ? Boolean(l.isOpen) : (rem.greaterThan(EPS) || parked.greaterThan(EPS));
    return {
      id: l.id,
      currency: l.currency,
      acquireDate: l.acquireDate,
      brokerSource: l.brokerSource,
      trigger: l.trigger ?? (l as { trigger?: string }).trigger ?? "—",
      orig,
      rem,
      parked,
      isOpen,
    };
  });

  const openCount = normalized.filter((l) => l.isOpen).length;
  const closedCount = totalLots - openCount;

  console.log(`\n${colores.b}=== ESTADO DE LOTES FX (${openCount} abiertos / ${totalLots} totales) ===${colores.z}`);

  const sep = `${colores.gray}│${colores.z}`;
  const hLot = padEndVisible("LOTE", 8);
  const hEstado = padEndVisible("ESTADO", 10);
  const hDiv = padEndVisible("DIV", 5);
  const hTrig = padEndVisible("ORIGEN", 14);
  const hAdq = padEndVisible("F.ADQ", 8);
  const hOrig = padStartVisible("CANT. ORIGINAL", 15);
  const hRem = padStartVisible("CANT. RESTANTE", 15);
  const hPark = padStartVisible("CANT. APARCADA", 15);
  const hBroker = "BROKER";

  const header = `${colores.b}${hLot} ${sep} ${hEstado} ${sep} ${hDiv} ${sep} ${hTrig} ${sep} ${hAdq} ${sep} ${hOrig} ${sep} ${hRem} ${sep} ${hPark} ${sep} ${hBroker}${colores.z}`;
  const border = `${colores.gray}${stripAnsi(header).replace(/[^│]/g, "─").replace(/│/g, "┼")}${colores.z}`;

  console.log(header);
  console.log(border);

  const poolTotalsByCur = new Map<string, Decimal>();
  const parkedTotalsByCur = new Map<string, Decimal>();

  for (const item of normalized) {
    const lotIdStr = padEndVisible(`${colores.g}${item.id}${colores.z}`, 8);
    const estadoStr = item.isOpen
      ? padEndVisible(`${colores.g}[ABIERTO]${colores.z}`, 10)
      : padEndVisible(`${colores.d}[CERRADO]${colores.z}`, 10);
    const divStr = padEndVisible(item.currency, 5);
    const trigStr = padEndVisible(item.trigger, 14);
    const adqStr = padEndVisible(formatDateVisual(item.acquireDate), 8);

    const origStr = padStartVisible(`${item.orig.toFixed(2)} ${item.currency}`, 15);

    const remText = item.rem.greaterThan(EPS)
      ? `${colores.g}${item.rem.toFixed(2)} ${item.currency}${colores.z}`
      : `${colores.d}0.00 ${item.currency}${colores.z}`;
    const remStr = padStartVisible(remText, 15);

    const parkText = item.parked.greaterThan(EPS)
      ? `${colores.y}${item.parked.toFixed(2)} ${item.currency}${colores.z}`
      : `${colores.d}0.00 ${item.currency}${colores.z}`;
    const parkStr = padStartVisible(parkText, 15);

    const brokerStr = item.brokerSource ? formatBrokerAlias(item.brokerSource) : "—";

    console.log(`${lotIdStr} ${sep} ${estadoStr} ${sep} ${divStr} ${sep} ${trigStr} ${sep} ${adqStr} ${sep} ${origStr} ${sep} ${remStr} ${sep} ${parkStr} ${sep} ${brokerStr}`);

    if (!poolTotalsByCur.has(item.currency)) {
      poolTotalsByCur.set(item.currency, new Decimal(0));
      parkedTotalsByCur.set(item.currency, new Decimal(0));
    }
    poolTotalsByCur.set(item.currency, poolTotalsByCur.get(item.currency)!.plus(item.rem));
    parkedTotalsByCur.set(item.currency, parkedTotalsByCur.get(item.currency)!.plus(item.parked));
  }

  console.log(`${colores.gray}${"─".repeat(stripAnsi(header).length)}${colores.z}`);
  console.log(`Lotes: ${colores.b}${openCount}${colores.z} abiertos, ${colores.b}${closedCount}${colores.z} cerrados (${totalLots} en total)`);
  for (const [cur, poolSum] of poolTotalsByCur) {
    const parkSum = parkedTotalsByCur.get(cur) ?? new Decimal(0);
    const totActivo = poolSum.plus(parkSum);
    console.log(
      `  • ${cur}: Restante pool: ${colores.g}${poolSum.toFixed(2)} ${cur}${colores.z} │ Aparcado: ${colores.y}${parkSum.toFixed(2)} ${cur}${colores.z} │ Total activo: ${colores.b}${totActivo.toFixed(2)} ${cur}${colores.z}`
    );
  }
  console.log("");
}

export const printFxAllLots = printFxLotsOverview;
