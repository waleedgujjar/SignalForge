'use client';

import * as React from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EligibilityTierBadge,
  VerificationStatusBadge,
} from '@/components/verification/status-badge';
import {
  createVerificationBulkJob,
  enrollCampaignLeads,
  fetchVerificationJob,
  previewCampaignEligibility,
  type EligibilityReport,
  type LeadEligibility,
  type VerificationTier,
} from '@/lib/api';

// The API previews at most 500 leads per call and switches to a background
// queue above 100 per enroll call; staying at 100 keeps enrollment synchronous
// so the result counts are exact.
const PREVIEW_CHUNK = 500;
const ENROLL_CHUNK = 100;

const REASON_LABEL: Record<string, string> = {
  ALREADY_ENROLLED: 'Already in this campaign',
  SUPPRESSED: 'On a suppression list',
  INVALID_EMAIL: 'Invalid or disposable address',
  UNVERIFIED_EMAIL: 'Not verified yet',
  ROLE_EMAIL: 'Role address (info@, sales@…)',
  RISKY_EMAIL: 'Risky (e.g. mailbox full)',
  UNKNOWN_EMAIL: 'Mailbox could not be confirmed',
  CATCH_ALL_EMAIL: 'Catch-all domain',
  LOW_CONFIDENCE_EMAIL: 'Low confidence',
  UNSUBSCRIBED: 'Unsubscribed',
  BOUNCED: 'Previously bounced',
  ARCHIVED: 'Archived',
  MISSING_EMAIL: 'No email address',
  LEAD_NOT_QUALIFIED: 'Not qualified',
};

type RowTier = VerificationTier | 'ENROLLED' | 'BLOCKED';
type Filter = 'ALL' | 'ELIGIBLE' | 'REVIEW' | 'NOT_ELIGIBLE' | 'UNVERIFIED';

function rowTier(row: LeadEligibility): RowTier {
  if (row.reasons.includes('ALREADY_ENROLLED')) return 'ENROLLED';
  if (row.eligible) return 'ELIGIBLE';
  if (row.reviewable) return 'REVIEW';
  if (row.reasons.includes('UNVERIFIED_EMAIL')) return 'UNVERIFIED';
  return row.verification?.tier === 'NOT_ELIGIBLE' ? 'NOT_ELIGIBLE' : 'BLOCKED';
}

function matchesFilter(tier: RowTier, filter: Filter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'NOT_ELIGIBLE') return tier === 'NOT_ELIGIBLE' || tier === 'BLOCKED' || tier === 'ENROLLED';
  return tier === filter;
}

async function previewAll(campaignId: string, leadIds: string[]): Promise<LeadEligibility[]> {
  const rows: LeadEligibility[] = [];
  for (let i = 0; i < leadIds.length; i += PREVIEW_CHUNK) {
    const report: EligibilityReport = await previewCampaignEligibility(campaignId, leadIds.slice(i, i + PREVIEW_CHUNK));
    rows.push(...(report.leads ?? [...report.eligible, ...report.ineligible]));
  }
  return rows;
}

/**
 * Review step before enrolling leads: shows each lead's verification status
 * and eligibility, verifies leads that are unverified or stale, lets the user
 * approve review-tier leads, and enrolls eligible + approved leads.
 */
