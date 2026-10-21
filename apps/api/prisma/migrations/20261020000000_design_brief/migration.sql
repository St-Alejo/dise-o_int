-- Brief de diseño: lo que la persona fijó (estilo, piso, piezas, zonas) para que "Recomendar"
-- lo respete. Aditivo y opcional: sin valor, no hay nada fijado.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "brief" JSONB;
