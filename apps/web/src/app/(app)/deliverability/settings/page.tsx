'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '@/components/dashboard/page-header';
import { ProtectionSettingsForm } from '@/components/deliverability/protection-settings-form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDeliverabilityPolicy } from '@/lib/api';

export default function DeliverabilitySettingsPage() {
  const policyQuery = useQuery({
    queryKey: ['deliverability', 'policy'],
    queryFn: fetchDeliverabilityPolicy,
  });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/deliverability">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to deliverability
        </Link>
      </Button>

      <PageHeader
        title="Protection settings"
        description="Control when SignalForge slows down or pauses sending to protect a mailbox."
      />

      {policyQuery.isLoading || !policyQuery.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <ProtectionSettingsForm policy={policyQuery.data} />
          {policyQuery.data.disclaimer && (
            <p className="text-xs text-muted-foreground">{policyQuery.data.disclaimer}</p>
          )}
        </>
      )}
    </>
  );
}
