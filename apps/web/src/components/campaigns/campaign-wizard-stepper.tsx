'use client';

import Link from 'next/link';
import { Check, Users, Mail, Clock, Rocket } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface WizardStep {
  key: string;
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
}

const WIZARD_STEPS: WizardStep[] = [
  { key: 'leads', label: 'Select Leads', href: '/leads', icon: Users, description: 'Add and manage campaign recipients' },
  { key: 'sequence', label: 'Compose Email', href: '/sequence', icon: Mail, description: 'Write your email template and follow-ups' },
  { key: 'schedule', label: 'Schedule & Setup', href: '/schedule', icon: Clock, description: 'Set timing, mailboxes, and sending options' },
  { key: 'review', label: 'Review & Launch', href: '/review', icon: Rocket, description: 'Preview emails and launch your campaign' },
];

function getStepCompletion(step: string, campaign: {
  _count?: { campaignLeads?: number; steps?: number; mailboxes?: number };
  steps?: { order: number; subjectTemplate: string; bodyTemplate: string }[];
  scheduleConfig?: unknown;
}): boolean {
  const counts = campaign._count ?? {};
  switch (step) {
    case 'leads':
      return (counts.campaignLeads ?? 0) > 0;
    case 'sequence':
      return (counts.steps ?? 0) > 0 && Boolean(campaign.steps?.[0]?.subjectTemplate);
    case 'schedule':
      return (counts.mailboxes ?? 0) > 0;
    case 'review':
      return false;
    default:
      return false;
  }
}

export function CampaignWizardStepper({
  campaignId,
  currentStep,
  campaign,
}: {
  campaignId: string;
  currentStep: string;
  campaign: {
    _count?: { campaignLeads?: number; steps?: number; mailboxes?: number };
    steps?: { order: number; subjectTemplate: string; bodyTemplate: string }[];
    scheduleConfig?: unknown;
  };
}) {
  const basePath = `/campaigns/${campaignId}`;
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="mb-6">
      <nav aria-label="Campaign setup progress" className="flex items-center gap-2">
        {WIZARD_STEPS.map((step, index) => {
          const isActive = step.key === currentStep;
          const isCompleted = getStepCompletion(step.key, campaign);
          const isPast = index < currentIndex;

          return (
            <div key={step.key} className="flex items-center gap-2">
              {index > 0 && (
                <div className={cn('hidden h-px w-8 sm:block', isPast || isActive ? 'bg-primary' : 'bg-border')} />
              )}
              <Link
                href={`${basePath}${step.href}`}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isCompleted
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : isCompleted
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground group-hover:text-foreground',
                )}>
                  {isCompleted && !isActive ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="hidden whitespace-nowrap sm:inline">{step.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export function WizardNavigation({
  campaignId,
  currentStep,
}: {
  campaignId: string;
  currentStep: string;
}) {
  const basePath = `/campaigns/${campaignId}`;
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.key === currentStep);
  const prevStep = currentIndex > 0 ? WIZARD_STEPS[currentIndex - 1] : null;
  const nextStep = currentIndex < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[currentIndex + 1] : null;

  return (
    <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
      {prevStep ? (
        <Link
          href={`${basePath}${prevStep.href}`}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          ← {prevStep.label}
        </Link>
      ) : (
        <div />
      )}
      {nextStep ? (
        <Link
          href={`${basePath}${nextStep.href}`}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {nextStep.label} →
        </Link>
      ) : null}
    </div>
  );
}

export { WIZARD_STEPS };
