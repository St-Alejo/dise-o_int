# ADR-0007 — Muebles paramétricos con geometría pura y búsqueda compartida

**Estado:** aceptada · **Fecha:** 2026-10-06

## Contexto
El catálogo tenía 49 muebles y casi ninguno de pared o de superficie (lámparas de mesa, cuadros, TV,
cocina, baño). Además, en la Fase 3 cada pieza tendrá sus propias medidas: un GLB estirado deforma las
patas y los cojines. La búsqueda solo comparaba subcadenas del nombre.

## Decisión
- **`@interiores/furniture-kit`**: recetas que generan **geometría pura** (vértices, normales e índices
  por slot de material), sin depender de three.js. Patrones: **Builder + Composite** (piezas y grupos
  anidados), **Factory** (`kind → receta`) y **Flyweight** (caché por medidas al mm).
- **Dos adaptadores** de la misma geometría:
  - web (three.js): dibuja en vivo y **reconstruye** al cambiar medidas o materiales;
  - seed (glTF): exporta un GLB con materiales PBR para AR, miniaturas y respaldo.
- **Calidad verificable sin GPU**: cada receta debe medir exactamente lo pedido (±1 cm) con medidas
  variadas y sus variantes, con las caras hacia afuera y solo slots declarados (53 pruebas).
- **Catálogo**: 98 ítems paramétricos + 34 de Poly Haven (miniatura oficial) + 15 de respaldo = 147.
  Cada ítem lleva palabras de búsqueda es/en y un *spec* de personalización (receta, slots validados,
  rangos de tamaño, altura de pared, si cabe bajo una mesa).
- **Búsqueda**: función pura `searchCatalog` en `shared-types`, idéntica en servidor y navegador:
  sin acentos, plurales es/en, trigramas para errores de tipeo, sinónimos por categoría y semántica AND.
  El API mantiene el catálogo en memoria 60 s y expone `GET /catalog/search` paginado por cursor.
  No se usan `pg_trgm` ni `unaccent`: el catálogo es pequeño y así no hacen falta extensiones de
  PostgreSQL, que en una base gestionada exigen permisos de superusuario.
- **Colocación automática por montaje**: pared → primera pared con espacio, mirando al cuarto;
  superficie → el soporte más apropiado (lámpara → mesa de noche) guardando `supportId`.

## Consecuencias
- Agregar un mueble nuevo es escribir una receta (≈ 20 líneas) y una entrada del manifiesto; la prueba
  de recetas y la del manifiesto lo validan solas.
- Las miniaturas de los paramétricos se renderizan en el navegador (con caché en IndexedDB); el primer
  render de cada una cuesta unos milisegundos.
- Si el catálogo crece a miles de ítems, la búsqueda debería pasar a la base de datos (índices
  trigram) manteniendo la misma interfaz `ICatalogRepository`.
