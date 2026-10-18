'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { submitManualVerification, type LeadResearch, type ManualVerificationInput } from '@/lib/api';
import { invalidateResearchQueries, isLinkedInPersonUrl } from './research-status';

interface PersonForm {
  firstName: string;
  lastName: string;
  title: string;
  profileUrl: string;
}

interface CompanyForm {
  name: string;
  url: string;
  industry: string;
  location: string;
  employeeRange: string;
}

interface SignalsForm {
  decisionMaker: boolean;
  hiring: boolean;
  growthSignal: boolean;
  technologySignal: boolean;
}

interface FormState {
  person: PersonForm;
  company: CompanyForm;
  signals: SignalsForm;
  notes: string;
}

const NOTES_MAX = 2000;

const PERSON_FIELDS: { key: keyof PersonForm; label: string; placeholder: string }[] = [
  { key: 'firstName', label: 'First name', placeholder: 'As shown on the profile' },
  { key: 'lastName', label: 'Last name', placeholder: 'As shown on the profile' },
  { key: 'title', label: 'Job title / headline', placeholder: 'e.g. Head of Operations' },
  { key: 'profileUrl', label: 'LinkedIn profile URL', placeholder: 'https://www.linkedin.com/in/…' },
];

const COMPANY_FIELDS: { key: keyof CompanyForm; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Company name', placeholder: 'As shown on the company page' },
  { key: 'url', label: 'Company website', placeholder: 'https://…' },
  { key: 'industry', label: 'Industry', placeholder: 'e.g. Dental practice' },
  { key: 'location', label: 'Location', placeholder: 'City, Region' },
  { key: 'employeeRange', label: 'Employee range', placeholder: 'e.g. 11-50 employees' },
];

const SIGNAL_FIELDS: { key: keyof SignalsForm; label: string; hint: string }[] = [
  { key: 'decisionMaker', label: 'Decision maker', hint: 'The person can sign off on purchases' },
  { key: 'hiring', label: 'Hiring', hint: 'Open roles are visible on the page' },
  { key: 'growthSignal', label: 'Growth signal', hint: 'Expansion, funding or new locations mentioned' },
  { key: 'technologySignal', label: 'Technology signal', hint: 'Tools or platforms named on the page' },
];

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

function buildInitialForm(research: LeadResearch): FormState {
  const data = research.structuredData ?? {};
  const person = data.person ?? {};
  const company = data.company ?? {};
  const signals = data.signals ?? {};
  const url = research.sourceUrl ?? research.normalizedUrl ?? '';
  return {
    person: {
      firstName: text(person.firstName),
      lastName: text(person.lastName),
      title: text(person.title),
      profileUrl: text(person.profileUrl) || (research.researchType === 'PERSON' ? url : ''),
    },
    company: {
      name: text(company.name),
      url: text(company.url),
      industry: text(company.industry),
      location: text(company.location),
      employeeRange: text(company.employeeRange),
    },
    signals: {
      decisionMaker: signals.decisionMaker === true,
      hiring: signals.hiring === true,
      growthSignal: signals.growthSignal === true,
      technologySignal: signals.technologySignal === true,
    },
    notes: '',
  };
}

function compactStrings<T extends { [K in keyof T]: string }>(block: T): Partial<T> | undefined {
  const result: Partial<T> = {};
  let count = 0;
  for (const key of Object.keys(block) as (keyof T)[]) {
    const val = block[key];
    if (val == null) continue;
    const trimmed = val.trim();
    if (trimmed) {
      result[key] = trimmed as T[keyof T];
      count += 1;
    }
  }
  return count > 0 ? result : undefined;
}

/** Trims every field, drops empty strings and empty sub-objects, always sends `signals`. */
export function toManualVerificationPayload(form: FormState): ManualVerificationInput {
  const payload: ManualVerificationInput = { signals: { ...form.signals } };
  const person = compactStrings(form.person);
  if (person) payload.person = person;
  const company = compactStrings(form.company);
  if (company) payload.company = company;
  const notes = form.notes.trim();
  if (notes) payload.notes = notes.slice(0, NOTES_MAX);
  return payload;
}

interface DialogProps {
  research: LeadResearch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (saved: LeadResearch) => void;
}

/**
 * Researcher data entry for a LinkedIn research record. Saving sets the record to
 * COMPLETED · manual · HIGH with every supplied field labelled VERIFIED (source: you).
 */
