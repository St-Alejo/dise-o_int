-- v3: acabados del cuarto, medidas pedidas por el usuario y metadatos de personalización del catálogo.
-- Todo es aditivo y opcional: los proyectos y el catálogo existentes siguen siendo válidos.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "finishes" JSONB,
ADD COLUMN "requestedRoom" JSONB;

-- AlterTable
ALTER TABLE "project_versions" ADD COLUMN "finishes" JSONB;

-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN "description" TEXT,
ADD COLUMN "spec" JSONB,
ADD COLUMN "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
