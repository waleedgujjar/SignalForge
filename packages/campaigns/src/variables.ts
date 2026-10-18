export const CAMPAIGN_VARIABLE_GROUPS = [
  {
    label: 'Lead',
    variables: [
      { key: 'first_name', label: 'First name', example: '{{first_name|there}}' },
      { key: 'last_name', label: 'Last name', example: '{{last_name}}' },
      { key: 'full_name', label: 'Full name', example: '{{full_name}}' },
      { key: 'email', label: 'Email', example: '{{email}}' },
      { key: 'company', label: 'Company', example: '{{company}}' },
      { key: 'company_domain', label: 'Company domain', example: '{{company_domain}}' },
      { key: 'job_title', label: 'Job title', example: '{{job_title}}' },
      { key: 'industry', label: 'Industry', example: '{{industry}}' },
      { key: 'country', label: 'Country', example: '{{country}}' },
      { key: 'city', label: 'City', example: '{{city}}' },
      { key: 'website', label: 'Website', example: '{{website}}' },
    ],
  },
  {
    label: 'Scores',
    variables: [
      { key: 'icp_score', label: 'ICP score', example: '{{icp_score}}' },
      { key: 'website_score', label: 'Website score', example: '{{website_score}}' },
      { key: 'prospect_score', label: 'Prospect score', example: '{{prospect_score}}' },
    ],
  },
  {
    label: 'Enrichment',
    variables: [
      { key: 'department', label: 'Department', example: '{{department}}' },
      { key: 'seniority', label: 'Seniority', example: '{{seniority}}' },
    ],
  },
  {
    label: 'AI Intelligence',
    variables: [
      { key: 'ai.pain_point', label: 'Pain point', example: '{{ai.pain_point}}' },
      { key: 'ai.personalization_hook', label: 'Personalization hook', example: '{{ai.personalization_hook}}' },
      { key: 'ai.outreach_angle', label: 'Outreach angle', example: '{{ai.outreach_angle}}' },
      { key: 'ai.recommended_service', label: 'Recommended service', example: '{{ai.recommended_service}}' },
      { key: 'ai.top_opportunity', label: 'Top opportunity', example: '{{ai.top_opportunity}}' },
    ],
  },
  {
    label: 'Research',
    variables: [
      { key: 'research.company_description', label: 'Company description', example: '{{research.company_description}}' },
      { key: 'research.services', label: 'Services offered', example: '{{research.services}}' },
      { key: 'research.service_area', label: 'Service area', example: '{{research.service_area}}' },
      { key: 'research.specializations', label: 'Specializations', example: '{{research.specializations}}' },
    ],
  },
] as const;

const CAMEL_ALIASES: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  fullName: 'full_name',
  companyDomain: 'company_domain',
  jobTitle: 'job_title',
  icpScore: 'icp_score',
  websiteScore: 'website_score',
  prospectScore: 'prospect_score',
};

export function normalizeVariableKey(key: string): string {
  return CAMEL_ALIASES[key] ?? key;
}
