'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { DomainAuthPanel } from '@/components/deliverability/domain-auth-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDeliverabilityDomains } from '@/lib/api';

export default function DeliverabilityDomainsPage() {
  const domainsQuery = useQuery({
    queryKey: ['deliverability', 'domains'],
    queryFn: fetchDeliverabilityDomains,
  });

  const domains = domainsQuery.data?.domains ?? [];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/deliverability">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to deliverability
        </Link>
      </Button>

      <PageHeader
        title="Domain authentication"
        description="SPF, DKIM, and DMARC records for the domains your mailboxes send from."
      />

      {domainsQuery.data?.note && (
        <p className="text-xs text-muted-foreground">{domainsQuery.data.note}</p>
      )}

      {domainsQuery.isLoading ? (
        <div className="space-y-4">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-52 w-full" />
          ))}
        </div>
      ) : domains.length === 0 ? (
        <EmptyState
          title="No sending domains"
          description="Connect a mailbox and its domain will be checked automatically."
        />
      ) : (
        <div className="space-y-4">
          {domains.map((domain) => (
            <DomainAuthPanel key={domain.domain} domain={domain} />
          ))}
        </div>
      )}
    </>
  );
}
