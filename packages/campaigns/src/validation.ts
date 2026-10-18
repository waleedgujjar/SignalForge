import { prisma } from '@signalforge/database';
import {
  detectVariables,
  leadToVariableContext,
  validateSpintax,
  validateTemplate,
} from '@signalforge/email';
import type { CampaignValidationResult, ScheduleConfig, ValidationCheck } from './types.js';

function parseScheduleConfig(raw: unknown): ScheduleConfig {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ScheduleConfig;
}

function validateSchedule(config: ScheduleConfig): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const hasAny = Boolean(config.timezone || config.days?.length || config.startTime || config.endTime);

  if (!hasAny) {
    checks.push({
      id: 'schedule',
      label: 'Schedule configuration',
      passed: true,
      severity: 'warning',
      message: 'No sending window configured; defaults will apply at send time.',
    });
    return checks;
  }

  if (config.timezone && config.timezone.length < 2) {
    checks.push({
      id: 'schedule_timezone',
      label: 'Schedule timezone',
      passed: false,
      severity: 'error',
      message: 'Invalid timezone.',
    });
  } else {
    checks.push({
      id: 'schedule_timezone',
      label: 'Schedule timezone',
      passed: true,
      severity: 'error',
    });
  }

  if (config.days && config.days.some((d) => d < 0 || d > 6)) {
    checks.push({
      id: 'schedule_days',
      label: 'Schedule days',
      passed: false,
      severity: 'error',
      message: 'Days must be 0-6 (Sun-Sat).',
    });
  } else {
    checks.push({
      id: 'schedule_days',
      label: 'Schedule days',
      passed: true,
      severity: 'error',
    });
  }

  return checks;
}

export class CampaignValidationService {
  async validate(campaignId: string, workspaceId: string): Promise<CampaignValidationResult> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        campaignLeads: { include: { lead: { include: { verification: true, enrichment: true, websiteAnalyses: { take: 1, orderBy: { createdAt: 'desc' } } } } } },
        mailboxes: true,
        smtpPool: { include: { members: true } },
        singleMailbox: true,
      },
    });

    if (!campaign) throw new Error('Campaign not found');

    const checks: ValidationCheck[] = [];

    checks.push({
      id: 'name',
      label: 'Campaign name',
      passed: campaign.name.trim().length > 0,
      severity: 'error',
      message: campaign.name.trim().length > 0 ? undefined : 'Campaign name is required.',
    });

    const enabledSteps = campaign.steps.filter((s) => s.enabled);
    checks.push({
      id: 'steps',
      label: 'Sequence steps',
      passed: enabledSteps.length > 0,
      severity: 'error',
      message: enabledSteps.length > 0 ? undefined : 'At least one enabled email step is required.',
    });

    checks.push({
      id: 'leads',
      label: 'Enrolled leads',
      passed: campaign.campaignLeads.length > 0,
      severity: 'error',
      message:
        campaign.campaignLeads.length > 0 ? undefined : 'Enroll at least one lead before launch.',
    });

    checks.push(...validateSchedule(parseScheduleConfig(campaign.scheduleConfig)));

    if (campaign.sendingMode === 'SMTP_POOL') {
      const pool = campaign.smtpPool;
      if (!pool) {
        checks.push({
          id: 'smtp_pool',
          label: 'SMTP pool',
          passed: false,
          severity: 'error',
          message: 'Sending mode is SMTP_POOL but no pool is assigned.',
        });
      } else if (!pool.enabled) {
        checks.push({
          id: 'smtp_pool_enabled',
          label: 'SMTP pool',
          passed: false,
          severity: 'error',
          message: `Pool "${pool.name}" is disabled.`,
        });
      } else if (pool.members.filter((m) => m.enabled).length === 0) {
        checks.push({
          id: 'smtp_pool_members',
          label: 'SMTP pool members',
          passed: false,
          severity: 'error',
          message: `Pool "${pool.name}" has no enabled mailboxes.`,
        });
      } else {
        checks.push({
          id: 'smtp_pool',
          label: 'SMTP pool',
          passed: true,
          severity: 'error',
        });
      }
    } else if (campaign.sendingMode === 'SINGLE_MAILBOX') {
      if (!campaign.singleMailbox) {
        checks.push({
          id: 'single_mailbox',
          label: 'Sending mailbox',
          passed: false,
          severity: 'error',
          message: 'Sending mode is SINGLE_MAILBOX but no mailbox is selected.',
        });
      } else {
        checks.push({
          id: 'single_mailbox',
          label: 'Sending mailbox',
          passed: true,
          severity: 'error',
        });
      }
    } else {
      checks.push({
        id: 'mailbox_list',
        label: 'Assigned mailboxes',
        passed: campaign.mailboxes.length > 0,
        severity: 'error',
        message:
          campaign.mailboxes.length > 0
            ? undefined
            : 'Assign at least one mailbox or switch to an SMTP pool.',
      });
    }

    for (const step of enabledSteps) {
      const subjectSpintax = validateSpintax(step.subjectTemplate);
      const bodySpintax = validateSpintax(step.bodyTemplate);

      checks.push({
        id: `spintax_subject_${step.id}`,
        label: `Step ${step.order + 1} subject spintax`,
        passed: subjectSpintax.valid,
        severity: 'error',
        message: subjectSpintax.valid ? undefined : subjectSpintax.error,
      });

      checks.push({
        id: `spintax_body_${step.id}`,
        label: `Step ${step.order + 1} body spintax`,
        passed: bodySpintax.valid,
        severity: 'error',
        message: bodySpintax.valid ? undefined : bodySpintax.error,
      });

      const variables = [
        ...detectVariables(step.subjectTemplate),
        ...detectVariables(step.bodyTemplate),
      ];
      if (variables.length === 0) {
        checks.push({
          id: `variables_${step.id}`,
          label: `Step ${step.order + 1} personalization`,
          passed: true,
          severity: 'warning',
          message: 'No merge variables used.',
        });
      }
    }

    let templateInvalidCount = 0;
    for (const cl of campaign.campaignLeads.slice(0, 50)) {
      const context = leadToVariableContext({
        ...cl.lead,
        enrichment: cl.lead.enrichment,
        websiteAnalysis: cl.lead.websiteAnalyses[0] ?? null,
      });
      for (const step of enabledSteps) {
        const result = validateTemplate(step.subjectTemplate, step.bodyTemplate, context);
        if (!result.valid) templateInvalidCount += 1;
      }
    }

    checks.push({
      id: 'templates',
      label: 'Template variable resolution',
      passed: templateInvalidCount === 0,
      severity: 'warning',
      message:
        templateInvalidCount === 0
          ? undefined
          : `${templateInvalidCount} lead/step combination(s) have unresolved variables.`,
    });

    const errors = checks.filter((c) => !c.passed && c.severity === 'error').map((c) => c.message ?? c.label);
    const warnings = checks.filter((c) => !c.passed && c.severity === 'warning').map((c) => c.message ?? c.label);

    const valid = errors.length === 0;

    return {
      valid,
      ready: valid,
      checks,
      errors,
      warnings,
    };
  }
}

export const campaignValidationService = new CampaignValidationService();
