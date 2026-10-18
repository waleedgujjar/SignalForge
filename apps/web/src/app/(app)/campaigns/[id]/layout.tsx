'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, Calendar, LayoutDashboard, Mail, Send, Users } from 'lucide-react';

import { fetchCampaign } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { CampaignWizardStepper } from '@/components/campaigns/campaign-wizard-stepper';
import { Skeleton } from '@/components/ui/skeleton';

const manageTabs = [
  { href: '', label: 'Overview', icon: LayoutDashboard },
  { href: '/sequence', label: 'Sequence', icon: Mail },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/mailboxes', label: 'Sending Accounts', icon: Send },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  { href: '/activity', label: 'Activity', icon: Activity },
];

function resolveWizardStep(pathname: string, basePath: string): string {
  const subPath = pathname.replace(basePath, '');
  if (subPath === '/leads' || subPath.startsWith('/leads/')) return 'leads';
  if (subPath === '/sequence' || subPath.startsWith('/sequence/')) return 'sequence';
  if (subPath === '/schedule' || subPath === '/mailboxes' || subPath.startsWith('/schedule/') || subPath.startsWith('/mailboxes/')) return 'schedule';
  if (subPath === '/review' || subPath.startsWith('/review/')) return 'review';
  return 'leads';
}

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const basePath = `/campaigns/${params.id}`;

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  const isDraftLike = campaign && ['DRAFT', 'SCHEDULED'].includes(campaign.status);
  const wizardStep = resolveWizardStep(pathname, basePath);

  return (
    <div className="space-y-6">
      <div>
        {isLoading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{campaign?.name ?? 'Campaign'}</h1>
            {campaign && <CampaignStatusBadge status={campaign.status} />}
          </div>
        )}
        {campaign?.description && (
          <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>
        )}
      </div>

      {isDraftLike && campaign ? (
        <CampaignWizardStepper
          campaignId={params.id}
          currentStep={wizardStep}
          campaign={campaign}
        />
      ) : (
        <nav className="flex flex-wrap gap-1 border-b border-border pb-2">
          {manageTabs.map((tab) => {
            const href = `${basePath}${tab.href}`;
            const active = tab.href === '' ? pathname === basePath : pathname.startsWith(href);
            return (
              <Link
                key={tab.href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div>{children}</div>
    </div>
  );
}
