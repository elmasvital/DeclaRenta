import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Decimal from "decimal.js";
import {
  formatFxTraceEvent,
  logFxTraceEvent,
  logO,
  printFxRemainingLots,
  printFxLotsClosed,
  printFxDisposals,
  printFxLotsOverview,
  printFxAllLots,
  trackFxLotEvent,
  resetFxLotTracker,
  type FxLotStatus,
  brokersPerm,
  colores,
  formatBrokerAlias,
  isBrokerPermitted,
} from "../../src/utils/fx-logger.js";
import type { FxLot, FxDisposal, FxTraceEvent } from "../../src/types/tax.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";

describe("fx-logger utilities (Capa 3)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    brokersPerm.length = 0; // Clear allowed brokers filter
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    brokersPerm.length = 0;
  });

  it("formats acquire trace event with green FXAdd tag", () => {
    const ev: FxTraceEvent = {
      seq: 1,
      date: "2024-01-15",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "1000",
      rate: "0.912",
      costBasisEur: "912",
      poolBalanceFcy: "1000",
      parkedBalanceFcy: "0",
      lotId: "FX-1",
      brokerSource: "IBKR",
    };

    const formatted = formatFxTraceEvent(ev);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("FXAdd");
    expect(formatted).toContain("IBKR");
    expect(formatted).toContain("1000.00");
    expect(formatted).toContain("USD");
    expect(formatted).toContain("FX-1");
  });

  it("formats dispose trace event with red FXCons tag", () => {
    const ev: FxTraceEvent = {
      seq: 2,
      date: "2024-02-15",
      kind: "dispose",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "500",
      rate: "0.920",
      costBasisEur: "456",
      proceedsEur: "460",
      gainLossEur: "4",
      poolBalanceFcy: "500",
      parkedBalanceFcy: "0",
      lotId: "FX-1",
      brokerSource: "IBKR",
    };

    const formatted = formatFxTraceEvent(ev);
    expect(formatted).toContain("FXCons");
    expect(formatted).toContain("GainEur:");
  });

  it("formats discard trace event with FXLoss tag", () => {
    const ev: FxTraceEvent = {
      seq: 3,
      date: "2024-03-01",
      kind: "discard",
      currency: "USD",
      trigger: "stock_sale",
      quantityFcy: "200",
      rate: "0.90",
      poolBalanceFcy: "300",
      parkedBalanceFcy: "0",
      lotId: "FX-1",
      brokerSource: "IBKR",
      note: "minusvalía bursátil → divisa destruida sin hecho imponible",
    };

    const formatted = formatFxTraceEvent(ev);
    expect(formatted).toContain("FXLoss");
    expect(formatted).toContain("minusvalía bursátil");
  });

  it("filters events by brokersPerm", () => {
    brokersPerm.push("IBKR");

    const ibkrEvent: FxTraceEvent = {
      seq: 1,
      date: "2024-01-15",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "1000",
      rate: "0.912",
      poolBalanceFcy: "1000",
      parkedBalanceFcy: "0",
      brokerSource: "IBKR",
    };

    const lyEvent: FxTraceEvent = {
      seq: 2,
      date: "2024-01-16",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "500",
      rate: "0.912",
      poolBalanceFcy: "1500",
      parkedBalanceFcy: "0",
      brokerSource: "LY",
    };

    expect(formatFxTraceEvent(ibkrEvent)).not.toBeNull();
    expect(formatFxTraceEvent(lyEvent)).toBeNull();

    logFxTraceEvent(ibkrEvent);
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    logFxTraceEvent(lyEvent);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("executes logO for backward compatibility", () => {
    logO({
      etiqueta: "FXAdd",
      brokerSource: "IBKR",
      trigger: "CONVERSION",
      quantity: new Decimal(100),
      moneda: "USD",
      FAdq: "2024-01-10",
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0]![0]).toContain("FXAdd");
    expect(consoleSpy.mock.calls[0]![0]).toContain("IBKR");
  });

  it("prints remaining lots table", () => {
    const lots: FxLot[] = [
      {
        id: "FX-1",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: new Decimal(1000),
        costPerUnit: new Decimal("0.91"),
        costInEur: new Decimal(910),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
    ];
    const map = new Map<string, FxLot[]>([["USD", lots]]);

    printFxRemainingLots(map);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("prints closed lots table", () => {
    const lots: FxLot[] = [
      {
        id: "FX-1",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: new Decimal(500),
        costPerUnit: new Decimal("0.91"),
        costInEur: new Decimal(455),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
    ];
    const map = new Map<string, FxLot[]>([["USD", lots]]);

    printFxLotsClosed(map);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("prints disposals table", () => {
    const disposals: FxDisposal[] = [
      {
        lotId: "FX-1",
        currency: "USD",
        acquireDate: "2024-01-10",
        disposeDate: "2024-02-10",
        quantity: new Decimal(500),
        costBasisEur: new Decimal(455),
        proceedsEur: new Decimal(460),
        gainLossEur: new Decimal(5),
        trigger: "conversion",
        holdingPeriodDays: 31,
        brokerSource: "IBKR",
      },
    ];

    printFxDisposals(disposals);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("connects directly with FxFifoEngine through FxTraceListener", () => {
    const eventsLogged: FxTraceEvent[] = [];
    const engine = new FxFifoEngine({
      onTraceEvent: (ev) => {
        eventsLogged.push(ev);
        logFxTraceEvent(ev);
      },
    });

    engine.processEvents([
      {
        date: "2024-01-10",
        currency: "USD",
        quantity: new Decimal(1000),
        ecbRate: new Decimal("0.90"),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
      {
        date: "2024-02-10",
        currency: "USD",
        quantity: new Decimal(-500),
        ecbRate: new Decimal("0.95"),
        trigger: "conversion",
        brokerSource: "IBKR",
      },
    ]);

    expect(eventsLogged.length).toBeGreaterThanOrEqual(2);
    expect(eventsLogged[0]!.kind).toBe("acquire");
    expect(eventsLogged[1]!.kind).toBe("dispose");
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("handles broker aliases for Interactive Brokers (IBKR) and Light Year (LY)", () => {
    // 1. Display formatting aliases
    expect(formatBrokerAlias("Interactive Brokers")).toBe("IBKR");
    expect(formatBrokerAlias("interactive brokers")).toBe("IBKR");
    expect(formatBrokerAlias("IBKR")).toBe("IBKR");
    expect(formatBrokerAlias("Lightyear")).toBe("LY");
    expect(formatBrokerAlias("Light Year")).toBe("LY");
    expect(formatBrokerAlias("light year")).toBe("LY");
    expect(formatBrokerAlias("LY")).toBe("LY");
    expect(formatBrokerAlias("Degiro")).toBe("Degiro");

    // 2. Filter matching with aliases
    brokersPerm.length = 0;
    brokersPerm.push("IBKR");
    expect(isBrokerPermitted("Interactive Brokers")).toBe(true);
    expect(isBrokerPermitted("IBKR")).toBe(true);
    expect(isBrokerPermitted("Lightyear")).toBe(false);

    brokersPerm.length = 0;
    brokersPerm.push("Interactive Brokers");
    expect(isBrokerPermitted("IBKR")).toBe(true);

    brokersPerm.length = 0;
    brokersPerm.push("LY");
    expect(isBrokerPermitted("Lightyear")).toBe(true);
    expect(isBrokerPermitted("Light Year")).toBe(true);
    expect(isBrokerPermitted("LY")).toBe(true);
    expect(isBrokerPermitted("IBKR")).toBe(false);

    brokersPerm.length = 0;
    brokersPerm.push("Light Year");
    expect(isBrokerPermitted("LY")).toBe(true);
    expect(isBrokerPermitted("Lightyear")).toBe(true);

    // 3. formatFxTraceEvent renders aliased names
    const ev1: FxTraceEvent = {
      seq: 1,
      date: "2024-01-15",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "1000",
      rate: "0.912",
      poolBalanceFcy: "1000",
      parkedBalanceFcy: "0",
      brokerSource: "Interactive Brokers",
    };
    const ev2: FxTraceEvent = {
      seq: 2,
      date: "2024-01-16",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "1000",
      rate: "0.912",
      poolBalanceFcy: "2000",
      parkedBalanceFcy: "0",
      brokerSource: "Light Year",
    };
    brokersPerm.length = 0;
    expect(formatFxTraceEvent(ev1)).toContain("IBKR");
    expect(formatFxTraceEvent(ev2)).toContain("LY");
  });
  it("prints FX lots overview table with open/closed status, original, remaining, and parked quantities", () => {
    const lots: FxLotStatus[] = [
      {
        id: "FX-1",
        currency: "USD",
        acquireDate: "2024-01-10",
        originalQuantity: new Decimal(1000),
        remainingQuantity: new Decimal(400),
        parkedQuantity: new Decimal(300),
        isOpen: true,
        trigger: "conversion",
        brokerSource: "Interactive Brokers",
      },
      {
        id: "FX-2",
        currency: "USD",
        acquireDate: "2024-01-15",
        originalQuantity: new Decimal(500),
        remainingQuantity: new Decimal(0),
        parkedQuantity: new Decimal(0),
        isOpen: false,
        trigger: "dividend",
        brokerSource: "Lightyear",
      },
    ];

    printFxLotsOverview(lots);

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Header shows open / total count
    expect(calls).toContain("1 abiertos / 2 totales");
    // Column headers
    expect(calls).toContain("ESTADO");
    expect(calls).toContain("CANT. ORIGINAL");
    expect(calls).toContain("CANT. RESTANTE");
    expect(calls).toContain("CANT. APARCADA");
    // Lot 1 details
    expect(calls).toContain("FX-1");
    expect(calls).toContain("[ABIERTO]");
    expect(calls).toContain("1000.00 USD");
    expect(calls).toContain("400.00 USD");
    expect(calls).toContain("300.00 USD");
    expect(calls).toContain("IBKR"); // Broker alias
    // Lot 2 details
    expect(calls).toContain("FX-2");
    expect(calls).toContain("[CERRADO]");
    expect(calls).toContain("0.00 USD");
    expect(calls).toContain("LY"); // Broker alias
  });

  it("filters FX lots overview by brokersPerm alias", () => {
    const lots: FxLotStatus[] = [
      {
        id: "FX-1",
        currency: "USD",
        acquireDate: "2024-01-10",
        originalQuantity: 1000,
        remainingQuantity: 1000,
        parkedQuantity: 0,
        isOpen: true,
        brokerSource: "Interactive Brokers",
      },
      {
        id: "FX-2",
        currency: "USD",
        acquireDate: "2024-01-15",
        originalQuantity: 500,
        remainingQuantity: 500,
        parkedQuantity: 0,
        isOpen: true,
        brokerSource: "Lightyear",
      },
    ];

    brokersPerm.push("IBKR");
    printFxLotsOverview(lots);

    const calls = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("FX-1");
    expect(calls).not.toContain("FX-2");
    expect(calls).toContain("1 abiertos / 1 totales");
  });

  it("tracks FX lot lifecycle across trace events automatically", () => {
    resetFxLotTracker();

    // 1. Acquire creates lot
    trackFxLotEvent({
      seq: 1,
      date: "2024-01-10",
      kind: "acquire",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "1000",
      rate: "0.92",
      poolBalanceFcy: "1000",
      parkedBalanceFcy: "0",
      lotId: "FX-1",
      brokerSource: "Interactive Brokers",
    });

    // 2. Park 300 from FX-1
    trackFxLotEvent({
      seq: 2,
      date: "2024-01-15",
      kind: "park",
      currency: "USD",
      trigger: "stock_purchase",
      quantityFcy: "300",
      rate: "0.92",
      poolBalanceFcy: "700",
      parkedBalanceFcy: "300",
      lotId: "FX-1",
      brokerSource: "Interactive Brokers",
    });

    // 3. Dispose 200 from FX-1
    trackFxLotEvent({
      seq: 3,
      date: "2024-01-20",
      kind: "dispose",
      currency: "USD",
      trigger: "conversion",
      quantityFcy: "200",
      rate: "0.93",
      poolBalanceFcy: "500",
      parkedBalanceFcy: "300",
      lotId: "FX-1",
      brokerSource: "Interactive Brokers",
    });

    // Overview printed from internal tracker
    printFxLotsOverview();

    const calls = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("FX-1");
    expect(calls).toContain("[ABIERTO]");
    expect(calls).toContain("1000.00 USD"); // original
    expect(calls).toContain("500.00 USD");  // remaining
    expect(calls).toContain("300.00 USD");  // parked
    expect(calls).toContain("IBKR");
  });
});
