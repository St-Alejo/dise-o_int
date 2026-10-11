-- Inventario de la foto: los muebles que el análisis reconoció, para que "Otra distribución"
-- vuelva a colocar esos y no la plantilla del tipo de cuarto. Aditivo y opcional.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "photoInventory" JSONB;
