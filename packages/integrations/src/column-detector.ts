import type { ColumnMapping } from './types.js';

const ALIAS_MAP: Record<string, string> = {
  email: 'email',
  'e-mail': 'email',
  'email address': 'email',
  'email_address': 'email',
  'emailaddress': 'email',
  'business_email': 'email',
  'business email': 'email',
  'contact email': 'email',
  'work email': 'email',
  'company email': 'email',
  'primary email': 'email',
  'e-mail address': 'email',
  'e mail address': 'email',
  'mail': 'email',

  'first name': 'firstName',
  'first_name': 'firstName',
  firstname: 'firstName',
  fname: 'firstName',
  'given name': 'firstName',

  'last name': 'lastName',
  'last_name': 'lastName',
  lastname: 'lastName',
  lname: 'lastName',
  surname: 'lastName',
  'family name': 'lastName',

  'full name': 'fullName',
  'full_name': 'fullName',
  fullname: 'fullName',
  name: 'fullName',
  'person name': 'fullName',
  'lead name': 'fullName',
  'contact name': 'fullName',
  owner: 'fullName',
  'owner ceo': 'fullName',
  'owner name': 'fullName',
  ceo: 'fullName',
  founder: 'fullName',
  'founder name': 'fullName',
  contact: 'fullName',
  'contact person': 'fullName',
  'decision maker': 'fullName',
  'decision maker name': 'fullName',
  principal: 'fullName',

  company: 'company',
  'company name': 'company',
  'company_name': 'company',
  'business name': 'company',
  'business_name': 'company',
  business: 'company',
  organization: 'company',
  organisation: 'company',
  'organization name': 'company',
  org: 'company',
  firm: 'company',
  'company title': 'company',
  'organisation name': 'company',

  'company domain': 'companyDomain',
  'company_domain': 'companyDomain',
  domain: 'companyDomain',

  'job title': 'jobTitle',
  'job_title': 'jobTitle',
  jobtitle: 'jobTitle',
  title: 'jobTitle',
  role: 'jobTitle',
  position: 'jobTitle',
  designation: 'jobTitle',

  industry: 'industry',
  sector: 'industry',
  'business category': 'industry',
  category: 'industry',
  'business type': 'industry',
  niche: 'industry',

  phone: 'phone',
  'phone number': 'phone',
  'phone_number': 'phone',
  telephone: 'phone',
  'telephone number': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  'mobile phone': 'phone',
  tel: 'phone',
  'phone no': 'phone',
  'phone #': 'phone',
  cell: 'phone',
  'cell phone': 'phone',
  'contact number': 'phone',
  'business phone': 'phone',
  'primary phone': 'phone',

  linkedin: 'linkedinUrl',
  'linkedin url': 'linkedinUrl',
  'linkedin_url': 'linkedinUrl',
  'linkedin profile': 'linkedinUrl',
  'linkedin person url': 'linkedinUrl',
  'linkedin_person_url': 'linkedinUrl',
  'person linkedin': 'linkedinUrl',
  'person_linkedin_url': 'linkedinUrl',

  // Company page URL is a research input (Module 17), not a Lead column: the
  // import route turns it into a PENDING LeadResearch suggestion.
  'linkedin company': 'linkedinCompanyUrl',
  'linkedin_company': 'linkedinCompanyUrl',
  'linkedin company url': 'linkedinCompanyUrl',
  'linkedin_company_url': 'linkedinCompanyUrl',
  'company linkedin': 'linkedinCompanyUrl',
  'company linkedin url': 'linkedinCompanyUrl',
  'company_linkedin_url': 'linkedinCompanyUrl',

  'country code': 'countryCode',
  'country_code': 'countryCode',
  countrycode: 'countryCode',

  country: 'country',
  nation: 'country',

  region: 'region',

  state: 'state',
  province: 'state',

  city: 'city',
  town: 'city',

  website: 'website',
  url: 'website',
  web: 'website',
  site: 'website',
  link: 'website',
  'web url': 'website',
  'company website': 'website',
  'company_website': 'website',
  'business website': 'website',
  'business link': 'website',
  'website url': 'website',
  'website link': 'website',

  // Custom fields — stored in Lead.customFields JSON, not as top-level columns.
  'social account': 'socialAccount',
  'social media': 'socialAccount',
  facebook: 'socialAccount',
  'facebook url': 'socialAccount',
  instagram: 'socialAccount',
  'social profile': 'socialAccount',

  'google url': 'googleUrl',
  'google maps': 'googleUrl',
  'google maps url': 'googleUrl',
  'google business': 'googleUrl',
  'google business url': 'googleUrl',
  'maps url': 'googleUrl',
  'google link': 'googleUrl',

  rating: 'rating',
  'google rating': 'rating',
  'review rating': 'rating',
  'star rating': 'rating',

  service: 'service',
  services: 'service',
  'service type': 'service',
  availability: 'service',
  hours: 'service',
  'business hours': 'service',

  'ai chatbot': 'aiChatbot',
  chatbot: 'aiChatbot',
  'ai chat': 'aiChatbot',
  'live chat': 'aiChatbot',
  'chatbot available': 'aiChatbot',

  'website type': 'websiteType',
  'site type': 'websiteType',
};

export const LEAD_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'fullName',
  'company',
  'companyDomain',
  'jobTitle',
  'industry',
  'phone',
  'linkedinUrl',
  'linkedinCompanyUrl',
  'countryCode',
  'country',
  'region',
  'state',
  'city',
  'website',
] as const;

export type LeadField = (typeof LEAD_FIELDS)[number];

export const CUSTOM_FIELD_TARGETS = [
  'socialAccount',
  'googleUrl',
  'rating',
  'service',
  'aiChatbot',
  'websiteType',
] as const;

export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

const CUSTOM_FIELD_SET = new Set<string>(CUSTOM_FIELD_TARGETS);

export function isCustomField(field: string): field is CustomFieldTarget {
  return CUSTOM_FIELD_SET.has(field);
}

/**
 * Normalize a raw spreadsheet header for alias lookup.
 *
 * "Phone-no" → "phone no", "CompanyName" → "company name",
 * "Owner/CEO" → "owner ceo", "AI-Chatbot" → "ai chatbot".
 */
export function normalizeHeader(raw: string): string {
  return (
    raw
      .trim()
      // Insert space before uppercase letters that follow lowercase (camelCase split)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Replace separators with spaces
      .replace(/[-_/\\]+/g, ' ')
      // Strip non-alphanumeric except spaces and #
      .replace(/[^a-zA-Z0-9\s#]/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function detectColumnMappings(headers: string[]): ColumnMapping[] {
  const usedFields = new Set<string>();
  const mappings: ColumnMapping[] = [];

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const field = ALIAS_MAP[normalized];

    if (field && !usedFields.has(field)) {
      usedFields.add(field);
      mappings.push({
        csvColumn: header,
        leadField: field,
        confidence: normalized === field ? 1.0 : 0.9,
        reason: normalized === field ? 'header-exact' : 'header-alias',
      });
    }
  }

  return mappings;
}

export function buildMappingsRecord(
  columnMappings: ColumnMapping[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const m of columnMappings) {
    if (m.leadField) {
      record[m.csvColumn] = m.leadField;
    }
  }
  return record;
}
