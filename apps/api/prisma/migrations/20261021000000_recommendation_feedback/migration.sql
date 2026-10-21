-- Historial de "Recomendar": propuestas enseñadas y los gestos de la persona (like, dislike,
-- kept, undone). Aditivo: no toca datos existentes.

-- CreateTable
CREATE TABLE "recommendation_feedback" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "parentId" UUID,
    "styleId" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_feedback_projectId_createdAt_idx" ON "recommendation_feedback"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "recommendation_feedback_ownerId_createdAt_idx" ON "recommendation_feedback"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
