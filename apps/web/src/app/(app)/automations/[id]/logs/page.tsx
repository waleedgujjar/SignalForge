'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fetchWorkflow, fetchWorkflowLogs } from '@/lib/api';

export default function WorkflowLogsPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => fetchWorkflow(workflowId),
  });

  const logsQuery = useQuery({
    queryKey: ['workflow-logs', workflowId],
    queryFn: () => fetchWorkflowLogs(workflowId),
  });

  const logs = (logsQuery.data ?? []) as Array<{
    id: string;
    nodeType: string;
    status: string;
    error: string | null;
    createdAt: string;
    execution?: { id: string; lead?: { email: string } };
  }>;

  return (
    <>
      <PageHeader
        title={`Logs — ${workflowQuery.data?.name ?? 'Workflow'}`}
        description="Recent node executions across all runs."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/automations/${workflowId}`}>Back to builder</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Node</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Error</th>
                  <th className="px-4 py-3">Execution</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b">
                    <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">{log.execution?.lead?.email ?? '—'}</td>
                    <td className="px-4 py-3">{log.nodeType}</td>
                    <td className="px-4 py-3">
                      <Badge variant={log.status === 'COMPLETED' ? 'default' : 'destructive'}>{log.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{log.error ?? '—'}</td>
                    <td className="px-4 py-3">
                      {log.execution?.id ? (
                        <Link
                          href={`/automations/${workflowId}/executions/${log.execution.id}`}
                          className="text-primary hover:underline"
                        >
                          View
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!logsQuery.isLoading && logs.length === 0 && (
            <div className="px-4 py-10 text-center text-muted-foreground">No log entries yet.</div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
