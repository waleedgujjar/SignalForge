export interface LeadVariableContext {

  email?: string | null;

  first_name?: string | null;

  last_name?: string | null;

  full_name?: string | null;

  company?: string | null;

  company_domain?: string | null;

  job_title?: string | null;

  industry?: string | null;

  country?: string | null;

  city?: string | null;

  website?: string | null;

  icp_score?: string | null;

  website_score?: string | null;

  prospect_score?: string | null;

  department?: string | null;

  seniority?: string | null;

  custom?: Record<string, string | null | undefined>;

  ai?: Record<string, string | null | undefined>;

  research?: Record<string, string | null | undefined>;

}



export interface VariableResolutionResult {

  text: string;

  missingVariables: string[];

  hasUnresolved: boolean;

}



const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_.]+)(?:\|([^}]*))?\}\}/g;



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



function normalizeKey(key: string): string {

  return CAMEL_ALIASES[key] ?? key;

}



export function detectVariables(template: string): string[] {

  const matches = template.matchAll(VARIABLE_PATTERN);

  return [...new Set([...matches].map((m) => normalizeKey(m[1]!)))];

}



export function resolveVariables(template: string, context: LeadVariableContext): VariableResolutionResult {

  const missingVariables: string[] = [];



  const text = template.replace(VARIABLE_PATTERN, (_match, rawKey: string, fallback?: string) => {

    const key = normalizeKey(rawKey);

    const value = getVariableValue(key, context);

    if (value === null || value === undefined || value === '') {

      if (fallback !== undefined && fallback !== '') {

        return fallback;

      }

      missingVariables.push(`{{${key}}}`);

      return '';

    }

    return value;

  });



  return {

    text,

    missingVariables: [...new Set(missingVariables)],

    hasUnresolved: missingVariables.length > 0,

  };

}



export function validateTemplate(

  subject: string,

  body: string,

  context: LeadVariableContext,

): { valid: boolean; errors: string[]; missingByField: Record<string, number> } {

  const subjectResult = resolveVariables(subject, context);

  const bodyResult = resolveVariables(body, context);

  const allMissing = [...subjectResult.missingVariables, ...bodyResult.missingVariables];



  if (allMissing.length === 0) {

    return { valid: true, errors: [], missingByField: {} };

  }



  const missingByField: Record<string, number> = {};

  for (const v of allMissing) {

    missingByField[v] = (missingByField[v] ?? 0) + 1;

  }



  const errors = Object.entries(missingByField).map(

    ([variable, count]) => `${variable} is missing for ${count} field(s).`,

  );



  return { valid: false, errors, missingByField };

}



function getVariableValue(key: string, context: LeadVariableContext): string | null | undefined {

  const normalizedKey = normalizeKey(key);



  if (normalizedKey.startsWith('custom.')) {

    const customKey = normalizedKey.slice('custom.'.length);

    return context.custom?.[customKey];

  }

  if (normalizedKey.startsWith('ai_') || normalizedKey.startsWith('ai.')) {

    const aiKey = normalizedKey.startsWith('ai.') ? normalizedKey.slice('ai.'.length) : normalizedKey;

    return context.ai?.[aiKey];

  }

  if (normalizedKey.startsWith('research.')) {

    const researchKey = normalizedKey.slice('research.'.length);

    return context.research?.[researchKey];

  }



  const map: Record<string, string | null | undefined> = {

    email: context.email,

    first_name: context.first_name,

    last_name: context.last_name,

    full_name: context.full_name,

    company: context.company,

    company_domain: context.company_domain,

    job_title: context.job_title,

    industry: context.industry,

    country: context.country,

    city: context.city,

    website: context.website,

    icp_score: context.icp_score,

    website_score: context.website_score,

    prospect_score: context.prospect_score,

    department: context.department,

    seniority: context.seniority,

  };



  return map[normalizedKey];

}



export function leadToVariableContext(lead: {

  email?: string | null;

  firstName?: string | null;

  lastName?: string | null;

  fullName?: string | null;

  company?: string | null;

  companyDomain?: string | null;

  jobTitle?: string | null;

  industry?: string | null;

  country?: string | null;

  city?: string | null;

  website?: string | null;

  icpScore?: number | null;

  customFields?: unknown;

  enrichment?: {

    icpFitScore?: number | null;

    prospectScore?: number | null;

    department?: string | null;

    seniority?: string | null;

    dynamicVariables?: unknown;

  } | null;

  websiteAnalysis?: {

    websiteScore?: number | null;

  } | null;

  research?: Array<{ structuredData?: unknown }> | null;

}): LeadVariableContext {

  const custom =

    lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)

      ? (lead.customFields as Record<string, string | null | undefined>)

      : {};



  const dynamicVars =

    lead.enrichment?.dynamicVariables &&

    typeof lead.enrichment.dynamicVariables === 'object' &&

    !Array.isArray(lead.enrichment.dynamicVariables)

      ? (lead.enrichment.dynamicVariables as Record<string, string | null | undefined>)

      : {};



  const researchVars: Record<string, string | null> = {};

  const topResearch = lead.research?.[0]?.structuredData;

  if (topResearch && typeof topResearch === 'object') {

    const rd = topResearch as Record<string, unknown>;

    const company = rd.company as Record<string, unknown> | undefined;

    if (company) {

      researchVars['company_description'] = typeof company.description === 'string' ? company.description : null;

      researchVars['services'] = Array.isArray(company.services) ? company.services.join(', ') : null;

      researchVars['service_area'] = typeof company.serviceArea === 'string' ? company.serviceArea : null;

      researchVars['specializations'] = Array.isArray(company.specializations) ? company.specializations.join(', ') : null;

    }

  }



  return {

    email: lead.email,

    first_name: lead.firstName,

    last_name: lead.lastName,

    full_name: lead.fullName ?? ([lead.firstName, lead.lastName].filter(Boolean).join(' ') || null),

    company: lead.company,

    company_domain: lead.companyDomain,

    job_title: lead.jobTitle,

    industry: lead.industry,

    country: lead.country,

    city: lead.city,

    website: lead.website,

    icp_score:

      lead.enrichment?.icpFitScore?.toString() ?? lead.icpScore?.toString() ?? null,

    website_score: lead.websiteAnalysis?.websiteScore?.toString() ?? null,

    prospect_score: lead.enrichment?.prospectScore?.toString() ?? null,

    department: lead.enrichment?.department ?? null,

    seniority: lead.enrichment?.seniority ?? null,

    custom,

    ai: dynamicVars,

    research: researchVars,

  };

}


