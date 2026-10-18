'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DnsStatusBadge } from './health-tier-badge';
import { checkDomainHealth, type DomainAuthSummary } from '@/lib/api';

export function DomainAuthPanel({ domain }: { domain: DomainAuthSummary }) {
  const queryClient = useQueryClient();
  const [selector, setSelector] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      checkDomainHealth(domain.domain, {
        force: true,
        ...(selector.trim() ? { dkimSelector: selector.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success(`Checked ${domain.domain}`);
      await queryClient.invalidateQueries({ queryKey: ['deliverability', 'domains'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{domain.domain}</CardTitle>
            <CardDescription>
              {domain.checkedAt
                ? `Last checked ${new Date(domain.checkedAt).toLocaleString()}`
                : 'Not checked yet'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <RefreshCw className={mutation.isPending ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            Check again
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <AuthRow label="SPF" status={domain.spfStatus} />
          <AuthRow label="DKIM" status={domain.dkimStatus} />
          <AuthRow label="DMARC" status={domain.dmarcStatus} />
          <AuthRow label="MX" status={domain.mxStatus} />
        </div>

        {domain.dmarcPolicy && (
          <p className="text-xs text-muted-foreground">
            DMARC policy: <span className="font-medium text-foreground">{domain.dmarcPolicy}</span>
          </p>
        )}

        {domain.dkimStatus === 'UNKNOWN' && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <Label htmlFor={`selector-${domain.domain}`} className="text-xs">
              DKIM selector
            </Label>
            <p className="text-[11px] text-muted-foreground">
              DKIM cannot be verified without the selector your provider publishes. Enter it to
              include DKIM in future checks.
            </p>
            <div className="flex gap-2">
              <Input
                id={`selector-${domain.domain}`}
                value={selector}
                onChange={(event) => setSelector(event.target.value)}
                placeholder="e.g. google or s1"
                className="h-8"
              />
              <Button
                size="sm"
                disabled={mutation.isPending || selector.trim().length === 0}
                onClick={() => mutation.mutate()}
              >
                Save & check
              </Button>
            </div>
          </div>
        )}

        {domain.recommendations.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-3">
            {domain.recommendations.map((recommendation) => (
              <li key={recommendation} className="text-sm text-muted-foreground">
                {recommendation}
              </li>
            ))}
          </ul>
        )}

        {domain.lastError && (
          <p className="text-xs text-muted-foreground">Lookup notes: {domain.lastError}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AuthRow({ label, status }: { label: string; status: DomainAuthSummary['spfStatus'] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <DnsStatusBadge status={status} />
    </div>
  );
}
