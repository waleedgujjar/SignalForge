'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CampaignStep } from '@/lib/api';
import { VariablePicker } from './variable-picker';
import { SpintaxHelper } from './spintax-helper';

export function EmailStepEditor({
  step,
  onChange,
  readOnly,
  hideDelay,
}: {
  step: Partial<CampaignStep>;
  onChange: (updates: Partial<CampaignStep>) => void;
  readOnly?: boolean;
  hideDelay?: boolean;
}) {
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  function insertVariable(field: 'subject' | 'body', token: string) {
    if (field === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const next = `${el.value.slice(0, start)}${token}${el.value.slice(start)}`;
      onChange({ subjectTemplate: next });
    }
    if (field === 'body' && bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const next = `${el.value.slice(0, start)}${token}${el.value.slice(start)}`;
      onChange({ bodyTemplate: next });
    }
  }

  return (
    <div className="space-y-4">
      {!hideDelay && (
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Delay amount</Label>
          <Input
            type="number"
            min={0}
            value={step.delayAmount ?? 0}
            disabled={readOnly}
            onChange={(e) => onChange({ delayAmount: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Delay unit</Label>
          <Select
            value={step.delayUnit ?? 'DAYS'}
            disabled={readOnly}
            onValueChange={(value) => onChange({ delayUnit: value as CampaignStep['delayUnit'] })}
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
        <div className="flex items-end gap-2 pb-2">
          <Switch
            checked={step.enabled ?? true}
            disabled={readOnly}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          <Label>Enabled</Label>
        </div>
      </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="subject">Subject</Label>
          {!readOnly && <VariablePicker onInsert={(token) => insertVariable('subject', token)} />}
        </div>
        <Input
          id="subject"
          ref={subjectRef}
          value={step.subjectTemplate ?? ''}
          disabled={readOnly}
          onChange={(e) => onChange({ subjectTemplate: e.target.value })}
          placeholder="{Hi|Hello} {{first_name|there}}"
        />
        <SpintaxHelper template={step.subjectTemplate ?? ''} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="body">Body</Label>
          {!readOnly && <VariablePicker onInsert={(token) => insertVariable('body', token)} />}
        </div>
        <Textarea
          id="body"
          ref={bodyRef}
          rows={8}
          value={step.bodyTemplate ?? ''}
          disabled={readOnly}
          onChange={(e) => onChange({ bodyTemplate: e.target.value })}
          placeholder="Email body with {{company}} and {spintax|options}"
        />
        <SpintaxHelper template={step.bodyTemplate ?? ''} />
      </div>
    </div>
  );
}
