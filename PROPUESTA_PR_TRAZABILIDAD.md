# Propuesta de Pull Request al Proyecto Original: Capa de Trazabilidad Transaccional (`brokerSource`)

Este documento analiza la idoneidad, beneficios, impacto técnico y compatibilidad de extraer la capa de trazabilidad de este fork y proponerla como un **Pull Request (PR)** al repositorio oficial [GeiserX/DeclaRenta](https://github.com/GeiserX/DeclaRenta).

---

## 1. Justificación y Valor Añadido: ¿En qué mejora al proyecto oficial?

### 1.1 Alineamiento con el diseño original del autor upstream
Al inspeccionar el código de `upstream/main` (v0.61.8), encontramos un hallazgo fundamental en `src/types/ibkr.ts` (línea 102):

```typescript
export interface Trade {
  // ...
  /** Optional: which broker produced this trade (for cross-broker reports) */
  brokerSource?: string;
}
```

El autor original del proyecto oficial **ya concibió e introdujo esta propiedad**, documentando explícitamente su propósito: *identificar qué broker produjo cada operación para informes multi-broker*. Sin embargo, dicha iniciativa quedó incompleta:
- Solo se rellenaba en `src/parsers/binance.ts` y en un caso sintético en `src/generators/report.ts`.
- Los otros 12 parsers oficiales (IBKR, Degiro, Revolut, Lightyear, Trade Republic, Scalable, Trading 212, Coinbase, Kraken, eToro, Flatex, Freedom24) **nunca la asignaban**.
- Ninguna otra entidad transaccional (`CashTransaction`, `CorporateAction`, `OpenPosition`, `CashBalance`, `OptionExercise`) tenía la propiedad.
- Los resultados de cálculo (`FifoDisposal`, `FxDisposal`, `FxLot`, `FxTraceEvent`) perdían la pista del broker emisor.

### 1.2 Beneficios funcionales directos

1. **Auditoría e informes multi-broker consolidados:**
   Una de las mayores virtudes de DeclaRenta es admitir múltiples archivos de diferentes entidades financieras y unificarlos con `mergeStatement()`. Sin embargo, tras la fusión, las transacciones se mezclaban en un único flujo homogéneo donde era imposible distinguir el origen de cada dividendo, venta o retención si no se deducía por el texto de la descripción. Con `brokerSource` unificado, cada apunte conserva su procedencia institucional inequívoca.

2. **Justificación ante inspecciones fiscales (AEAT):**
   Al declarar ganancias/pérdidas patrimoniales o rendimientos de capital mobiliario ante la Agencia Tributaria en el Modelo 100 o al cumplimentar los Modelos 720/721, el contribuyente debe justificar la procedencia de cada partida ante un requerimiento. Disponer de `brokerSource` en las enajenaciones FIFO (`FifoDisposal`) y en los movimientos de divisa (`FxDisposal`) permite desglosar los resultados por entidad pagadora/custodia.

3. **Facilidad de diagnóstico y soporte de errores:**
   Cuando un cálculo descuadra o un lote FIFO queda huérfano (`UNKNOWN`), saber de inmediato si provino de Trade Republic, Scalable o Degiro ahorra horas de depuración tanto al usuario como a los desarrolladores al reproducir incidencias con ficheros anonimizados.

4. **Filtrado selectivo en herramientas de logging e inspección:**
   Permite desacoplar logs y trazas de auditoría (por ejemplo, analizar únicamente la operativa en divisas de IBKR ignorando los cientos de microtransacciones de Binance o viceversa).

---

## 2. Análisis de Colisiones y Compatibilidad con la Versión Actual (`v0.61.8`)

Se ha realizado una auditoría comparando contra el commit más reciente de upstream (`6315b33`, versión `0.61.8`). El resultado es que **no existe ninguna colisión técnica ni conceptual**:

### A. Coincidencia nominal total (`brokerSource`)
- No existe conflicto de nombres. El repositorio oficial ya emplea exactamente el identificador `brokerSource` en `Trade`. No se introduce un nombre alternativo (como `broker`, `source` o `institution`), garantizando coherencia terminológica con el repositorio upstream.

### B. Retrocompatibilidad del 100% (No invasivo)
- Todas las propiedades añadidas son opcionales (`brokerSource?: string`).
- Ningún parser existente, test unitario, generador de PDF, interfaz web o proceso CLI se rompe al procesar objetos que tengan o no tengan este campo.
- `JSON.stringify`, serializaciones de estado y tablas locales siguen operando de forma transparente.

### C. Coexistencia con las nuevas características de v0.61.8
En las versiones recientes (v0.58 a v0.61.8), upstream ha añadido:
- `holdingsBySource` en `FlexStatement` para discriminar fotos de cartera a 31 de diciembre en el Modelo 720/721.
- `custodianCountry` en `OpenPosition` para el país de custodia en el Modelo 720.
- `tradeTime` en `Trade` para ordenar operaciones intradiarias según el Art. 37.2 LIRPF.
- `openingLots` para traspasos manuales entre brokers.

`brokerSource` **no colisiona** con ninguno de estos campos; al contrario, los complementa de forma natural (por ejemplo, `HoldingsSource` agrupa por cuenta/fecha, y `brokerSource` indica el broker concreto de cada posición y saldo de caja).

### D. Rendimiento y huella en memoria
- Asignar una cadena constante (`"IBKR"`, `"Degiro"`, `"Revolut"`, etc.) durante el bucle de parseo tiene un coste computacional O(1) despreciable y añade apenas unos pocos bytes por transacción en memoria JS (las cadenas literales son internadas por el motor V8 de Node/navegadores).

---

## 3. Estrategia Recomendada para el Pull Request

Para maximizar la probabilidad de aceptación por parte del creador y mantenedor oficial ([GeiserX](https://github.com/GeiserX)), el PR debe ser **quirúrgico, limpio y centrado exclusivamente en la trazabilidad estándar**, aislando cualquier modificación particular o controvertida del fork.

### Qué DEBE incluir el PR hacia Upstream:
1. **Extensión de tipos en `src/types/ibkr.ts`:**
   - Añadir `brokerSource?: string;` a `CashTransaction`, `CorporateAction`, `OpenPosition`, `SecurityInfo`, `CashBalance`, `OptionExercise`.
2. **Propagación a tipos de cálculo en `src/types/tax.ts`:**
   - Añadir `brokerSource?: string;` a `FifoDisposal`, `FxLot`, `FxDisposal`, `FxTraceEvent`.
3. **Población en los 13 parsers oficiales (`src/parsers/`):**
   - Inyección de la constante correspondiente a cada broker (`"IBKR"`, `"Degiro"`, `"Revolut"`, `"Lightyear"`, `"TradeRepublic"`, `"Scalable"`, `"Trading212"`, `"Coinbase"`, `"Kraken"`, `"eToro"`, `"Flatex"`, `"Freedom24"`, `"Binance"`).
4. **Propagación en motores:**
   - En `src/engine/fifo.ts`: asignar `brokerSource: trade.brokerSource` en la creación de `FifoDisposal`.
   - En `src/engine/fx-fifo.ts`: asignar `brokerSource: event.brokerSource` en los eventos FX y disposals resultantes.
5. **Tests:**
   - Tests unitarios verificando que cada parser asigna su respectivo `brokerSource`.

### Qué NO debe incluir el PR (mantener en el fork como personalización):
- **NO incluir** llamadas directas a `console.log(...)` en los parsers (el proyecto original prefiere un output limpio o mensajes estructurados vía `TaxMessage`/`parserMessages`).
- **NO incluir** el fichero custom `src/utils/utils.ts` ni colores ANSI hardcodeados en el motor.
- **NO incluir** la lógica particular de comisiones en distribuciones de fondos de Lightyear (`txType === "distribution"`) en este mismo PR, ya que cambiaría las cifras fiscales de tests existentes y requeriría una discusión fiscal independiente.
- **NO incluir** las desactivaciones o comentarios en el motor FX FIFO que están siendo evaluados en este fork.

---

## 4. Borrador de Presentación del Pull Request (Draft PR)

A continuación se proporciona el texto preparado en inglés y español listo para abrir el Pull Request en GitHub:

```markdown
### Summary
Complete `brokerSource` traceability across all 13 broker parsers and engine types.

### Rationale
`Trade.brokerSource?: string` was already defined in `src/types/ibkr.ts` with the rationale:
> *"Optional: which broker produced this trade (for cross-broker reports)"*

However, it was only populated by the Binance parser. When users merge statements from multiple brokers (e.g. IBKR + Degiro + Trade Republic), all subsequent trades, cash transactions, and resulting FIFO/FX disposals lose origin provenance.

This PR completes the feature without any breaking change:
1. Adds `brokerSource?: string` to `CashTransaction`, `CorporateAction`, `OpenPosition`, `CashBalance`, `OptionExercise`, `FifoDisposal`, `FxLot`, and `FxDisposal`.
2. Populates `brokerSource` in all 13 broker parsers (`IBKR`, `Degiro`, `Revolut`, `Lightyear`, `TradeRepublic`, `Scalable`, `Trading212`, `Coinbase`, `Kraken`, `eToro`, `Flatex`, `Freedom24`, `Binance`).
3. Propagates `brokerSource` through `FifoEngine` and `FxFifoEngine` so final tax disposals carry broker auditability.

### Compatibility
- 100% backward compatible (all fields optional).
- Zero tax calculation impact (no changes to math, casillas, or report values).
- All existing parser and engine tests continue to pass.
```

---

## 5. Conclusión

Aportar esta mejora al proyecto oficial es la estrategia más beneficiosa para reducir la brecha entre el fork y el original. Al estar 100% alineada con las intenciones iniciales de GeiserX y no colisionar en absoluto con `v0.61.8`, tiene todas las probabilidades de ser aprobada y fusionada upstream. Una vez integrada en el proyecto original, este fork podrá actualizarse de forma mucho más limpia y transparente.

