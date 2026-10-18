-- CreateIndex
CREATE INDEX "EmailMessage_leadId_sentAt_idx" ON "EmailMessage"("leadId", "sentAt");

-- CreateIndex
CREATE INDEX "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");
