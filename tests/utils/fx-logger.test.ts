import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Decimal from "decimal.js";
import {
  formatFxTraceEvent,
  logFxTraceEvent,
  logO,
  printFxRemainingLots,
  printFxLotsClosed,
  printFxDisposals,
  brokersPerm,
  colores,
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
});
