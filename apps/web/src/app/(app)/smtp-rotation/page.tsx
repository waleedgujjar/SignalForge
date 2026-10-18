'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { AllocationDistributionTable } from '@/components/smtp-rotation/allocation-distribution-table';
import { CapacityOverview } from '@/components/smtp-rotation/capacity-overview';
import { RotationSettingsForm } from '@/components/smtp-rotation/rotation-settings-form';
import { fetchRotationStats } from '@/lib/api';

export default function SmtpRotationPage() {
  const statsQuery = useQuery({
    queryKey: ['rotation-stats'],
    queryFn: fetchRotationStats,
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="SMTP Rotation"
        description="Workspace-wide sending capacity, allocation distribution, and rotation defaults."
      />

      <CapacityOverview stats={statsQuery.data} isLoading={statsQuery.isLoading} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <RotationSettingsForm />
        </div>
        <div className="lg:col-span-2">
          <AllocationDistributionTable stats={statsQuery.data} isLoading={statsQuery.isLoading} />
        </div>
      </div>
    </>
  );
}
