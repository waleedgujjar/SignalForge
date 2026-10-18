'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Pencil,
  Rocket,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Users,
  AlertTriangle,
  Calendar,
  Send,
  X,
} from 'lucide-react';

import {
  fetchCampaign,
  launchCampaign,
  previewCampaignEmail,
  updateCampaignLeadOverride,
  validateCampaign,
  type CampaignValidationResult,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CampaignValidationChecklist } from '@/components/campaigns/campaign-validation-checklist';
import { Skeleton } from '@/components/ui/skeleton';
import { WizardNavigation } from '@/components/campaigns/campaign-wizard-stepper';

export default function CampaignReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [validation, setValidation] = React.useState<CampaignValidationResult | null>(null);
  const [recipientIndex, setRecipientIndex] = React.useState(0);
  const [recipientSearch, setRecipientSearch] = React.useState('');
  const [preview, setPreview] = React.useState<{ subject: string; body: string } | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [editSubject, setEditSubject] = React.useState('');
  const [editBody, setEditBody] = React.useState('');
  const [overrides, setOverrides] = React.useState<Record<string, { subjectOverride?: string | null; bodyOverride?: string | null }>>({});

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['campaign', params.id] });
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  const validateMutation = useMutation({
    mutationFn: () => validateCampaign(params.id),
    onSuccess: (result) => {
      setValidation(result);
      toast.success(result.valid ? 'Campaign is ready to launch!' : 'Validation found issues');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const launchMutation = useMutation({
    mutationFn: () => launchCampaign(params.id),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(campaign?.scheduledAt ? 'Campaign scheduled!' : 'Campaign launched!');
        invalidate();
        router.push(`/campaigns/${params.id}`);
      } else if (result.validation) {
        setValidation(result.validation);
        toast.error('Launch blocked — fix validation issues first');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ leadId, subjectOverride, bodyOverride }: {
      leadId: string;
      subjectOverride?: string | null;
      bodyOverride?: string | null;
    }) => updateCampaignLeadOverride(params.id, leadId, { subjectOverride, bodyOverride }),
    onSuccess: (result, variables) => {
      setOverrides((prev) => ({
        ...prev,
        [variables.leadId]: {
          subjectOverride: result.subjectOverride,
          bodyOverride: result.bodyOverride,
        },
      }));
      setEditing(false);
      toast.success('Override saved for this recipient');
      if (variables.leadId) previewMutation.mutate(variables.leadId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const previewMutation = useMutation({
    mutationFn: (leadId: string) => {
      const firstStep = campaign?.steps?.[0];
      if (!firstStep) throw new Error('No email step configured');
      const leadOverride = overrides[leadId];
      return previewCampaignEmail(params.id, {
        leadId,
        subjectTemplate: leadOverride?.subjectOverride ?? firstStep.subjectTemplate,
        bodyTemplate: leadOverride?.bodyOverride ?? firstStep.bodyTemplate,
      });
    },
    onSuccess: (result) => {
      if (result.subject && result.body) {
        setPreview({ subject: result.subject, body: result.body });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const enrolled = campaign?.campaignLeads ?? [];
  const filteredRecipients = React.useMemo(() => {
    if (!recipientSearch) return enrolled;
    const q = recipientSearch.toLowerCase();
    return enrolled.filter(
      (cl) =>
        cl.lead.email.toLowerCase().includes(q) ||
        (cl.lead.company ?? '').toLowerCase().includes(q) ||
        (cl.lead.firstName ?? '').toLowerCase().includes(q) ||
        (cl.lead.lastName ?? '').toLowerCase().includes(q),
    );
  }, [enrolled, recipientSearch]);

  const currentRecipient = filteredRecipients[recipientIndex];

  const currentLeadId = currentRecipient?.leadId;
  const firstStepSubject = campaign?.steps?.[0]?.subjectTemplate;
  const firstStepBody = campaign?.steps?.[0]?.bodyTemplate;

  React.useEffect(() => {
    if (currentLeadId && firstStepSubject && firstStepBody) {
      previewMutation.mutate(currentLeadId);
    }
  }, [currentLeadId, firstStepSubject, firstStepBody]);

  if (isLoading || !campaign) {
    return <Skeleton className="h-40 w-full" />;
  }

  const firstStep = campaign.steps?.[0];
  const counts = campaign._count ?? { campaignLeads: 0, steps: 0, mailboxes: 0 };
  const canLaunch = ['DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status);

  const followUpSteps = (campaign.steps ?? []).filter((s) => s.order > 0);
  const scheduleConfig = campaign.scheduleConfig as {
    timezone?: string;
    days?: number[];
    startTime?: string;
    endTime?: string;
  } | null;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6">
      {/* Campaign Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={Users}
          label="Recipients"
          value={counts.campaignLeads ?? 0}
          description={`${counts.campaignLeads ?? 0} lead(s) enrolled`}
        />
        <SummaryCard
          icon={Mail}
          label="Email Steps"
          value={counts.steps ?? 0}
          description={followUpSteps.length > 0
            ? `1 initial + ${followUpSteps.length} follow-up(s)`
            : '1 initial email'}
        />
        <SummaryCard
          icon={Send}
          label="Mailboxes"
          value={counts.mailboxes ?? 0}
          description={`${counts.mailboxes ?? 0} sending account(s)`}
        />
        <SummaryCard
          icon={Calendar}
          label="Schedule"
          value={campaign.scheduledAt ? 'Scheduled' : 'Send Now'}
          description={
            campaign.scheduledAt
              ? new Date(campaign.scheduledAt).toLocaleString()
              : scheduleConfig?.timezone ?? 'Immediate upon launch'
          }
        />
      </div>

      {/* Sending Schedule Details */}
      {scheduleConfig && (scheduleConfig.days || scheduleConfig.startTime) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sending Window</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              {scheduleConfig.days && (
                <div>
                  <span className="font-medium text-muted-foreground">Days: </span>
                  {scheduleConfig.days.map((d) => dayNames[d]).join(', ')}
                </div>
              )}
              {scheduleConfig.startTime && scheduleConfig.endTime && (
                <div>
                  <span className="font-medium text-muted-foreground">Hours: </span>
                  {scheduleConfig.startTime} – {scheduleConfig.endTime}
                </div>
              )}
              {scheduleConfig.timezone && (
                <div>
                  <span className="font-medium text-muted-foreground">Timezone: </span>
                  {scheduleConfig.timezone}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Recipient Email Preview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Recipient Email Preview</CardTitle>
              <CardDescription>
                Review the personalized email each recipient will receive.
                {filteredRecipients.length > 0 && ` (${recipientIndex + 1} of ${filteredRecipients.length})`}
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={recipientSearch}
                onChange={(e) => {
                  setRecipientSearch(e.target.value);
                  setRecipientIndex(0);
                }}
                placeholder="Search recipients..."
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredRecipients.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {enrolled.length === 0
                  ? 'No leads enrolled yet. Go to Select Leads to add recipients.'
                  : 'No recipients match your search.'}
              </p>
            </div>
          ) : !firstStep ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Mail className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No email step configured yet. Go to Compose Email to write your template.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Recipient info bar */}
              {currentRecipient && (
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{currentRecipient.lead.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      currentRecipient.lead.firstName || currentRecipient.lead.lastName
                        ? [currentRecipient.lead.firstName, currentRecipient.lead.lastName].filter(Boolean).join(' ')
                        : null,
                      currentRecipient.lead.company,
                      currentRecipient.lead.jobTitle,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No additional info'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={recipientIndex === 0}
                    onClick={() => { setRecipientIndex((i) => i - 1); setEditing(false); }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
                    {recipientIndex + 1} / {filteredRecipients.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={recipientIndex === filteredRecipients.length - 1}
                    onClick={() => { setRecipientIndex((i) => i + 1); setEditing(false); }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              )}

              {/* Rendered email preview */}
              {previewMutation.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Rendering email...</span>
                </div>
              ) : preview ? (
                <div className="space-y-3 rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {currentRecipient && overrides[currentRecipient.leadId]?.subjectOverride != null
                        ? 'Personalized (override)'
                        : 'Preview'}
                    </p>
                    {canLaunch && currentRecipient && !editing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          const lo = overrides[currentRecipient.leadId];
                          setEditSubject(lo?.subjectOverride ?? firstStep?.subjectTemplate ?? '');
                          setEditBody(lo?.bodyOverride ?? firstStep?.bodyTemplate ?? '');
                          setEditing(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit for this recipient
                      </Button>
                    )}
                    {currentRecipient && overrides[currentRecipient.leadId]?.subjectOverride != null && !editing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground"
                        onClick={() => {
                          overrideMutation.mutate({
                            leadId: currentRecipient.leadId,
                            subjectOverride: null,
                            bodyOverride: null,
                          });
                        }}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset to template
                      </Button>
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-3 px-4 py-3">
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Subject (template with {'{{variables}}'}  )
                        </label>
                        <Input
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Body (template with {'{{variables}}'}  )
                        </label>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={8}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (currentRecipient) {
                              overrideMutation.mutate({
                                leadId: currentRecipient.leadId,
                                subjectOverride: editSubject,
                                bodyOverride: editBody,
                              });
                            }
                          }}
                          disabled={overrideMutation.isPending}
                        >
                          {overrideMutation.isPending ? (
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <Save className="mr-1.5 h-3 w-3" />
                          )}
                          Save override
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(false)}
                        >
                          <X className="mr-1.5 h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-border px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject</p>
                        <p className="mt-1 text-sm font-medium">{preview.subject}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</p>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{preview.body}</div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Select a recipient to preview their email.
                </p>
              )}

              {/* Follow-up previews summary */}
              {followUpSteps.length > 0 && (
                <div className="rounded-md border border-border p-4">
                  <p className="text-sm font-medium">Follow-up Sequence</p>
                  <div className="mt-2 space-y-2">
                    {followUpSteps.map((step, i) => {
                      const delay =
                        step.delayUnit === 'DAYS'
                          ? `${step.delayAmount} day(s)`
                          : step.delayUnit === 'HOURS'
                            ? `${step.delayAmount} hour(s)`
                            : `${step.delayAmount} minute(s)`;
                      return (
                        <div key={step.id} className="flex items-center gap-3 text-sm">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {i + 1}
                          </span>
                          <span className="text-muted-foreground">After {delay}:</span>
                          <span className="truncate">{step.subjectTemplate || '(no subject)'}</span>
                          {!step.enabled && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Disabled</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation & Launch */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CampaignValidationChecklist validation={validation} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Launch Campaign</CardTitle>
            <CardDescription>
              Validate your campaign, then launch to start sending personalized emails
              to each recipient individually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pre-launch checklist */}
            <div className="space-y-2">
              <PreLaunchItem
                ok={(counts.campaignLeads ?? 0) > 0}
                label={`${counts.campaignLeads ?? 0} recipient(s) enrolled`}
              />
              <PreLaunchItem
                ok={(counts.steps ?? 0) > 0}
                label={`${counts.steps ?? 0} email step(s) configured`}
              />
              <PreLaunchItem
                ok={(counts.mailboxes ?? 0) > 0}
                label={`${counts.mailboxes ?? 0} sending account(s) assigned`}
              />
              <PreLaunchItem
                ok={validation?.valid === true}
                label={validation ? (validation.valid ? 'Validation passed' : 'Validation failed') : 'Run validation first'}
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
              >
                {validateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Validate
              </Button>
              {canLaunch && (
                <Button
                  onClick={() => launchMutation.mutate()}
                  disabled={launchMutation.isPending}
                >
                  {launchMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="mr-2 h-4 w-4" />
                  )}
                  {campaign.scheduledAt ? 'Schedule Campaign' : 'Start Campaign'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Wizard navigation */}
      {['DRAFT', 'SCHEDULED'].includes(campaign.status) && (
        <WizardNavigation campaignId={params.id} currentStep="review" />
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PreLaunchItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      )}
      <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}
