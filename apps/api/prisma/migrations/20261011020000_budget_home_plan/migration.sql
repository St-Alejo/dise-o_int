-- Tope de presupuesto del cuarto y su sitio en la planta conjunta de la vivienda. Aditivo y
-- opcional: sin valor, el cuarto no tiene tope y se coloca solo junto a los demás.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "homePosition" JSONB,
ADD COLUMN "budgetCap" DOUBLE PRECISION;
