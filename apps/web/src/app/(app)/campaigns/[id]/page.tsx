'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Pause, RotateCcw, Square, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import * as React from 'react';

import { fetchCampaign, fetchCampaignExecutionPlan, launchCampaign, pauseCampaign, resumeCampaign, stopCampaign, updateCampaign, validateCampaign } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CampaignValidationChecklist } from '@/components/campaigns/campaign-validation-checklist';
import { CampaignSendingProgress } from '@/components/campaigns/campaign-sending-progress';
import { StopCampaignDialog } from '@/components/campaigns/stop-campaign-dialog';
import { Skeleton } from '@/components/ui/skeleton';

import type { ReplyHandlingPolicy } from '@/lib/api';

const DEFAULT_REPLY_HANDLING: ReplyHandlingPolicy = {
  pauseOnReply: false,
  stopOnReply: true,
  autoArchiveOoo: false,
  detectUnsubscribe: true,
};

export default function CampaignOverviewPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [stopOpen, setStopOpen] = React.useState(false);
  const [validation, setValidation] = React.useState<Awaited<ReturnType<typeof validateCampaign>> | null>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  const { data: executionPlan } = useQuery({
    queryKey: ['campaign', params.id, 'execution-plan'],
    queryFn: () => fetchCampaignExecutionPlan(params.id),
    enabled: Boolean(campaign && ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(campaign.status)),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['campaign', params.id] });
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  const validateMutation = useMutation({
    mutationFn: () => validateCampaign(params.id),
    onSuccess: (result) => {
      setValidation(result);
      toast.success(result.valid ? 'Campaign is ready to launch' : 'Validation found issues');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const launchMutation = useMutation({
    mutationFn: () => launchCampaign(params.id),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Campaign launched');
        invalidate();
      } else if (result.validation) {
        setValidation(result.validation);
        toast.error('Launch blocked — fix validation issues first');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pauseMutation = useMutation({
    mutationFn: () => pauseCampaign(params.id),
    onSuccess: () => {
      toast.success('Campaign paused');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeCampaign(params.id),
    onSuccess: () => {
      toast.success('Campaign resumed');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stopMutation = useMutation({
    mutationFn: (reason?: string) => stopCampaign(params.id, { confirmed: true, reason }),
    onSuccess: () => {
      toast.success('Campaign stopped');
      setStopOpen(false);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const replyPolicy = {
    ...DEFAULT_REPLY_HANDLING,
    ...(campaign?.replyHandlingPolicy as Partial<ReplyHandlingPolicy> | undefined),
  };

  const replyHandlingMutation = useMutation({
    mutationFn: (patch: Partial<ReplyHandlingPolicy>) =>
      updateCampaign(params.id, {
        replyHandlingPolicy: { ...replyPolicy, ...patch },
      }),
    onSuccess: () => {
      toast.success('Reply handling updated');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !campaign) {
    return <Skeleton className="h-40 w-full" />;
  }

  const canLaunch = ['DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status);
  const canPause = ['ACTIVE', 'SCHEDULED'].includes(campaign.status);
  const canResume = campaign.status === 'PAUSED';
  const canStop = ['ACTIVE', 'PAUSED', 'SCHEDULED'].includes(campaign.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Campaign actions</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Validate
              </Button>
              {canLaunch && (
                <Button size="sm" onClick={() => launchMutation.mutate()} disabled={launchMutation.isPending}>
                  <Play className="mr-2 h-4 w-4" />
                  Launch
                </Button>
              )}
              {canPause && (
                <Button variant="outline" size="sm" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </Button>
              )}
              {canResume && (
                <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resume
                </Button>
              )}
              {canStop && (
                <Button variant="destructive" size="sm" onClick={() => setStopOpen(true)}>
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Stat label="Leads" value={campaign._count?.campaignLeads ?? 0} />
            <Stat label="Steps" value={campaign._count?.steps ?? 0} />
            <Stat label="Mailboxes" value={campaign._count?.mailboxes ?? 0} />
          </CardContent>
        </Card>

        {['ACTIVE', 'SCHEDULED', 'PAUSED', 'COMPLETED', 'STOPPED'].includes(campaign.status) && (
          <CampaignSendingProgress campaignId={params.id} />
        )}

        {executionPlan && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution plan (preview)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {executionPlan.count} planned send job(s). This is an estimate — actual sending is
                driven by campaign schedule, daily limits, and per-mailbox availability.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reply handling</CardTitle>
            <CardDescription>
              Control how enrolled leads are treated when they reply to campaign emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <Label htmlFor="pause-on-reply">Pause on reply</Label>
                <p className="text-xs text-muted-foreground">
                  Pause the lead&apos;s sequence when a reply is detected.
                </p>
              </div>
              <Switch
                id="pause-on-reply"
                checked={replyPolicy.pauseOnReply}
                disabled={replyHandlingMutation.isPending}
                onCheckedChange={(checked) =>
                  replyHandlingMutation.mutate({ pauseOnReply: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <Label htmlFor="stop-on-reply">Stop on reply</Label>
                <p className="text-xs text-muted-foreground">
                  Permanently stop the lead from receiving further steps.
                </p>
              </div>
              <Switch
                id="stop-on-reply"
                checked={replyPolicy.stopOnReply}
                disabled={replyHandlingMutation.isPending}
                onCheckedChange={(checked) =>
                  replyHandlingMutation.mutate({ stopOnReply: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <Label htmlFor="detect-unsubscribe">Detect unsubscribe</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically detect unsubscribe requests and suppress the lead.
                </p>
              </div>
              <Switch
                id="detect-unsubscribe"
                checked={replyPolicy.detectUnsubscribe}
                disabled={replyHandlingMutation.isPending}
                onCheckedChange={(checked) =>
                  replyHandlingMutation.mutate({ detectUnsubscribe: checked })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Automated follow-ups</CardTitle>
            <CardDescription>
              {campaign.followUpsEnabled
                ? `${campaign.maxFollowUps ?? 5} max follow-ups configured`
                : 'Follow-ups are disabled for this campaign'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {campaign.followUpsEnabled && campaign.steps && campaign.steps.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {campaign.steps
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((step, i) => {
                    if (step.order === 0) return 'Initial';
                    const wait =
                      step.delayUnit === 'DAYS'
                        ? `${step.delayAmount}d`
                        : step.delayUnit === 'HOURS'
                          ? `${step.delayAmount}h`
                          : `${step.delayAmount}m`;
                    return i === 0 ? '' : ` → ${wait} → F${step.order}`;
                  })
                  .join('')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enable follow-ups on the Sequence tab to automate up to 5 follow-up emails.
              </p>
            )}
          </CardContent>
        </Card>

        <CampaignValidationChecklist validation={validation} />
      </div>

      <StopCampaignDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        loading={stopMutation.isPending}
        onConfirm={(reason) => stopMutation.mutate(reason)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
