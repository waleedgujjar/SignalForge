'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { fetchCampaign } from '@/lib/api';
import { FollowUpSequenceEditor } from '@/components/campaigns/follow-up-sequence-editor';
import { EmailPreviewPanel } from '@/components/campaigns/email-preview-panel';
import { WizardNavigation } from '@/components/campaigns/campaign-wizard-stepper';
import { Skeleton } from '@/components/ui/skeleton';

export default function CampaignSequencePage() {
  const params = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  if (isLoading || !campaign) {
    return <Skeleton className="h-40 w-full" />;
  }

  const readOnly = !['DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status);
  const firstStep = campaign.steps?.[0];
  const leads = campaign.campaignLeads?.map((cl) => cl.lead) ?? [];

  return (
    <div className="space-y-0">
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <FollowUpSequenceEditor campaign={campaign} readOnly={readOnly} />
        {firstStep && leads.length > 0 && (
          <EmailPreviewPanel
            campaignId={campaign.id}
            subjectTemplate={firstStep.subjectTemplate}
            bodyTemplate={firstStep.bodyTemplate}
            leads={leads}
          />
        )}
      </div>
      {['DRAFT', 'SCHEDULED'].includes(campaign.status) && (
        <WizardNavigation campaignId={campaign.id} currentStep="sequence" />
      )}
    </div>
  );
}
