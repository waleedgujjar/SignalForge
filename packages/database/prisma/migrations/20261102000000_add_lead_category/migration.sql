-- Local-business category on every lead (editable; populated by the categorizer on import).
ALTER TABLE "Lead" ADD COLUMN "category" TEXT;

CREATE INDEX "Lead_workspaceId_category_idx" ON "Lead"("workspaceId", "category");
