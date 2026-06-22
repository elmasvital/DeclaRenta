// Logging utility for operations in the FX FIFO engine
// Utilidad separada de la versión oficial

import Decimal from "decimal.js";


export interface Colores {
  reset: string;
  bold: string;
  green: string;
  yellow: string;
  cyan: string;
  white: string;
  red: string;
  magenta: string;
}

export const colores: Colores = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  red: "\x1b[31m",
  magenta: "\x1b[35m"
};

// 1. ESTRUCTURA DE PARES: Nombre de Etiqueta -> Color Ansi
// Aquí puedes centralizar y cambiar los colores de tus etiquetas fácilmente
export const colorEtiq: Record<string, string> = {
  FXAdd: colores.green,
  FXCons: colores.red,
  STKPark: colores.yellow,
  BUYSTK: colores.cyan,
  // Puedes añadir las que quieras en el futuro, por ejemplo:
  // RETIRO: colores.red,
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
  date?: string;
  quantity?: string | number;
  moneda?: string;
  costInEur?: number | null;
  ratio?: Decimal | null;
  copyTXT?: string;
  colorNum?: string;
  costFcy?: Decimal;
}

export function logO({
  etiqueta,
  colorEtiqueta, // Quitamos el valor por defecto de aquí para procesarlo abajo
  lotId = "",
  symbol = "",
  brokerSource: brokerSource = "",
  trigger = "",
  date = "",
  quantity = "",
  costFcy= undefined,
  moneda = "USD",
  costInEur = null,
  ratio = null,
  copyTXT = "",
  colorNum = colores.green
}: LogOperacionParams): void {
  const dFmat: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  };

  // Filtro de brokers
  if (brokersPerm.length > 0 && !brokersPerm.includes(brokerSource)) {
    return;
  }

  const { reset, bold } = colores;

  // 2. ASIGNACIÓN AUTOMÁTICA DE COLOR:
  // Prioridad: 1. El color que pases por parámetro / 2. El color de la estructura de pares / 3. Blanco por defecto
  const colorFinalEtiqueta = colorEtiqueta || colorEtiq[etiqueta] || colores.white;

  const cn = (valor: string | number): string => `${colorNum}${valor}${reset}`;

  // Usamos colorFinalEtiqueta para pintar la etiqueta
  let msg = `[${colorFinalEtiqueta}${etiqueta}${reset}] `;
  date = date ? new Date(date).toLocaleDateString("es-ES",dFmat) : "";

  if (lotId) msg += `${lotId} | `;
  if (brokerSource) msg += `${brokerSource} | `;
  if (trigger) msg += `${bold}${trigger.padEnd(14)}${reset} | `;
  if (symbol) msg += `${symbol.toUpperCase()} | `;
  if (date) msg += `${cn(date)} | `;
  if (quantity !== "") msg += `Cant: ${cn(quantity)} ${moneda} | `;
  if (costFcy !== undefined) msg += `CostFcy: ${cn(Number(costFcy).toFixed(3))} ${moneda} | `;
  if (costInEur !== null) msg += `CostEurBroker: ${cn(costInEur)} EUR | `;
  if (ratio !== null) msg += `Ratio: ${cn(ratio.toFixed(4))} `;
  if (copyTXT) msg += copyTXT;

  console.log(msg.trim());
}