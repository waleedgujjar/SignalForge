'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  ClipboardCheck,
  ExternalLink,
  Info,
  Linkedin,
  Loader2,
  Play,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  analyzeWebsite,
  approveResearch,
  fetchLeadResearch,
  fetchResearchProviderStatus,
  fetchResearchSuggestions,
  markResearchVerified,
  retryResearch,
  startLinkedInResearch,
  type Lead,
  type LeadResearch,
  type ResearchProvenance,
  type ResearchStructuredData,
  type ResearchSuggestion,
  type VerificationState,
} from '@/lib/api';
import { ConfidenceBadge } from './confidence-badge';
import { ManualVerificationDialog } from './manual-verification-dialog';
import { ProvenanceList } from './provenance-list';
import { ResearchStatusBadge } from './research-status-badge';
import { ResearchSuggestions, type ResolvedSuggestion, type SuggestionAction } from './research-suggestions';
import {
  RESEARCH_QUERY_KEYS,
  RESEARCH_TYPE_LABELS,
  humanizeField,
  invalidateResearchQueries,
  isLinkedInCompanyUrl,
  isLinkedInPersonUrl,
  isResearchActive,
  toVerificationState,
} from './research-status';
import { VerificationBadge } from './verification-badge';

export const LINKEDIN_FOOTNOTE = 'No LinkedIn actions are automated. SignalForge only reads URLs you provide.';

type UrlState = 'empty' | 'valid' | 'invalid';

interface DisplayField {
  field: string;
  label: string;
  value: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function urlState(value: string, validator: (input: string) => boolean): UrlState {
  const trimmed = value.trim();
  if (trimmed === '') return 'empty';
  return validator(trimmed) ? 'valid' : 'invalid';
}

/** Only fields that actually exist on the record are listed — nothing is fabricated. */
function flattenStructuredData(data: ResearchStructuredData | null): DisplayField[] {
  const out: DisplayField[] = [];
  const push = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
    out.push({ field, label: humanizeField(field), value: display });
  };

  const company = data?.company;
  if (company) {
    push('company.name', company.name);
    push('company.industry', company.industry);
    push('company.location', company.location);
    push('company.employeeRange', company.employeeRange);
    push('company.url', company.url);
  }

  const person = data?.person;
  if (person) {
    if (person.fullName) {
      push('person.fullName', person.fullName);
    } else {
      push('person.firstName', person.firstName);
      push('person.lastName', person.lastName);
    }
    push('person.title', person.title);
    push('person.profileUrl', person.profileUrl);
  }

  const signals = data?.signals;
  if (signals) {
    for (const key of ['decisionMaker', 'hiring', 'growthSignal', 'technologySignal'] as const) {
      const value = signals[key];
      if (typeof value === 'boolean') push(`signals.${key}`, value);
    }
  }

  return out;
}

