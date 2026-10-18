'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Facebook, Globe, Linkedin, Loader2, Microscope, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchLeadWebsiteAnalysis, type Lead } from '@/lib/api';
import { LinkedInResearchCard } from './linkedin-research-card';
import { RESEARCH_QUERY_KEYS } from './research-status';

interface Props {
  leadId: string;
  lead: Lead;
}

/**
 * Lead-page Research card: LinkedIn (active), Website (read-only view of the existing analysis),
 * Web and Facebook (disabled — not available in this release).
 */
export function ResearchSection({ leadId, lead }: Props) {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Microscope className="h-4 w-4" /> Research
        </CardTitle>
        <CardDescription>
          Source-attributed research for this lead. Every value carries a verification label; nothing inferred is
          presented as verified.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="linkedin">
          <TabsList>
            <TabsTrigger value="linkedin">
              <Linkedin className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> LinkedIn
            </TabsTrigger>
            <TabsTrigger value="website">
              <Globe className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Website
            </TabsTrigger>
            <DisabledTab value="web" label="Web" icon={Search} />
            <DisabledTab value="facebook" label="Facebook" icon={Facebook} />
          </TabsList>
          <TabsContent value="linkedin" className="pt-3">
            <LinkedInResearchCard leadId={leadId} lead={lead} />
          </TabsContent>
          <TabsContent value="website" className="pt-3">
            <WebsiteResearchTab leadId={leadId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/**
 * Disabled triggers have `pointer-events-none`, so the tooltip target is a focusable wrapper span.
 * No content pane exists for these values on purpose.
 */
function DisabledTab({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex" aria-label={`${label} — not available`}>
          <TabsTrigger value={value} disabled>
            <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {label}
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent>Not available</TooltipContent>
    </Tooltip>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  return score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-500';
}

/** Reuses the exact query the Website Intel sidebar card uses; no second "Analyze" button here. */
function WebsiteResearchTab({ leadId }: { leadId: string }) {
  const { data: analysis, isLoading, isError } = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.leadWebsiteAnalysis(leadId),
    queryFn: () => fetchLeadWebsiteAnalysis(leadId),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading website analysis…
      </div>
    );
  }

  if (isError || !analysis) {
    return (
      <p className="text-sm text-muted-foreground">
        No website analysis yet. Start one from the Website Intel card in the sidebar.
      </p>
    );
  }

  const analyzedAt = analysis.analyzedAt ?? (analysis.status === 'COMPLETED' ? analysis.updatedAt : null);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{analysis.status}</Badge>
        <span className="text-xs text-muted-foreground">{analysis.domain}</span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-xs text-muted-foreground">Website score</dt>
          <dd className={`font-semibold ${scoreColor(analysis.websiteScore)}`}>
            {analysis.websiteScore ?? '—'}/100
          </dd>
        </div>
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-xs text-muted-foreground">Opportunity</dt>
          <dd className={`font-semibold ${scoreColor(analysis.opportunityScore)}`}>
            {analysis.opportunityScore ?? '—'}/100
          </dd>
        </div>
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-xs text-muted-foreground">Analyzed</dt>
          <dd className="font-medium">
            {analyzedAt ? new Date(analyzedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          </dd>
        </div>
      </dl>
      {analysis.status === 'COMPLETED' && (
        <Link href={`/website-intelligence/${analysis.id}`} className="text-sm text-primary hover:underline">
          Open full report
        </Link>
      )}
      <p className="text-xs text-muted-foreground">
        Read-only view. Start or re-run analyses from the Website Intel card.
      </p>
    </div>
  );
}
