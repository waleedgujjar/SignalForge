'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  createCampaignStep,
  deleteCampaignStep,
  duplicateCampaignStep,
  reorderCampaignSteps,
  updateCampaignStep,
  type Campaign,
  type CampaignStep,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmailStepEditor } from './email-step-editor';

export function SequenceBuilder({
  campaign,
  readOnly,
}: {
  campaign: Campaign;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const steps = [...(campaign.steps ?? [])].sort((a, b) => a.order - b.order);
  const [drafts, setDrafts] = React.useState<Record<string, Partial<CampaignStep>>>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });

  const createMutation = useMutation({
    mutationFn: () =>
      createCampaignStep(campaign.id, {
        subjectTemplate: 'Hi {{first_name|there}}',
        bodyTemplate: 'Quick note about {{company}}.',
        delayAmount: steps.length === 0 ? 0 : 3,
        delayUnit: 'DAYS',
      }),
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

  const duplicateMutation = useMutation({
    mutationFn: (stepId: string) => duplicateCampaignStep(campaign.id, stepId),
    onSuccess: () => {
      toast.success('Step duplicated');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedStepIds: string[]) => reorderCampaignSteps(campaign.id, orderedStepIds),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const orderedStepIds = steps.map((s) => s.id);
    [orderedStepIds[index], orderedStepIds[target]] = [orderedStepIds[target]!, orderedStepIds[index]!];
    reorderMutation.mutate(orderedStepIds);
  }

  function getStepDraft(step: CampaignStep) {
    return { ...step, ...drafts[step.id] };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Email sequence</h2>
          <p className="text-sm text-muted-foreground">
            Build a multi-step outreach sequence with delays between emails.
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Add step
          </Button>
        )}
      </div>

      {steps.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No steps yet. Add your first email step to get started.
          </CardContent>
        </Card>
      ) : (
        steps.map((step, index) => {
          const draft = getStepDraft(step);
          return (
            <Card key={step.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Step {index + 1}</CardTitle>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => moveStep(index, -1)} disabled={index === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => duplicateMutation.mutate(step.id)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(step.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <EmailStepEditor
                  step={draft}
                  readOnly={readOnly}
                  onChange={(updates) =>
                    setDrafts((prev) => ({ ...prev, [step.id]: { ...prev[step.id], ...updates } }))
                  }
                />
                {!readOnly && (
                  <Button
                    size="sm"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ stepId: step.id, data: drafts[step.id] ?? {} })}
                  >
                    Save step
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
