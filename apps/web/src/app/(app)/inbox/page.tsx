'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Mail,
  MoreHorizontal,
  Search,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { ClassificationBadge } from '@/components/inbox/classification-badge';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type {
  InboxConversationListQuery,
  InboxConversationSummary,
  ReplyClassification,
} from '@/lib/api';
import {
  addConversationNote,
  archiveConversation,
  composeInboxDraft,
  fetchInboxConversation,
  fetchInboxConversations,
  fetchInboxStats,
  markConversationRead,
  sendInboxReply,
  updateConversation,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type InboxFolder =
  | 'ALL'
  | 'UNREAD'
  | 'INTERESTED'
  | 'QUESTION'
  | 'NOT_INTERESTED'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE'
  | 'UNMATCHED';

const FOLDERS: { id: InboxFolder; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UNREAD', label: 'Unread' },
  { id: 'INTERESTED', label: 'Interested' },
  { id: 'QUESTION', label: 'Questions' },
  { id: 'NOT_INTERESTED', label: 'Not Interested' },
  { id: 'OUT_OF_OFFICE', label: 'OOO' },
  { id: 'UNSUBSCRIBE', label: 'Unsubscribe' },
  { id: 'UNMATCHED', label: 'Unmatched' },
];

function folderToQuery(folder: InboxFolder): Partial<InboxConversationListQuery> {
  switch (folder) {
    case 'UNREAD':
      return { unreadOnly: true };
    case 'INTERESTED':
      return { classification: 'INTERESTED' };
    case 'QUESTION':
      return { classification: 'QUESTION' };
    case 'NOT_INTERESTED':
      return { classification: 'NOT_INTERESTED' };
    case 'OUT_OF_OFFICE':
      return { classification: 'OUT_OF_OFFICE' };
    case 'UNSUBSCRIBE':
      return { classification: 'UNSUBSCRIBE' };
    case 'UNMATCHED':
      return { matchStatus: 'UNMATCHED' };
    default:
      return {};
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function leadDisplayName(conversation: InboxConversationSummary): string {
  if (conversation.lead?.name) return conversation.lead.name;
  if (conversation.lead?.email) return conversation.lead.email;
  return conversation.subject ?? 'Unknown sender';
}

function conversationPreview(conversation: InboxConversationSummary): string {
  if (conversation.subject) return conversation.subject;
  if (conversation.lead?.company) return conversation.lead.company;
  if (conversation.lead?.email) return conversation.lead.email;
  return 'No preview';
}

export default function InboxPage() {
  const queryClient = useQueryClient();
  const [folder, setFolder] = React.useState<InboxFolder>('ALL');
  const [search, setSearch] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [replySubject, setReplySubject] = React.useState('');
  const [replyBody, setReplyBody] = React.useState('');
  const [noteText, setNoteText] = React.useState('');

  const listQuery = React.useMemo<InboxConversationListQuery>(() => {
    return {
      page: 1,
      limit: 50,
      search: search.trim() || undefined,
      ...folderToQuery(folder),
    };
  }, [folder, search]);

  const statsQuery = useQuery({
    queryKey: ['inbox', 'stats'],
    queryFn: () => fetchInboxStats(),
    refetchInterval: 15_000,
  });

  const conversationsQuery = useQuery({
    queryKey: ['inbox', 'conversations', listQuery],
    queryFn: () => fetchInboxConversations(listQuery),
    refetchInterval: 15_000,
  });

  const detailQuery = useQuery({
    queryKey: ['inbox', 'conversation', selectedId],
    queryFn: () => fetchInboxConversation(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: 15_000,
  });

  React.useEffect(() => {
    const conversations = conversationsQuery.data?.data ?? [];
    if (conversations.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(conversations[0]!.id);
    }
  }, [conversationsQuery.data, selectedId]);

  React.useEffect(() => {
    const detail = detailQuery.data;
    if (!detail) return;
    const lastInbound = [...detail.messages].reverse().find((m) => m.direction === 'INBOUND');
    const subject = lastInbound?.subject ?? detail.conversation.subject ?? '';
    setReplySubject(subject.startsWith('Re:') ? subject : subject ? `Re: ${subject}` : 'Re:');
    setReplyBody('');
    if (detail.conversation.unreadCount > 0) {
      markConversationRead(detail.conversation.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ['inbox'] });
      });
    }
  }, [detailQuery.data?.conversation.id, queryClient]);

  const invalidateInbox = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };

  const sendReplyMutation = useMutation({
    mutationFn: () =>
      sendInboxReply(selectedId!, {
        subject: replySubject.trim(),
        body: replyBody.trim(),
      }),
    onSuccess: () => {
      toast.success('Reply queued for sending');
      setReplyBody('');
      invalidateInbox();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const composeDraftMutation = useMutation({
    mutationFn: () => composeInboxDraft(selectedId!),
    onSuccess: (draft) => {
      setReplySubject(draft.subject);
      setReplyBody(draft.body);
      toast.success('Draft composed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveConversation(selectedId!),
    onSuccess: () => {
      toast.success('Conversation archived');
      invalidateInbox();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const classifyMutation = useMutation({
    mutationFn: (classification: ReplyClassification) =>
      updateConversation(selectedId!, { classification }),
    onSuccess: () => {
      toast.success('Classification updated');
      invalidateInbox();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addNoteMutation = useMutation({
    mutationFn: () => addConversationNote(selectedId!, noteText.trim()),
    onSuccess: () => {
      toast.success('Note added');
      setNoteText('');
      invalidateInbox();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const folderCount = (id: InboxFolder): number | undefined => {
    const stats = statsQuery.data?.stats;
    if (!stats) return undefined;
    switch (id) {
      case 'ALL':
        return stats.totalConversations;
      case 'UNREAD':
        return stats.unreadCount;
      case 'INTERESTED':
        return stats.byClassification.INTERESTED;
      case 'QUESTION':
        return stats.byClassification.QUESTION;
      case 'NOT_INTERESTED':
        return stats.byClassification.NOT_INTERESTED;
      case 'OUT_OF_OFFICE':
        return stats.byClassification.OUT_OF_OFFICE;
      case 'UNSUBSCRIBE':
        return stats.byClassification.UNSUBSCRIBE;
      default:
        return undefined;
    }
  };

  const syncIssues = statsQuery.data?.syncHealth.filter(
    (m) => m.lastInboundError || m.syncState?.lastError,
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Review replies, classify intent, and respond to leads from connected mailboxes."
      />

      {syncIssues && syncIssues.length > 0 && (
        <Alert className="mt-4">
          <Mail className="h-4 w-4" />
          <AlertTitle>Inbound sync issues</AlertTitle>
          <AlertDescription>
            {syncIssues.length} mailbox{syncIssues.length === 1 ? '' : 'es'} reported sync errors.
            Check mailbox inbound settings under Infrastructure → Mailboxes.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 flex h-[calc(100vh-11rem)] min-h-[520px] flex-col gap-4 lg:flex-row">
        {/* Folder filters */}
        <Card className="flex w-full shrink-0 flex-col border-border lg:w-52">
          <div className="border-b border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Folders
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 p-2">
              {FOLDERS.map((item) => {
                const count = folderCount(item.id);
                const active = folder === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFolder(item.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span>{item.label}</span>
                    {count !== undefined && (
                      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        {/* Conversation list */}
        <Card className="flex min-w-0 flex-1 flex-col border-border lg:max-w-md">
          <div className="space-y-3 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="pl-9"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {conversationsQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : conversationsQuery.data?.data.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="No conversations"
                description="Replies will appear here once inbound sync is enabled on a mailbox."
                className="py-12"
              />
            ) : (
              <div className="divide-y divide-border">
                {conversationsQuery.data?.data.map((conversation) => {
                  const active = conversation.id === selectedId;
                  const unread = conversation.unreadCount > 0;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors hover:bg-muted/50',
                        active && 'bg-muted',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {unread && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                          <span
                            className={cn(
                              'truncate text-sm',
                              unread ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            {leadDisplayName(conversation)}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatTimestamp(conversation.lastMessageAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {conversationPreview(conversation)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <ClassificationBadge classification={conversation.classification} />
                        {conversation.matchStatus === 'UNMATCHED' && (
                          <Badge variant="outline">Unmatched</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Conversation detail */}
        <Card className="flex min-w-0 flex-[1.4] flex-col border-border">
          {!selectedId || detailQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center p-6">
              {detailQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <EmptyState
                  icon={Mail}
                  title="Select a conversation"
                  description="Choose a thread from the list to view messages and reply."
                  className="py-12"
                />
              )}
            </div>
          ) : detailQuery.data ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0 space-y-1">
                  <h2 className="truncate text-lg font-semibold">
                    {leadDisplayName(detailQuery.data.conversation)}
                  </h2>
                  {detailQuery.data.conversation.lead && (
                    <p className="text-sm text-muted-foreground">
                      {detailQuery.data.conversation.lead.email}
                      {detailQuery.data.conversation.lead.company
                        ? ` · ${detailQuery.data.conversation.lead.company}`
                        : ''}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <ClassificationBadge classification={detailQuery.data.conversation.classification} />
                    {detailQuery.data.conversation.campaign && (
                      <Link href={`/campaigns/${detailQuery.data.conversation.campaign.id}`}>
                        <Badge variant="secondary" className="cursor-pointer hover:opacity-80">
                          {detailQuery.data.conversation.campaign.name}
                        </Badge>
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">
                      via {detailQuery.data.conversation.mailbox.emailAddress}
                    </span>
                  </div>
                  {detailQuery.data.conversation.classificationSummary && (
                    <p className="text-xs text-muted-foreground">
                      {detailQuery.data.conversation.classificationSummary}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Reclassify</DropdownMenuLabel>
                    {(['INTERESTED', 'QUESTION', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'] as const).map(
                      (c) => (
                        <DropdownMenuItem key={c} onClick={() => classifyMutation.mutate(c)}>
                          {c.replace(/_/g, ' ').toLowerCase()}
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <ScrollArea className="flex-1 px-4">
                <div className="space-y-3 py-4">
                  {detailQuery.data.messages.map((message) => {
                    const inbound = message.direction === 'INBOUND';
                    return (
                      <div
                        key={message.id}
                        className={cn(
                          'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                          inbound
                            ? 'mr-auto border-border bg-muted/40'
                            : 'ml-auto border-primary/20 bg-primary/5',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {message.fromName ?? message.fromEmail}
                            {inbound ? ' · Inbound' : ' · Sent'}
                          </span>
                          <span>
                            {formatTimestamp(message.receivedAt ?? message.sentAt ?? message.createdAt)}
                          </span>
                        </div>
                        {message.subject && (
                          <p className="mb-1 text-xs font-medium text-foreground">{message.subject}</p>
                        )}
                        <p className="whitespace-pre-wrap text-foreground">
                          {message.textBody ?? '(No text content)'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {detailQuery.data.notes.length > 0 && (
                  <>
                    <Separator />
                    <div className="py-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notes
                      </p>
                      <div className="space-y-2">
                        {detailQuery.data.notes.map((note) => (
                          <div key={note.id} className="rounded-md border border-border bg-muted/30 p-2 text-sm">
                            <p>{note.content}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(note.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </ScrollArea>

              <div className="space-y-3 border-t border-border p-4">
                <div className="flex items-center gap-2">
                  <Input
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    placeholder="Subject"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => composeDraftMutation.mutate()}
                    disabled={composeDraftMutation.isPending}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Draft
                  </Button>
                </div>
                <Textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply..."
                  rows={4}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => sendReplyMutation.mutate()}
                    disabled={
                      sendReplyMutation.isPending ||
                      !replySubject.trim() ||
                      !replyBody.trim()
                    }
                  >
                    Send reply
                  </Button>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add an internal note..."
                      className="min-w-0"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => addNoteMutation.mutate()}
                      disabled={addNoteMutation.isPending || !noteText.trim()}
                    >
                      <StickyNote className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <Alert variant="destructive" className="max-w-md">
                <AlertTitle>Failed to load conversation</AlertTitle>
                <AlertDescription>
                  {(detailQuery.error as Error)?.message ?? 'Unknown error'}
                </AlertDescription>
              </Alert>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
