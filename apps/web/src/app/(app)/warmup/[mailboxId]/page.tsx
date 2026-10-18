'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Flame, Pause, Play, Power, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { WarmupStatusBadge } from '@/components/warmup/warmup-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  disableWarmup,
  enableWarmup,
  fetchWarmupAccount,
  fetchWarmupHistory,
  pauseWarmup,
  resetWarmup,
  resumeWarmup,
  updateWarmupSettings,
  type WarmupSettingsInput,
} from '@/lib/api';

export default function WarmupDetailPage({
  params,
}: {
  params: Promise<{ mailboxId: string }>;
}) {
  const { mailboxId } = use(params);
  const queryClient = useQueryClient();

  const account = useQuery({
    queryKey: ['warmup', 'account', mailboxId],
    queryFn: () => fetchWarmupAccount(mailboxId),
  });

  const history = useQuery({
    queryKey: ['warmup', 'history', mailboxId],
    queryFn: () => fetchWarmupHistory(mailboxId, { page: 1, limit: 14 }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['warmup', 'account', mailboxId] });
    queryClient.invalidateQueries({ queryKey: ['warmup', 'accounts'] });
    queryClient.invalidateQueries({ queryKey: ['warmup', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['warmup', 'history', mailboxId] });
  };

  const enableMutation = useMutation({
    mutationFn: (settings?: WarmupSettingsInput) => enableWarmup(mailboxId, settings),
    onSuccess: () => {
      toast.success('Warmup enabled');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pauseMutation = useMutation({
    mutationFn: () => pauseWarmup(mailboxId),
    onSuccess: () => {
      toast.success('Warmup paused');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeWarmup(mailboxId),
    onSuccess: () => {
      toast.success('Warmup resumed');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const disableMutation = useMutation({
    mutationFn: () => disableWarmup(mailboxId),
    onSuccess: () => {
      toast.success('Warmup disabled');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const resetMutation = useMutation({
    mutationFn: () => resetWarmup(mailboxId),
    onSuccess: () => {
      toast.success('Warmup progression reset');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const settingsMutation = useMutation({
    mutationFn: (settings: WarmupSettingsInput) => updateWarmupSettings(mailboxId, settings),
    onSuccess: () => {
      toast.success('Settings saved');
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (account.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!account.data) {
    return (
      <div className="py-16 text-center text-muted-foreground">Mailbox not found.</div>
    );
  }

  const { mailbox, config, eligibility, capacity, recentFailures } = account.data;
  const status = config?.status ?? 'NOT_STARTED';
  const currentLimit = config?.currentDailyLimit ?? 0;
  const warmupSent = capacity?.warmupSentToday ?? 0;
  const warmupReserved = capacity?.warmupReservedToday ?? 0;
  const usedToday = warmupSent + warmupReserved;
  const usagePercent =
    currentLimit > 0 ? Math.min(100, Math.round((usedToday / currentLimit) * 100)) : 0;

  return (
    <>
      <PageHeader
        title={mailbox.emailAddress}
        description={`Warmup detail for ${mailbox.fromName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/warmup">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
            <WarmupStatusBadge status={status} />
          </div>
        }
      />

      {status === 'BLOCKED' && config?.blockReason && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Warmup blocked</AlertTitle>
          <AlertDescription>{config.blockReason}</AlertDescription>
        </Alert>
      )}
      {!eligibility.eligible && eligibility.reason !== 'ELIGIBLE' && (
        <Alert className="mt-4">
          <AlertTitle>Not currently sending</AlertTitle>
          <AlertDescription>{eligibility.message}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today&apos;s warmup usage</CardTitle>
            <CardDescription>
              Sent {warmupSent} · Reserved {warmupReserved}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">
                {usedToday}
                <span className="text-base font-normal text-muted-foreground"> / {currentLimit || '—'}</span>
              </span>
            </div>
            <Progress value={usagePercent} className="mt-3" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Account capacity today</CardTitle>
            <CardDescription>
              Campaign sends share this limit with warmup
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {capacity ? capacity.accountRemaining : '—'}
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                left of {mailbox.dailySendingLimit}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ramp progress</CardTitle>
            <CardDescription>
              Ramps {config?.rampStep ?? 0}/day every {config?.rampIntervalHours ?? 0}h
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {currentLimit}
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                / {config?.maximumDailyLimit ?? mailbox.dailySendingLimit} target
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {status === 'NOT_STARTED' || status === 'COMPLETED' || status === 'DISABLED' ? (
          <Button
            onClick={() => enableMutation.mutate(undefined)}
            disabled={enableMutation.isPending}
          >
            <Flame className="mr-2 h-4 w-4" />
            {status === 'NOT_STARTED' ? 'Enable warmup' : 'Restart warmup'}
          </Button>
        ) : null}
        {status === 'ACTIVE' && (
          <Button
            variant="outline"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
          >
            <Pause className="mr-2 h-4 w-4" />
            Pause
          </Button>
        )}
        {status === 'PAUSED' && (
          <Button onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
            <Play className="mr-2 h-4 w-4" />
            Resume
          </Button>
        )}
        {(status === 'ACTIVE' || status === 'PAUSED' || status === 'BLOCKED') && (
          <Button
            variant="outline"
            onClick={() => disableMutation.mutate()}
            disabled={disableMutation.isPending}
          >
            <Power className="mr-2 h-4 w-4" />
            Disable
          </Button>
        )}
        {config && (
          <Button
            variant="ghost"
            onClick={() => {
              if (window.confirm('Reset warmup progression back to the starting limit?')) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset progression
          </Button>
        )}
      </div>

      {config && (
        <WarmupSettingsForm
          key={config.id}
          config={{
            startingDailyLimit: config.startingDailyLimit,
            maximumDailyLimit: config.maximumDailyLimit,
            rampStep: config.rampStep,
            rampIntervalHours: config.rampIntervalHours,
            timezone: config.timezone,
            windowStart: config.windowStart,
            windowEnd: config.windowEnd,
            weekdays: config.weekdays,
            consecutiveFailureThreshold: config.consecutiveFailureThreshold,
          }}
          onSave={(values) => settingsMutation.mutate(values)}
          saving={settingsMutation.isPending}
        />
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent history</CardTitle>
          <CardDescription>Daily send summaries for this mailbox</CardDescription>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <Skeleton className="h-40" />
          ) : history.data && history.data.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Deferred</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.usageDate.slice(0, 10)}
                    </TableCell>
                    <TableCell>{row.configuredLimit}</TableCell>
                    <TableCell>{row.sentCount}</TableCell>
                    <TableCell>{row.failedCount}</TableCell>
                    <TableCell>{row.deferredCount}</TableCell>
                    <TableCell>
                      <WarmupStatusBadge status={row.statusSnapshot} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No history yet. Warmup activity appears here once jobs run.
            </p>
          )}
        </CardContent>
      </Card>

      {recentFailures.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent send failures</CardTitle>
            <CardDescription>Investigate persistent failures to avoid blocking</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFailures.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {f.failedAt ? new Date(f.failedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.recipientEmail}</TableCell>
                    <TableCell>{f.errorCategory ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.lastError ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

interface SettingsFormProps {
  config: {
    startingDailyLimit: number;
    maximumDailyLimit: number;
    rampStep: number;
    rampIntervalHours: number;
    timezone: string;
    windowStart: string;
    windowEnd: string;
    weekdays: number[];
    consecutiveFailureThreshold: number;
  };
  onSave: (values: WarmupSettingsInput) => void;
  saving: boolean;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WarmupSettingsForm({ config, onSave, saving }: SettingsFormProps) {
  const [values, setValues] = useState(config);

  const toggleWeekday = (day: number) => {
    setValues((v) => ({
      ...v,
      weekdays: v.weekdays.includes(day)
        ? v.weekdays.filter((d) => d !== day)
        : [...v.weekdays, day].sort(),
    }));
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Warmup settings</CardTitle>
        <CardDescription>Adjust the ramp, schedule, and safety thresholds.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(values);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="startingDailyLimit">Starting daily limit</Label>
            <Input
              id="startingDailyLimit"
              type="number"
              min={1}
              value={values.startingDailyLimit}
              onChange={(e) =>
                setValues((v) => ({ ...v, startingDailyLimit: Number(e.target.value) }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maximumDailyLimit">Maximum daily limit</Label>
            <Input
              id="maximumDailyLimit"
              type="number"
              min={1}
              value={values.maximumDailyLimit}
              onChange={(e) =>
                setValues((v) => ({ ...v, maximumDailyLimit: Number(e.target.value) }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rampStep">Ramp step</Label>
            <Input
              id="rampStep"
              type="number"
              min={1}
              value={values.rampStep}
              onChange={(e) => setValues((v) => ({ ...v, rampStep: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rampIntervalHours">Ramp interval (hours)</Label>
            <Input
              id="rampIntervalHours"
              type="number"
              min={1}
              value={values.rampIntervalHours}
              onChange={(e) =>
                setValues((v) => ({ ...v, rampIntervalHours: Number(e.target.value) }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              value={values.timezone}
              onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="failureThreshold">Failure threshold</Label>
            <Input
              id="failureThreshold"
              type="number"
              min={1}
              max={20}
              value={values.consecutiveFailureThreshold}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  consecutiveFailureThreshold: Number(e.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="windowStart">Window start (HH:MM)</Label>
            <Input
              id="windowStart"
              value={values.windowStart}
              onChange={(e) => setValues((v) => ({ ...v, windowStart: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="windowEnd">Window end (HH:MM)</Label>
            <Input
              id="windowEnd"
              value={values.windowEnd}
              onChange={(e) => setValues((v) => ({ ...v, windowEnd: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <Label className="mb-2 block">Weekdays</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, day) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={values.weekdays.includes(day) ? 'default' : 'outline'}
                  onClick={() => toggleWeekday(day)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              Save settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
