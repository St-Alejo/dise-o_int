-- Estudio de render (plan v9): galería de renders, fotos realistas y vídeos de cada proyecto.
-- Aditivo: una tabla nueva que se borra en cascada con su proyecto.

-- CreateTable
CREATE TABLE "renders" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "PreviewStatus" NOT NULL DEFAULT 'pending',
    "mediaType" TEXT,
    "fileKey" TEXT,
    "spec" JSONB,
    "sourceRenderId" UUID,
    "fidelity" TEXT,
    "provider" TEXT,
    "cacheKey" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renders_projectId_createdAt_idx" ON "renders"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "renders_projectId_cacheKey_idx" ON "renders"("projectId", "cacheKey");

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
