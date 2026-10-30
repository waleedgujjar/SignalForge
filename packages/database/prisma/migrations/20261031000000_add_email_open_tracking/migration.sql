-- Email open tracking (tracking-pixel approach).

-- New delivery-event type for recorded opens, and a source for pixel hits.
-- Not used as a value within this same migration, so no in-transaction
-- enum-use restriction applies.
ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'OPENED';
ALTER TYPE "DeliveryEventSource" ADD VALUE IF NOT EXISTS 'TRACKING';

-- Per-message open summary + opaque tracking id (random, never a DB id/email).
ALTER TABLE "EmailMessage"
  ADD COLUMN "trackingId" TEXT,
  ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "lastOpenedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EmailMessage_trackingId_key" ON "EmailMessage"("trackingId");
CREATE INDEX "EmailMessage_campaignId_campaignLeadId_idx" ON "EmailMessage"("campaignId", "campaignLeadId");
