import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FxFifoEngine } from "../../src/engine/fx-fifo.js";
import type { FxEvent } from "../../src/engine/fx-fifo.js";

describe("FxFifoEngine: stockLossMode flag", () => {
  it("defaults to carry-basis mode", () => {
    const engine = new FxFifoEngine();
    expect(engine.getStockLossMode()).toBe("carry-basis");
  });

  it("can be configured to destruction mode", () => {
    const engine = new FxFifoEngine({ stockLossMode: "destruction" });
    expect(engine.getStockLossMode()).toBe("destruction");
  });

  describe("destruction mode (fork logic)", () => {
    it("does not park principal on stock buy, and destroys currency without tax disposal on stock loss", () => {
      const engine = new FxFifoEngine({ stockLossMode: "destruction" });

      const events: FxEvent[] = [
        // 1. Initial funding: buy 1,000 USD @ 0.90 EUR/USD
        {
          date: "2024-01-10",
          currency: "USD",
          quantity: new Decimal(1000),
          ecbRate: new Decimal("0.90"),
          trigger: "conversion",
        },
        // 2. Buy stock: cost 500 USD
        {
          kind: "stock_buy",
          date: "2024-02-15",
          currency: "USD",
          quantity: new Decimal(0),
          costFcy: new Decimal(500),
          ecbRate: new Decimal("0.92"),
          trigger: "stock_purchase",
          positionKey: "US0000000001",
        },
        // 3. Sell stock at a loss: cost 500 USD, proceeds 400 USD (loss = 100 USD)
        {
          kind: "stock_sell",
          date: "2024-06-20",
          currency: "USD",
          quantity: new Decimal(0),
          costFcy: new Decimal(500),
          proceedsFcy: new Decimal(400),
          ecbRate: new Decimal("0.95"),
          trigger: "stock_sale",
          positionKey: "US0000000001",
        },
      ];

      const disposals = engine.processEvents(events);

      // In destruction mode:
      // - Stock buy does not park into parked map
      expect(engine.getParked().size).toBe(0);

      // - The 100 USD loss consumed pool lots, so remaining USD is 900
      const remainingLots = engine.getRemainingLots().get("USD");
      expect(remainingLots).toBeDefined();
      const totalRemaining = remainingLots!.reduce((acc, l) => acc.plus(l.quantity), new Decimal(0));
      expect(totalRemaining.toNumber()).toBe(900);

      // - Crucial: NO FxDisposal is emitted for the destroyed currency (no tax in Renta)
      expect(disposals).toHaveLength(0);

      // - Conservation identity balanced without warning
      const warnings = engine.messages.filter((m) => m.id === "fx.conservation_mismatch");
      expect(warnings).toHaveLength(0);
    });

    it("adds net profit to pool when stock sold with gain in FCY", () => {
      const engine = new FxFifoEngine({ stockLossMode: "destruction" });

      const events: FxEvent[] = [
        // 1. Initial funding: buy 1,000 USD
        {
          date: "2024-01-10",
          currency: "USD",
          quantity: new Decimal(1000),
          ecbRate: new Decimal("0.90"),
          trigger: "conversion",
        },
        // 2. Stock sell with profit: cost 500 USD, proceeds 650 USD (profit = 150 USD)
        {
          kind: "stock_sell",
          date: "2024-07-15",
          currency: "USD",
          quantity: new Decimal(0),
          costFcy: new Decimal(500),
          proceedsFcy: new Decimal(650),
          ecbRate: new Decimal("0.95"),
          trigger: "stock_sale",
          positionKey: "US0000000001",
        },
      ];

      const disposals = engine.processEvents(events);

      // 1,000 + 150 profit = 1,150 USD in pool
      const remainingLots = engine.getRemainingLots().get("USD");
      const totalRemaining = remainingLots!.reduce((acc, l) => acc.plus(l.quantity), new Decimal(0));
      expect(totalRemaining.toNumber()).toBe(1150);

      // Still no disposals (profit is fresh currency, not a disposal)
      expect(disposals).toHaveLength(0);

      // No conservation mismatch
      const warnings = engine.messages.filter((m) => m.id === "fx.conservation_mismatch");
      expect(warnings).toHaveLength(0);
    });

    it("only emits FxDisposal when currency is explicitly disposed or converted to EUR", () => {
      const engine = new FxFifoEngine({ stockLossMode: "destruction" });

      const events: FxEvent[] = [
        // 1. Initial funding: 1,000 USD
        {
          date: "2024-01-10",
          currency: "USD",
          quantity: new Decimal(1000),
          ecbRate: new Decimal("0.90"),
          trigger: "conversion",
        },
        // 2. Stock sell with loss: 100 USD destroyed
        {
          kind: "stock_sell",
          date: "2024-06-20",
          currency: "USD",
          quantity: new Decimal(0),
          costFcy: new Decimal(500),
          proceedsFcy: new Decimal(400),
          ecbRate: new Decimal("0.95"),
          trigger: "stock_sale",
        },
        // 3. User converts 300 USD back to EUR
        {
          date: "2024-09-10",
          currency: "USD",
          quantity: new Decimal(-300),
          ecbRate: new Decimal("0.96"),
          trigger: "conversion",
        },
      ];

      const disposals = engine.processEvents(events);

      // Exactly 1 disposal: the actual cash conversion of 300 USD
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toNumber()).toBe(300);
      expect(disposals[0]!.trigger).toBe("conversion");

      // Remaining pool: 1,000 - 100 (destroyed) - 300 (converted) = 600 USD
      const remainingLots = engine.getRemainingLots().get("USD");
      const totalRemaining = remainingLots!.reduce((acc, l) => acc.plus(l.quantity), new Decimal(0));
      expect(totalRemaining.toNumber()).toBe(600);
    });
  });
});
