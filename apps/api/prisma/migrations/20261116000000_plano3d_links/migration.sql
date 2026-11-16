-- Puente con Plano 3D (ADR-0039): casas enlazadas por código y la referencia de cada cuarto.
-- Aditivo: una columna opcional y una tabla nueva que se borra en cascada con su dueño.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "plano3d" JSONB;

-- CreateTable
CREATE TABLE "plano3d_links" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "plano3dProjectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "linkToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plano3d_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plano3d_links_homeId_key" ON "plano3d_links"("homeId");
CREATE INDEX "plano3d_links_ownerId_idx" ON "plano3d_links"("ownerId");

-- AddForeignKey
ALTER TABLE "plano3d_links" ADD CONSTRAINT "plano3d_links_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
