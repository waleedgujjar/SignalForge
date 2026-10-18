'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';

const GROUPS = [
  {
    label: 'Lead',
    variables: [
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'full_name', label: 'Full name' },
      { key: 'email', label: 'Email' },
      { key: 'company', label: 'Company' },
      { key: 'company_domain', label: 'Company domain' },
      { key: 'job_title', label: 'Job title' },
      { key: 'industry', label: 'Industry' },
      { key: 'country', label: 'Country' },
      { key: 'city', label: 'City' },
      { key: 'website', label: 'Website' },
    ],
  },
  {
    label: 'Scores',
    variables: [
      { key: 'icp_score', label: 'ICP score' },
      { key: 'website_score', label: 'Website score' },
      { key: 'prospect_score', label: 'Prospect score' },
    ],
  },
  {
    label: 'Enrichment',
    variables: [
      { key: 'department', label: 'Department' },
      { key: 'seniority', label: 'Seniority' },
    ],
  },
  {
    label: 'AI Intelligence',
    variables: [
      { key: 'ai.pain_point', label: 'Pain point' },
      { key: 'ai.personalization_hook', label: 'Personalization hook' },
      { key: 'ai.outreach_angle', label: 'Outreach angle' },
      { key: 'ai.recommended_service', label: 'Recommended service' },
      { key: 'ai.top_opportunity', label: 'Top opportunity' },
    ],
  },
  {
    label: 'Research',
    variables: [
      { key: 'research.company_description', label: 'Company description' },
      { key: 'research.services', label: 'Services offered' },
      { key: 'research.service_area', label: 'Service area' },
      { key: 'research.specializations', label: 'Specializations' },
    ],
  },
];

export function VariablePicker({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Insert variable
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</div>
            {group.variables.map((v) => (
              <DropdownMenuItem key={v.key} onClick={() => onInsert(`{{${v.key}}}`)}>
                {v.label}
                <span className="ml-auto text-xs text-muted-foreground">{`{{${v.key}}}`}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
