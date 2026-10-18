'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Globe2, RefreshCw, Loader2, ExternalLink } from 'lucide-react';

import { fetchWebsiteAnalysis, rescanWebsite } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

function ScoreCircle({ score, label, size = 'md' }: { score: number | null; label: string; size?: 'md' | 'lg' }) {
  if (score === null) return null;
  const color = score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-500';
  const dim = size === 'lg' ? 'w-24 h-24' : 'w-16 h-16';
  const textSize = size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${dim} rounded-full border-4 border-muted flex items-center justify-center`}>
        <span className={`${textSize} font-bold ${color}`}>{score}</span>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function FindingsList({ findings }: { findings: Array<{ title: string; description: string; severity: string }> }) {
  if (!findings || findings.length === 0) return <p className="text-sm text-muted-foreground">No issues found.</p>;
  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <Badge
            variant={f.severity === 'HIGH' || f.severity === 'CRITICAL' ? 'destructive' : f.severity === 'MEDIUM' ? 'secondary' : 'outline'}
            className="mt-0.5 text-xs shrink-0"
          >
            {f.severity}
          </Badge>
          <div>
            <p className="font-medium">{f.title}</p>
            <p className="text-muted-foreground text-xs">{f.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WebsiteAnalysisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: analysis, isLoading } = useQuery({
    queryKey: ['website-analysis', id],
    queryFn: () => fetchWebsiteAnalysis(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'PENDING' || status === 'CRAWLING' || status === 'ANALYZING') return 3000;
      return false;
    },
  });

  const rescanMutation = useMutation({
    mutationFn: () => rescanWebsite(id),
    onSuccess: (data) => {
      toast.success('Re-scan started');
      router.push(`/website-intelligence/${data.analysisId}`);
    },
    onError: () => toast.error('Failed to start re-scan'),
  });

  if (isLoading || !analysis) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inProgress = analysis.status === 'PENDING' || analysis.status === 'CRAWLING' || analysis.status === 'ANALYZING';
  const scoreBreakdown = analysis.scoreBreakdown as Record<string, number> | null;
  const techFindings = (analysis.technicalFindings as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const perfFindings = (analysis.performanceData as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const seoFindingsList = (analysis.seoFindings as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const mobileFindingsList = (analysis.mobileFindings as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const contentFindingsList = (analysis.contentFindings as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const conversionFindingsList = (analysis.conversionData as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  const aiSignalFindings = (analysis.aiSignals as Record<string, unknown>)?.findings as Array<{ title: string; description: string; severity: string }> | undefined;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/website-intelligence')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Globe2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">{analysis.domain}</h1>
            <a href={analysis.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline flex items-center gap-1">
              {analysis.url} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => rescanMutation.mutate()} disabled={rescanMutation.isPending || inProgress}>
          <RefreshCw className={`mr-1 h-4 w-4 ${rescanMutation.isPending ? 'animate-spin' : ''}`} />
          Re-scan
        </Button>
      </div>

      {inProgress && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium">Analysis in progress</p>
              <p className="text-sm text-muted-foreground">Status: {analysis.status}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {analysis.status === 'FAILED' && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="font-medium text-destructive">Analysis Failed</p>
            <p className="text-sm text-muted-foreground">{analysis.errorMessage || 'Unknown error'}</p>
          </CardContent>
        </Card>
      )}

      {analysis.status === 'COMPLETED' && (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Scores</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-around">
                    <ScoreCircle score={analysis.websiteScore} label="Website" size="lg" />
                    <ScoreCircle score={analysis.opportunityScore} label="Opportunity" size="lg" />
                  </div>
                  {scoreBreakdown && (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-6">
                      {Object.entries(scoreBreakdown).map(([key, value]) => (
                        <ScoreCircle key={key} score={value} label={key.replace(/([A-Z])/g, ' $1').trim()} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Tabs defaultValue="technical">
                <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
                  <TabsTrigger value="technical">Technical</TabsTrigger>
                  <TabsTrigger value="seo">SEO</TabsTrigger>
                  <TabsTrigger value="performance">Performance</TabsTrigger>
                  <TabsTrigger value="mobile">Mobile</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="conversion">Conversion</TabsTrigger>
                  <TabsTrigger value="ai-signals">AI Signals</TabsTrigger>
                </TabsList>
                <TabsContent value="technical"><Card><CardContent className="pt-6"><FindingsList findings={techFindings ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="seo"><Card><CardContent className="pt-6"><FindingsList findings={seoFindingsList ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="performance"><Card><CardContent className="pt-6"><FindingsList findings={perfFindings ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="mobile"><Card><CardContent className="pt-6"><FindingsList findings={mobileFindingsList ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="content"><Card><CardContent className="pt-6"><FindingsList findings={contentFindingsList ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="conversion"><Card><CardContent className="pt-6"><FindingsList findings={conversionFindingsList ?? []} /></CardContent></Card></TabsContent>
                <TabsContent value="ai-signals"><Card><CardContent className="pt-6"><FindingsList findings={aiSignalFindings ?? []} /></CardContent></Card></TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6">
              {analysis.aiSummary && (
                <Card>
                  <CardHeader><CardTitle className="text-base">AI Summary</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground">{analysis.aiSummary}</p></CardContent>
                </Card>
              )}

              {analysis.recommendedServices && analysis.recommendedServices.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Recommended Services</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {analysis.recommendedServices.map((svc, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{svc.service}</p>
                          <Badge variant="outline" className="text-xs">{svc.confidence}</Badge>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {svc.evidence.map((e, j) => <li key={j}>• {e}</li>)}
                        </ul>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {analysis.technologies && analysis.technologies.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Technologies Detected</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {analysis.technologies.map((t, i) => (
                        <Badge key={i} variant="outline">{t.name}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {analysis.aiPersonalizationHooks && analysis.aiPersonalizationHooks.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Personalization Hooks</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {analysis.aiPersonalizationHooks.map((h, i) => <li key={i}>• {h}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">Crawl Info</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Pages crawled:</span> {analysis.pagesCrawled}</p>
                  <p><span className="text-muted-foreground">Duration:</span> {analysis.crawlDurationMs ? `${(analysis.crawlDurationMs / 1000).toFixed(1)}s` : '—'}</p>
                  <p><span className="text-muted-foreground">Analyzed:</span> {new Date(analysis.createdAt).toLocaleString()}</p>
                  {analysis.lead && (
                    <p><span className="text-muted-foreground">Lead:</span> {analysis.lead.fullName || analysis.lead.email}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