export function LeadEligibilityModal({
  open,
  onOpenChange,
  campaignId,
  leadIds,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  leadIds: string[];
  onEnrolled: (enrolled: number) => void;
}) {
  const [rows, setRows] = React.useState<LeadEligibility[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const [approved, setApproved] = React.useState<Set<string>>(new Set());
  const [verifying, setVerifying] = React.useState<{ done: number; total: number } | null>(null);
  const [enrolling, setEnrolling] = React.useState(false);

  const load = React.useCallback(async () => {
    if (leadIds.length === 0) return;
    setLoading(true);
    try {
      setRows(await previewAll(campaignId, leadIds));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, leadIds]);

  React.useEffect(() => {
    if (open) {
      setRows(null);
      setApproved(new Set());
      setFilter('ALL');
      void load();
    }
  }, [open, load]);

  const tiers = React.useMemo(() => new Map((rows ?? []).map((r) => [r.leadId, rowTier(r)])), [rows]);
  const counts = React.useMemo(() => {
    const c = { ELIGIBLE: 0, REVIEW: 0, NOT_ELIGIBLE: 0, UNVERIFIED: 0 };
    for (const tier of tiers.values()) {
      if (tier === 'ELIGIBLE' || tier === 'REVIEW' || tier === 'UNVERIFIED') c[tier]++;
      else c.NOT_ELIGIBLE++;
    }
    return c;
  }, [tiers]);
  const needsVerification = React.useMemo(
    () => (rows ?? []).filter((r) => !r.verification || r.verification.stale).map((r) => r.leadId),
    [rows],
  );
  const reviewIds = React.useMemo(
    () => (rows ?? []).filter((r) => tiers.get(r.leadId) === 'REVIEW').map((r) => r.leadId),
    [rows, tiers],
  );
  const visible = (rows ?? []).filter((r) => matchesFilter(tiers.get(r.leadId) ?? 'BLOCKED', filter));
  const toEnroll = (rows ?? [])
    .filter((r) => tiers.get(r.leadId) === 'ELIGIBLE' || (tiers.get(r.leadId) === 'REVIEW' && approved.has(r.leadId)))
    .map((r) => r.leadId);

  async function verifyNow() {
    if (needsVerification.length === 0) return;
    try {
      const job = await createVerificationBulkJob({
        leadIds: needsVerification,
        source: 'LEADS',
        name: 'Campaign enrollment check',
      });
      setVerifying({ done: 0, total: job.total });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await fetchVerificationJob(job.jobId);
        setVerifying({ done: status.completed, total: status.total });
        if (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(status.status)) break;
      }
      toast.success('Verification finished');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setVerifying(null);
    }
  }

  async function enroll() {
    setEnrolling(true);
    let enrolled = 0;
    try {
      const approvedIds = toEnroll.filter((id) => approved.has(id));
      for (let i = 0; i < toEnroll.length; i += ENROLL_CHUNK) {
        const chunk = toEnroll.slice(i, i + ENROLL_CHUNK);
        const result = await enrollCampaignLeads(campaignId, {
          leadIds: chunk,
          approvedLeadIds: approvedIds.filter((id) => chunk.includes(id)),
        });
        enrolled += result.enrolled ?? 0;
      }
      onEnrolled(enrolled);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
      if (enrolled > 0) onEnrolled(enrolled);
    } finally {
      setEnrolling(false);
    }
  }

  const busy = loading || verifying !== null || enrolling;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Review leads before enrolling</DialogTitle>
          <DialogDescription>
            Only eligible leads are enrolled. Leads that need review are left out unless you approve them;
            invalid, disposable, suppressed and unsubscribed addresses are never enrolled.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(
            [
              ['ELIGIBLE', 'Eligible', 'text-emerald-600'],
              ['REVIEW', 'Review required', 'text-amber-600'],
              ['UNVERIFIED', 'Not verified', 'text-muted-foreground'],
              ['NOT_ELIGIBLE', 'Not eligible', 'text-destructive'],
            ] as const
          ).map(([key, label, color]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(filter === key ? 'ALL' : key)}
              className={`rounded-md border p-2 text-left transition-colors ${filter === key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-semibold tabular-nums ${color}`}>{rows ? counts[key] : '—'}</p>
            </button>
          ))}
        </div>

        {needsVerification.length > 0 || verifying ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            {verifying ? (
              <div className="flex w-full items-center gap-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span className="shrink-0 tabular-nums">
                  Verifying {verifying.done}/{verifying.total}
                </span>
                <Progress value={verifying.total ? (verifying.done / verifying.total) * 100 : 0} className="h-2" />
              </div>
            ) : (
              <>
                <span>
                  {needsVerification.length} lead{needsVerification.length === 1 ? ' has' : 's have'} no recent
                  verification. Results less than a week old are reused, not re-checked.
                </span>
                <Button size="sm" onClick={verifyNow} disabled={busy}>
                  <ShieldCheck className="mr-1 h-4 w-4" /> Verify {needsVerification.length}
                </Button>
              </>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All leads ({rows?.length ?? 0})</SelectItem>
              <SelectItem value="ELIGIBLE">Eligible</SelectItem>
              <SelectItem value="REVIEW">Review required</SelectItem>
              <SelectItem value="UNVERIFIED">Not verified</SelectItem>
              <SelectItem value="NOT_ELIGIBLE">Not eligible</SelectItem>
            </SelectContent>
          </Select>
          {reviewIds.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setApproved(approved.size === reviewIds.length ? new Set() : new Set(reviewIds))
              }
            >
              {approved.size === reviewIds.length ? 'Clear approvals' : `Approve all ${reviewIds.length} for review`}
            </Button>
          ) : null}
        </div>

        <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
          {loading && !rows ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Campaign eligibility</TableHead>
                  <TableHead className="w-20 text-center">Approve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      No leads in this group.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row) => {
                    const tier = tiers.get(row.leadId) ?? 'BLOCKED';
                    return (
                      <TableRow key={row.leadId}>
                        <TableCell className="max-w-[240px] truncate font-medium" title={row.email}>
                          {row.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            <VerificationStatusBadge status={row.verification?.status} />
                            {row.verification?.verifiedAt ? (
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(row.verification.verifiedAt).toLocaleDateString()}
                                {row.verification.stale ? ' · out of date' : ''}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            {tier === 'ENROLLED' ? (
                              <span className="text-xs text-muted-foreground">Already enrolled</span>
                            ) : (
                              <EligibilityTierBadge
                                tier={tier === 'BLOCKED' ? 'NOT_ELIGIBLE' : tier}
                              />
                            )}
                            {row.reasons.length > 0 && tier !== 'ENROLLED' ? (
                              <span className="text-[11px] text-muted-foreground">
                                {row.reasons.map((r) => REASON_LABEL[r] ?? r).join(' · ')}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {tier === 'REVIEW' ? (
                            <Checkbox
                              checked={approved.has(row.leadId)}
                              onCheckedChange={(checked) => {
                                const next = new Set(approved);
                                if (checked) next.add(row.leadId);
                                else next.delete(row.leadId);
                                setApproved(next);
                              }}
                              aria-label={`Approve ${row.email}`}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={enroll} disabled={busy || toEnroll.length === 0}>
            {enrolling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Enroll {toEnroll.length} lead{toEnroll.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
