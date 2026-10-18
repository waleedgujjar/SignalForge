'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fetchWorkflowExecution } from '@/lib/api';

export default function WorkflowExecutionPage() {
  const params = useParams<{ id: string; executionId: string }>();

  const executionQuery = useQuery({
    queryKey: ['workflow-execution', params.executionId],
    queryFn: () => fetchWorkflowExecution(params.executionId),
  });

  const execution = executionQuery.data;

  return (
    <>
      <PageHeader
        title="Execution detail"
        description={execution?.lead?.email ?? 'Workflow run timeline'}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/automations/${params.id}/logs`}>Back to logs</Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-4 py-4 text-sm">
          <div>
            <span className="text-muted-foreground">Status:</span>{' '}
            <Badge>{execution?.status ?? '—'}</Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Started:</span>{' '}
            {execution?.startedAt ? new Date(execution.startedAt).toLocaleString() : '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Completed:</span>{' '}
            {execution?.completedAt ? new Date(execution.completedAt).toLocaleString() : '—'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          {(execution?.nodeExecutions ?? []).map((node) => (
            <div key={node.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{node.nodeType}</p>
                  <p className="text-xs text-muted-foreground">Node {node.nodeId}</p>
                </div>
                <Badge variant={node.status === 'COMPLETED' ? 'default' : 'destructive'}>{node.status}</Badge>
              </div>
              {node.error && <p className="mt-2 text-sm text-destructive">{node.error}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(node.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
          {!executionQuery.isLoading && (execution?.nodeExecutions?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No node executions recorded.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
