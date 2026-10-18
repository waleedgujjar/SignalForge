'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ExternalLink, Trash2, CheckCircle2, AlertCircle, Cloud } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchIntegrations,
  connectIntegration,
  disconnectIntegration,
} from '@/lib/api';
import type { Integration } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PROVIDERS = [
  {
    id: 'GOOGLE_DRIVE' as const,
    name: 'Google Drive',
    description: 'Import leads from CSV and XLSX files stored in your Google Drive.',
    icon: (
      <svg viewBox="0 0 87.3 78" className="h-8 w-8">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L3.45 44.7c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00AC47" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 10.15z" fill="#EA4335" />
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
        <path d="M59.85 53H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC" />
        <path d="M73.4 26.5L60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.25 28h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
      </svg>
    ),
  },
  {
    id: null,
    name: 'OneDrive',
    description: 'Import leads from Microsoft OneDrive files.',
    comingSoon: true,
    icon: (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="#0078D4">
        <path d="M14.5 15h5.75a3.75 3.75 0 0 0 .69-7.44A5.5 5.5 0 0 0 10.5 6a5.48 5.48 0 0 0-4 1.73A4.5 4.5 0 0 0 7.5 16.5H14.5V15z" opacity="0.7" />
      </svg>
    ),
  },
  {
    id: null,
    name: 'Dropbox',
    description: 'Import leads from Dropbox files.',
    comingSoon: true,
    icon: (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="#0061FF">
        <path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm18-3.75l6 3.75L18 17l-6-3.75zM6 18.25l6-3.75 6 3.75L12 22z" />
      </svg>
    ),
  },
];

function statusBadge(status: Integration['status']) {
  switch (status) {
    case 'CONNECTED':
      return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge>;
    case 'EXPIRED':
      return <Badge variant="secondary" className="bg-yellow-600 text-white"><AlertCircle className="mr-1 h-3 w-3" />Expired</Badge>;
    case 'ERROR':
    case 'REVOKED':
      return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />{status === 'REVOKED' ? 'Revoked' : 'Error'}</Badge>;
  }
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
  });

  useEffect(() => {
    if (searchParams.get('connected') === 'google_drive') {
      toast.success('Google Drive connected successfully');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    }
    if (searchParams.get('error')) {
      toast.error(searchParams.get('error'));
    }
  }, [searchParams, queryClient]);

  const connectMutation = useMutation({
    mutationFn: (provider: 'GOOGLE_DRIVE') => connectIntegration(provider),
    onSuccess: (data) => {
      window.open(data.authUrl, '_blank', 'width=600,height=700');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectIntegration,
    onSuccess: () => {
      toast.success('Integration disconnected');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setDisconnectId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const getIntegration = (provider: string): Integration | undefined =>
    integrations.find((i) => i.provider === provider);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect external services to import leads and data.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const integration = provider.id ? getIntegration(provider.id) : undefined;
            const isConnected = integration?.status === 'CONNECTED';
            const comingSoon = 'comingSoon' in provider && provider.comingSoon;

            return (
              <Card key={provider.name} className={comingSoon ? 'opacity-60' : ''}>
                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="shrink-0">{provider.icon}</div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {provider.name}
                      {comingSoon && (
                        <Badge variant="outline" className="text-xs">Coming Soon</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {provider.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {integration ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        {statusBadge(integration.status)}
                        <span className="text-xs text-muted-foreground">
                          {integration.accountEmail}
                        </span>
                      </div>
                      {integration.lastUsedAt && (
                        <p className="text-xs text-muted-foreground">
                          Last used: {new Date(integration.lastUsedAt).toLocaleDateString()}
                        </p>
                      )}
                      <div className="flex gap-2">
                        {isConnected && (
                          <Button variant="outline" size="sm" asChild>
                            <a href="/leads/import/drive">
                              <Cloud className="mr-1.5 h-3.5 w-3.5" />
                              Import Leads
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDisconnectId(integration.id)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  ) : comingSoon ? (
                    <Button variant="outline" size="sm" disabled>
                      Not Available
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      disabled={connectMutation.isPending}
                      onClick={() => provider.id && connectMutation.mutate(provider.id)}
                    >
                      {connectMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!disconnectId} onOpenChange={() => setDisconnectId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Integration</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke access and remove the connection. You can reconnect anytime.
              Previously imported leads will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectId && disconnectMutation.mutate(disconnectId)}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
