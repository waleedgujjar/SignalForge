-- Track verification of warmup recipient addresses before use.
ALTER TABLE "WarmupRecipient" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "WarmupRecipient" ADD COLUMN "verifiedAt" TIMESTAMP(3);
