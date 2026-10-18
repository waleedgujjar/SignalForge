import type { WorkflowGraph } from './types.js';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

const baseNodes = {
  trigger: (id: string, eventType: string, y = 0) => ({
    id,
    type: 'TRIGGER' as const,
    position: { x: 250, y },
    data: { eventType, label: eventType.replace(/_/g, ' ') },
  }),
  delay: (id: string, amount: number, unit: string, y: number) => ({
    id,
    type: 'DELAY' as const,
    position: { x: 250, y },
    data: { amount, unit, label: `Wait ${amount} ${unit.toLowerCase()}` },
  }),
  action: (id: string, type: WorkflowGraph['nodes'][0]['type'], data: Record<string, unknown>, y: number) => ({
    id,
    type,
    position: { x: 250, y },
    data,
  }),
  condition: (id: string, rules: unknown[], y: number) => ({
    id,
    type: 'CONDITION' as const,
    position: { x: 250, y },
    data: { logic: 'AND', rules, label: 'Condition' },
  }),
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'new-lead-outreach',
    name: 'New Lead Outreach',
    description: 'Verify email, qualify lead, then enroll in a campaign',
    graph: {
      nodes: [
        baseNodes.trigger('trigger', 'LEAD_CREATED', 0),
        baseNodes.action('verify', 'VERIFY_EMAIL', { label: 'Verify Email' }, 120),
        baseNodes.action('qualify', 'QUALIFY_LEAD', { label: 'Qualify Lead' }, 240),
        baseNodes.delay('delay', 1, 'HOURS', 360),
        baseNodes.action('enroll', 'ADD_TO_CAMPAIGN', { label: 'Add to Campaign', campaignId: '' }, 480),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'verify' },
        { id: 'e2', source: 'verify', target: 'qualify' },
        { id: 'e3', source: 'qualify', target: 'delay' },
        { id: 'e4', source: 'delay', target: 'enroll' },
      ],
    },
  },
  {
    id: 'positive-reply',
    name: 'Positive Reply Follow-up',
    description: 'Notify team and pause other campaigns when a positive reply is received',
    graph: {
      nodes: [
        baseNodes.trigger('trigger', 'POSITIVE_REPLY_RECEIVED', 0),
        baseNodes.action('notify', 'NOTIFY_USER', {
          label: 'Notify Team',
          title: 'Positive reply received',
          body: 'A lead sent a positive reply',
        }, 120),
        baseNodes.action('pause', 'PAUSE_LEAD', { label: 'Pause Lead' }, 240),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'notify' },
        { id: 'e2', source: 'notify', target: 'pause' },
      ],
    },
  },
  {
    id: 'bounce-protection',
    name: 'Bounce Protection',
    description: 'Stop workflow and pause lead on hard bounce',
    graph: {
      nodes: [
        baseNodes.trigger('trigger', 'EMAIL_BOUNCED', 0),
        baseNodes.action('pause', 'PAUSE_LEAD', { label: 'Pause Lead' }, 120),
        baseNodes.action('stop', 'STOP_WORKFLOW', { label: 'Stop Workflow' }, 240),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'pause' },
        { id: 'e2', source: 'pause', target: 'stop' },
      ],
    },
  },
  {
    id: 'meeting-booked',
    name: 'Meeting Booked',
    description: 'Notify team when a meeting is booked',
    graph: {
      nodes: [
        baseNodes.trigger('trigger', 'MEETING_BOOKED', 0),
        baseNodes.action('notify', 'NOTIFY_USER', {
          label: 'Notify Team',
          title: 'Meeting booked',
          body: 'A lead booked a meeting',
          href: '/leads',
        }, 120),
        baseNodes.action('stop', 'STOP_WORKFLOW', { label: 'Stop Workflow' }, 240),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'notify' },
        { id: 'e2', source: 'notify', target: 'stop' },
      ],
    },
  },
];