function normalizeFieldKey(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Exact provenance match (tolerating separator/case differences); anything else is UNKNOWN. */
function verificationFor(provenance: ResearchProvenance[] | null, field: string): VerificationState {
  if (!provenance || provenance.length === 0) return 'UNKNOWN';
  const wanted = normalizeFieldKey(field);
  const entry = provenance.find((p) => p.field === field) ?? provenance.find((p) => normalizeFieldKey(p.field) === wanted);
  return toVerificationState(entry?.verification);
}

interface Props {
  leadId: string;
  lead: Lead;
}

export function LinkedInResearchCard({ leadId, lead }: Props) {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.providerStatus,
    queryFn: fetchResearchProviderStatus,
    retry: false,
    staleTime: 60_000,
  });
  const providerStatus = statusQuery.data;
  const enabled = providerStatus?.status === 'ok';

  const researchQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.leadResearch(leadId),
    queryFn: () => fetchLeadResearch(leadId),
    enabled,
    refetchInterval: (query) => {
      const records = query.state.data?.research ?? [];
      return records.some((record) => isResearchActive(record.status)) ? 3000 : false;
    },
  });

  const suggestionsQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.leadSuggestions(leadId),
    queryFn: () => fetchResearchSuggestions(leadId),
    enabled,
    retry: false,
  });

  const records = (researchQuery.data?.research ?? []).filter((record) => record.source === 'LINKEDIN');
  const companyRecord = records.find((record) => record.researchType === 'COMPANY');
  const personRecord = records.find((record) => record.researchType === 'PERSON');

  const [companyUrl, setCompanyUrl] = useState('');
  const [personUrl, setPersonUrl] = useState(() =>
    lead.linkedinUrl && isLinkedInPersonUrl(lead.linkedinUrl) ? lead.linkedinUrl : '',
  );
  const companyPrefilled = useRef(false);
  const existingCompanyUrl = companyRecord?.sourceUrl ?? companyRecord?.normalizedUrl ?? null;
  useEffect(() => {
    if (companyPrefilled.current || !existingCompanyUrl) return;
    companyPrefilled.current = true;
    setCompanyUrl(existingCompanyUrl);
  }, [existingCompanyUrl]);

  const [dialogResearch, setDialogResearch] = useState<LeadResearch | null>(null);

  const companyState = urlState(companyUrl, isLinkedInCompanyUrl);
  const personState = urlState(personUrl, isLinkedInPersonUrl);
  const canStart =
    (companyState === 'valid' || personState === 'valid') && companyState !== 'invalid' && personState !== 'invalid';

  const startMutation = useMutation({
    mutationFn: (input: { companyUrl?: string; personUrl?: string }) => startLinkedInResearch({ leadId, ...input }),
    onSuccess: (result) => {
      toast.success(
        result.reused > 0
          ? `Research queued (${result.queued} new, ${result.reused} already in progress)`
          : `Research queued (${result.queued})`,
      );
      invalidateResearchQueries(queryClient, leadId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const approveMutation = useMutation({
    mutationFn: (researchIds: string[]) => approveResearch({ researchIds }),
    onSuccess: (result) => {
      toast.success(result.queued > 0 ? 'Research approved and queued' : 'Nothing to queue — already handled');
      invalidateResearchQueries(queryClient, leadId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retryMutation = useMutation({
    mutationFn: (researchId: string) => retryResearch(researchId),
    onSuccess: () => {
      toast.success('Research re-queued');
      invalidateResearchQueries(queryClient, leadId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const markVerifiedMutation = useMutation({
    mutationFn: (researchId: string) => markResearchVerified(researchId),
    onSuccess: () => {
      toast.success('Marked as manually verified');
      invalidateResearchQueries(queryClient, leadId, { includeLead: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const websiteMutation = useMutation({
    mutationFn: () => analyzeWebsite({ leadId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.leadWebsiteAnalysis(leadId) });
      invalidateResearchQueries(queryClient, leadId);
      toast.success('Website analysis started');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isRunningSuggestions = startMutation.isPending || approveMutation.isPending || websiteMutation.isPending;

  function resolveSuggestion(suggestion: ResearchSuggestion): ResolvedSuggestion {
    switch (suggestion.key) {
      case 'COMPANY_LINKEDIN': {
        if (companyRecord?.status === 'PENDING') {
          return { action: { kind: 'approve', researchId: companyRecord.id }, hint: 'Approves the suggested company research.' };
        }
        if (companyState === 'valid') {
          return { action: { kind: 'start', companyUrl: companyUrl.trim() }, hint: 'Researches the company URL entered above.' };
        }
        return { action: null, hint: 'Paste a LinkedIn company URL above to enable this.' };
      }
      case 'PERSON_LINKEDIN': {
        if (personRecord?.status === 'PENDING') {
          return { action: { kind: 'approve', researchId: personRecord.id }, hint: 'Approves the suggested person research.' };
        }
        if (personState === 'valid') {
          return { action: { kind: 'start', personUrl: personUrl.trim() }, hint: 'Researches the person URL entered above.' };
        }
        return { action: null, hint: 'Paste a LinkedIn person URL above to enable this.' };
      }
      case 'WEBSITE': {
        if (lead.website || lead.companyDomain) {
          return { action: { kind: 'analyze-website' }, hint: 'Runs the existing website analysis for this lead.' };
        }
        return { action: null, hint: 'No website on file for this lead.' };
      }
      default:
        return { action: null, hint: 'Not available in this release.' };
    }
  }

  async function runSuggestions(actions: SuggestionAction[]) {
    const approveIds: string[] = [];
    const start: { companyUrl?: string; personUrl?: string } = {};
    let runWebsite = false;
    for (const action of actions) {
      if (action.kind === 'approve') approveIds.push(action.researchId);
      else if (action.kind === 'start') {
        if (action.companyUrl) start.companyUrl = action.companyUrl;
        if (action.personUrl) start.personUrl = action.personUrl;
      } else if (action.kind === 'analyze-website') runWebsite = true;
    }
    const tasks: Promise<unknown>[] = [];
    if (approveIds.length > 0) tasks.push(approveMutation.mutateAsync(approveIds));
    if (start.companyUrl || start.personUrl) tasks.push(startMutation.mutateAsync(start));
    if (runWebsite) tasks.push(websiteMutation.mutateAsync());
    await Promise.allSettled(tasks);
  }

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking research service…
      </div>
    );
  }

  if (statusQuery.isError || !providerStatus || providerStatus.status === 'unavailable') {
    return (
      <Alert>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Research service is unreachable</AlertTitle>
        <AlertDescription>
          LinkedIn research actions are paused until the API responds. Existing records are not affected.
        </AlertDescription>
      </Alert>
    );
  }

  if (providerStatus.status === 'disabled') {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>LinkedIn research is disabled</AlertTitle>
        <AlertDescription>
          This deployment has the Lead Research module switched off. An administrator can review the setup under{' '}
          <Link href="/settings/research" className="font-medium text-primary hover:underline">
            Settings → Research Providers
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }

  const companyInputId = `linkedin-company-url-${leadId}`;
  const personInputId = `linkedin-person-url-${leadId}`;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={companyInputId}>LinkedIn Company URL</Label>
          <Input
            id={companyInputId}
            value={companyUrl}
            placeholder="https://www.linkedin.com/company/…"
            maxLength={500}
            aria-invalid={companyState === 'invalid' || undefined}
            onChange={(e) => setCompanyUrl(e.target.value)}
          />
          {companyState === 'invalid' && (
            <p className="text-xs text-destructive">Enter a linkedin.com/company/… (or /school/…) URL.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={personInputId}>LinkedIn Person URL</Label>
          <Input
            id={personInputId}
            value={personUrl}
            placeholder="https://www.linkedin.com/in/…"
            maxLength={500}
            aria-invalid={personState === 'invalid' || undefined}
            onChange={(e) => setPersonUrl(e.target.value)}
          />
          {personState === 'invalid' && <p className="text-xs text-destructive">Enter a linkedin.com/in/… URL.</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {LINKEDIN_FOOTNOTE}
        </p>
        <Button
          size="sm"
          disabled={!canStart || startMutation.isPending}
          onClick={() =>
            startMutation.mutate({
              companyUrl: companyState === 'valid' ? companyUrl.trim() : undefined,
              personUrl: personState === 'valid' ? personUrl.trim() : undefined,
            })
          }
        >
          {startMutation.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Linkedin className="mr-1 h-4 w-4" />
          )}
          Research LinkedIn
        </Button>
      </div>

      <Separator />

      {researchQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : researchQuery.isError ? (
        <p className="text-sm text-muted-foreground">Research records could not be loaded.</p>
      ) : records.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ResearchStatusBadge status="NOT_RESEARCHED" />
          No LinkedIn research yet. Paste a URL above to start.
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <ResearchRecord
              key={record.id}
              record={record}
              busy={
                (approveMutation.isPending && approveMutation.variables?.includes(record.id) === true) ||
                (retryMutation.isPending && retryMutation.variables === record.id) ||
                (markVerifiedMutation.isPending && markVerifiedMutation.variables === record.id)
              }
              onApprove={() => approveMutation.mutate([record.id])}
              onRetry={() => retryMutation.mutate(record.id)}
              onMarkVerified={() => markVerifiedMutation.mutate(record.id)}
              onEnterData={() => setDialogResearch(record)}
            />
          ))}
        </div>
      )}

      <Separator />

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Suggested next steps</h4>
        <ResearchSuggestions
          idPrefix={`lead-${leadId}`}
          suggestions={suggestionsQuery.data?.suggestions}
          isLoading={suggestionsQuery.isLoading}
          isRunning={isRunningSuggestions}
          resolve={resolveSuggestion}
          onRun={(actions) => {
            void runSuggestions(actions);
          }}
        />
      </div>

      <ManualVerificationDialog
        research={dialogResearch}
        open={dialogResearch !== null}
        onOpenChange={(open) => {
          if (!open) setDialogResearch(null);
        }}
      />
    </div>
  );
}

interface RecordProps {
  record: LeadResearch;
  busy: boolean;
  onApprove: () => void;
  onRetry: () => void;
  onMarkVerified: () => void;
  onEnterData: () => void;
}

function OpenLinkedInButton({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Open LinkedIn
      </a>
    </Button>
  );
}

function ResearchRecord({ record, busy, onApprove, onRetry, onMarkVerified, onEnterData }: RecordProps) {
  const url = record.sourceUrl ?? record.normalizedUrl;
  const lastDate = record.completedAt ?? record.updatedAt;
  const fields = flattenStructuredData(record.structuredData);
  const provenanceCount = record.provenance?.length ?? 0;

  let body: React.ReactNode;
  switch (record.status) {
    case 'PENDING':
      body = (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {record.summary ?? 'Suggested from an import — nothing runs until you approve it.'}
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={onApprove}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            Approve
          </Button>
        </div>
      );
      break;
    case 'QUEUED':
    case 'IN_PROGRESS':
      body = (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {record.status === 'QUEUED' ? 'Queued — waiting for the research worker.' : 'Researching — one request to the URL you provided.'}
        </div>
      );
      break;
    case 'COMPLETED':
    case 'PARTIAL':
      body = (
        <div className="space-y-3">
          {record.status === 'PARTIAL' && (
            <div className="flex items-center gap-2 text-xs text-yellow-700">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Only some fields could be established from the source. Missing fields stay Unknown.
            </div>
          )}
          {record.summary && <p className="text-sm text-muted-foreground">{record.summary}</p>}
          {fields.length > 0 ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.field} className="rounded-md border border-border/60 p-2">
                  <dt className="text-xs text-muted-foreground">{field.label}</dt>
                  <dd className="mt-0.5 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate" title={field.value}>
                      {field.value}
                    </span>
                    <VerificationBadge verification={verificationFor(record.provenance, field.field)} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No structured fields were captured.</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Provenance ({provenanceCount})
            </summary>
            <div className="mt-2">
              <ProvenanceList entries={record.provenance} />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            {record.verifiedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Manually verified {formatDate(record.verifiedAt)}
              </span>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={onMarkVerified} title="Only after you checked every value on the page yourself.">
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="mr-1 h-3.5 w-3.5" />}
                Mark as Manually Verified
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onEnterData}>
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> {record.verifiedAt ? 'Edit Data' : 'Edit / Enter Data'}
            </Button>
            {record.status === 'PARTIAL' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRetry}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
              </Button>
            )}
            <OpenLinkedInButton url={url} />
          </div>
        </div>
      );
      break;
    case 'MANUAL_REVIEW':
      body = (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{record.errorMessage ?? 'Manual verification required.'}</span>
            {record.errorCode && (
              <Badge variant="outline" className="text-xs">
                {record.errorCode}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The provider stopped here (no retries around a refusal). Open the page yourself and enter what you confirm.
          </p>
          <div className="flex flex-wrap gap-2">
            <OpenLinkedInButton url={url} />
            <Button size="sm" onClick={onEnterData}>
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Enter Data
            </Button>
          </div>
        </div>
      );
      break;
    case 'FAILED':
    case 'UNAVAILABLE':
      body = (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={record.status === 'FAILED' ? 'text-destructive' : ''}>
              {record.errorMessage ?? (record.status === 'FAILED' ? 'Research failed.' : 'Research unavailable.')}
            </span>
            {record.errorCode && (
              <Badge variant="outline" className="text-xs">
                {record.errorCode}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Retry
            </Button>
            <OpenLinkedInButton url={url} />
          </div>
        </div>
      );
      break;
    default:
      body = <p className="text-sm text-muted-foreground">Status: {record.status}</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{RESEARCH_TYPE_LABELS[record.researchType] ?? record.researchType}</span>
          <ResearchStatusBadge status={record.status} />
          {record.provider && (
            <Badge variant="outline" className="text-xs">
              {record.provider}
            </Badge>
          )}
          <ConfidenceBadge confidence={record.confidence} />
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(lastDate)}</span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 break-all text-xs text-primary hover:underline"
        >
          {url} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
      )}
      {body}
    </div>
  );
}
