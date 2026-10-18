'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft, Mail, Phone, Building2, Briefcase, Globe, Globe2, MapPin,
  Linkedin, Trash2, Save, Plus, X, Loader2, Brain, ChevronDown, ChevronUp,
  RefreshCw, Sparkles, Target, BarChart3,
} from 'lucide-react';

import {
  fetchLead, updateLead, deleteLead, verifyEmail, recheckLeadVerification,
  fetchTags, addTagsToLead, removeTagFromLead,
  createLeadNote, deleteLeadNote,
  fetchLeadWebsiteAnalysis, analyzeWebsite as analyzeWebsiteApi,
  fetchLeadEnrichment, enrichLead as enrichLeadApi, retryEnrichment,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { VerificationStatusBadge } from '@/components/verification/status-badge';
import { ConfidenceBadge } from '@/components/research/confidence-badge';
import { VerificationBadge } from '@/components/research/verification-badge';
import { ResearchSection } from '@/components/research/research-section';
import { ResearchHistoryCard } from '@/components/research/research-history-card';
import { ASSESSMENT_LEVEL_LABELS, OPPORTUNITY_ASSESSMENT_ROWS } from '@/components/research/research-status';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  getLeadDisplayName,
  getLeadWebsite,
  formatWebsiteHref,
  formatWebsiteLabel,
  formatPhoneTel,
  formatEmailMailto,
} from '@/lib/lead-display';

const CUSTOM_FIELD_LABELS: Record<string, string> = {
  socialAccount: 'Social Account', googleUrl: 'Google Maps URL', rating: 'Rating',
  service: 'Service', aiChatbot: 'AI Chatbot', websiteType: 'Website Type',
};

