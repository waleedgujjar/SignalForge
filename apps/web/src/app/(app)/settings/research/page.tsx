'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ExternalLink, Info, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/components/auth-provider';
import { AGENT_REACH_REPO_URL, ProviderSetupDialog } from '@/components/research/provider-setup-dialog';
import { RESEARCH_QUERY_KEYS, type BadgeTone } from '@/components/research/research-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  fetchResearchProviderStatus,
  fetchResearchProviders,
  runResearchHealthCheck,
  updateResearchProvider,
  type ProviderAuthentication,
  type ProviderHealth,
  type ProviderHealthStatus,
  type ResearchProviderConfig,
  type ResearchProviderStatus,
} from '@/lib/api';

const STATUS_BADGES: Record<ProviderHealthStatus, { label: string; variant: BadgeTone }> = {
  READY: { label: 'Ready', variant: 'success' },
  NEEDS_SETUP: { label: 'Needs setup', variant: 'warning' },
  UNAVAILABLE: { label: 'Unavailable', variant: 'destructive' },
  DISABLED: { label: 'Disabled', variant: 'outline' },
};

const AUTH_LABELS: Record<ProviderAuthentication, string> = {
  CONFIGURED: 'Configured',
  NOT_CONFIGURED: 'Not configured',
  NOT_REQUIRED: 'Not required',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  manual: 'A researcher opens the page and enters only what they confirmed. Always the last step in the chain.',
  public: 'One fetch of the URL you paste through a reader service; parses only visibly present fields.',
  'agent-reach': 'Health check via the Agent-Reach doctor command; research is routed through the public single fetch.',
  'authorized-api': 'Placeholder for an official LinkedIn partner API integration.',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function ComplianceNotice() {
  return (
    <Alert>
      <ShieldCheck className="h-4 w-4" />
      <AlertTitle>Compliance boundary</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>
          SignalForge never automates LinkedIn actions. No scraping at scale, no connection requests, messages or
          engagement, no CAPTCHA, anti-bot or rate-limit bypass, no proxy rotation, no fake accounts, no credential
          harvesting.
        </p>
        <p>
          No LinkedIn passwords, cookies, tokens or browser sessions are ever stored in SignalForge. A provider
          rejection (login wall, rate limit, CAPTCHA, private profile) stops the job and routes the record to Manual
          Review with the reason. Only URLs you provide are read, one request per researcher action.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function ProvidersSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="border-border">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ResearchProvidersPage() {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const queryClient = useQueryClient();
  const [setupProvider, setSetupProvider] = useState<{ provider: string; displayName: string } | null>(null);

  const statusQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.providerStatus,
    queryFn: fetchResearchProviderStatus,
    retry: false,
    staleTime: 60_000,
  });
  const providerStatus = statusQuery.data;
  const enabled = providerStatus?.status === 'ok';

  const providersQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.providers,
    queryFn: fetchResearchProviders,
    enabled,
    retry: false,
  });

  const healthMutation = useMutation({
    mutationFn: runResearchHealthCheck,
    onSuccess: (data) => {
      queryClient.setQueryData<ResearchProviderStatus>(RESEARCH_QUERY_KEYS.providerStatus, data);
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.providers });
      toast.success('Health check complete');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { provider: string; enabled: boolean }) =>
      updateResearchProvider({ source: 'LINKEDIN', provider: input.provider, enabled: input.enabled }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.providerStatus });
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.providers });
      toast.success(input.enabled ? 'Provider enabled for this workspace' : 'Provider disabled for this workspace');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const configByProvider = new Map<string, ResearchProviderConfig>(
    (providersQuery.data?.providers ?? [])
      .filter((config) => config.source === 'LINKEDIN')
      .map((config) => [config.provider, config]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Research Providers → LinkedIn</h2>
        <p className="text-sm text-muted-foreground">
          How LinkedIn research runs for this workspace. Provider credentials never live here — settings stay
          server-side, and this page shows environment variable names only.
        </p>
      </div>

      {statusQuery.isLoading ? (
        <ProvidersSkeleton />
      ) : statusQuery.isError || !providerStatus || providerStatus.status === 'unavailable' ? (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Research service is unreachable</AlertTitle>
          <AlertDescription>Provider status will load once the API responds.</AlertDescription>
        </Alert>
      ) : providerStatus.status === 'disabled' ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>LinkedIn research is disabled</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              The Lead Research module is switched off on this deployment. To turn it on, set{' '}
              <code className="text-xs">LINKEDIN_RESEARCH_ENABLED</code> on the API and worker hosts (strict: only
              &quot;true&quot; or &quot;1&quot; enable it) and restart them. Nothing is fetched while it is off.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSetupProvider({ provider: 'public', displayName: 'Public page fetch' })}
            >
              <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Setup Instructions
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Card className="border-border">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Selected provider:</span>{' '}
                  <span className="font-medium">{providerStatus.selectedProvider}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Chain: {providerStatus.chain.length > 0 ? providerStatus.chain.join(' → ') : 'manual'} — manual is
                  always the final step, so every job ends with a decision.
                </p>
              </div>
              {canManage ? (
                <Button size="sm" disabled={healthMutation.isPending} onClick={() => healthMutation.mutate()}>
                  {healthMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                  )}
                  Run Health Check
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Workspace admins can run health checks and change providers.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {providerStatus.providers.map((provider) => (
              <ProviderCard
                key={provider.provider}
                provider={provider}
                config={configByProvider.get(provider.provider)}
                canManage={canManage}
                toggling={toggleMutation.isPending && toggleMutation.variables?.provider === provider.provider}
                onToggle={(next) => toggleMutation.mutate({ provider: provider.provider, enabled: next })}
                onSetup={() => setSetupProvider({ provider: provider.provider, displayName: provider.displayName })}
              />
            ))}
          </div>
        </>
      )}

      <ComplianceNotice />

      <ProviderSetupDialog
        provider={setupProvider?.provider ?? null}
        displayName={setupProvider?.displayName}
        open={setupProvider !== null}
        onOpenChange={(open) => {
          if (!open) setSetupProvider(null);
        }}
      />
    </div>
  );
}

