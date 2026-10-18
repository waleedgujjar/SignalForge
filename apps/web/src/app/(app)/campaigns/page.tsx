'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, MoreHorizontal, Pause, Play, Plus, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';

import {
  fetchCampaigns,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
} from '@/lib/api';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'ARCHIVED'];

const STRATEGY_LABELS: Record<string, string> = {
  HEALTH_AWARE: 'Health-aware',
  LEAST_UTILIZED: 'Least utilized',
  ROUND_ROBIN: 'Round robin',
};

export default function CampaignsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', statusFilter, search],
    queryFn: () =>
      fetchCampaigns({
        ...(statusFilter && { status: statusFilter }),
        ...(search && { search }),
      }),
  });

  const pauseMutation = useMutation({
    mutationFn: pauseCampaign,
    onSuccess: () => {
      toast.success('Campaign paused');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeCampaign,
    onSuccess: () => {
      toast.success('Campaign resumed');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const launchMutation = useMutation({
    mutationFn: launchCampaign,
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Campaign launched');
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      } else {
        toast.error(result.validation?.errors[0] ?? 'Launch validation failed');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const campaigns = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Manage outreach campaigns with multi-step email sequences."
        actions={
          <Button onClick={() => router.push('/campaigns/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Create Campaign
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card className="border-border">
          <div className="space-y-4 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : campaigns.length === 0 ? (
        <Card className="border-border">
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Create your first campaign to start building email sequences and enrolling leads."
            action={{
              label: 'Create Campaign',
              onClick: () => router.push('/campaigns/new'),
            }}
          />
        </Card>
      ) : (
        <Card className="border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">
                    <Link href={`/campaigns/${campaign.id}`} className="hover:underline">
                      {campaign.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={campaign.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {STRATEGY_LABELS[campaign.rotationStrategy] ?? campaign.rotationStrategy}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign._count?.campaignLeads ?? 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign._count?.steps ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {campaign.createdAt
                      ? new Date(campaign.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/campaigns/${campaign.id}`)}>
                          Open
                        </DropdownMenuItem>
                        {['DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status) && (
                          <DropdownMenuItem
                            onClick={() => launchMutation.mutate(campaign.id)}
                            disabled={launchMutation.isPending}
                          >
                            <Play className="mr-2 h-4 w-4" />
                            Launch
                          </DropdownMenuItem>
                        )}
                        {['ACTIVE', 'SCHEDULED'].includes(campaign.status) && (
                          <DropdownMenuItem
                            onClick={() => pauseMutation.mutate(campaign.id)}
                            disabled={pauseMutation.isPending}
                          >
                            <Pause className="mr-2 h-4 w-4" />
                            Pause
                          </DropdownMenuItem>
                        )}
                        {campaign.status === 'PAUSED' && (
                          <DropdownMenuItem
                            onClick={() => resumeMutation.mutate(campaign.id)}
                            disabled={resumeMutation.isPending}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Resume
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {data?.pagination && (
            <div className="border-t border-border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total}{' '}
                total campaigns
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
