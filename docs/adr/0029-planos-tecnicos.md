# ADR-0029: Planos técnicos con un modelo de dibujo propio (fase 1 del plan v8)

**Estado:** aceptada · **Fecha:** 2026-11-01

## Contexto
Un profesional necesita entregar planos: plantas acotadas, alzados, cortes, láminas a escala con
rótulo, y archivos que abra su programa de CAD. El "plano SVG" que ya existía era un dibujo de
pantalla sin grosor de muros, sin escala y sin rótulo.

## Decisión
- **Un modelo de dibujo independiente del formato** (`shared-types/src/pro/drawing/model.ts`):
  capas con nombres AIA (`A-WALL`, `A-DOOR`, `A-GLAZ`, `A-ANNO-DIMS`…), entidades simples (línea,
  polilínea, arco, círculo, texto, cota, achurado) y grupos que trasladan y escalan (Composite). Las
  vistas lo construyen con un `DrawingBuilder` (Builder).
- **Tres renderizadores, un Visitor cada uno** sobre el mismo árbol: SVG (`svg.ts`, vista previa y
  descarga), DXF R12 (`dxf.ts`) y PDF (`apps/api/.../drawings.pdf.ts`, pdfkit). Lo que se ve, lo que
  se imprime y lo que abre AutoCAD es lo mismo.
- **DXF escrito a mano, sin librerías:** R12 ASCII, metros, y invertida, texto Latin-1 con lo demás
  como `\U+XXXX`. Cotas y achurados se descomponen en líneas y textos (R12 no tiene HATCH y así se ven
  igual en AutoCAD, LibreCAD o QCAD). Una prueba relee las entidades y comprueba capas y coordenadas.
- **Achurado como geometría** (`hatch.ts`): líneas recortadas al contorno; ningún formato depende de
  sus patrones propios.
- **Vistas:** planta arquitectónica (cotas encadenadas por muro medidas en la cara interior y una
  fila total, marca del corte), de amoblamiento, de cielo raso e iluminación y de acabados; alzado
  de cada pared visto desde dentro (vanos, revestimiento, objetos a menos de 60 cm, niveles N.P.T. y
  N.C.R.); corte A–A' que corta muros y tabiques con lo de más allá en proyección.
- **Láminas:** papel A4–A1 apaisado, rótulo vertical a la derecha con los datos de la ficha, título y
  escala gráfica bajo cada vista. El texto mide 2,5 mm en el papel a la escala de la ficha; si las
  vistas no caben, se prueba la siguiente escala normalizada y la lámina lo avisa.
- **Dónde se genera:** la vista previa, el SVG y el DXF, en el navegador (instantáneo y con lo que hay
  en pantalla, aunque no se haya guardado); el juego de planos en PDF, en el servidor
  (`GET /projects/:id/drawings/set.pdf`). La API sirve también `<lámina>.svg|dxf`.
- **Corte A–A'** con un formulario (horizontal o vertical, posición y hacia dónde se mira) en vez de
  trazarlo a mano en el plano: cubre el caso habitual con mucho menos riesgo; trazarlo libre queda
  para después.

## Consecuencias
- Añadir un formato (por ejemplo, PNG de alta resolución) es escribir otro Visitor.
- Sin norte ni ejes estructurales: el cuarto no conoce su orientación ni su estructura. El rótulo
  dice "Verificar en obra antes de construir".
- El plano editable del editor sigue sin grosor de muros: la planta técnica es una vista aparte.
