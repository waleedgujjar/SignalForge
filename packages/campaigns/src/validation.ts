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

    // ── Deliverability quality report (warnings only; never blocks launch) ─────
    // Sending-domain authentication: surface SPF/DKIM/DMARC so a campaign is not
    // launched from a domain that will land in spam. Reads the cached
    // DomainHealthCheck (the scheduler auto-checks sending domains).
    const mailboxIds = new Set<string>();
    for (const cm of campaign.mailboxes) mailboxIds.add(cm.mailboxId);
    for (const member of campaign.smtpPool?.members ?? []) mailboxIds.add(member.mailboxId);
    if (campaign.mailboxId) mailboxIds.add(campaign.mailboxId);
    const domains = new Set<string>();
    if (campaign.singleMailbox?.emailAddress) {
      const d = domainOf(campaign.singleMailbox.emailAddress);
      if (d) domains.add(d);
    }
    if (mailboxIds.size > 0) {
      const boxes = await prisma.mailbox.findMany({
        where: { id: { in: [...mailboxIds] } },
        select: { emailAddress: true },
      });
      for (const box of boxes) {
        const d = domainOf(box.emailAddress);
        if (d) domains.add(d);
      }
    }
    if (domains.size > 0) {
      const rows = await prisma.domainHealthCheck.findMany({
        where: { workspaceId, domain: { in: [...domains] } },
      });
      const byDomain = new Map(rows.map((r) => [r.domain, r]));
      for (const domain of domains) {
        const row = byDomain.get(domain);
        for (const kind of ['SPF', 'DKIM', 'DMARC'] as const) {
          const status =
            kind === 'SPF' ? row?.spfStatus : kind === 'DKIM' ? row?.dkimStatus : row?.dmarcStatus;
          const passed = status === 'PASS';
          checks.push({
            id: `auth_${kind.toLowerCase()}_${domain}`,
            label: `${kind} — ${domain}`,
            passed,
            severity: 'warning',
            message: passed
              ? undefined
              : !row
                ? `${kind} not checked yet for ${domain}. Open Domain Auth to verify DNS.`
                : `${kind} is ${status ?? 'UNKNOWN'} for ${domain}. Fix DNS (enable DKIM, set DMARC) to improve inbox placement.`,
          });
        }
      }
    }

    // Content quality: suspicious links and spammy subjects.
    pushContentQualityChecks(checks, enabledSteps);

    // Unsubscribe is injected automatically at send time (header + footer).
    checks.push({
      id: 'unsubscribe',
      label: 'Unsubscribe mechanism',
      passed: true,
      severity: 'warning',
      message: 'A one-click List-Unsubscribe header and a footer link are added to every email automatically.',
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

function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? '').lastIndexOf('@');
  if (at === -1) return null;
  return email!.slice(at + 1).trim().toLowerCase() || null;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()"']+/gi;
const URL_SHORTENERS = /(?:^|\.)(?:bit\.ly|tinyurl\.com|goo\.gl|t\.co|is\.gd|ow\.ly|buff\.ly|rebrand\.ly|cutt\.ly)$/i;
const SPAM_WORD_PATTERNS = [
  /\bfree\b/i,
  /\bguarantee/i,
  /\bact now\b/i,
  /\blimited time\b/i,
  /\bclick here\b/i,
  /\b100%\b/,
  /\bwinner\b/i,
  /\brisk[- ]?free\b/i,
  /\bcash\b/i,
  /\$\$\$/,
];

/// Non-TLS, raw-IP, unparseable, or shortener links are the ones spam filters
/// weigh against a message.
function isSuspiciousUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.protocol !== 'https:') return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)) return true;
  if (URL_SHORTENERS.test(url.hostname)) return true;
  return false;
}

function looksSpammy(subject: string): boolean {
  if (!subject) return false;
  const letters = subject.replace(/[^A-Za-z]/g, '');
  const caps = subject.replace(/[^A-Z]/g, '');
  const shouting = letters.length >= 6 && caps.length / letters.length > 0.7;
  const punctSpam = /[!?]{2,}|\${2,}/.test(subject);
  const triggerHits = SPAM_WORD_PATTERNS.filter((re) => re.test(subject)).length;
  return shouting || punctSpam || triggerHits >= 2;
}

/// Content warnings surfaced in the pre-send quality report. Warnings only — they
/// never block a launch.
function pushContentQualityChecks(
  checks: ValidationCheck[],
  steps: Array<{ subjectTemplate: string; bodyTemplate: string }>,
): void {
  const suspicious = new Set<string>();
  const spammySubjects: string[] = [];
  for (const step of steps) {
    for (const url of step.bodyTemplate.match(URL_PATTERN) ?? []) {
      if (isSuspiciousUrl(url)) suspicious.add(url.slice(0, 80));
    }
    if (looksSpammy(step.subjectTemplate)) spammySubjects.push(step.subjectTemplate.slice(0, 60));
  }
  checks.push({
    id: 'links',
    label: 'Link quality',
    passed: suspicious.size === 0,
    severity: 'warning',
    message:
      suspicious.size === 0
        ? undefined
        : `${suspicious.size} suspicious link(s): ${[...suspicious].slice(0, 3).join(', ')}. Use plain https links on a domain that matches your sender.`,
  });
  checks.push({
    id: 'subject_quality',
    label: 'Subject quality',
    passed: spammySubjects.length === 0,
    severity: 'warning',
    message:
      spammySubjects.length === 0
        ? undefined
        : `Subject may look spammy: "${spammySubjects[0]}". Avoid ALL CAPS, excessive punctuation and spam trigger words.`,
  });
}
