'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchWorkspaceDetails,
  updateWorkspaceSettings,
} from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  const queryClient = useQueryClient();
  const { role, refreshSession } = useAuth();

  const { data: workspace, isLoading } = useQuery({
    queryKey: ['workspace-details'],
    queryFn: fetchWorkspaceDetails,
  });

  const [form, setForm] = useState<{
    name: string;
    timezone: string;
    defaultFromName: string;
    defaultReplyTo: string;
  } | null>(null);

  useEffect(() => {
    if (workspace && !form) {
      setForm({
        name: workspace.name,
        timezone: workspace.timezone,
        defaultFromName: workspace.defaultFromName ?? '',
        defaultReplyTo: workspace.defaultReplyTo ?? '',
      });
    }
  }, [workspace, form]);

  const mutation = useMutation({
    mutationFn: updateWorkspaceSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-details'] });
      refreshSession();
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    mutation.mutate({
      name: form.name,
      timezone: form.timezone,
      defaultFromName: form.defaultFromName || null,
      defaultReplyTo: form.defaultReplyTo || null,
    });
  }

  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const hasChanges = form && workspace && (
    form.name !== workspace.name ||
    form.timezone !== workspace.timezone ||
    form.defaultFromName !== (workspace.defaultFromName ?? '') ||
    form.defaultReplyTo !== (workspace.defaultReplyTo ?? '')
  );

  if (isLoading) return <WorkspaceSkeleton />;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>
            Workspace name, slug, and identification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ws-name">Workspace Name</Label>
                <Input
                  id="ws-name"
                  value={form?.name ?? ''}
                  onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-slug">Slug</Label>
                <Input id="ws-slug" value={workspace?.slug ?? ''} disabled />
                <p className="text-xs text-muted-foreground">
                  Slug is generated on creation and cannot be changed.
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="ws-tz">Timezone</Label>
              <Select
                value={form?.timezone ?? 'UTC'}
                onValueChange={(val) => setForm((f) => f && { ...f, timezone: val })}
                disabled={!canEdit}
              >
                <SelectTrigger id="ws-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-medium text-foreground">Email Defaults</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ws-from">Default Sender Name</Label>
                  <Input
                    id="ws-from"
                    value={form?.defaultFromName ?? ''}
                    onChange={(e) =>
                      setForm((f) => f && { ...f, defaultFromName: e.target.value })
                    }
                    placeholder="e.g. Sales Team"
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ws-reply">Default Reply-To Email</Label>
                  <Input
                    id="ws-reply"
                    type="email"
                    value={form?.defaultReplyTo ?? ''}
                    onChange={(e) =>
                      setForm((f) => f && { ...f, defaultReplyTo: e.target.value })
                    }
                    placeholder="reply@yourcompany.com"
                    disabled={!canEdit}
                  />
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button type="submit" disabled={!hasChanges || mutation.isPending}>
                  {mutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}

            {!canEdit && (
              <p className="text-sm text-muted-foreground">
                Only workspace owners and admins can update these settings.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Workspace Info</CardTitle>
          <CardDescription>Details about this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Your Role</dt>
              <dd className="mt-1">
                <Badge variant="secondary">{workspace?.role ?? 'N/A'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Members</dt>
              <dd className="mt-1 text-sm text-foreground">
                {workspace?.memberCount ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1 text-sm text-foreground">
                {workspace?.createdAt
                  ? new Date(workspace.createdAt).toLocaleDateString()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
              <dd className="mt-1 text-sm text-foreground">
                {workspace?.updatedAt
                  ? new Date(workspace.updatedAt).toLocaleDateString()
                  : '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
