import { emailVerificationService } from '@signalforge/verification';
import { prisma } from '@signalforge/database';
import { campaignLeadService } from '@signalforge/campaigns';
import { sendingJobService } from '@signalforge/sending';
import type { WorkflowGraphNode } from '../types.js';
import type { ActionResult, WorkflowContext } from '../types.js';
import { notificationService } from '../notification-service.js';

export async function runActionNode(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  switch (node.type) {
    case 'VERIFY_EMAIL':
      return verifyEmailAction(context);
    case 'QUALIFY_LEAD':
      return qualifyLeadAction(context);
    case 'ADD_TO_CAMPAIGN':
      return addToCampaignAction(node, context);
    case 'REMOVE_FROM_CAMPAIGN':
      return removeFromCampaignAction(node, context);
    case 'SEND_EMAIL':
    case 'SEND_SEQUENCE':
      return sendEmailAction(node, context);
    case 'ADD_TAG':
      return addTagAction(node, context);
    case 'REMOVE_TAG':
      return removeTagAction(node, context);
    case 'ADD_TO_LIST':
      return addToListAction(node, context);
    case 'REMOVE_FROM_LIST':
      return removeFromListAction(node, context);
    case 'UPDATE_LEAD':
      return updateLeadAction(node, context);
    case 'NOTIFY_USER':
      return notifyUserAction(node, context);
    case 'PAUSE_LEAD':
      return pauseLeadAction(node, context);
    case 'STOP_WORKFLOW':
      return { success: true, output: { stopped: true } };
    default:
      return {
        success: false,
        error: `Unsupported action node type: ${node.type}`,
        errorCategory: 'CONFIGURATION_ERROR',
      };
  }
}

async function verifyEmailAction(context: WorkflowContext): Promise<ActionResult> {
  const lead = await prisma.lead.findFirst({
    where: { id: context.leadId, workspaceId: context.workspaceId },
  });
  if (!lead) {
    return { success: false, error: 'Lead not found', errorCategory: 'VALIDATION_ERROR' };
  }

  const result = await emailVerificationService.verifyAndPersist(lead.email, {
    workspaceId: context.workspaceId,
    leadId: lead.id,
  });

  return { success: true, output: { status: result.status, score: result.score, riskScore: result.riskScore } };
}

async function qualifyLeadAction(context: WorkflowContext): Promise<ActionResult> {
  const lead = await prisma.lead.findFirst({
    where: { id: context.leadId, workspaceId: context.workspaceId },
    include: { verification: true },
  });
  if (!lead) {
    return { success: false, error: 'Lead not found', errorCategory: 'VALIDATION_ERROR' };
  }

  const newStatus = lead.verification?.status === 'VERIFIED' ? 'QUALIFIED' : 'UNQUALIFIED';
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: newStatus },
  });

  return { success: true, output: { status: newStatus } };
}

async function addToCampaignAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const campaignId = String(node.data.campaignId ?? '');
  if (!campaignId) {
    return { success: false, error: 'Missing campaignId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  try {
    const result = await campaignLeadService.enrollLeads(
      campaignId,
      context.workspaceId,
      [context.leadId],
      { force: false },
    );
    return {
      success: result.enrolled > 0 || result.skipped > 0,
      output: { enrolled: result.enrolled, skipped: result.skipped },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Enrollment failed',
      errorCategory: 'SYSTEM_ERROR',
    };
  }
}

async function removeFromCampaignAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const campaignId = String(node.data.campaignId ?? '');
  if (!campaignId) {
    return { success: false, error: 'Missing campaignId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  try {
    await campaignLeadService.removeLead(campaignId, context.leadId, context.workspaceId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Remove failed',
      errorCategory: 'SYSTEM_ERROR',
    };
  }
}

