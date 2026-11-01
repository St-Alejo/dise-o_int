-- Modo Pro (plan v8): preferencia de la cuenta y ficha técnica del proyecto. Aditivo: sin valor,
-- la cuenta no está en Modo Pro y el proyecto usa la ficha por defecto.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "proMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "technical" JSONB;
