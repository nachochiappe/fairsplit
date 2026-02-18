CREATE TABLE "SuperCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SuperCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Category"
ADD COLUMN "superCategoryId" TEXT;

CREATE UNIQUE INDEX "SuperCategory_slug_key" ON "SuperCategory"("slug");
CREATE INDEX "SuperCategory_archivedAt_sortOrder_name_idx" ON "SuperCategory"("archivedAt", "sortOrder", "name");
CREATE INDEX "Category_superCategoryId_idx" ON "Category"("superCategoryId");

ALTER TABLE "Category"
ADD CONSTRAINT "Category_superCategoryId_fkey"
FOREIGN KEY ("superCategoryId") REFERENCES "SuperCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SuperCategory" ("id", "name", "slug", "color", "icon", "sortOrder", "isSystem", "createdAt", "updatedAt")
VALUES
  ('sc_housing', 'Housing', 'housing', '#4f46e5', 'home', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sc_essentials', 'Essentials', 'essentials', '#f59e0b', 'cart', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sc_mobility', 'Mobility', 'mobility', '#0891b2', 'car', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sc_finance', 'Finance', 'finance', '#7c3aed', 'wallet', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sc_lifestyle', 'Lifestyle', 'lifestyle', '#10b981', 'sparkles', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sc_other', 'Other', 'other', '#64748b', 'dots', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "Category"
SET "superCategoryId" = CASE
  WHEN lower("name") ~ '(housing|home|casa|hogar|rent|alquiler|mortgage|hipoteca|utilities|luz|agua|gas|internet|fijo)' THEN 'sc_housing'
  WHEN lower("name") ~ '(food|comida|super|supermercado|grocery|market|health|salud|pharmacy|farmacia|essential)' THEN 'sc_essentials'
  WHEN lower("name") ~ '(transport|transporte|mobility|uber|cabify|taxi|bus|train|nafta|combustible|fuel|auto|car|parking)' THEN 'sc_mobility'
  WHEN lower("name") ~ '(finance|bank|banco|tax|impuesto|debt|loan|credito|credit|insurance|seguro|fee|investment|savings)' THEN 'sc_finance'
  WHEN lower("name") ~ '(lifestyle|travel|viaje|trip|salidas|entertainment|ocio|restaurant|restaurante|tech|tecnologia|shopping|subscription)' THEN 'sc_lifestyle'
  ELSE NULL
END;
