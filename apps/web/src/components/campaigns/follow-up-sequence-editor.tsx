'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Clock, Mail, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  createCampaignStep,
  deleteCampaignStep,
  seedCampaignFollowUps,
  updateCampaign,
  updateCampaignStep,
  type Campaign,
  type CampaignStep,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { EmailStepEditor } from './email-step-editor';

const DEFAULT_DELAYS = [2, 3, 4, 5, 7];

function stepTitle(order: number): string {
  return order === 0 ? 'Initial Email' : `Follow-up #${order}`;
}

function delayLabel(amount: number, unit: string): string {
  const label = unit.toLowerCase();
  return `${amount} ${label}${amount === 1 ? '' : ''}`;
}

export function FollowUpSequenceEditor({
  campaign,
  readOnly,
}: {
  campaign: Campaign;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const steps = [...(campaign.steps ?? [])].sort((a, b) => a.order - b.order);
  const followUpSteps = steps.filter((s) => s.order > 0);
  const [drafts, setDrafts] = React.useState<Record<string, Partial<CampaignStep>>>({});
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [pendingDisable, setPendingDisable] = React.useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });

  const updateCampaignMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateCampaign(campaign.id, data),
    onSuccess: () => {
      invalidate();
      toast.success('Follow-up settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const seedMutation = useMutation({
    mutationFn: (maxFollowUps: number) => seedCampaignFollowUps(campaign.id, maxFollowUps),
    onSuccess: () => {
      invalidate();
      toast.success('Default follow-up sequence created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const nextOrder = steps.length;
      const delayAmount = nextOrder === 0 ? 0 : DEFAULT_DELAYS[Math.min(nextOrder - 1, 4)] ?? 3;
      return createCampaignStep(campaign.id, {
        subjectTemplate: nextOrder === 0 ? 'Hi {{first_name|there}}' : `Following up — {{company}}`,
        bodyTemplate:
          nextOrder === 0
            ? 'Quick note about {{company}}.'
            : 'Hi {{first_name|there}},\n\nJust wanted to follow up on my previous email.\n\nBest,',
        delayAmount,
        delayUnit: 'DAYS',
      });
    },
    onSuccess: () => {
      toast.success('Step added');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ stepId, data }: { stepId: string; data: Partial<CampaignStep> }) =>
      updateCampaignStep(campaign.id, stepId, data),
    onSuccess: () => {
      toast.success('Step saved');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (stepId: string) => deleteCampaignStep(campaign.id, stepId),
    onSuccess: () => {
      toast.success('Step removed');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleToggleFollowUps(enabled: boolean) {
    if (!enabled && campaign.followUpsEnabled) {
      setDisableOpen(true);
      return;
    }
    if (enabled && steps.length === 0) {
      seedMutation.mutate(campaign.maxFollowUps ?? 5);
      return;
    }
    updateCampaignMutation.mutate({ followUpsEnabled: enabled });
  }

  function confirmDisableFollowUps() {
    setPendingDisable(true);
    updateCampaignMutation.mutate(
      { followUpsEnabled: false, disableFollowUpsConfirmed: true },
      {
        onSettled: () => {
          setPendingDisable(false);
          setDisableOpen(false);
        },
      },
    );
  }

  function getStepDraft(step: CampaignStep) {
    return { ...step, ...drafts[step.id] };
  }

  const maxFollowUps = campaign.maxFollowUps ?? 5;

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Automated Follow-ups</CardTitle>
          <CardDescription>
            Send up to 5 automated follow-ups when a lead has not replied within each wait period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
            <div>
              <Label htmlFor="follow-ups-toggle" className="text-sm font-medium">
                Enable automated follow-ups
              </Label>
              <p className="text-xs text-muted-foreground">
                Opens are not required — follow-ups send when no reply is detected.
              </p>
            </div>
            <Switch
              id="follow-ups-toggle"
              checked={campaign.followUpsEnabled ?? false}
              disabled={readOnly || updateCampaignMutation.isPending}
              onCheckedChange={handleToggleFollowUps}
            />
          </div>

          {campaign.followUpsEnabled && (
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Maximum follow-ups</Label>
                <Select
                  value={String(maxFollowUps)}
                  disabled={readOnly}
                  onValueChange={(v) =>
                    updateCampaignMutation.mutate({ maxFollowUps: Number(v) })
                  }
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Badge variant="secondary">{followUpSteps.length} configured</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {!campaign.followUpsEnabled ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Automated follow-ups are disabled.</p>
            {!readOnly && (
              <Button onClick={() => handleToggleFollowUps(true)} disabled={seedMutation.isPending}>
                Enable follow-ups
              </Button>
            )}
          </CardContent>
        </Card>
      ) : steps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">Configure your first follow-up sequence.</p>
            {!readOnly && (
              <Button onClick={() => seedMutation.mutate(maxFollowUps)} disabled={seedMutation.isPending}>
                Add follow-up sequence
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0">
          {steps.map((step, index) => {
            const draft = getStepDraft(step);
            const showWait = index > 0;
            return (
              <React.Fragment key={step.id}>
                {showWait && (
                  <div className="flex flex-col items-center py-2">
                    <ArrowDown className="h-4 w-4 text-muted-foreground" />
                    <div className="mt-1 flex items-center gap-2 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Wait {delayLabel(draft.delayAmount, draft.delayUnit)}
                    </div>
                  </div>
                )}
                <Card className="border-border/60">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{stepTitle(step.order)}</CardTitle>
                      {step.order === 0 && (
                        <Badge variant="outline" className="text-xs">
                          Send immediately
                        </Badge>
                      )}
                    </div>
                    {!readOnly && step.order > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(step.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <EmailStepEditor
                      step={draft}
                      readOnly={readOnly}
                      hideDelay={step.order === 0}
                      onChange={(updates) =>
                        setDrafts((prev) => ({ ...prev, [step.id]: { ...prev[step.id], ...updates } }))
                      }
                    />
                    {!readOnly && (
                      <Button
                        size="sm"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({ stepId: step.id, data: drafts[step.id] ?? {} })
                        }
                      >
                        Save step
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </React.Fragment>
            );
          })}

          {!readOnly && followUpSteps.length < maxFollowUps && steps.length < 6 && (
            <div className="pt-4">
              <Button variant="outline" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                Add follow-up
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable automated follow-ups?</AlertDialogTitle>
            <AlertDialogDescription>
              Disabling automated follow-ups will cancel all pending follow-ups for this campaign.
              Leads already in progress will not receive remaining scheduled follow-ups.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingDisable}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisableFollowUps} disabled={pendingDisable}>
              Disable follow-ups
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
