import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import { computeCasillaBlocksWithFx } from "../../src/generators/casillas.js";
import type { FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function makeFxTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2024-01-15";
  return {
    tradeID: overrides.tradeID ?? "1",
    accountId: "U1",
    symbol: overrides.symbol ?? "EUR.USD",
    description: overrides.description ?? "EUR/USD forex",
    isin: "",
    assetCategory: "CASH",
    currency: overrides.currency ?? "USD",
    tradeDate,
    settlementDate: overrides.settlementDate ?? tradeDate,
    quantity: overrides.quantity ?? "1000",
    tradePrice: overrides.tradePrice ?? "1.00",
    tradeMoney: overrides.tradeMoney ?? "1000",
    proceeds: overrides.proceeds ?? "-1000",
    cost: overrides.cost ?? "1000",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: overrides.buySell ?? "BUY",
    openCloseIndicator: "O",
    exchange: "IDEALPRO",
    commissionCurrency: "EUR",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeStatement(trades: Trade[]): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "2024-01-01",
    toDate: "2025-12-31",
    trades,
    cashTransactions: [],
    corporateActions: [],
    positions: [],
  };
}

describe("E2E FX Wash Sales (DGT V1613-25 / Art. 33.5.e)", () => {
  const rates = makeRateMap({
    "2024-01-15": { USD: "1.00" }, // 1 USD = 1.00 EUR
    "2024-03-15": { USD: "0.80" }, // USD depreciates to 0.80 EUR
    "2024-06-15": { USD: "0.90" }, // USD at 0.90 EUR
    "2025-02-15": { USD: "0.95" }, // USD at 0.95 EUR
  });

  // 1. 2024-01-15: Adquisición de 1.000 USD (EUR.USD SELL, tradeMoney -1000) a tipo 1.00 -> Coste = 1.000 €
  // 2. 2024-03-15: Conversión a EUR de 1.000 USD (EUR.USD BUY, tradeMoney 1000) a tipo 0.80 -> Venta = 800 €, Pérdida = -200 €
  // 3. 2024-06-15: Recompra de 500 USD (EUR.USD SELL, tradeMoney -500) a tipo 0.90 -> Absorbe 500 USD dentro de 1 año
  const trades: Trade[] = [
    makeFxTrade({
      tradeID: "T1",
      tradeDate: "2024-01-15",
      symbol: "EUR.USD",
      buySell: "SELL",
      quantity: "-1000",
      tradeMoney: "-1000",
      tradePrice: "1.00",
    }),
    makeFxTrade({
      tradeID: "T2",
      tradeDate: "2024-03-15",
      symbol: "EUR.USD",
      buySell: "BUY",
      quantity: "1250",
      tradeMoney: "1000",
      tradePrice: "0.80",
    }),
    makeFxTrade({
      tradeID: "T3",
      tradeDate: "2024-06-15",
      symbol: "EUR.USD",
      buySell: "SELL",
      quantity: "-555.55",
      tradeMoney: "-500",
      tradePrice: "0.90",
    }),
  ];

  it("con --fx-wash-sale activado bloquea proporcionalmente el 50% de la pérdida (-100 €)", () => {
    const statement = makeStatement(trades);
    const report = generateTaxReport(statement, rates, 2024, { fxWashSale: true });

    expect(report.settings?.fxWashSale).toBe(true);
    expect(report.fxGains.disposals).toHaveLength(1);

    const d = report.fxGains.disposals[0]!;
    expect(d.gainLossEur.toFixed(2)).toBe("-200.00");
    expect(d.washSaleBlocked).toBe(true);
    expect(d.blockedLossEur?.toFixed(2)).toBe("100.00");
    expect(report.fxGains.blockedLosses?.toFixed(2)).toBe("100.00");

    // Casillas 1633 / 1637 / 1638: la pérdida computable neta es de 100 €, no 200 €
    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.otherElements.losses.toFixed(2)).toBe("100.00");
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("-100.00");
  });

  it("sin --fx-wash-sale computa la pérdida al 100% y emite aviso informativo DGT V1613-25", () => {
    const statement = makeStatement(trades);
    const report = generateTaxReport(statement, rates, 2024, { fxWashSale: false });

    expect(report.settings?.fxWashSale).toBeUndefined();
    expect(report.fxGains.blockedLosses?.toFixed(2)).toBe("0.00");

    const blocks = computeCasillaBlocksWithFx(report);
    expect(blocks.otherElements.losses.toFixed(2)).toBe("200.00");
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("-200.00");

    const notice = report.messages.find((m) => m.id === "fx.wash_sale_dgt_v1613_25_notice");
    expect(notice).toBeDefined();
    expect(notice?.message).toContain("100.00 € de pérdidas en USD");
  });

  it("reintegra la pérdida diferida en un año posterior al convertir la divisa recomprada", () => {
    // Añadimos conversión de los 500 USD en 2025 (EUR.USD BUY, tradeMoney 500)
    const multiYearTrades: Trade[] = [
      ...trades,
      makeFxTrade({
        tradeID: "T4",
        tradeDate: "2025-02-15",
        symbol: "EUR.USD",
        buySell: "BUY",
        quantity: "526.31",
        tradeMoney: "500", // vende los 500 USD adquiridos el 2024-06-15
        tradePrice: "0.95",
      }),
    ];

    const statement = makeStatement(multiYearTrades);
    const report2025 = generateTaxReport(statement, rates, 2025, { fxWashSale: true });

    expect(report2025.fxGains.reintegratedLosses?.toFixed(2)).toBe("100.00");
    const d = report2025.fxGains.disposals[0]!;
    expect(d.reintegratedLossEur?.toFixed(2)).toBe("100.00");

    // En 2025 la ganancia bruta FX es 500 * (0.95 - 0.90) = 25 €
    // Con la pérdida reintegrada de 100 €, el resultado neto efectivo es 25 - 100 = -75 €
    const blocks = computeCasillaBlocksWithFx(report2025);
    expect(blocks.otherElements.netGainLoss.toFixed(2)).toBe("-75.00");
    expect(blocks.otherElements.losses.toFixed(2)).toBe("75.00");
  });
});
