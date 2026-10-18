'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { HealthTierBadge } from '@/components/deliverability/health-tier-badge';
import { PeriodSelect } from '@/components/deliverability/period-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  downloadDeliverabilityExport,
  fetchDeliverabilityCampaigns,
  type DeliverabilityPeriod,
} from '@/lib/api';

export default function CampaignDeliverabilityPage() {
  const [period, setPeriod] = useState<DeliverabilityPeriod>('7d');
  const [exporting, setExporting] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ['deliverability', 'campaigns', period],
    queryFn: () => fetchDeliverabilityCampaigns(period),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const { filename, csv } = await downloadDeliverabilityExport('campaigns', period);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const campaigns = campaignsQuery.data?.campaigns ?? [];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/deliverability">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to deliverability
        </Link>
      </Button>

      <PageHeader
        title="Campaign health"
        description="Delivery outcomes per campaign so you can compare which sequences are drawing bounces."
        actions={
          <div className="flex items-center gap-2">
            <PeriodSelect value={period} onChange={setPeriod} />
            <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {campaignsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <EmptyState
              title="No campaign activity"
              description="Campaign health appears once a campaign has attempted sends in this period."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Bounce rate</TableHead>
                  <TableHead>Failure rate</TableHead>
                  <TableHead>Reply rate</TableHead>
                  <TableHead>Unsubscribe rate</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.campaignId}>
                    <TableCell className="max-w-[220px] truncate font-medium">
                      {campaign.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{campaign.healthScore}</span>
                        <HealthTierBadge tier={campaign.tier} />
                      </div>
                    </TableCell>
                    <TableCell>{campaign.counters.sent}</TableCell>
                    <TableCell>{campaign.rates.bounceRate}%</TableCell>
                    <TableCell>{campaign.rates.failureRate}%</TableCell>
                    <TableCell>{campaign.rates.replyRate}%</TableCell>
                    <TableCell>{campaign.rates.unsubscribeRate}%</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/campaigns/${campaign.campaignId}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {campaignsQuery.data?.disclaimer && (
            <p className="mt-4 text-xs text-muted-foreground">{campaignsQuery.data.disclaimer}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
