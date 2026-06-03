@"
# FLUJO DE LOS LOTES FIFOFX EN DECLARENTA

## 📍 Donde aparecen los lotes FIFOFX:

1. **CREACIÓN** en `src/engine/fx-fifo.ts`:
   - Clase: `FxFifoEngine`
   - Método: `private addLot(event)` - crea una `FxLot`
   - Propiedad: `private lots: Map<string, FxLot[]>` (mapa interno)

2. **CONSUMO** en `src/engine/fx-fifo.ts`:
   - Método: `private consumeLots(event)` - consume lotes via FIFO
   - Retorna: `FxDisposal[]` (los lotes consumidos + ganancia/pérdida)

3. **ACCESO A LOTES RESTANTES**:
   - Método público: `getRemainingLots(): Map<string, FxLot[]>`
   - Devuelve los lotes que NO fueron consumidos

## ❌ DONDE DESAPARECEN:

### ⚠️ PUNTO CRÍTICO: En `src/generators/report.ts` (líneas 194-212)

El engine calcula los lotes, pero:
- ✅ Se usan los `FxDisposal` (línea 198: processEvents() devuelve disposals)
- ✅ Se incluyen en el reporte (los disposals se ponen en `TaxSummary.fxGains.disposals`)
- ❌ Se IGNORAN los lotes restantes con `getRemainingLots()`
- ❌ No hay forma de ver qué lotes FX siguen abiertos

### Los lotes desaparecen aquí:

  const fxEngine = new FxFifoEngine();
  const allFxDisposals = fxEngine.processEvents([...]);  // ← Se crea fxEngine
  fxDisposals = allFxDisposals.filter(...);  // ← Solo se usan los disposals
  // ... fxEngine.getRemainingLots() NUNCA SE LLAMA

## 🔍 IMPACTO:

- El usuario no puede ver qué lotes FX están pendientes (posiciones abiertas)
- El TaxSummary NO tiene un campo para `remainingFxLots`
- Solo se reporten las VENTAS (FxDisposal), no los SALDOS

## 📊 Estructura de datos actual:

TaxSummary.fxGains = {
  transmissionValue,    // Casilla 1633
  acquisitionValue,     // Casilla 1637
  netGainLoss,          // 1633 - 1637
  disposals: FxDisposal[]  // ← Aquí están los lotes consumidos
  // ❌ NO HAY CAMPO para lotes restantes
}
"@
