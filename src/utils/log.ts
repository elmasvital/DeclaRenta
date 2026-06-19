// logger.ts

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
export const brokersPerm: string[] = [];

export interface LogOperacionParams {
  etiqueta: string;
  colorEtiqueta?: string; // Sigue sirviendo por si quieres forzar un color manual en un log específico
  lotId?: string;
  broker?: string;
  trigger?: string;
  dateTXT?: string;
  quantity?: string | number;
  moneda?: string;
  costInEur?: number | null;
  ratio?: number | null;
  copyTXT?: string;
  colorNum?: string;
}

export function logO({
  etiqueta,
  colorEtiqueta, // Quitamos el valor por defecto de aquí para procesarlo abajo
  lotId = "",
  broker = "",
  trigger = "",
  dateTXT = "",
  quantity = "",
  moneda = "USD",
  costInEur = null,
  ratio = null,
  copyTXT = "",
  colorNum = colores.green
}: LogOperacionParams): void {

  // Filtro de brokers
  if (brokersPerm.length > 0 && !brokersPerm.includes(broker)) {
    return;
  }

  const { reset, bold } = colores;

  // 2. ASIGNACIÓN AUTOMÁTICA DE COLOR:
  // Prioridad: 1. El color que pases por parámetro / 2. El color de la estructura de pares / 3. Blanco por defecto
  const colorFinalEtiqueta = colorEtiqueta || colorEtiq[etiqueta] || colores.white;

  const cn = (valor: string | number): string => `${colorNum}${valor}${reset}`;

  // Usamos colorFinalEtiqueta para pintar la etiqueta
  let msg = `[${colorFinalEtiqueta}${etiqueta}${reset}] `;

  if (lotId) msg += `${lotId} | `;
  if (broker) msg += `${broker} | `;
  if (trigger) msg += `${bold}${trigger.padEnd(14)}${reset} | `;
  if (dateTXT) msg += `${cn(dateTXT)} | `;
  if (quantity !== "") msg += `Cant: ${cn(quantity)} ${moneda} | `;
  if (costInEur !== null) msg += `CostEurBroker: ${cn(costInEur)} EUR | `;
  if (ratio !== null) msg += `Ratio: ${cn(ratio)} `;
  if (copyTXT) msg += copyTXT;

  console.log(msg.trim());
}