async function sendEmailAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const campaignId = String(node.data.campaignId ?? context.campaignId ?? '');
  if (!campaignId) {
    return { success: false, error: 'Missing campaignId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId: context.workspaceId },
  });
  if (!campaign) {
    return { success: false, error: 'Campaign not found', errorCategory: 'VALIDATION_ERROR' };
  }

  let campaignLead = await prisma.campaignLead.findFirst({
    where: { campaignId, leadId: context.leadId },
  });

  if (!campaignLead) {
    const enroll = await campaignLeadService.enrollLeads(
      campaignId,
      context.workspaceId,
      [context.leadId],
      { force: false },
    );
    if (enroll.enrolled === 0 && enroll.skipped > 0) {
      campaignLead = await prisma.campaignLead.findFirst({
        where: { campaignId, leadId: context.leadId },
      });
    }
    if (!campaignLead && enroll.enrolled === 0) {
      return {
        success: false,
        error: 'Lead ineligible for campaign send',
        errorCategory: 'SAFETY_BLOCK',
      };
    }
    campaignLead = await prisma.campaignLead.findFirst({
      where: { campaignId, leadId: context.leadId },
    });
  }

  if (!campaignLead) {
    return { success: false, error: 'Campaign lead not found', errorCategory: 'SYSTEM_ERROR' };
  }

  if (campaign.status === 'ACTIVE') {
    const bootstrap = await sendingJobService.bootstrapCampaign(campaignId, context.workspaceId);
    return {
      success: bootstrap.created > 0 || bootstrap.skipped > 0,
      output: { created: bootstrap.created, skipped: bootstrap.skipped },
    };
  }

  return { success: true, output: { enrolled: true, campaignStatus: campaign.status } };
}

async function addTagAction(node: WorkflowGraphNode, context: WorkflowContext): Promise<ActionResult> {
  const tagId = String(node.data.tagId ?? '');
  if (!tagId) {
    return { success: false, error: 'Missing tagId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  await prisma.leadTag.createMany({
    data: [{ leadId: context.leadId, tagId }],
    skipDuplicates: true,
  });
  return { success: true };
}

async function removeTagAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const tagId = String(node.data.tagId ?? '');
  if (!tagId) {
    return { success: false, error: 'Missing tagId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  await prisma.leadTag.deleteMany({ where: { leadId: context.leadId, tagId } });
  return { success: true };
}

async function addToListAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const listId = String(node.data.listId ?? '');
  if (!listId) {
    return { success: false, error: 'Missing listId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  await prisma.leadListMember.createMany({
    data: [{ leadId: context.leadId, listId }],
    skipDuplicates: true,
  });
  return { success: true };
}

async function removeFromListAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const listId = String(node.data.listId ?? '');
  if (!listId) {
    return { success: false, error: 'Missing listId', errorCategory: 'CONFIGURATION_ERROR' };
  }

  await prisma.leadListMember.deleteMany({ where: { leadId: context.leadId, listId } });
  return { success: true };
}

const ALLOWED_UPDATE_FIELDS = new Set(['status', 'jobTitle', 'industry', 'country']);
const ALLOWED_STATUSES = new Set(['QUALIFIED', 'UNQUALIFIED', 'ARCHIVED']);

async function updateLeadAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const field = String(node.data.field ?? '');
  const value = node.data.value;
  if (!ALLOWED_UPDATE_FIELDS.has(field)) {
    return { success: false, error: `Field ${field} is not allowed`, errorCategory: 'VALIDATION_ERROR' };
  }
  if (field === 'status' && !ALLOWED_STATUSES.has(String(value))) {
    return { success: false, error: 'Invalid status value', errorCategory: 'VALIDATION_ERROR' };
  }

  await prisma.lead.update({
    where: { id: context.leadId },
    data: { [field]: value },
  });
  return { success: true, output: { field, value } };
}

async function notifyUserAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const title = String(node.data.title ?? 'Workflow notification');
  const body = String(node.data.body ?? '');
  const userId = node.data.userId ? String(node.data.userId) : undefined;
  const href = node.data.href ? String(node.data.href) : undefined;

  await notificationService.create({
    workspaceId: context.workspaceId,
    userId,
    title,
    body,
    href,
    workflowExecutionId: context.metadata?.executionId as string | undefined,
  });

  return { success: true };
}

async function pauseLeadAction(
  node: WorkflowGraphNode,
  context: WorkflowContext,
): Promise<ActionResult> {
  const campaignId = node.data.campaignId ? String(node.data.campaignId) : undefined;

  const where = campaignId
    ? { leadId: context.leadId, campaignId, campaign: { workspaceId: context.workspaceId } }
    : { leadId: context.leadId, campaign: { workspaceId: context.workspaceId } };

  const campaignLeads = await prisma.campaignLead.findMany({ where });

  for (const cl of campaignLeads) {
    await prisma.campaignLead.update({
      where: { id: cl.id },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    await sendingJobService.cancelCampaignLeadJobs(cl.id, context.workspaceId, 'workflow_pause_lead');
  }

  return { success: true, output: { paused: campaignLeads.length } };
}
