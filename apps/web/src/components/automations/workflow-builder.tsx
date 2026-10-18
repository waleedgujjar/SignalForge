'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowGraphEdge, WorkflowGraphNode } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

const NODE_LIBRARY = {
  Triggers: [{ type: 'TRIGGER', label: 'Trigger', data: { eventType: 'LEAD_CREATED' } }],
  Actions: [
    { type: 'VERIFY_EMAIL', label: 'Verify Email', data: { label: 'Verify Email' } },
    { type: 'QUALIFY_LEAD', label: 'Qualify Lead', data: { label: 'Qualify Lead' } },
    { type: 'ADD_TO_CAMPAIGN', label: 'Add to Campaign', data: { label: 'Add to Campaign', campaignId: '' } },
    { type: 'SEND_EMAIL', label: 'Send Email', data: { label: 'Send Email', campaignId: '' } },
    { type: 'ADD_TAG', label: 'Add Tag', data: { label: 'Add Tag', tagId: '' } },
    { type: 'NOTIFY_USER', label: 'Notify User', data: { title: '', body: '' } },
    { type: 'PAUSE_LEAD', label: 'Pause Lead', data: { label: 'Pause Lead' } },
    { type: 'STOP_WORKFLOW', label: 'Stop Workflow', data: { label: 'Stop' } },
  ],
  Logic: [{ type: 'CONDITION', label: 'Condition', data: { logic: 'AND', rules: [] } }],
  Timing: [{ type: 'DELAY', label: 'Delay', data: { amount: 1, unit: 'HOURS' } }],
};

const TRIGGER_EVENTS = [
  'LEAD_CREATED',
  'LEAD_IMPORTED',
  'LEAD_VERIFIED',
  'LEAD_QUALIFIED',
  'CAMPAIGN_STARTED',
  'EMAIL_SENT',
  'EMAIL_BOUNCED',
  'EMAIL_REPLIED',
  'POSITIVE_REPLY_RECEIVED',
  'NEGATIVE_REPLY_RECEIVED',
  'UNSUBSCRIBE_RECEIVED',
  'MEETING_BOOKED',
  'WEBSITE_ANALYSIS_COMPLETED',
  'LEAD_RESEARCH_COMPLETED',
];

type WorkflowBuilderProps = {
  initialNodes: WorkflowGraphNode[];
  initialEdges: WorkflowGraphEdge[];
  onChange: (nodes: WorkflowGraphNode[], edges: WorkflowGraphEdge[]) => void;
};

function toFlowNodes(nodes: WorkflowGraphNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'default',
    position: n.position,
    data: { label: String(n.data.label ?? n.type), ...n.data, nodeType: n.type },
  }));
}

function toFlowEdges(edges: WorkflowGraphEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.sourceHandle,
  }));
}

function fromFlowNodes(nodes: Node[]): WorkflowGraphNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: String(n.data.nodeType ?? 'ACTION'),
    position: n.position,
    data: { ...n.data, label: n.data.label },
  }));
}

function fromFlowEdges(edges: Edge[]): WorkflowGraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
  }));
}

export function WorkflowBuilder({ initialNodes, initialEdges, onChange }: WorkflowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(initialNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initialEdges));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    onChange(fromFlowNodes(nodes), fromFlowEdges(edges));
  }, [nodes, edges, onChange]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const addNode = (type: string, data: Record<string, unknown>) => {
    const id = `${type.toLowerCase()}-${Date.now()}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'default',
        position: { x: 120 + nds.length * 40, y: 120 + nds.length * 30 },
        data: { label: String(data.label ?? type), ...data, nodeType: type },
      },
    ]);
  };

  const updateSelectedData = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, ...patch, label: patch.label ?? n.data.label } }
          : n,
      ),
    );
  };

  return (
    <div className="grid h-[calc(100vh-12rem)] grid-cols-12 gap-4">
      <Card className="col-span-2 overflow-hidden">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Node library</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-16rem)] px-3 pb-3">
            {Object.entries(NODE_LIBRARY).map(([group, items]) => (
              <div key={group} className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{group}</p>
                <div className="space-y-1">
                  {items.map((item) => (
                    <Button
                      key={item.type}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => addNode(item.type, item.data)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="col-span-7 rounded-lg border bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <Card className="col-span-3 overflow-hidden">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedNode ? (
            <p className="text-sm text-muted-foreground">Select a node to configure it.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Input value={String(selectedNode.data.nodeType)} disabled />
              </div>
              <div>
                <Label>Label</Label>
                <Input
                  value={String(selectedNode.data.label ?? '')}
                  onChange={(e) => updateSelectedData({ label: e.target.value })}
                />
              </div>
              {selectedNode.data.nodeType === 'TRIGGER' && (
                <div>
                  <Label>Event</Label>
                  <Select
                    value={String(selectedNode.data.eventType ?? 'LEAD_CREATED')}
                    onValueChange={(value) => updateSelectedData({ eventType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_EVENTS.map((event) => (
                        <SelectItem key={event} value={event}>
                          {event.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {['ADD_TO_CAMPAIGN', 'SEND_EMAIL', 'SEND_SEQUENCE'].includes(String(selectedNode.data.nodeType)) && (
                <div>
                  <Label>Campaign ID</Label>
                  <Input
                    value={String(selectedNode.data.campaignId ?? '')}
                    onChange={(e) => updateSelectedData({ campaignId: e.target.value })}
                    placeholder="Campaign ID"
                  />
                </div>
              )}
              {['ADD_TAG', 'REMOVE_TAG'].includes(String(selectedNode.data.nodeType)) && (
                <div>
                  <Label>Tag ID</Label>
                  <Input
                    value={String(selectedNode.data.tagId ?? '')}
                    onChange={(e) => updateSelectedData({ tagId: e.target.value })}
                  />
                </div>
              )}
              {selectedNode.data.nodeType === 'DELAY' && (
                <>
                  <div>
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      value={String(selectedNode.data.amount ?? 1)}
                      onChange={(e) => updateSelectedData({ amount: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label>Unit</Label>
                    <Select
                      value={String(selectedNode.data.unit ?? 'HOURS')}
                      onValueChange={(value) => updateSelectedData({ unit: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MINUTES">Minutes</SelectItem>
                        <SelectItem value="HOURS">Hours</SelectItem>
                        <SelectItem value="DAYS">Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {selectedNode.data.nodeType === 'NOTIFY_USER' && (
                <>
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={String(selectedNode.data.title ?? '')}
                      onChange={(e) => updateSelectedData({ title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Body</Label>
                    <Textarea
                      value={String(selectedNode.data.body ?? '')}
                      onChange={(e) => updateSelectedData({ body: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
