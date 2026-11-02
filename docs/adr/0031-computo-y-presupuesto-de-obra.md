# ADR-0031: Cómputo métrico y presupuesto de obra (fase 3 del plan v8)

**Estado:** aceptada · **Fecha:** 2026-11-01

## Contexto
El presupuesto que ya había solo sumaba muebles. Para llevar el diseño a obra hace falta saber
cuánto mide cada superficie, cuánto material comprar y cuánto cuesta instalarlo, con el formato que
usa un constructor en Colombia: análisis de precios unitarios (APU) y AIU.

## Decisión
- **Cómputo desde el modelo** (`shared-types/src/pro/takeoff/quantities.ts`): piso por material
  (las zonas con su piso propio), cielo raso, muros brutos y netos (sin vanos), revestimiento hasta
  su altura descontando la parte de los vanos que le toca, guardaescoba (perímetro menos puertas,
  dos caras por tabique) y tabiques nuevos de las zonas.
- **Lista base de actividades** (`rates.ts`) con APU en COP de referencia: material y mano de obra
  por unidad, rendimiento por día de una cuadrilla y fase de obra. La ficha técnica guarda los
  precios propios del proyecto (`rates.overrides`) y el AIU; nada se reescribe en la lista base.
- **Desperdicio como Strategy** (`WasteStrategy`, por defecto `PATTERN_WASTE`): recto 10 %,
  espiga 15 %, hexagonal 12 %, piedra 12 %, moqueta 8 %, pintura 0.
- **Compras**: cajas según el tamaño de pieza, pegante y boquilla por m², galones a 10 m²/L y dos
  manos; las líneas del mismo material y empaque se unen.
- **Cronograma**: fases en orden (instalaciones → tabiques → estuco → pisos → enchapes → pintura →
  carpintería → mobiliario); dentro de una fase las cuadrillas trabajan a la vez; días de medio en
  medio.
- **Obra + mobiliario contra el tope**: el catálogo está en USD y el APU en COP, así que la ficha
  guarda una tasa (`rates.fx`, 1 USD = 4.000 COP por defecto, editable); el mobiliario y el tope se
  convierten antes de sumar. Sin tasa para esa moneda, el mobiliario no se suma y se dice.
- **Dónde corre**: en el navegador (instantáneo, CSV sin servidor) y en la API
  (`GET /projects/:id/takeoff`, `.csv`, `.pdf`) con el mismo código.

## Consecuencias
- Los precios son orientativos; el PDF y la web lo dicen y piden ajustarlos a la zona.
- Las puertas existentes del cuarto no se presupuestan (solo las de los tabiques nuevos).
- Los puntos de instalación entran al presupuesto en cuanto existan en la ficha (fase 4).
