'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, Loader2, X, Plus } from 'lucide-react';

import {
  createLead,
  enrollCampaignLeads,
  fetchCampaign,
  fetchLeads,
  previewCampaignEligibility,
  removeCampaignLead,
  smartImportLeads,
  type EligibilityReport,
} from '@/lib/api';
import { WizardNavigation } from '@/components/campaigns/campaign-wizard-stepper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LeadEligibilityModal } from '@/components/campaigns/lead-eligibility-modal';
import { LeadSequenceTimeline } from '@/components/campaigns/lead-sequence-timeline';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isSupportedSpreadsheet } from '@/lib/spreadsheet-parser';

type AddMode = 'quick-add' | 'search' | 'upload';

export default function CampaignLeadsPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selectedLeadIds, setSelectedLeadIds] = React.useState<string[]>([]);
  const [eligibilityReport, setEligibilityReport] = React.useState<EligibilityReport | null>(null);
  const [eligibilityOpen, setEligibilityOpen] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);

  const [addMode, setAddMode] = React.useState<AddMode>('quick-add');
  const [quickEmail, setQuickEmail] = React.useState('');
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  const { data: leadsData } = useQuery({
    queryKey: ['leads', 'campaign-picker', search],
    queryFn: () => fetchLeads({ ...(search && { search }), limit: '50' }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['campaign', params.id] });

  const previewMutation = useMutation({
    mutationFn: () => previewCampaignEligibility(params.id, selectedLeadIds),
    onSuccess: (report) => {
      setEligibilityReport(report);
      setEligibilityOpen(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const enrollMutation = useMutation({
    mutationFn: () => enrollCampaignLeads(params.id, { leadIds: selectedLeadIds }),
    onSuccess: (result) => {
      toast.success(`Enrolled ${result.enrolled} lead(s)`);
      setEligibilityOpen(false);
      setSelectedLeadIds([]);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (leadId: string) => removeCampaignLead(params.id, leadId),
    onSuccess: () => {
      toast.success('Lead removed');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const result = await smartImportLeads(file);
      const leadIds = result.createdLeadIds ?? [];
      if (leadIds.length > 0) {
        await enrollCampaignLeads(params.id, { leadIds, force: true });
      }
      return { importResult: result, enrolledCount: leadIds.length };
    },
    onSuccess: ({ importResult, enrolledCount }) => {
      const { summary } = importResult;
      if (summary.created === 0 && summary.updated === 0) {
        toast.warning('No leads were imported. Check that your file has valid data.');
      } else {
        toast.success(
          `Imported ${summary.created} lead(s) and enrolled ${enrolledCount} into this campaign.${summary.updated > 0 ? ` ${summary.updated} existing lead(s) updated.` : ''}`,
        );
      }
      setUploadFile(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const quickAddMutation = useMutation({
    mutationFn: async (email: string) => {
      const lead = await createLead({ email });
      await enrollCampaignLeads(params.id, { leadIds: [lead.id], force: true });
      return lead;
    },
    onSuccess: (lead) => {
      toast.success(`Added ${lead.email} and enrolled in campaign`);
      setQuickEmail('');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !campaign) {
    return <Skeleton className="h-40 w-full" />;
  }

  const enrolled = campaign.campaignLeads ?? [];
  const availableLeads = leadsData?.data ?? [];

  function toggleLead(id: string) {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && isSupportedSpreadsheet(file)) {
      setUploadFile(file);
    } else {
      toast.error('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && isSupportedSpreadsheet(file)) {
      setUploadFile(file);
    } else if (file) {
      toast.error('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Add leads</CardTitle>
            <div className="flex gap-1 rounded-lg border border-border p-0.5">
              <button
                onClick={() => setAddMode('quick-add')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  addMode === 'quick-add'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Quick Add
              </button>
              <button
                onClick={() => setAddMode('search')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  addMode === 'search'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Search
              </button>
              <button
                onClick={() => setAddMode('upload')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  addMode === 'upload'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Upload File
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {addMode === 'quick-add' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Type an email address to instantly create a lead and enroll it in this campaign.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = quickEmail.trim();
                  if (trimmed) quickAddMutation.mutate(trimmed);
                }}
                className="flex gap-2"
              >
                <Input
                  type="email"
                  value={quickEmail}
                  onChange={(e) => setQuickEmail(e.target.value)}
                  placeholder="name@company.com"
                  disabled={quickAddMutation.isPending}
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={!quickEmail.trim() || quickAddMutation.isPending}
                >
                  {quickAddMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </>
          ) : addMode === 'search' ? (
            <>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads by email or company..."
              />
              <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Email</TableHead>
                      <TableHead>Company</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={() => toggleLead(lead.id)}
                          />
                        </TableCell>
                        <TableCell>{lead.email}</TableCell>
                        <TableCell>{lead.company ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                disabled={selectedLeadIds.length === 0 || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                Preview eligibility ({selectedLeadIds.length})
              </Button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileSelect}
              />

              {!uploadFile ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  }`}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      Drag &amp; drop your file here, or click to browse
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Supports CSV, Excel (.xlsx, .xls) — max 10 MB
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                    <FileSpreadsheet className="h-8 w-8 flex-shrink-0 text-green-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{uploadFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    {!uploadMutation.isPending && (
                      <button
                        onClick={() => setUploadFile(null)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Leads will be imported and automatically enrolled in this campaign.
                    Columns like Email, Name, Company, Job Title, etc. are auto-detected.
                  </p>

                  <Button
                    className="w-full"
                    onClick={() => uploadMutation.mutate(uploadFile)}
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importing &amp; enrolling...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Import &amp; Enroll Leads
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enrolled leads ({enrolled.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {enrolled.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads enrolled yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrolled.map((cl) => (
                  <TableRow
                    key={cl.id}
                    className={selectedLeadId === cl.leadId ? 'bg-muted/40' : undefined}
                    onClick={() => setSelectedLeadId(cl.leadId)}
                  >
                    <TableCell>{cl.lead.email}</TableCell>
                    <TableCell>{cl.lead.status}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMutation.mutate(cl.leadId);
                        }}
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {selectedLeadId && (
            <div className="mt-4">
              <LeadSequenceTimeline campaignId={params.id} leadId={selectedLeadId} />
            </div>
          )}
        </CardContent>
      </Card>

      <LeadEligibilityModal
        open={eligibilityOpen}
        onOpenChange={setEligibilityOpen}
        report={eligibilityReport}
        loading={enrollMutation.isPending}
        onConfirm={() => enrollMutation.mutate()}
      />

      {campaign && ['DRAFT', 'SCHEDULED'].includes(campaign.status) && (
        <WizardNavigation campaignId={params.id} currentStep="leads" />
      )}
    </div>
  );
}
