'use client';

import Link from 'next/link';
import {
  Mail,
  Megaphone,
  Users,
  Activity,
  ArrowUpRight,
  TrendingUp,
  ShieldCheck,
  Zap,
  Plus,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchMailboxes, fetchCampaigns, fetchLeads, fetchHealth } from '@/lib/api';
import { DashboardAnalyticsSummary } from '@/components/analytics/dashboard-analytics-summary';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth-provider';

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  CONNECTED: 'success',
  PAUSED: 'warning',
  DRAFT: 'secondary',
  COMPLETED: 'default',
  DISCONNECTED: 'destructive',
  ERROR: 'destructive',
};

export default function DashboardPage() {
  const { workspace, user, isAuthenticated } = useAuth();

  const { data: mailboxes, isLoading: loadingMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(),
    enabled: isAuthenticated,
  });

  const { data: campaignsData, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['campaigns', { page: '1', limit: '5' }],
    queryFn: () => fetchCampaigns({ page: '1', limit: '5' }),
    enabled: isAuthenticated,
  });

  const { data: leadsData, isLoading: loadingLeads } = useQuery({
    queryKey: ['leads', { page: '1', limit: '1' }],
    queryFn: () => fetchLeads({ page: '1', limit: '1' }),
    enabled: isAuthenticated,
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  const statsLoading = loadingMailboxes || loadingCampaigns || loadingLeads;

  const campaigns = campaignsData?.data ?? [];
  const totalCampaigns = campaignsData?.pagination?.total ?? 0;
  const totalLeads = leadsData?.pagination?.total ?? 0;
  const totalMailboxes = mailboxes?.length ?? 0;
  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;
  const connectedMailboxes = mailboxes?.filter((m) => m.status === 'ACTIVE').length ?? 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        variant="hero"
        title={`Welcome back${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        description={
          workspace?.name
            ? `Here's what's happening in ${workspace.name} today.`
            : 'Monitor campaigns, mailboxes, and outbound performance at a glance.'
        }
        actions={
          <Button asChild className="gap-2 shadow-md shadow-primary/20">
            <Link href="/campaigns">
              <Plus className="h-4 w-4" />
              New campaign
            </Link>
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border">
              <CardContent className="p-6">
                <Skeleton className="mb-3 h-4 w-24" />
                <Skeleton className="mb-2 h-8 w-20" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
        <StatCard
          title="Total Campaigns"
          value={totalCampaigns}
          description={`${activeCampaigns} active`}
          icon={Megaphone}
          accent="blue"
        />
        <StatCard
          title="Total Leads"
          value={totalLeads}
          icon={Users}
          accent="violet"
        />
        <StatCard
          title="Mailboxes"
          value={totalMailboxes}
          description={`${connectedMailboxes} connected`}
          icon={Mail}
          accent="emerald"
        />
        <StatCard
          title="Platform Status"
          value={health?.status === 'ok' ? 'Healthy' : 'Degraded'}
          description={health?.version ? `v${health.version}` : undefined}
          icon={Activity}
          accent="amber"
        />
          </>
        )}
      </div>

      <DashboardAnalyticsSummary />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Campaigns */}
        <Card className="border-border/60 bg-white">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Campaigns</CardTitle>
              <Badge variant="secondary" className="text-xs">{totalCampaigns} total</Badge>
            </div>
            <CardDescription>Latest campaign activity</CardDescription>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="No campaigns yet"
                description="Create your first outbound campaign to start reaching prospects."
                className="py-8"
              />
            ) : (
              <div className="space-y-3">
                {campaigns.slice(0, 5).map((campaign) => (
                  <div
                    key={campaign.id}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {campaign.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {campaign._count?.campaignLeads ?? 0} leads · {campaign._count?.mailboxes ?? 0} mailboxes
                      </p>
                    </div>
                    <Badge variant={statusVariant[campaign.status] ?? 'secondary'} className="ml-3">
                      {campaign.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mailbox Health */}
        <Card className="border-border/60 bg-white">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Mailbox Health</CardTitle>
              <Badge variant="secondary" className="text-xs">{totalMailboxes} total</Badge>
            </div>
            <CardDescription>SMTP connection status and usage</CardDescription>
          </CardHeader>
          <CardContent>
            {!mailboxes || mailboxes.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="No mailboxes connected"
                description="Connect your first SMTP mailbox to start sending outbound emails."
                className="py-8"
              />
            ) : (
              <div className="space-y-4">
                {mailboxes.slice(0, 5).map((mailbox) => {
                  const usage = mailbox.dailySendingLimit
                    ? Math.round((mailbox.currentDailyUsage / mailbox.dailySendingLimit) * 100)
                    : 0;

                  return (
                    <div key={mailbox.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {mailbox.emailAddress}
                          </p>
                        </div>
                        <Badge variant={statusVariant[mailbox.status] ?? 'secondary'} className="ml-3 text-xs">
                          {mailbox.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <Progress value={usage} className="h-1.5 flex-1" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {mailbox.currentDailyUsage}/{mailbox.dailySendingLimit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Platform features */}
      <Card className="border-border/60 bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Platform Capabilities</CardTitle>
          <CardDescription>Integrated features powering your outbound engine</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Mail, label: 'Multiple SMTP', desc: 'Encrypted credentials' },
              { icon: TrendingUp, label: 'Smart Rotation', desc: 'Health-aware sending' },
              { icon: Zap, label: 'Dynamic Variables', desc: 'Spintax support' },
              { icon: Megaphone, label: 'Unlimited Campaigns', desc: 'Search & pagination' },
              { icon: Users, label: 'Country Filters', desc: 'Geographic targeting' },
              { icon: ShieldCheck, label: 'Email Verification', desc: 'Smart pipeline' },
              { icon: Activity, label: 'Suppression Lists', desc: 'Domain reputation' },
              { icon: ArrowUpRight, label: 'Pause & Resume', desc: 'Campaign & mailbox' },
            ].map((feature) => (
              <div
                key={feature.label}
                className="group flex items-start gap-3 rounded-xl border border-border/50 bg-muted/20 p-4 transition-all hover:border-primary/20 hover:bg-primary/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <feature.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
