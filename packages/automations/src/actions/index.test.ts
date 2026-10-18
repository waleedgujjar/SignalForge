import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma, mockEmailVerificationService, mockCampaignLeadService, mockSendingJobService, mockNotificationService } = vi.hoisted(() => ({
  mockPrisma: {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    leadTag: { createMany: vi.fn(), deleteMany: vi.fn() },
    leadListMember: { createMany: vi.fn(), deleteMany: vi.fn() },
    campaign: { findFirst: vi.fn() },
    campaignLead: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
  mockEmailVerificationService: { verifyAndPersist: vi.fn() },
  mockCampaignLeadService: { enrollLeads: vi.fn(), removeLead: vi.fn() },
  mockSendingJobService: { bootstrapCampaign: vi.fn(), cancelCampaignLeadJobs: vi.fn() },
  mockNotificationService: { create: vi.fn() },
}));

vi.mock('@signalforge/database', () => ({ prisma: mockPrisma }));
vi.mock('@signalforge/verification', () => ({ emailVerificationService: mockEmailVerificationService }));
vi.mock('@signalforge/campaigns', () => ({ campaignLeadService: mockCampaignLeadService }));
vi.mock('@signalforge/sending', () => ({ sendingJobService: mockSendingJobService }));
vi.mock('../notification-service.js', () => ({ notificationService: mockNotificationService }));

import { runActionNode } from './index.js';
import type { WorkflowGraphNode, WorkflowContext } from '../types.js';

const baseContext: WorkflowContext = {
  leadId: 'lead1',
  workspaceId: 'ws1',
  campaignId: 'camp1',
  metadata: { executionId: 'exec1' },
};

function makeNode(type: WorkflowGraphNode['type'], data: Record<string, unknown> = {}): WorkflowGraphNode {
  return { id: 'n1', type, position: { x: 0, y: 0 }, data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runActionNode', () => {
  describe('STOP_WORKFLOW', () => {
    it('returns success with stopped output', async () => {
      const result = await runActionNode(makeNode('STOP_WORKFLOW'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ stopped: true });
    });
  });

  describe('unsupported type', () => {
    it('returns failure for unknown node type', async () => {
      const result = await runActionNode(makeNode('TRIGGER'), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('VERIFY_EMAIL', () => {
    it('verifies email successfully', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead1', email: 'test@test.com' });
      mockEmailVerificationService.verifyAndPersist.mockResolvedValue({
        status: 'VERIFIED',
        score: 0.95,
        riskScore: 0.05,
      });

      const result = await runActionNode(makeNode('VERIFY_EMAIL'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ status: 'VERIFIED', score: 0.95, riskScore: 0.05 });
    });

    it('fails when lead not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      const result = await runActionNode(makeNode('VERIFY_EMAIL'), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('VALIDATION_ERROR');
    });
  });

  describe('QUALIFY_LEAD', () => {
    it('qualifies lead with verified email', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead1',
        verification: { status: 'VERIFIED' },
      });
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(makeNode('QUALIFY_LEAD'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ status: 'QUALIFIED' });
    });

    it('unqualifies lead without verified email', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead1',
        verification: { status: 'INVALID' },
      });
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(makeNode('QUALIFY_LEAD'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ status: 'UNQUALIFIED' });
    });

    it('unqualifies lead without any verification', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead1',
        verification: null,
      });
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(makeNode('QUALIFY_LEAD'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ status: 'UNQUALIFIED' });
    });

    it('fails when lead not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      const result = await runActionNode(makeNode('QUALIFY_LEAD'), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('VALIDATION_ERROR');
    });
  });

  describe('ADD_TO_CAMPAIGN', () => {
    it('enrolls lead successfully', async () => {
      mockCampaignLeadService.enrollLeads.mockResolvedValue({ enrolled: 1, skipped: 0 });

      const result = await runActionNode(
        makeNode('ADD_TO_CAMPAIGN', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ enrolled: 1, skipped: 0 });
    });

    it('fails when campaignId is missing', async () => {
      const result = await runActionNode(makeNode('ADD_TO_CAMPAIGN', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });

    it('handles enrollment error', async () => {
      mockCampaignLeadService.enrollLeads.mockRejectedValue(new Error('Campaign not found'));

      const result = await runActionNode(
        makeNode('ADD_TO_CAMPAIGN', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('SYSTEM_ERROR');
    });
  });

  describe('REMOVE_FROM_CAMPAIGN', () => {
    it('removes lead successfully', async () => {
      mockCampaignLeadService.removeLead.mockResolvedValue(undefined);

      const result = await runActionNode(
        makeNode('REMOVE_FROM_CAMPAIGN', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('fails when campaignId is missing', async () => {
      const result = await runActionNode(makeNode('REMOVE_FROM_CAMPAIGN', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });

    it('handles removal error', async () => {
      mockCampaignLeadService.removeLead.mockRejectedValue(new Error('Not found'));

      const result = await runActionNode(
        makeNode('REMOVE_FROM_CAMPAIGN', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('SYSTEM_ERROR');
    });
  });

  describe('ADD_TAG', () => {
    it('adds tag successfully', async () => {
      mockPrisma.leadTag.createMany.mockResolvedValue({ count: 1 });

      const result = await runActionNode(
        makeNode('ADD_TAG', { tagId: 'tag1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('fails when tagId is missing', async () => {
      const result = await runActionNode(makeNode('ADD_TAG', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('REMOVE_TAG', () => {
    it('removes tag successfully', async () => {
      mockPrisma.leadTag.deleteMany.mockResolvedValue({ count: 1 });

      const result = await runActionNode(
        makeNode('REMOVE_TAG', { tagId: 'tag1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('fails when tagId is missing', async () => {
      const result = await runActionNode(makeNode('REMOVE_TAG', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('ADD_TO_LIST', () => {
    it('adds to list successfully', async () => {
      mockPrisma.leadListMember.createMany.mockResolvedValue({ count: 1 });

      const result = await runActionNode(
        makeNode('ADD_TO_LIST', { listId: 'list1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('fails when listId is missing', async () => {
      const result = await runActionNode(makeNode('ADD_TO_LIST', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('REMOVE_FROM_LIST', () => {
    it('removes from list successfully', async () => {
      mockPrisma.leadListMember.deleteMany.mockResolvedValue({ count: 1 });

      const result = await runActionNode(
        makeNode('REMOVE_FROM_LIST', { listId: 'list1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('fails when listId is missing', async () => {
      const result = await runActionNode(makeNode('REMOVE_FROM_LIST', {}), baseContext);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('UPDATE_LEAD', () => {
    it('updates allowed field', async () => {
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'status', value: 'QUALIFIED' }),
        baseContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ field: 'status', value: 'QUALIFIED' });
    });

    it('rejects disallowed field', async () => {
      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'email', value: 'new@test.com' }),
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid status value', async () => {
      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'status', value: 'INVALID_STATUS' }),
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('VALIDATION_ERROR');
    });

    it('allows jobTitle update', async () => {
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'jobTitle', value: 'CTO' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('allows industry update', async () => {
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'industry', value: 'Tech' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it('allows country update', async () => {
      mockPrisma.lead.update.mockResolvedValue({});

      const result = await runActionNode(
        makeNode('UPDATE_LEAD', { field: 'country', value: 'Canada' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('NOTIFY_USER', () => {
    it('creates notification', async () => {
      mockNotificationService.create.mockResolvedValue({});

      const result = await runActionNode(
        makeNode('NOTIFY_USER', { title: 'Test', body: 'Hello', userId: 'u1', href: '/leads' }),
        baseContext,
      );
      expect(result.success).toBe(true);
      expect(mockNotificationService.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        userId: 'u1',
        title: 'Test',
        body: 'Hello',
        href: '/leads',
        workflowExecutionId: 'exec1',
      });
    });

    it('uses default title when not provided', async () => {
      mockNotificationService.create.mockResolvedValue({});

      await runActionNode(makeNode('NOTIFY_USER', {}), baseContext);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Workflow notification', body: '' }),
      );
    });
  });

  describe('PAUSE_LEAD', () => {
    it('pauses campaign leads', async () => {
      mockPrisma.campaignLead.findMany.mockResolvedValue([
        { id: 'cl1' },
        { id: 'cl2' },
      ]);
      mockPrisma.campaignLead.update.mockResolvedValue({});
      mockSendingJobService.cancelCampaignLeadJobs.mockResolvedValue(undefined);

      const result = await runActionNode(makeNode('PAUSE_LEAD'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ paused: 2 });
    });

    it('handles no campaign leads to pause', async () => {
      mockPrisma.campaignLead.findMany.mockResolvedValue([]);

      const result = await runActionNode(makeNode('PAUSE_LEAD'), baseContext);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ paused: 0 });
    });

    it('pauses specific campaign when campaignId is provided', async () => {
      mockPrisma.campaignLead.findMany.mockResolvedValue([{ id: 'cl1' }]);
      mockPrisma.campaignLead.update.mockResolvedValue({});
      mockSendingJobService.cancelCampaignLeadJobs.mockResolvedValue(undefined);

      await runActionNode(
        makeNode('PAUSE_LEAD', { campaignId: 'camp1' }),
        baseContext,
      );

      expect(mockPrisma.campaignLead.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ campaignId: 'camp1' }),
      });
    });
  });

  describe('SEND_EMAIL / SEND_SEQUENCE', () => {
    it('fails when campaignId is missing and not in context', async () => {
      const ctx = { ...baseContext, campaignId: undefined };
      const result = await runActionNode(makeNode('SEND_EMAIL', {}), ctx);
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
    });

    it('fails when campaign not found', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue(null);

      const result = await runActionNode(
        makeNode('SEND_EMAIL', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('VALIDATION_ERROR');
    });

    it('uses campaignId from node data over context', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue({ id: 'camp-from-node', status: 'DRAFT', workspaceId: 'ws1' });
      mockPrisma.campaignLead.findFirst.mockResolvedValue({ id: 'cl1' });

      await runActionNode(
        makeNode('SEND_EMAIL', { campaignId: 'camp-from-node' }),
        baseContext,
      );

      expect(mockPrisma.campaign.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'camp-from-node' }) }),
      );
    });

    it('bootstraps active campaign', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue({ id: 'camp1', status: 'ACTIVE', workspaceId: 'ws1' });
      mockPrisma.campaignLead.findFirst.mockResolvedValue({ id: 'cl1' });
      mockSendingJobService.bootstrapCampaign.mockResolvedValue({ created: 1, skipped: 0 });

      const result = await runActionNode(
        makeNode('SEND_EMAIL', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ created: 1, skipped: 0 });
    });

    it('handles non-active campaign', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue({ id: 'camp1', status: 'DRAFT', workspaceId: 'ws1' });
      mockPrisma.campaignLead.findFirst.mockResolvedValue({ id: 'cl1' });

      const result = await runActionNode(
        makeNode('SEND_EMAIL', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ enrolled: true, campaignStatus: 'DRAFT' });
    });

    it('SEND_SEQUENCE delegates the same way', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue({ id: 'camp1', status: 'DRAFT', workspaceId: 'ws1' });
      mockPrisma.campaignLead.findFirst.mockResolvedValue({ id: 'cl1' });

      const result = await runActionNode(
        makeNode('SEND_SEQUENCE', { campaignId: 'camp1' }),
        baseContext,
      );
      expect(result.success).toBe(true);
    });
  });
});
