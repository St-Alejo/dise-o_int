-- Viviendas: varios cuartos de una misma persona agrupados bajo un nombre. Aditivo y opcional:
-- un cuarto sin vivienda sigue siendo un proyecto suelto, como hasta ahora.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "homeId" UUID,
ADD COLUMN "homeName" TEXT;

-- CreateIndex
CREATE INDEX "projects_ownerId_homeId_idx" ON "projects"("ownerId", "homeId");
