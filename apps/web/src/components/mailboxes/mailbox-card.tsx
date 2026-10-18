'use client';

import { MoreHorizontal, FlaskConical, Power, Pencil, Trash2, History } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Mailbox } from '@/lib/api';

import { MailboxHealthBadge } from './mailbox-health-badge';
import { MailboxStatusBadge } from './mailbox-status-badge';

interface Props {
  mailbox: Mailbox;
  selected: boolean;
  onSelect: (id: string, next: boolean) => void;
  onTest: (id: string) => void;
  onToggle: (id: string, status: Mailbox['status']) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function MailboxCard({
  mailbox,
  selected,
  onSelect,
  onTest,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: Props) {
  const usagePercent =
    mailbox.dailySendingLimit > 0
      ? Math.min(100, Math.round((mailbox.currentDailyUsage / mailbox.dailySendingLimit) * 100))
      : 0;

  const displayName = mailbox.name?.trim() ? mailbox.name : mailbox.emailAddress;
  const assignedCampaigns = mailbox.assignedCampaigns ?? [];

  return (
    <Card className="flex flex-col gap-4 border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(next) => onSelect(mailbox.id, next === true)}
            aria-label={`Select ${displayName}`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{displayName}</h3>
              <MailboxStatusBadge status={mailbox.status} />
              <MailboxHealthBadge status={mailbox.healthStatus} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mailbox.emailAddress}
              {mailbox.smtpHost ? ` · ${mailbox.smtpHost}:${mailbox.smtpPort ?? ''}` : ''}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Account actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onTest(mailbox.id)} disabled={disabled}>
              <FlaskConical className="mr-2 h-4 w-4" /> Test connection
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(mailbox.id)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit settings
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/mailboxes/${mailbox.id}/history`}>
                <History className="mr-2 h-4 w-4" /> View test history
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {mailbox.status === 'DISABLED' || mailbox.status === 'UNVERIFIED' ? (
              <DropdownMenuItem
                onClick={() => onToggle(mailbox.id, 'ACTIVE')}
                disabled={!mailbox.verifiedAt || disabled}
              >
                <Power className="mr-2 h-4 w-4" /> Enable account
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onToggle(mailbox.id, 'DISABLED')} disabled={disabled}>
                <Power className="mr-2 h-4 w-4" /> Disable account
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(mailbox.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily Usage</div>
          <div className="mt-1 flex items-center gap-3">
            <Progress value={usagePercent} className="h-2 w-32" />
            <span className="text-xs text-muted-foreground">
              {mailbox.currentDailyUsage}/{mailbox.dailySendingLimit}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Tested</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {mailbox.lastTestedAt
              ? new Date(mailbox.lastTestedAt).toLocaleString()
              : 'Never tested'}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Campaigns</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {assignedCampaigns.length === 0
              ? 'Not assigned'
              : `${assignedCampaigns.length} campaign${assignedCampaigns.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      {mailbox.lastErrorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {mailbox.lastErrorMessage}
        </div>
      )}
      {mailbox.eligibility && !mailbox.eligibility.eligible && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-800">
          {mailbox.eligibility.message}
        </div>
      )}
    </Card>
  );
}
