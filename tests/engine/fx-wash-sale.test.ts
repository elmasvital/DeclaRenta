import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { detectFxWashSales, isFxRepurchase } from "../../src/engine/fx-wash-sale.js";
import type { FxDisposal } from "../../src/types/tax.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";

function makeDisposal(overrides: Partial<FxDisposal> = {}): FxDisposal {
  return {
    currency: "USD",
    disposeDate: "2024-03-01",
    acquireDate: "2024-01-01",
    quantity: new Decimal(1000),
    proceedsEur: new Decimal(900),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(-100),
    trigger: "conversion",
    holdingPeriodDays: 60,
    lotId: "LOT-1",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FxEvent> = {}): FxEvent {
  return {
    date: "2024-06-01",
    currency: "USD",
    quantity: new Decimal(1000),
    ecbRate: new Decimal(1),
    trigger: "conversion",
    ...overrides,
  };
}

describe("detectFxWashSales (DGT V1613-25 / Art. 33.5.e LIRPF)", () => {
  it("Caso 1: Bloqueo básico 100% al recomprar la totalidad en el año posterior", () => {
    // Venta de 1.000 USD con pérdida cambiaria el 01/03/2024; compra de 1.000 USD el 01/06/2024
    const disposals = [makeDisposal()];
    const events = [makeEvent()];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(100);
    expect(result.disposals[0]!.washSaleBlocked).toBe(true);
    expect(result.disposals[0]!.blockedLossEur?.toNumber()).toBe(100);
    expect(result.disposals[0]!.washSaleMatchDates).toEqual(["2024-06-01"]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe("fx.wash_sale_applied");
  });

  it("Caso 2: Bloqueo proporcional (prorrateo según cantidad recomprada)", () => {
    // Venta de 1.000 USD con pérdida de -100 €; compra de 300 USD a los 5 meses
    const disposals = [makeDisposal({ quantity: new Decimal(1000), gainLossEur: new Decimal(-100) })];
    const events = [makeEvent({ date: "2024-08-01", quantity: new Decimal(300) })];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    // 300 / 1000 = 30% -> 30 € bloqueados
    expect(result.totalBlockedEur.toNumber()).toBe(30);
    expect(result.disposals[0]!.washSaleBlocked).toBe(true);
    expect(result.disposals[0]!.blockedLossEur?.toNumber()).toBe(30);
  });

  it("Caso 3: Inmunidad de dividendos cobrados en divisa", () => {
    // Venta de 1.000 USD con pérdida; cobro de 500 USD en dividendos en los 12 meses siguientes
    const disposals = [makeDisposal()];
    const events = [makeEvent({ trigger: "dividend", quantity: new Decimal(500) })];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(0);
    expect(result.disposals[0]!.washSaleBlocked).toBe(false);
    expect(result.disposals[0]!.blockedLossEur?.toNumber()).toBe(0);
  });

  it("Caso 4: Inmunidad de intereses cobrados en divisa", () => {
    // Venta de 1.000 USD con pérdida; cobro de intereses bancarios en USD
    const disposals = [makeDisposal()];
    const events = [makeEvent({ trigger: "interest", quantity: new Decimal(500) })];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(0);
    expect(result.disposals[0]!.washSaleBlocked).toBe(false);
    expect(result.disposals[0]!.blockedLossEur?.toNumber()).toBe(0);
  });

  it("Caso 5: Inmunidad de principal de acciones desaparcado (stock_sell)", () => {
    // Venta de acciones con retorno de principal según doctrina DGT V2422-20
    const disposals = [makeDisposal()];
    const events = [
      makeEvent({
        kind: "stock_sell",
        trigger: "stock_sale",
        costFcy: new Decimal(10000),
        proceedsFcy: new Decimal(12000),
      }),
    ];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(0);
    expect(result.disposals[0]!.washSaleBlocked).toBe(false);
  });

  it("Caso 6: Expiración de la ventana de 1 año (+366 días)", () => {
    // Venta el 01/03/2024; compra el 02/03/2025 (fuera de la ventana de 1 año)
    const disposals = [makeDisposal({ disposeDate: "2024-03-01" })];
    const events = [makeEvent({ date: "2025-03-02", quantity: new Decimal(1000) })];

    const result = detectFxWashSales(disposals, events, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(0);
    expect(result.disposals[0]!.washSaleBlocked).toBe(false);
  });

  it("Caso 7: Reintegración de la pérdida diferida al transmitir la divisa recomprada", () => {
    // 1. 2024-03-01: Venta de 1.000 USD con pérdida de -100 €
    // 2. 2024-06-01: Recompra de 1.000 USD (bloquea los 100 €)
    // 3. 2025-02-01: Disposición posterior de los 1.000 USD comprados el 2024-06-01
    const disposal1 = makeDisposal({
      disposeDate: "2024-03-01",
      acquireDate: "2024-01-01",
      quantity: new Decimal(1000),
      gainLossEur: new Decimal(-100),
    });
    const disposal2 = makeDisposal({
      disposeDate: "2025-02-01",
      acquireDate: "2024-06-01",
      quantity: new Decimal(1000),
      gainLossEur: new Decimal(20),
    });
    const repurchases = [makeEvent({ date: "2024-06-01", quantity: new Decimal(1000) })];

    const result = detectFxWashSales([disposal1, disposal2], repurchases, { enabled: true });

    expect(result.totalBlockedEur.toNumber()).toBe(100);
    expect(disposal1.blockedLossEur?.toNumber()).toBe(100);
    expect(disposal1.washSaleBlocked).toBe(true);

    // En la segunda disposición se libera la pérdida diferida
    expect(disposal2.reintegratedLossEur?.toNumber()).toBe(100);
    expect(result.totalReintegratedEur.toNumber()).toBe(100);
  });

  it("Caso 8: Modo diagnóstico informativo cuando --fx-wash-sale no está activo", () => {
    const disposals = [makeDisposal()];
    const events = [makeEvent()];

    // Por defecto enabled: false
    const result = detectFxWashSales(disposals, events, { enabled: false });

    // La pérdida NO se bloquea en los números
    expect(result.totalBlockedEur.toNumber()).toBe(0);
    expect(result.disposals[0]!.washSaleBlocked).toBe(false);
    expect(result.disposals[0]!.blockedLossEur?.toNumber()).toBe(0);

    // Pero se genera un mensaje informativo para avisar al contribuyente
    expect(result.potentialBlockedEur.toNumber()).toBe(100);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe("fx.wash_sale_dgt_v1613_25_notice");
    expect(result.messages[0]!.message).toContain("100.00 € de pérdidas en USD");
  });

  it("Caso 9: Sin doble cómputo de presupuesto (no double-counting, DGT V2481-20)", () => {
    // Dos ventas sucesivas de 1.000 USD con pérdida cada una
    const disposal1 = makeDisposal({ disposeDate: "2024-03-01", gainLossEur: new Decimal(-100) });
    const disposal2 = makeDisposal({ disposeDate: "2024-04-01", gainLossEur: new Decimal(-100) });
    // Solo una compra de 1.000 USD
    const events = [makeEvent({ date: "2024-06-01", quantity: new Decimal(1000) })];

    const result = detectFxWashSales([disposal1, disposal2], events, { enabled: true });

    // Solo la primera venta queda bloqueada (consume el presupuesto de 1000 USD)
    expect(disposal1.blockedLossEur?.toNumber()).toBe(100);
    expect(disposal1.washSaleBlocked).toBe(true);

    // La segunda venta NO queda bloqueada porque no hay más divisa recomprada disponible
    expect(disposal2.blockedLossEur?.toNumber()).toBe(0);
    expect(disposal2.washSaleBlocked).toBe(false);
    expect(result.totalBlockedEur.toNumber()).toBe(100);
  });

  it("isFxRepurchase clasifica correctamente los eventos", () => {
    expect(isFxRepurchase(makeEvent({ trigger: "conversion", quantity: new Decimal(100) }))).toBe(true);
    expect(isFxRepurchase(makeEvent({ trigger: "dividend", quantity: new Decimal(100) }))).toBe(false);
    expect(isFxRepurchase(makeEvent({ trigger: "interest", quantity: new Decimal(100) }))).toBe(false);
    expect(isFxRepurchase(makeEvent({ kind: "stock_buy", quantity: new Decimal(0) }))).toBe(false);
    expect(isFxRepurchase(makeEvent({ kind: "stock_sell", quantity: new Decimal(0) }))).toBe(false);
    expect(isFxRepurchase(makeEvent({ trigger: "conversion", quantity: new Decimal(-100) }))).toBe(false);
  });
});
