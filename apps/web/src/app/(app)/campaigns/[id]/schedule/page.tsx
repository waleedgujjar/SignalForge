'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { fetchCampaign, updateCampaign } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { WizardNavigation } from '@/components/campaigns/campaign-wizard-stepper';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CampaignSchedulePage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', params.id],
    queryFn: () => fetchCampaign(params.id),
  });

  const schedule = (campaign?.scheduleConfig ?? {}) as {
    timezone?: string;
    days?: number[];
    startTime?: string;
    endTime?: string;
    minDelayMinutes?: number;
    maxDelayMinutes?: number;
  };

  const [timezone, setTimezone] = React.useState('');
  const [days, setDays] = React.useState<number[]>([]);
  const [startTime, setStartTime] = React.useState('09:00');
  const [endTime, setEndTime] = React.useState('17:00');
  const [minDelay, setMinDelay] = React.useState<number>(2);
  const [maxDelay, setMaxDelay] = React.useState<number>(5);
  const [dailyLimit, setDailyLimit] = React.useState<string>('');
  const [scheduledAt, setScheduledAt] = React.useState('');

  React.useEffect(() => {
    if (campaign) {
      setTimezone(schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setDays(schedule.days ?? [1, 2, 3, 4, 5]);
      setStartTime(schedule.startTime ?? '09:00');
      setEndTime(schedule.endTime ?? '17:00');
      setMinDelay(schedule.minDelayMinutes ?? 2);
      setMaxDelay(schedule.maxDelayMinutes ?? 5);
      setDailyLimit(
        campaign.dailySendingLimit !== null && campaign.dailySendingLimit !== undefined
          ? String(campaign.dailySendingLimit)
          : '',
      );
      setScheduledAt(
        campaign.scheduledAt ? new Date(campaign.scheduledAt).toISOString().slice(0, 16) : '',
      );
    }
  }, [
    campaign,
    schedule.days,
    schedule.endTime,
    schedule.startTime,
    schedule.timezone,
    schedule.minDelayMinutes,
    schedule.maxDelayMinutes,
  ]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (maxDelay < minDelay) {
        throw new Error('Max delay must be greater than or equal to min delay');
      }
      const parsedLimit = dailyLimit === '' ? null : Number(dailyLimit);
      if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
        throw new Error('Daily limit must be a positive number');
      }
      return updateCampaign(params.id, {
        scheduleConfig: {
          timezone,
          days,
          startTime,
          endTime,
          minDelayMinutes: minDelay,
          maxDelayMinutes: maxDelay,
        },
        dailySendingLimit: parsedLimit,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
    },
    onSuccess: () => {
      toast.success('Schedule saved');
      queryClient.invalidateQueries({ queryKey: ['campaign', params.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !campaign) {
    return <Skeleton className="h-40 w-full" />;
  }

  function toggleDay(day: number) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  return (
    <div className="space-y-4">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Sending schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Sending days</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, index) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={days.includes(index) ? 'default' : 'outline'}
                  onClick={() => toggleDay(index)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start time</Label>
              <Input id="startTime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End time</Label>
              <Input id="endTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="minDelay">Min delay between emails (minutes)</Label>
              <Input
                id="minDelay"
                type="number"
                min={0}
                value={minDelay}
                onChange={(e) => setMinDelay(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDelay">Max delay between emails (minutes)</Label>
              <Input
                id="maxDelay"
                type="number"
                min={0}
                value={maxDelay}
                onChange={(e) => setMaxDelay(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dailyLimit">Daily sending limit</Label>
            <Input
              id="dailyLimit"
              type="number"
              min={1}
              placeholder="No cap"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Maximum emails this campaign will send per day. Leave blank for no campaign-level cap.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduledAt">Optional launch datetime</Label>
            <Input
              id="scheduledAt"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If set in the future, launch will mark the campaign as SCHEDULED instead of ACTIVE.
            </p>
          </div>

          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save schedule
          </Button>
        </CardContent>
      </Card>

      {campaign && ['DRAFT', 'SCHEDULED'].includes(campaign.status) && (
        <WizardNavigation campaignId={params.id} currentStep="schedule" />
      )}
    </div>
  );
}