const STATUS_OPTIONS = [
  'NEW', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'UNQUALIFIED',
  'CONVERTED', 'UNSUBSCRIBED', 'BOUNCED', 'ARCHIVED',
] as const;
const STATUS_LABELS: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', REPLIED: 'Replied',
  QUALIFIED: 'Qualified', UNQUALIFIED: 'Unqualified', CONVERTED: 'Converted',
  UNSUBSCRIBED: 'Unsubscribed', BOUNCED: 'Bounced', ARCHIVED: 'Archived',
};
const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual', CSV_IMPORT: 'CSV / Excel Import', GOOGLE_DRIVE: 'Google Drive Import',
  DISCOVERY: 'Discovery', API: 'API', OTHER: 'Other',
};

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card><CardContent className="pt-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent></Card>
        </div>
        <div className="space-y-6">
          <Card><CardContent className="pt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
          </CardContent></Card>
        </div>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showAddTag, setShowAddTag] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [form, setForm] = useState<Record<string, string | null>>({});

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
    enabled: !!id,
  });

  const { data: allTags } = useQuery({ queryKey: ['tags'], queryFn: fetchTags });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateLead(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setIsEditing(false);
      toast.success('Lead updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead deleted');
      router.push('/leads');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyEmail(lead?.email ?? '', { leadId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      toast.success('Verification complete');
    },
  });

  const recheckMutation = useMutation({
    mutationFn: () => recheckLeadVerification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      toast.success('Re-verification complete');
    },
  });

  const addTagMutation = useMutation({
    mutationFn: (tagIds: string[]) => addTagsToLead(id, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      setShowAddTag(false);
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) => removeTagFromLead(id, tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead', id] }),
  });

  const addNoteMutation = useMutation({
    mutationFn: (content: string) => createLeadNote(id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      setNoteContent('');
      toast.success('Note added');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteLeadNote(id, noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      toast.success('Note deleted');
    },
  });

  function startEditing() {
    if (!lead) return;
    setForm({
      firstName: lead.firstName ?? '',
      lastName: lead.lastName ?? '',
      email: lead.email,
      company: lead.company ?? '',
      jobTitle: lead.jobTitle ?? '',
      phone: lead.phone ?? '',
      linkedinUrl: lead.linkedinUrl ?? '',
      industry: lead.industry ?? '',
      website: lead.website ?? '',
      companyDomain: lead.companyDomain ?? '',
      countryCode: lead.countryCode ?? '',
      country: lead.country ?? '',
      state: lead.state ?? '',
      city: lead.city ?? '',
      status: lead.status,
    });
    setIsEditing(true);
  }

  function handleSave() {
    const data: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(form)) {
      data[key] = val || null;
    }
    if (form.status) data.status = form.status;
    updateMutation.mutate(data);
  }

  if (isLoading) return <DetailSkeleton />;
  if (!lead) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/leads')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Leads
        </Button>
        <Card><CardContent className="py-12 text-center text-muted-foreground">Lead not found.</CardContent></Card>
      </div>
    );
  }

  const assignedTagIds = new Set(lead.tags?.map((lt) => lt.tag.id) ?? []);
  const availableTags = allTags?.filter((t) => !assignedTagIds.has(t.id)) ?? [];
  const importMeta = lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
    ? (lead.customFields as Record<string, { sourceFile?: string; sourceRow?: number }>)._import
    : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/leads')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Leads
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-semibold">
            {getLeadDisplayName(lead) ?? lead.email}
          </h1>
          <Badge variant="outline">{STATUS_LABELS[lead.status] ?? lead.status}</Badge>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <>
              <Button variant="outline" onClick={startEditing}>Edit</Button>
              <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="mr-1 h-4 w-4" />
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>First name</Label>
                    <Input value={form.firstName ?? ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Last name</Label>
                    <Input value={form.lastName ?? ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Email</Label>
                    <Input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Company</Label>
                    <Input value={form.company ?? ''} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Job title</Label>
                    <Input value={form.jobTitle ?? ''} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>LinkedIn</Label>
                    <Input value={form.linkedinUrl ?? ''} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Industry</Label>
                    <Input value={form.industry ?? ''} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input value={form.website ?? ''} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Company domain</Label>
                    <Input value={form.companyDomain ?? ''} onChange={(e) => setForm({ ...form, companyDomain: e.target.value })} placeholder="example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Country code</Label>
                    <Input value={form.countryCode ?? ''} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} maxLength={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Input value={form.country ?? ''} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Input value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>City</Label>
                    <Input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.status ?? 'NEW'} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <InfoRow icon={Briefcase} label="Owner Name" value={lead.fullName} />
                    <InfoRow icon={Building2} label="Company" value={lead.company} />
                    <InfoRow icon={Briefcase} label="Job Title" value={lead.jobTitle} />
                    <ContactLinkRow
                      icon={Mail}
                      label="Email"
                      value={formatEmailMailto(lead.email) ? lead.email : null}
                      href={formatEmailMailto(lead.email) ? `mailto:${formatEmailMailto(lead.email)}` : undefined}
                      emptyLabel="(no email)"
                    />
                    <ContactLinkRow
                      icon={Phone}
                      label="Phone"
                      value={lead.phone}
                      href={lead.phone ? (formatPhoneTel(lead.phone) ? `tel:${formatPhoneTel(lead.phone)}` : undefined) : undefined}
                    />
                    <ContactLinkRow
                      icon={Globe}
                      label="Website"
                      value={getLeadWebsite(lead) ? formatWebsiteLabel(getLeadWebsite(lead)!) : null}
                      href={getLeadWebsite(lead) ? formatWebsiteHref(getLeadWebsite(lead)!) : undefined}
                      external
                    />
                    <ContactLinkRow
                      icon={Linkedin}
                      label="LinkedIn"
                      value={lead.linkedinUrl}
                      href={lead.linkedinUrl?.startsWith('http') ? lead.linkedinUrl : lead.linkedinUrl ? `https://${lead.linkedinUrl}` : undefined}
                      external
                    />
                    <InfoRow icon={Globe2} label="Company domain" value={lead.companyDomain} />
                    <InfoRow icon={MapPin} label="Location" value={[lead.city, lead.state, lead.country].filter(Boolean).join(', ')} />
                    <InfoRow icon={Building2} label="Industry" value={lead.industry} />
                  </dl>
                  {(lead.source === 'CSV_IMPORT' || lead.source === 'GOOGLE_DRIVE') && (
                    <>
                      <Separator className="my-4" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-3">Import Source</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          <InfoRow icon={Globe2} label="Source" value={SOURCE_LABELS[lead.source] ?? lead.source} />
                          {importMeta?.sourceFile && (
                            <InfoRow icon={Globe} label="Original File" value={importMeta.sourceFile} />
                          )}
                          {importMeta?.sourceRow != null && (
                            <InfoRow icon={Globe2} label="Source Row" value={String(importMeta.sourceRow)} />
                          )}
                        </dl>
                      </div>
                    </>
                  )}
                  {lead.customFields && typeof lead.customFields === 'object' && Object.keys(lead.customFields as Record<string, string>).length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-3">Additional Fields</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(lead.customFields as Record<string, unknown>)
                            .filter(([key, val]) => key !== '_import' && (typeof val === 'string' || typeof val === 'number'))
                            .map(([key, val]) => (
                            <div key={key}>
                              <dt className="text-xs text-muted-foreground">{CUSTOM_FIELD_LABELS[key] ?? key}</dt>
                              <dd className="text-sm">{String(val) || '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Add a note..."
                  className="min-h-[60px]"
                />
                <Button
                  size="sm"
                  className="self-end"
                  disabled={!noteContent.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate(noteContent.trim())}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {lead.notes && lead.notes.length > 0 ? (
                <div className="space-y-3">
                  {lead.notes.map((note) => (
                    <div key={note.id} className="flex items-start justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(note.createdAt).toLocaleDateString()} at {new Date(note.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteNoteMutation.mutate(note.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Research (Module 17) */}
          <ResearchSection leadId={id} lead={lead} />
          <ResearchHistoryCard leadId={id} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Tags */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Tags</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowAddTag(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {lead.tags && lead.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {lead.tags.map((lt) => (
                    <Badge
                      key={lt.tag.id}
                      variant="outline"
                      className="gap-1"
                      style={{ borderColor: lt.tag.color, color: lt.tag.color }}
                    >
                      {lt.tag.name}
                      <button
                        className="ml-1 hover:opacity-70"
                        onClick={() => removeTagMutation.mutate(lt.tag.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No tags assigned.</p>
              )}
            </CardContent>
          </Card>

          {/* Details */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">{STATUS_LABELS[lead.status] ?? lead.status}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="mt-0.5">{SOURCE_LABELS[lead.source] ?? lead.source}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verification</dt>
                  <dd className="mt-0.5 space-y-2">
                    {lead.verification ? (
                      <>
                        <div className="flex items-center gap-2">
                          <VerificationStatusBadge status={lead.verification.status} />
                          <span className="text-xs text-muted-foreground">Score {lead.verification.score}</span>
                        </div>
                        {lead.verification.reason && (
                          <p className="text-xs text-muted-foreground">{lead.verification.reason}</p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => recheckMutation.mutate()}
                          disabled={recheckMutation.isPending}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> Re-verify
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => verifyMutation.mutate()}
                        disabled={verifyMutation.isPending}
                      >
                        Verify Email
                      </Button>
                    )}
                  </dd>
                </div>
                {lead.icpScore !== null && (
                  <div>
                    <dt className="text-muted-foreground">ICP Score</dt>
                    <dd className="mt-0.5">{lead.icpScore}</dd>
                  </div>
                )}
                <Separator />
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="mt-0.5">{new Date(lead.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="mt-0.5">{new Date(lead.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Lists */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base">Lists</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.listMembers && lead.listMembers.length > 0 ? (
                <div className="space-y-2">
                  {lead.listMembers.map((lm) => (
                    <Badge key={lm.list.id} variant="secondary">{lm.list.name}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not in any lists.</p>
              )}
            </CardContent>
          </Card>

          {/* Campaigns */}
          {lead.campaignLeads && lead.campaignLeads.length > 0 && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base">Campaigns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {lead.campaignLeads.map((cl) => (
                    <div key={cl.campaign.id} className="flex items-center justify-between text-sm">
                      <span>{cl.campaign.name}</span>
                      <Badge variant="outline">{cl.campaign.status}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Website Intelligence */}
          <WebsiteIntelCard leadId={id} hasWebsite={!!(lead.website || lead.companyDomain)} />

          {/* Lead Intelligence */}
          <LeadIntelligenceCard leadId={id} />
        </div>
      </div>

      {/* Delete confirm */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {lead.email} and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add tag dialog */}
      <Dialog open={showAddTag} onOpenChange={setShowAddTag}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Tags</DialogTitle>
          </DialogHeader>
          {availableTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  style={{ borderColor: tag.color, color: tag.color }}
                  onClick={() => addTagMutation.mutate([tag.id])}
                >
                  <Plus className="mr-1 h-3 w-3" /> {tag.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No more tags available. Create new tags from the lead management page.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTag(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm">{value || '—'}</dd>
      </div>
    </div>
  );
}

function ContactLinkRow({
  icon: Icon,
  label,
  value,
  href,
  external,
  emptyLabel = '—',
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  href?: string;
  external?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm">
          {!value ? (
            <span className="text-muted-foreground/60">{emptyLabel}</span>
          ) : href ? (
            <a
              href={href}
              className="hover:underline text-primary"
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {value}{external ? ' ↗' : ''}
            </a>
          ) : (
            value
          )}
        </dd>
      </div>
    </div>
  );
}

function ScoreMini({ score, label }: { score: number | null; label: string }) {
  if (score === null) return null;
  const color = score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-500';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold ${color}`}>{score}/100</span>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button className="flex items-center justify-between w-full text-sm font-medium py-1.5" onClick={() => setOpen(!open)}>
        {title}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function LeadIntelligenceCard({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();

  const { data: enrichment, isLoading } = useQuery({
    queryKey: ['lead-enrichment', leadId],
    queryFn: () => fetchLeadEnrichment(leadId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'QUEUED' || status === 'ENRICHING') return 3000;
      return false;
    },
  });

  const enrichMutation = useMutation({
    mutationFn: () => enrichLeadApi(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-enrichment', leadId] });
      toast.success('Enrichment started');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryEnrichment(enrichment!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-enrichment', leadId] });
      toast.success('Retry started');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const priorityBadge = (p: string | null) => {
    if (!p) return null;
    const variant = (p === 'VERY_HIGH' || p === 'HIGH') ? 'destructive' as const : p === 'MEDIUM' ? 'secondary' as const : 'outline' as const;
    return <Badge variant={variant}>{p.replace('_', ' ')}</Badge>;
  };

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4" /> Lead Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : enrichment && (enrichment.status === 'COMPLETED' || enrichment.status === 'PARTIAL') ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Prospect Score</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${(enrichment.prospectScore ?? 0) >= 70 ? 'text-green-500' : (enrichment.prospectScore ?? 0) >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {enrichment.prospectScore ?? '—'}
                </span>
                {priorityBadge(enrichment.prospectPriority)}
              </div>
            </div>

            <ScoreMini score={enrichment.icpFitScore} label="ICP Fit" />
            <ScoreMini score={enrichment.leadQualityScore} label="Lead Quality" />

            {enrichment.seniority && enrichment.seniority !== 'UNKNOWN' && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Seniority</span>
                <Badge variant="outline">{enrichment.seniority.replace('_', ' ')}</Badge>
              </div>
            )}

            {enrichment.status === 'PARTIAL' && (
              <div className="flex items-center justify-between text-xs text-yellow-600">
                <span>AI enrichment incomplete</span>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </div>
            )}

            <Separator />

            {enrichment.aiSummary && (
              <CollapsibleSection title="AI Summary" defaultOpen>
                <p className="text-sm text-muted-foreground">{enrichment.aiSummary}</p>
                {enrichment.aiConfidence && (
                  <div className="mt-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-muted-foreground" />
                    <ConfidenceBadge confidence={enrichment.aiConfidence} />
                  </div>
                )}
              </CollapsibleSection>
            )}

            {enrichment.painPointHypotheses && enrichment.painPointHypotheses.length > 0 && (
              <CollapsibleSection title="Pain Points">
                <ul className="space-y-2">
                  {enrichment.painPointHypotheses.map((p, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-1">
                        <ConfidenceBadge confidence={p.confidence} />
                        <Badge variant="outline" className="text-xs">{p.source}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5">{p.hypothesis}</p>
                    </li>
                  ))}
                </ul>
              </CollapsibleSection>
            )}

            {enrichment.recommendedServices && enrichment.recommendedServices.length > 0 && (
              <CollapsibleSection title="Recommended Services">
                <div className="space-y-2">
                  {enrichment.recommendedServices.map((s, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.service}</span>
                        <div className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs">{s.score}</span>
                          <ConfidenceBadge confidence={s.confidence} />
                        </div>
                      </div>
                      <ul className="text-xs text-muted-foreground mt-0.5">
                        {s.evidence.map((e, j) => <li key={j}>- {e}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {enrichment.personalizationHooks && enrichment.personalizationHooks.length > 0 && (
              <CollapsibleSection title="Personalization Hooks">
                <ul className="space-y-1.5">
                  {enrichment.personalizationHooks.map((h, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-1"><ConfidenceBadge confidence={h.confidence} /></div>
                      <p className="text-muted-foreground text-xs">{h.angle}</p>
                    </li>
                  ))}
                </ul>
              </CollapsibleSection>
            )}

            {enrichment.outreachAngles && enrichment.outreachAngles.length > 0 && (
              <CollapsibleSection title="Outreach Angles">
                <div className="space-y-2">
                  {enrichment.outreachAngles.map((a, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{a.angle}</span>
                        <ConfidenceBadge confidence={a.confidence} />
                      </div>
                      <p className="text-xs text-muted-foreground">{a.reasoning}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {enrichment.opportunityAssessment && (
              <CollapsibleSection title="Opportunity Assessment">
                <ul className="space-y-2">
                  {OPPORTUNITY_ASSESSMENT_ROWS.map(({ key, label }) => {
                    const assessment = enrichment.opportunityAssessment;
                    const entry = assessment ? assessment[key] : undefined;
                    // Absence of evidence is never a negative: UNKNOWN status or a null value renders "Unknown".
                    const unknown = !entry || entry.status === 'UNKNOWN' || entry.value === null;
                    return (
                      <li key={key} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-1">
                            <span className="font-medium">
                              {unknown || !entry?.value ? 'Unknown' : ASSESSMENT_LEVEL_LABELS[entry.value]}
                            </span>
                            <VerificationBadge verification={unknown ? 'UNKNOWN' : entry.status} />
                          </div>
                        </div>
                        {!unknown && entry.evidence.length > 0 && (
                          <ul className="mt-0.5 text-xs text-muted-foreground">
                            {entry.evidence.map((item, i) => <li key={i}>- {item}</li>)}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleSection>
            )}
          </div>
        ) : enrichment && (enrichment.status === 'QUEUED' || enrichment.status === 'ENRICHING') ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Enriching lead...
          </div>
        ) : enrichment && enrichment.status === 'FAILED' ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Enrichment failed</p>
            {enrichment.errorMessage && <p className="text-xs text-muted-foreground">{enrichment.errorMessage}</p>}
            <Button variant="outline" size="sm" className="w-full" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              <RefreshCw className="mr-1 h-4 w-4" /> Retry
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => enrichMutation.mutate()} disabled={enrichMutation.isPending}>
            {enrichMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Brain className="mr-1 h-4 w-4" />}
            Enrich Lead
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function WebsiteIntelCard({ leadId, hasWebsite }: { leadId: string; hasWebsite: boolean }) {
  const queryClient = useQueryClient();

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['lead-website-analysis', leadId],
    queryFn: () => fetchLeadWebsiteAnalysis(leadId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ['PENDING', 'CRAWLING', 'ANALYZING'].includes(status) ? 3000 : false;
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeWebsiteApi({ leadId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-website-analysis', leadId] });
      queryClient.invalidateQueries({ queryKey: ['website-analyses'] });
      toast.success('Analysis started');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const scoreColor = (s: number | null) => {
    if (s === null) return 'text-muted-foreground';
    return s >= 70 ? 'text-green-500' : s >= 40 ? 'text-yellow-500' : 'text-red-500';
  };

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe2 className="h-4 w-4" /> Website Intel
        </CardTitle>
        {analysis && analysis.status === 'COMPLETED' && (
          <Link href={`/website-intelligence/${analysis.id}`} className="text-xs text-primary hover:underline">
            View Report
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : analysis && analysis.status === 'COMPLETED' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Website Score</span>
              <span className={`font-bold ${scoreColor(analysis.websiteScore)}`}>{analysis.websiteScore ?? '—'}/100</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Opportunity</span>
              <span className={`font-bold ${scoreColor(analysis.opportunityScore)}`}>{analysis.opportunityScore ?? '—'}/100</span>
            </div>
            {analysis.opportunityPriority && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Priority</span>
                <Badge variant={analysis.opportunityPriority === 'VERY_HIGH' || analysis.opportunityPriority === 'HIGH' ? 'destructive' : 'secondary'}>
                  {analysis.opportunityPriority.replace('_', ' ')}
                </Badge>
              </div>
            )}
          </div>
        ) : analysis && (analysis.status === 'PENDING' || analysis.status === 'CRAWLING' || analysis.status === 'ANALYZING') ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analysis in progress...
            </div>
            <p className="text-xs text-muted-foreground capitalize">{analysis.status.toLowerCase()}</p>
          </div>
        ) : analysis && analysis.status === 'FAILED' ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {analysis.errorMessage ?? 'Analysis failed'}
            </p>
            {hasWebsite && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
                {analyzeMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Globe2 className="mr-1 h-4 w-4" />}
                Retry Analysis
              </Button>
            )}
          </div>
        ) : hasWebsite ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
            {analyzeMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Globe2 className="mr-1 h-4 w-4" />}
            Analyze Website
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            No website on file. Edit the lead to add a website or company domain.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
