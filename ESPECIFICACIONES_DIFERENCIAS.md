# Especificaciones de Diferencias: Fork vs Repositorio Original

Este documento recoge de forma sistemática y por capas las diferencias, personalizaciones y mejoras implementadas en este fork con respecto al repositorio original oficial de **DeclaRenta** ([GeiserX/DeclaRenta](https://github.com/GeiserX/DeclaRenta.git)).

Su propósito es servir de guía técnica para mantener, conservar e integrar ordenadamente estas características durante futuras actualizaciones y rebases sobre las nuevas versiones del repositorio original.

---

## 0. Estado de Referencia de los Repositorios

- **Repositorio Original (Upstream):** `https://github.com/GeiserX/DeclaRenta.git`
  - Punto base del fork (merge-base): Commit `1ceea9a` (Versión `0.57.1`, 22 de junio de 2026).
  - Último commit upstream disponible: `6315b33` (Versión `0.61.8`).
- **Fork Actual:** `https://github.com/elmasvital/DeclaRenta.git`
  - Rama de trabajo: `0.56.0-FXMOD_DEVELOP` (sincronizada con `origin/0.56.0-DEVELOP`).

---

## Capa 1: Trazabilidad en los Parsers y Tipos de Datos

En el proyecto original, las entidades generadas por los parsers no conservaban explícitamente el broker de procedencia ni emitían trazas detalladas de la ingesta de transacciones. En este fork se introduce una infraestructura de trazabilidad que permite conocer en todo momento el broker fuente (`brokerSource`) a lo largo del flujo de cálculo (FIFO de acciones, FX FIFO y generación de informes), así como registros en consola durante el parseo.

### 1.1 Modificaciones en Tipos de Datos (`src/types/`)

#### A. Tipos de IBKR / Generales (`src/types/ibkr.ts`)
Se añade la propiedad opcional `brokerSource?: string` a todas las estructuras de datos que representan transacciones u objetos parseados:

```typescript
// src/types/ibkr.ts
export interface Trade {
  // ...
  brokerSource?: string;
}

export interface CashTransaction {
  // ...
  brokerSource?: string;
  costInEur?: string; // Campo añadido para trazabilidad de coste en EUR
}

export interface CorporateAction {
  // ...
  brokerSource?: string;
}

export interface OpenPosition {
  // ...
  brokerSource?: string;
}

export interface SecurityInfo {
  // ...
  brokerSource?: string;
}

export interface CashBalance {
  // ...
  brokerSource?: string;
}

export interface OptionExercise {
  // ...
  brokerSource?: string;
}
```

#### B. Tipos Fiscales y de Motor (`src/types/tax.ts`)
La trazabilidad se propaga a los resultados de enajenación y lotes de divisas:

```typescript
// src/types/tax.ts
export interface FifoDisposal {
  // ...
  brokerSource?: string; // Origen del broker para auditoría
}

export interface FxLot {
  // ...
  trigger: FxTrigger;
  brokerSource?: string;
}

export interface FxTraceEvent {
  // ...
  brokerSource?: string;
}

export interface FxDisposal {
  // ...
  brokerSource?: string; // Origen del broker para auditoría
}
```

---

### 1.2 Trazabilidad Implementada en Parsers (`src/parsers/`)

Se ha propagado de manera homogénea la inyección de `brokerSource` en la totalidad de los 13 parsers soportados por DeclaRenta:

#### 1. Interactive Brokers (`src/parsers/ibkr.ts`)
- **Identificador de broker:** `"IBKR"`
- **Puntos de inyección:** `mapTrade()`, `mapCashTransaction()`, `mapCorporateAction()`, `mapOpenPosition()`, `mapSecurityInfo()`, `mapCashBalance()`, `parseOptionEaeRows()`.

#### 2. Binance (`src/parsers/binance.ts`)
- **Identificador de broker:** `"Binance"`
- **Puntos de inyección:** Operaciones spot (`parseBinanceCsv()`), rendimientos/staking crypto (`parseBinanceTxCsv()`), y swaps de criptomonedas (`emitCryptoSwap()`). Incorpora logging en consola por operación.

#### 3. Lightyear (`src/parsers/lightyear.ts`)
- **Identificador de broker:** `"LY"`
- **Puntos de inyección:** Dividendos, retenciones fiscales, intereses, conversiones FX y operaciones de acciones.
- **Lógica específica:** Deducción de comisión en distribuciones de fondos (`txType === "distribution"`) y ajuste de signos en comisiones.

#### 4. Degiro (`src/parsers/degiro.ts`)
- **Identificador de broker:** `"Degiro"`
- **Puntos de inyección:** Trades de compra/venta y transacciones de efectivo (dividendos y retenciones).

#### 5. Trade Republic (`src/parsers/trade-republic.ts`)
- **Identificador de broker:** `"TradeRepublic"`
- **Puntos de inyección:** Operaciones de trading (acciones/ETFs), dividendos, retenciones fiscales (`Withholding Tax`), abonos de intereses de efectivo y reembolsos/optimizaciones fiscales.

#### 6. Revolut (`src/parsers/revolut.ts`)
- **Identificador de broker:** `"Revolut"`
- **Puntos de inyección:** Operaciones de trading tanto en formato de transacciones como en formato de posiciones cerradas (piernas de compra y venta), depósitos/retiradas de efectivo y posiciones abiertas (`OpenPosition`).

#### 7. Scalable Capital (`src/parsers/scalable.ts`)
- **Identificador de broker:** `"Scalable"`
- **Puntos de inyección:** Operaciones de compra/venta de acciones y ETFs, distribuciones/dividendos, retenciones y abonos/cargos de intereses de efectivo.

#### 8. Trading 212 (`src/parsers/trading212.ts`)
- **Identificador de broker:** `"Trading212"`
- **Puntos de inyección:** Operaciones de compra/venta, dividendos, retenciones fiscales e intereses de cuenta.

#### 9. Coinbase (`src/parsers/coinbase.ts`)
- **Identificador de broker:** `"Coinbase"`
- **Puntos de inyección:** Rendimientos de crypto reward / staking, conversiones (compra y venta) y órdenes spot de compra/venta.

#### 10. Kraken (`src/parsers/kraken.ts`)
- **Identificador de broker:** `"Kraken"`
- **Puntos de inyección:** Operaciones de trading spot de criptomonedas y transacciones de rendimientos por staking.

#### 11. eToro (`src/parsers/etoro.ts`)
- **Identificador de broker:** `"eToro"`
- **Puntos de inyección:** Operaciones cerradas (piernas de apertura y cierre), dividendos, retenciones fiscales y pagos de intereses en cuenta.

#### 12. Flatex (`src/parsers/flatex.ts`)
- **Identificador de broker:** `"Flatex"`
- **Puntos de inyección:** Operaciones de trading en cuenta de custodia y transacciones de efectivo en libreta de cuenta (dividendos, retenciones, etc.).

#### 13. Freedom24 (`src/parsers/freedom24.ts`)
- **Identificador de broker:** `"Freedom24"`
- **Puntos de inyección:** Operaciones de trading y acciones corporativas (dividendos y retenciones fiscales).

---

### 1.3 Estado de Cobertura de Parsers

Todos los parsers del registro oficial cuentan ahora con la propiedad `brokerSource` asignada en cada objeto emitido, garantizando que tanto en importaciones individuales como en archivos consolidados a través de `mergeStatement()` se preserve la trazabilidad del broker originario.

---

### 1.4 Propagación Downstream de la Trazabilidad

La presencia de `brokerSource` en los parsers permite:
1. **Motor FIFO de acciones (`src/engine/fifo.ts`):** Propagar `brokerSource` del trade a `FifoDisposal`, permitiendo auditar qué broker originó cada ganancia o pérdida patrimonial.
2. **Motor FX FIFO (`src/engine/fx-fifo.ts`):** Recibir `brokerSource` en `FxEvent` a partir de trades y transacciones de efectivo, asignándolo a `FxLot` y emitiéndolo en trazas de eventos (`FxTraceEvent`).
3. **Módulo de Logging (`src/utils/utils.ts`):** Filtrar trazas y registros de consola por broker mediante la lista `brokersPerm: string[] = []`, posibilitando aislar la operativa de un único broker (por ejemplo solo `"IBKR"` o solo `"LY"`).

---

## 2. Capa 2: Motor FX FIFO (`src/engine/fx-fifo.ts`) y Estrategia de Flag / Selector

### 2.1 Contexto Doctrinal y Antecedentes (Issue #230)

El debate sobre cómo debe impactar en la divisa una venta de acciones en moneda extranjera (por ejemplo acciones compradas y vendidas en USD) fue discutido en profundidad en el [Issue #230 de DeclaRenta](https://github.com/GeiserX/DeclaRenta/issues/230) entre `elmasvital` y `GeiserX`:

1. **El vacío normativo:**  
   La Ley del IRPF (LIRPF) y las consultas vinculantes de la DGT no contemplan expresamente el ordenamiento del FIFO de la divisa cuando esta ha permanecido invertida en acciones. Como reconoció el propio autor oficial:
   > *"Tienes razón en que el 'aparcamiento' de la divisa no tiene una base explícita en la ley — la ley simplemente no dice cómo ordenar el FIFO de una divisa cuando parte de ella está 'metida' en una acción todavía en cartera. Es un hueco que el motor rellena con un criterio razonado, no un mandato... ambos son lecturas razonadas de un hueco."*

2. **Modelo Oficial (*Carry-Basis* - GeiserX):**
   - **En compras:** El principal en divisa se "aparca" (`parkPrincipal`), saliendo del inventario de divisa disponible pero reteniendo su base de coste en euros.
   - **En ventas:** Se recupera el principal aparcado (`unparkAndReadd`) devolviéndolo a la cola FIFO con su fecha y tipo de adquisición original. Si hay beneficio en divisa, los dólares extra se añaden al tipo de cambio de la venta. Si hay pérdida, se busca mantener la conservación matemática estricta del saldo total.

3. **Modelo del Fork (*Destrucción de Divisa por Minusvalía* - `elmasvital` / `lossFxFifo`):**
   - Si se compran acciones por 10.000 $ y se venden por 8.000 $, se han perdido físicamente 2.000 $.
   - **Tratamiento del inventario:** Hay que retirar esos 2.000 $ del inventario de lotes FIFO (`lots.shift()`) para que el saldo real en cuenta coincida y no queden "dólares fantasma".
   - **Tratamiento fiscal:** **NO debe generarse ninguna liquidación fiscal de divisa** (`disposals.push` bloqueado). Esos 2.000 $ nunca se convirtieron a euros ni se disfrutaron patrimonialmente; la pérdida económica ya está imputada al 100% en la casilla de ganancias/pérdidas de acciones (Art. 35 LIRPF). Generar además una transmisión de divisa (Art. 33.1 LIRPF) computaría una segunda pérdida o ganancia cambiaria ficticia sobre dinero evaporado.

---

### 2.2 Problema de Mantenimiento en el Fork Actual

En la rama `0.56.0-FXMOD_DEVELOP`, este modelo se programó modificando directamente el código central:
1. Comentando llamadas del motor oficial (`// this.parkPrincipal(event)`).
2. Modificando `unparkAndReadd` para invocar a `lossFxFifo`.
3. Comentando `this.disposals.push(...)`.
4. Incrustando llamadas directas a utilidades de logging por consola (`logO`).

**El problema:**  
Entre la versión 0.56 y la 0.61.8+, el motor oficial incorporó más de 500 líneas nuevas: acumuladores obligatorios de conservación de divisa (`checkConservation` / issue #260), gestión de spread real en conversiones (issue #253), trazas de auditoría (`FxTraceEvent`), y manejo multidivisa estricto.  
Al hacer un `merge` o `rebase` directo de `upstream/main`, estas modificaciones "a machete" provocan colisiones graves y rompen los tests de conservación del motor oficial.

---

### 2.3 Estrategia Técnica de Actualización: Patrón Selector / Flag

Para poder **actualizar el fork a la versión oficial más reciente (v0.61.8+) y seguir recibiendo actualizaciones futuras sin esfuerzo**, la solución técnica consiste en desacoplar tu lógica mediante un **flag o selector de modo de cálculo**:

```
                              ┌──────────────────────────────────┐
                              │ fxStockLossMode                  │
                              └─────────────────┬────────────────┘
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       ▼                                                 ▼
             "carry-basis" (Default Upstream)                 "destruction" (Modo Fork)
      ──────────────────────────────────────────       ──────────────────────────────────────────
      - Flujo estándar oficial GeiserX.                - Ejecuta `lossFxFifo`.
      - Usa `parkPrincipal` y `unparkAndReadd`.        - Reduce lotes del pool FIFO (`lots.shift`).
      - Pasa el 100% de la suite de tests oficial.     - Bloquea `disposals.push` (sin venta fiscal).
                                                       - Notifica a `accumulate("discard", ...)`
                                                         para cuadrar `checkConservation`.
```

#### 1. Definición de Tipos y Opciones
En `src/types/tax.ts` o en las opciones de `FxFifoEngine`:
```typescript
export type FxStockLossMode = "carry-basis" | "destruction";

export interface FxFifoEngineOptions {
  traditionalCostBasis?: boolean;
  stockLossMode?: FxStockLossMode; // Por defecto: "carry-basis"
}
```

#### 2. Bifurcación Limpia en `src/engine/fx-fifo.ts`
En lugar de comentar código del motor oficial, se introduce una condición clara en los puntos clave:

* **En la gestión de la compra/venta de acciones:**
  ```typescript
  if (event.kind === "stock_buy") {
    if (this.stockLossMode === "destruction") {
      // Modo Fork: no aparca principal en acciones
      return;
    }
    this.parkPrincipal(event);
  }
  ```

* **En la venta de acciones con pérdida:**
  ```typescript
  if (profit.lessThan(EPS)) {
    if (this.stockLossMode === "destruction") {
      this.lossFxFifo(event);
      return;
    }
    // Flujo oficial carry-basis...
  }
  ```

#### 3. Conciliación con los Acumuladores de Conservación de la v0.61.8
Para que la versión moderna no emita alertas de descuadre (`fx.conservation_mismatch`), `lossFxFifo` debe registrar la salida de los dólares quemados en el acumulador de descartes que GeiserX añadió en el PR #260:
```typescript
private lossFxFifo(event: FxEvent): void {
  // 1. Consume los lotes FIFO del pool de divisas...
  // 2. NO hace this.disposals.push (evita la venta ficticia en Renta)
  // 3. Notifica al acumulador de balance oficial:
  this.accumulate("discard", event.currency, consumedQty);
  this.record("discard", event, { quantityFcy: consumedQty, rate: effRate, note: "minusvalía bursátil → divisa destruida sin hecho imponible" });
}
```
De este modo:
- El balance de divisa cuadra con rigor contable en el test de conservación.
- La declaración de la Renta queda 100% limpia de ventas ficticias de divisa.

#### 4. Aislamiento del Logging Visual
Las funciones de consola y coloreado ANSI (`src/utils/utils.ts` / `logO`) no deben incrustarse directamente en medio del algoritmo matemático, sino conectarse al sistema de eventos (`this.emit(...)` o un suscriptor de eventos de traza). Así, el motor se mantiene puro y fácil de rebasear.

---

### 2.4 Hoja de Ruta para Aplicar la Actualización al Fork

1. **Paso 1:** Rebasar o fusionar la base oficial `v0.61.8` en una rama de trabajo.
2. **Paso 2:** Incorporar la interfaz `FxStockLossMode` en las opciones de `FxFifoEngine`.
3. **Paso 3:** Implementar `lossFxFifo` respetando los métodos auxiliares modernos (`this.accumulate("discard")` y `this.record("discard")`).
4. **Paso 4:** Añadir pruebas unitarias dedicadas en `tests/engine/fx-fifo-destruction.test.ts` que demuestren que:
   - En modo `"destruction"`, una venta con minusvalía reduce el saldo de USD pero genera **0** disposals.
   - En modo `"carry-basis"`, se mantiene la compatibilidad idéntica con el oficial.
5. **Paso 5:** Exponer el selector en la CLI (`--fx-stock-loss-mode`) y en el formulario de opciones de la interfaz Web.


---

## Próximas Capas a Documentar
- **Capa 3:** Sistema de Logging y Utilidades ANSI (`src/utils/utils.ts`): registro visual coloreado de eventos (`FXAdd`, `FXCons`, `STKPark`, `BUYSTK`, lotes cerrados y remanentes) y filtrado selectivo por broker.
- **Capa 4:** Informes y Generadores (`src/generators/report.ts`): campos de trazabilidad, desglose por broker y ajustes en reportes finales.

---

## 2. Capa 2: Motor FX FIFO (`src/engine/fx-fifo.ts`) y Estrategia de Flag / Selector

### 2.1 Contexto Doctrinal y Antecedentes (Issue #230)

El debate sobre cómo debe impactar en la divisa una venta de acciones en moneda extranjera (por ejemplo acciones compradas y vendidas en USD) fue discutido en profundidad en el [Issue #230 de DeclaRenta](https://github.com/GeiserX/DeclaRenta/issues/230) entre `elmasvital` y `GeiserX`:

1. **El vacío normativo:**  
   La Ley del IRPF (LIRPF) y las consultas vinculantes de la DGT no contemplan expresamente el ordenamiento del FIFO de la divisa cuando esta ha permanecido invertida en acciones. Como reconoció el propio autor oficial:
   > *"Tienes razón en que el 'aparcamiento' de la divisa no tiene una base explícita en la ley — la ley simplemente no dice cómo ordenar el FIFO de una divisa cuando parte de ella está 'metida' en una acción todavía en cartera. Es un hueco que el motor rellena con un criterio razonado, no un mandato... ambos son lecturas razonadas de un hueco."*

2. **Modelo Oficial (*Carry-Basis* - GeiserX):**
   - **En compras:** El principal en divisa se "aparca" (`parkPrincipal`), saliendo del inventario de divisa disponible pero reteniendo su base de coste en euros.
   - **En ventas:** Se recupera el principal aparcado (`unparkAndReadd`) devolviéndolo a la cola FIFO con su fecha y tipo de adquisición original. Si hay beneficio en divisa, los dólares extra se añaden al tipo de cambio de la venta. Si hay pérdida, se busca mantener la conservación matemática estricta del saldo total.

3. **Modelo del Fork (*Destrucción de Divisa por Minusvalía* - `elmasvital` / `lossFxFifo`):**
   - Si se compran acciones por 10.000 $ y se venden por 8.000 $, se han perdido físicamente 2.000 $.
   - **Tratamiento del inventario:** Hay que retirar esos 2.000 $ del inventario de lotes FIFO (`lots.shift()`) para que el saldo real en cuenta coincida y no queden "dólares fantasma".
   - **Tratamiento fiscal:** **NO debe generarse ninguna liquidación fiscal de divisa** (`disposals.push` bloqueado). Esos 2.000 $ nunca se convirtieron a euros ni se disfrutaron patrimonialmente; la pérdida económica ya está imputada al 100% en la casilla de ganancias/pérdidas de acciones (Art. 35 LIRPF). Generar además una transmisión de divisa (Art. 33.1 LIRPF) computaría una segunda pérdida o ganancia cambiaria ficticia sobre dinero evaporado.

---

### 2.2 Problema de Mantenimiento en el Fork Actual

En la rama `0.56.0-FXMOD_DEVELOP`, este modelo se programó modificando directamente el código central:
1. Comentando llamadas del motor oficial (`// this.parkPrincipal(event)`).
2. Modificando `unparkAndReadd` para invocar a `lossFxFifo`.
3. Comentando `this.disposals.push(...)`.
4. Incrustando llamadas directas a utilidades de logging por consola (`logO`).

**El problema:**  
Entre la versión 0.56 y la 0.61.8+, el motor oficial incorporó más de 500 líneas nuevas: acumuladores obligatorios de conservación de divisa (`checkConservation` / issue #260), gestión de spread real en conversiones (issue #253), trazas de auditoría (`FxTraceEvent`), y manejo multidivisa estricto.  
Al hacer un `merge` o `rebase` directo de `upstream/main`, estas modificaciones "a machete" provocan colisiones graves y rompen los tests de conservación del motor oficial.

---

### 2.3 Estrategia Técnica de Actualización: Patrón Selector / Flag

Para poder **actualizar el fork a la versión oficial más reciente (v0.61.8+) y seguir recibiendo actualizaciones futuras sin esfuerzo**, la solución técnica consiste en desacoplar tu lógica mediante un **flag o selector de modo de cálculo**:

```
                              ┌──────────────────────────────────┐
                              │ fxStockLossMode                  │
                              └─────────────────┬────────────────┘
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       ▼                                                 ▼
             "carry-basis" (Default Upstream)                 "destruction" (Modo Fork)
      ──────────────────────────────────────────       ──────────────────────────────────────────
      - Flujo estándar oficial GeiserX.                - Ejecuta `lossFxFifo`.
      - Usa `parkPrincipal` y `unparkAndReadd`.        - Reduce lotes del pool FIFO (`lots.shift`).
      - Pasa el 100% de la suite de tests oficial.     - Bloquea `disposals.push` (sin venta fiscal).
                                                       - Notifica a `accumulate("discard", ...)`
                                                         para cuadrar `checkConservation`.
```

#### 1. Definición de Tipos y Opciones
En `src/types/tax.ts` o en las opciones de `FxFifoEngine`:
```typescript
export type FxStockLossMode = "carry-basis" | "destruction";

export interface FxFifoEngineOptions {
  traditionalCostBasis?: boolean;
  stockLossMode?: FxStockLossMode; // Por defecto: "carry-basis"
}
```

#### 2. Bifurcación Limpia en `src/engine/fx-fifo.ts`
En lugar de comentar código del motor oficial, se introduce una condición clara en los puntos clave:

* **En la gestión de la compra/venta de acciones:**
  ```typescript
  if (event.kind === "stock_buy") {
    if (this.stockLossMode === "destruction") {
      // Modo Fork: no aparca principal en acciones
      return;
    }
    this.parkPrincipal(event);
  }
  ```

* **En la venta de acciones con pérdida:**
  ```typescript
  if (profit.lessThan(EPS)) {
    if (this.stockLossMode === "destruction") {
      this.lossFxFifo(event);
      return;
    }
    // Flujo oficial carry-basis...
  }
  ```

#### 3. Conciliación con los Acumuladores de Conservación de la v0.61.8
Para que la versión moderna no emita alertas de descuadre (`fx.conservation_mismatch`), `lossFxFifo` debe registrar la salida de los dólares quemados en el acumulador de descartes que GeiserX añadió en el PR #260:
```typescript
private lossFxFifo(event: FxEvent): void {
  // 1. Consume los lotes FIFO del pool de divisas...
  // 2. NO hace this.disposals.push (evita la venta ficticia en Renta)
  // 3. Notifica al acumulador de balance oficial:
  this.accumulate("discard", event.currency, consumedQty);
  this.record("discard", event, { quantityFcy: consumedQty, rate: effRate, note: "minusvalía bursátil → divisa destruida sin hecho imponible" });
}
```
De este modo:
- El balance de divisa cuadra con rigor contable en el test de conservación.
- La declaración de la Renta queda 100% limpia de ventas ficticias de divisa.

#### 4. Aislamiento del Logging Visual
Las funciones de consola y coloreado ANSI (`src/utils/utils.ts` / `logO`) no deben incrustarse directamente en medio del algoritmo matemático, sino conectarse al sistema de eventos (`this.emit(...)` o un suscriptor de eventos de traza). Así, el motor se mantiene puro y fácil de rebasear.

---

### 2.4 Hoja de Ruta para Aplicar la Actualización al Fork

1. **Paso 1:** Rebasar o fusionar la base oficial `v0.61.8` en una rama de trabajo.
2. **Paso 2:** Incorporar la interfaz `FxStockLossMode` en las opciones de `FxFifoEngine`.
3. **Paso 3:** Implementar `lossFxFifo` respetando los métodos auxiliares modernos (`this.accumulate("discard")` y `this.record("discard")`).
4. **Paso 4:** Añadir pruebas unitarias dedicadas en `tests/engine/fx-fifo-destruction.test.ts` que demuestren que:
   - En modo `"destruction"`, una venta con minusvalía reduce el saldo de USD pero genera **0** disposals.
   - En modo `"carry-basis"`, se mantiene la compatibilidad idéntica con el oficial.
5. **Paso 5:** Exponer el selector en la CLI (`--fx-stock-loss-mode`) y en el formulario de opciones de la interfaz Web.
