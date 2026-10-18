'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MailboxEncryption } from '@/lib/api';
import { createMailbox, testMailboxConnection } from '@/lib/api';

import { PROVIDER_PRESETS, type ProviderPreset } from './provider-presets';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface FormState {
  presetId: string;
  name: string;
  emailAddress: string;
  fromName: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  encryptionType: MailboxEncryption;
  dailySendingLimit: string;
}

const INITIAL_STATE: FormState = {
  presetId: 'custom',
  name: '',
  emailAddress: '',
  fromName: '',
  replyTo: '',
  smtpHost: '',
  smtpPort: '587',
  smtpUsername: '',
  smtpPassword: '',
  encryptionType: 'TLS',
  dailySendingLimit: '100',
};

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; errorCategory?: string };

export function AddMailboxDialog({ open, onOpenChange, onCreated }: Props) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });

  useEffect(() => {
    if (!open) {
      setState(INITIAL_STATE);
      setTestState({ status: 'idle' });
    }
  }, [open]);

  const testMutation = useMutation({
    mutationFn: testMailboxConnection,
    onMutate: () => setTestState({ status: 'testing' }),
    onSuccess: (result) => {
      if (result.success) {
        setTestState({ status: 'success', message: result.message });
      } else {
        setTestState({
          status: 'error',
          message: result.message,
          errorCategory: result.errorCategory,
        });
      }
    },
    onError: (err) => {
      setTestState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Connection failed.',
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: createMailbox,
    onSuccess: () => {
      toast.success('Email account created.');
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create account.');
    },
  });

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
    setTestState({ status: 'idle' });
  }

  function applyPreset(preset: ProviderPreset) {
    setState((prev) => ({
      ...prev,
      presetId: preset.id,
      smtpHost: preset.smtpHost ?? prev.smtpHost,
      smtpPort: preset.smtpPort ? String(preset.smtpPort) : prev.smtpPort,
      encryptionType: preset.encryptionType ?? prev.encryptionType,
    }));
    setTestState({ status: 'idle' });
  }

  function payloadForTest() {
    return {
      smtpHost: state.smtpHost.trim(),
      smtpPort: Number(state.smtpPort),
      smtpUsername: state.smtpUsername.trim() || state.emailAddress.trim(),
      smtpPassword: state.smtpPassword,
      encryptionType: state.encryptionType,
      emailAddress: state.emailAddress.trim(),
      fromName: state.fromName.trim(),
    };
  }

  function handleTest() {
    const payload = payloadForTest();
    if (!payload.smtpHost || !payload.smtpPort || !payload.smtpPassword || !payload.emailAddress) {
      toast.error('Fill in email, host, port, and password before testing.');
      return;
    }
    testMutation.mutate(payload);
  }

  function handleCreate() {
    createMutation.mutate({
      provider: 'SMTP',
      name: state.name.trim() || null,
      emailAddress: state.emailAddress.trim(),
      fromName: state.fromName.trim(),
      replyTo: state.replyTo.trim() || null,
      smtpHost: state.smtpHost.trim(),
      smtpPort: Number(state.smtpPort),
      smtpUsername: state.smtpUsername.trim() || state.emailAddress.trim(),
      smtpPassword: state.smtpPassword,
      encryptionType: state.encryptionType,
      dailySendingLimit: Number(state.dailySendingLimit || '100'),
      verified: testState.status === 'success',
    });
  }

  const preset = PROVIDER_PRESETS.find((p) => p.id === state.presetId) ?? PROVIDER_PRESETS[0]!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect an email account</DialogTitle>
          <DialogDescription>
            Enter the SMTP details for the account you want to send from. We test the connection
            before saving. Passwords are encrypted at rest and never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Provider preset</Label>
            <Select
              value={state.presetId}
              onValueChange={(value) => {
                const next = PROVIDER_PRESETS.find((p) => p.id === value);
                if (next) applyPreset(next);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset.hint && (
              <p className="text-xs text-muted-foreground">{preset.hint}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Display name (optional)</Label>
              <Input
                id="name"
                value={state.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Sales Account 01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fromName">From name</Label>
              <Input
                id="fromName"
                value={state.fromName}
                onChange={(e) => updateField('fromName', e.target.value)}
                placeholder="Jane Doe"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailAddress">Email address</Label>
              <Input
                id="emailAddress"
                type="email"
                value={state.emailAddress}
                onChange={(e) => updateField('emailAddress', e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replyTo">Reply-to (optional)</Label>
              <Input
                id="replyTo"
                type="email"
                value={state.replyTo}
                onChange={(e) => updateField('replyTo', e.target.value)}
                placeholder="replies@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpHost">SMTP host</Label>
              <Input
                id="smtpHost"
                value={state.smtpHost}
                onChange={(e) => updateField('smtpHost', e.target.value)}
                placeholder="smtp.example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPort">SMTP port</Label>
              <Input
                id="smtpPort"
                type="number"
                value={state.smtpPort}
                onChange={(e) => updateField('smtpPort', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpUsername">Username</Label>
              <Input
                id="smtpUsername"
                value={state.smtpUsername}
                onChange={(e) => updateField('smtpUsername', e.target.value)}
                placeholder="Defaults to email address"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPassword">Password</Label>
              <Input
                id="smtpPassword"
                type="password"
                value={state.smtpPassword}
                onChange={(e) => updateField('smtpPassword', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Encryption</Label>
              <Select
                value={state.encryptionType}
                onValueChange={(value) => updateField('encryptionType', value as MailboxEncryption)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TLS">TLS (STARTTLS)</SelectItem>
                  <SelectItem value="SSL">SSL</SelectItem>
                  <SelectItem value="NONE">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dailySendingLimit">Daily send limit</Label>
              <Input
                id="dailySendingLimit"
                type="number"
                value={state.dailySendingLimit}
                onChange={(e) => updateField('dailySendingLimit', e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="text-sm">
              <div className="font-medium text-foreground">Connection test</div>
              <p className="text-xs text-muted-foreground">
                Verify SMTP credentials before saving. Testing does not send an email.
              </p>
              {testState.status === 'success' && (
                <p className="mt-2 flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> {testState.message}
                </p>
              )}
              {testState.status === 'error' && (
                <p className="mt-2 flex items-center gap-2 text-xs text-destructive">
                  <XCircle className="h-4 w-4" /> {testState.message}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test connection
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            Save without verifying
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={createMutation.isPending || testState.status !== 'success'}
          >
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save & enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
