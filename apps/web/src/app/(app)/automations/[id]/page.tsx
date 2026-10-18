'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/dashboard/page-header';
import { WorkflowBuilder } from '@/components/automations/workflow-builder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchWorkflow,
  publishWorkflow,
  updateWorkflow,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
} from '@/lib/api';

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workflowId = params.id;

  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => fetchWorkflow(workflowId),
  });

  const draft = workflowQuery.data?.versions[0];
  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<WorkflowGraphNode[]>([]);
  const [edges, setEdges] = useState<WorkflowGraphEdge[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  useEffect(() => {
    if (!workflowQuery.data) return;
    setName(workflowQuery.data.name);
    const graph = draft ?? workflowQuery.data.publishedVersion;
    if (graph) {
      setNodes((graph.nodes as WorkflowGraphNode[]) ?? []);
      setEdges((graph.edges as WorkflowGraphEdge[]) ?? []);
    }
    setDirty(false);
    setSaveState('saved');
  }, [workflowQuery.data, draft]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleGraphChange = useCallback((nextNodes: WorkflowGraphNode[], nextEdges: WorkflowGraphEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    setDirty(true);
    setSaveState('unsaved');
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateWorkflow(workflowId, {
        name,
        nodes,
        edges,
      }),
    onMutate: () => setSaveState('saving'),
    onSuccess: () => {
      setDirty(false);
      setSaveState('saved');
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
      toast.success('Workflow saved');
    },
    onError: (e: Error) => {
      setSaveState('unsaved');
      toast.error(e.message);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
      toast.success('Workflow published');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = useMemo(() => {
    const status = workflowQuery.data?.status ?? 'DRAFT';
    return <Badge>{status}</Badge>;
  }, [workflowQuery.data?.status]);

  const handleNavigateAway = () => {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    router.push('/automations');
  };

  if (workflowQuery.isLoading || !workflowQuery.data) {
    return <div className="text-sm text-muted-foreground">Loading workflow...</div>;
  }

  return (
    <>
      <PageHeader
        title={name || 'Workflow builder'}
        description="Design triggers, actions, conditions, and delays."
        actions={
          <div className="flex items-center gap-2">
            {statusBadge}
            <span className="text-xs text-muted-foreground">
              {saveState === 'saving' ? 'Saving...' : saveState === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </span>
            <Button variant="outline" size="sm" onClick={handleNavigateAway}>
              Back
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/automations/${workflowId}/logs`}>Logs</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              Save
            </Button>
            <Button size="sm" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
              Publish
            </Button>
          </div>
        }
      />

      <div className="mb-4 max-w-md">
        <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); setSaveState('unsaved'); }} />
      </div>

      <WorkflowBuilder initialNodes={nodes} initialEdges={edges} onChange={handleGraphChange} />
    </>
  );
}
