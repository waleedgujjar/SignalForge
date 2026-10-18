'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Pause, Play, Archive, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  archiveWorkflow,
  createWorkflow,
  createWorkflowFromTemplate,
  duplicateWorkflow,
  fetchWorkflowTemplates,
  fetchWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  type WorkflowStatus,
} from '@/lib/api';

const statusVariant: Record<WorkflowStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  ACTIVE: 'default',
  PAUSED: 'outline',
  ARCHIVED: 'destructive',
};

export default function AutomationsPage() {
  const queryClient = useQueryClient();
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: () => fetchWorkflows() });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: fetchWorkflowTemplates });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['workflows'] });

  const createMutation = useMutation({
    mutationFn: () => createWorkflow({ name: 'New Workflow' }),
    onSuccess: (workflow) => {
      invalidate();
      toast.success('Workflow created');
      window.location.href = `/automations/${workflow.id}`;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fromTemplateMutation = useMutation({
    mutationFn: (templateId: string) => createWorkflowFromTemplate(templateId),
    onSuccess: (workflow) => {
      invalidate();
      toast.success('Workflow created from template');
      window.location.href = `/automations/${workflow.id}`;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'pause' | 'resume' | 'archive' | 'duplicate' }) => {
      if (action === 'pause') return pauseWorkflow(id);
      if (action === 'resume') return resumeWorkflow(id);
      if (action === 'archive') return archiveWorkflow(id);
      return duplicateWorkflow(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success('Workflow updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const workflows = workflowsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Automations"
        description="Build workflows that orchestrate verification, campaigns, tags, and notifications."
        actions={
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            New workflow
          </Button>
        }
      />

      {templates.length > 0 && workflows.length === 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Start from a template</CardTitle>
            <CardDescription>Pre-built workflows for common outbound scenarios.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="rounded-lg border p-4 text-left transition hover:bg-muted/40"
                onClick={() => fromTemplateMutation.mutate(template.id)}
              >
                <p className="font-medium">{template.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {workflows.map((workflow) => (
          <Card key={workflow.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">
                    <Link href={`/automations/${workflow.id}`} className="hover:underline">
                      {workflow.name}
                    </Link>
                  </CardTitle>
                  <Badge variant={statusVariant[workflow.status]}>{workflow.status}</Badge>
                </div>
                {workflow.description && (
                  <CardDescription className="mt-1">{workflow.description}</CardDescription>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/automations/${workflow.id}`}>Edit</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/automations/${workflow.id}/logs`}>
                    <FileText className="mr-1 h-4 w-4" />
                    Logs
                  </Link>
                </Button>
                {workflow.status === 'ACTIVE' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actionMutation.mutate({ id: workflow.id, action: 'pause' })}
                  >
                    <Pause className="mr-1 h-4 w-4" />
                    Pause
                  </Button>
                )}
                {workflow.status === 'PAUSED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actionMutation.mutate({ id: workflow.id, action: 'resume' })}
                  >
                    <Play className="mr-1 h-4 w-4" />
                    Resume
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actionMutation.mutate({ id: workflow.id, action: 'duplicate' })}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  Duplicate
                </Button>
                {workflow.status !== 'ARCHIVED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm('Archive this workflow? Active executions may be cancelled.')) {
                        actionMutation.mutate({ id: workflow.id, action: 'archive' });
                      }
                    }}
                  >
                    <Archive className="mr-1 h-4 w-4" />
                    Archive
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {workflow._count?.executions ?? 0} executions
            </CardContent>
          </Card>
        ))}

        {!workflowsQuery.isLoading && workflows.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No workflows yet. Create one or pick a template above.
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