export function ManualVerificationDialog({ research, open, onOpenChange, onSaved }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {research ? (
          <ManualVerificationForm
            key={research.id}
            research={research}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onSaved?.(saved);
              onOpenChange(false);
            }}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>Enter research data</DialogTitle>
            <DialogDescription>Select a research record first.</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  research: LeadResearch;
  onCancel: () => void;
  onSaved: (saved: LeadResearch) => void;
}

function ManualVerificationForm({ research, onCancel, onSaved }: FormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => buildInitialForm(research));
  const idPrefix = `mv-${research.id}`;

  const saveMutation = useMutation({
    mutationFn: (payload: ManualVerificationInput) => submitManualVerification(research.id, payload),
    onSuccess: (saved) => {
      invalidateResearchQueries(queryClient, research.leadId, { includeLead: true });
      toast.success('Research saved and marked Verified');
      onSaved(saved);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const profileUrl = form.person.profileUrl.trim();
  const profileUrlInvalid = profileUrl !== '' && !isLinkedInPersonUrl(profileUrl);
  const hasAnyValue =
    Object.values(form.person).some((v) => v.trim() !== '') ||
    Object.values(form.company).some((v) => v.trim() !== '');
  const canSave = hasAnyValue && !profileUrlInvalid && !saveMutation.isPending;

  const openUrl = research.sourceUrl ?? research.normalizedUrl;

  const personSection = (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Person</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {PERSON_FIELDS.map((field) => {
          const id = `${idPrefix}-person-${field.key}`;
          const invalid = field.key === 'profileUrl' && profileUrlInvalid;
          return (
            <div key={field.key} className={field.key === 'profileUrl' || field.key === 'title' ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
              <Label htmlFor={id}>{field.label}</Label>
              <Input
                id={id}
                value={form.person[field.key]}
                placeholder={field.placeholder}
                maxLength={field.key === 'profileUrl' ? 500 : 200}
                aria-invalid={invalid || undefined}
                onChange={(e) => setForm({ ...form, person: { ...form.person, [field.key]: e.target.value } })}
              />
              {invalid && (
                <p className="text-xs text-destructive">Enter a LinkedIn profile URL (linkedin.com/in/…).</p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );

  const companySection = (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Company</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {COMPANY_FIELDS.map((field) => {
          const id = `${idPrefix}-company-${field.key}`;
          return (
            <div key={field.key} className={field.key === 'url' ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
              <Label htmlFor={id}>{field.label}</Label>
              <Input
                id={id}
                value={form.company[field.key]}
                placeholder={field.placeholder}
                maxLength={field.key === 'url' ? 500 : 200}
                onChange={(e) => setForm({ ...form, company: { ...form.company, [field.key]: e.target.value } })}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );

  const primaryIsPerson = research.researchType === 'PERSON';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enter research data</DialogTitle>
        <DialogDescription>
          Enter only what you personally confirmed on the profile. Saved values are labelled Verified with you as
          the source.
        </DialogDescription>
      </DialogHeader>

      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
        >
          Open LinkedIn page in a new tab <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}

      <div className="space-y-5">
        {primaryIsPerson ? (
          <>
            {personSection}
            {companySection}
          </>
        ) : (
          <>
            {companySection}
            {personSection}
          </>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Signals you observed</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SIGNAL_FIELDS.map((signal) => {
              const id = `${idPrefix}-signal-${signal.key}`;
              return (
                <div key={signal.key} className="flex items-start gap-2 rounded-md border border-border p-2.5">
                  <Checkbox
                    id={id}
                    checked={form.signals[signal.key]}
                    onCheckedChange={(v) => setForm({ ...form, signals: { ...form.signals, [signal.key]: v === true } })}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor={id} className="text-sm">
                      {signal.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{signal.hint}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Researcher notes (optional)</Label>
          <Textarea
            id={`${idPrefix}-notes`}
            value={form.notes}
            maxLength={NOTES_MAX}
            placeholder="What you checked and where you saw it."
            className="min-h-[70px]"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <p className="text-right text-xs text-muted-foreground">
            {form.notes.length}/{NOTES_MAX}
          </p>
        </div>

        {!hasAnyValue && (
          <p className="text-xs text-muted-foreground">Enter at least one person or company value to save.</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => saveMutation.mutate(toManualVerificationPayload(form))} disabled={!canSave}>
          {saveMutation.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Save as Verified
        </Button>
      </DialogFooter>
    </>
  );
}