interface ProviderCardProps {
  provider: ProviderHealth;
  config: ResearchProviderConfig | undefined;
  canManage: boolean;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onSetup: () => void;
}

function ProviderCard({ provider, config, canManage, toggling, onToggle, onSetup }: ProviderCardProps) {
  const badge = STATUS_BADGES[provider.status];
  const workspaceEnabled = config?.enabled ?? provider.enabled;
  const usage: { requestCount: number; successfulRequests: number } | undefined = config ?? provider.usage ?? undefined;
  const isManual = provider.provider === 'manual';
  const switchId = `research-provider-${provider.provider}`;
  const lastCheck = provider.checkedAt ?? config?.lastHealthCheckAt ?? null;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>{provider.displayName}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardTitle>
        <CardDescription>
          {provider.note ?? PROVIDER_DESCRIPTIONS[provider.provider] ?? 'LinkedIn research provider.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Authentication</dt>
            <dd className="font-medium">{AUTH_LABELS[provider.authentication]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last health check</dt>
            <dd className="font-medium">{formatDate(lastCheck)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="font-medium tabular-nums">
              {usage ? `${usage.successfulRequests}/${usage.requestCount} succeeded` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Workspace</dt>
            <dd className="font-medium">{workspaceEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
        </dl>

        {provider.details.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {provider.details.map((detail, index) => (
              <li key={`${index}-${detail}`}>{detail}</li>
            ))}
          </ul>
        )}

        {!provider.implemented && (
          <p className="text-xs text-muted-foreground">Not implemented in this release.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            {provider.implemented && (
              <>
                <Switch
                  id={switchId}
                  checked={workspaceEnabled}
                  disabled={!canManage || isManual || toggling}
                  onCheckedChange={onToggle}
                />
                <Label htmlFor={switchId} className="text-xs">
                  {isManual ? 'Always on' : 'Enabled for this workspace'}
                </Label>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onSetup}>
              <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Setup Instructions
            </Button>
            {provider.provider === 'agent-reach' && (
              <Button variant="ghost" size="sm" asChild>
                <a href={AGENT_REACH_REPO_URL} target="_blank" rel="noopener noreferrer">
                  GitHub <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {!canManage && provider.implemented && !isManual && (
          <p className="text-xs text-muted-foreground">Workspace admins can change this.</p>
        )}
      </CardContent>
    </Card>
  );
}
