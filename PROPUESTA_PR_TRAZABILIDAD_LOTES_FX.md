# Propuesta de Pull Request: Trazabilidad Bidireccional de Lotes FX (`lotId`)

Este documento describe la propuesta de mejora técnica para someter como **Pull Request (PR)** al repositorio oficial [GeiserX/DeclaRenta](https://github.com/GeiserX/DeclaRenta).

---

## 1. Justificación y Problema Detectado

En la versión actual de DeclaRenta (v0.62+), el motor FX FIFO (`src/engine/fx-fifo.ts`) incluye una traza diagnóstica de movimientos activable mediante `--fx-trace` o el modo diagnóstico de la web (`#debug`).

El contrato de datos de cada evento (`FxTraceEvent` en `src/types/tax.ts`) contempla los campos:
```typescript
export interface FxTraceEvent {
  // ...
  lotId?: string;          // Ej: "FX-1", "FX-2"
  lotAcquireDate?: string; // Fecha original de adquisición
  // ...
}
```

### La asimetría actual en las trazas:
1. **En los consumos (`kind: "dispose"` / `[FXCons]`):**  
   Cuando un evento consume divisas del pool, `consumeLots()` registra rigurosamente `lotId: lotIdConsumed` y `lotAcquireDate: lot.acquireDate`.
2. **En las creaciones de lotes (`kind: "acquire"` / `[FXAdd]`):**  
   En `addLot()`, el motor genera el objeto `FxLot` con su identificador único secuencial `id: "FX-" + this.nextLotId++`. Sin embargo, en la llamada inmediatamente posterior a `record()`:
   ```typescript
   // src/engine/fx-fifo.ts (~línea 1166)
   this.record("acquire", event, { quantityFcy: event.quantity, rate: costPerUnit });
   ```
   **Se omiten `lotId` y `lotAcquireDate`**, a pesar de que ambos valores ya existen en el objeto `lot` recién instanciado y `record()` ya los acepta como campos opcionales.
3. **En las creaciones por plusvalía bursátil (`kind: "profit"`):**  
   `pushPoolLot()` inserta un nuevo lote en el pool con su ID correspondiente, pero retorna `void`, impidiendo que el evento de traza `profit` indique qué lote se ha creado.

### Consecuencia:
En los ficheros CSV de auditoría generados por `serializeFxTrace()` y en los registros de diagnóstico, un asesor o desarrollador puede ver qué lote se consume (ej. `FX-4`), pero **no puede buscar dónde nació `FX-4`** en el historial de eventos porque el apunte de origen carece de identificador.

---

## 2. Solución Propuesta (Quirúrgica y 100% Retrocompatible)

La modificación es mínima, limpia y respeta al 100% los invariantes del proyecto oficial:

1. **En `addLot()`:**
   Pasar `lotId: lot.id` y `lotAcquireDate: lot.acquireDate` a `this.record("acquire", ...)`.

2. **En `pushPoolLot()`:**
   Hacer que retorne el lote recién creado (`FxLot`), permitiendo a `processStockSell()` asociar el `lotId` al evento `profit` o `unpark`.

3. **Invariantes preservados:**
   - **Cero impacto en el cálculo fiscal:** No se altera ninguna cifra de ninguna casilla del Modelo 100.
   - **Coste cero cuando la traza está apagada:** `record()` mantiene su guarda `if (!this.traceEnabled) return;`.
   - **Retrocompatibilidad total:** Los campos son opcionales en `FxTraceEvent`. Ningún consumidor externo se rompe.

---

## 3. Diff Técnico Detallado (`src/engine/fx-fifo.ts`)

```diff
diff --git a/src/engine/fx-fifo.ts b/src/engine/fx-fifo.ts
--- a/src/engine/fx-fifo.ts
+++ b/src/engine/fx-fifo.ts
@@ -1163,7 +1163,12 @@ export class FxFifoEngine {
     }
     this.lots.get(event.currency)!.push(lot);
-    this.record("acquire", event, { quantityFcy: event.quantity, rate: costPerUnit });
+    this.record("acquire", event, {
+      quantityFcy: event.quantity,
+      rate: costPerUnit,
+      lotId: lot.id,
+      lotAcquireDate: lot.acquireDate,
+    });
     this.accumulate("acquire", event.currency, event.quantity);
   }
 
@@ -1334,8 +1339,8 @@ export class FxFifoEngine {
    * same-date ordering is unchanged from the old append.
    */
-  private pushPoolLot(currency: string, date: string, q: Decimal, rate: Decimal, brokerSource?: string): void {
-    if (!q.greaterThan(0)) return;
+  private pushPoolLot(currency: string, date: string, q: Decimal, rate: Decimal, brokerSource?: string): FxLot | undefined {
+    if (!q.greaterThan(0)) return undefined;
     const lot: FxLot = {
       id: `FX-${this.nextLotId++}`,
       currency,
@@ -1358,6 +1363,7 @@ export class FxFifoEngine {
       else lo = mid + 1;
     }
     lots.splice(lo, 0, lot);
+    return lot;
   }
 
@@ -1579,8 +1585,12 @@ export class FxFifoEngine {
     const profit = proc.minus(placed);
     if (profit.greaterThan(EPS)) {
-      this.pushPoolLot(event.currency, event.date, profit, saleRate, event.brokerSource);
-      this.record("profit", event, { quantityFcy: profit, rate: saleRate });
+      const newLot = this.pushPoolLot(event.currency, event.date, profit, saleRate, event.brokerSource);
+      this.record("profit", event, {
+        quantityFcy: profit,
+        rate: saleRate,
+        lotId: newLot?.id,
+      });
       this.accumulate("profit", event.currency, profit);
     }
```

---

## 4. Test Unitario a Añadir (`tests/engine/fx-fifo-trace.test.ts`)

En la suite `describe("FxFifoEngine.getTrace — acquire", ...)`:

```typescript
it("attaches lotId and lotAcquireDate to acquire trace events", () => {
  const trace = traceOf([["fund", "USD", 1000, 0.9]]);
  expect(trace).toHaveLength(1);
  const ev = trace[0]!;
  expect(ev.kind).toBe("acquire");
  expect(ev.lotId).toBe("FX-1");
  expect(ev.lotAcquireDate).toBe("2024-01-01");
});
```

---

## 5. Plantilla de Pull Request para GitHub (Listo para copiar y pegar)

A continuación se incluye el texto formateado tanto en inglés (idioma principal de los PRs de DeclaRenta) como en español.

### Versión en Inglés (Recomendada para abrir el PR):

```markdown
## feat(fx): attach lotId and lotAcquireDate to pool creation trace events

### Motivation
When diagnosing foreign exchange calculations via `--fx-trace` or the web audit CSV export, consumers can see which lot is consumed on disposal events (`kind: "dispose"`), because `consumeLots()` populates `lotId` (e.g. `FX-1`) and `lotAcquireDate`.

However, the origin events that *create* lots in the pool (`kind: "acquire"` in `addLot()` and `kind: "profit"` in `pushPoolLot()`) currently omit `lotId`, even though:
1. The unique lot ID (`FX-N`) is already instantiated at that exact moment.
2. `FxTraceEvent` and `this.record()` already define optional `lotId?: string` and `lotAcquireDate?: string`.

Without `lotId` on creation events, it is difficult to perform bidirectional auditing (tracing a lot from its origin to its eventual disposal).

### Changes
1. **`src/engine/fx-fifo.ts` (`addLot`):** Pass `lotId: lot.id` and `lotAcquireDate: lot.acquireDate` to `this.record("acquire", ...)`.
2. **`src/engine/fx-fifo.ts` (`pushPoolLot`):** Return the created `FxLot` and pass `lotId: newLot?.id` to `this.record("profit", ...)`.
3. **`tests/engine/fx-fifo-trace.test.ts`:** Add unit test asserting `lotId` and `lotAcquireDate` presence on `acquire` events.

### Verification
- `npm run typecheck`: clean (0 errors)
- `npm test`: all unit and regression tests pass
- No changes to any tax calculations, casillas, or performance invariants (zero-cost when trace is disabled).
```

### Versión en Español:

```markdown
## feat(fx): incluir lotId y lotAcquireDate en las trazas de creación de lotes FX

### Motivación
Al auditar los cálculos de divisa mediante `--fx-trace` o la exportación CSV de diagnóstico, los eventos de consumo (`kind: "dispose"`) muestran claramente qué lote se enajena (`lotId: "FX-1"`).

Sin embargo, los eventos donde nacen dichos lotes (`kind: "acquire"` y `kind: "profit"`) no incluían el `lotId`, a pesar de que el identificador único ya se genera en ese punto y el tipo `FxTraceEvent` ya soporta `lotId` de forma nativa. Esto dificultaba la conciliación bidireccional de lotes.

### Cambios realizados
- `src/engine/fx-fifo.ts`: Propagar `lotId` y `lotAcquireDate` en `addLot()` y `pushPoolLot()`.
- `tests/engine/fx-fifo-trace.test.ts`: Añadido test unitario de verificación.
- Cero impacto en las cifras de impuestos y coste nulo cuando la traza no está activa.
```
