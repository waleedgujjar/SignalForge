/// Web-specific research shapes — the structured data a web provider fills,
/// provider names, and the per-provider confidence ceiling.

import type { ResearchConfidence } from '@signalforge/database';

export type WebProviderName = 'website' | 'manual';

export interface WebCompanyData {
  name?: string;
  description?: string;
  services?: string[];
  specializations?: string[];
  location?: string;
  hasContactForm?: boolean;
  hasTestimonials?: boolean;
  hasTeamPage?: boolean;
  hasBlog?: boolean;
  technologies?: string[];
  certifications?: string[];
  serviceArea?: string;
  yearEstablished?: string;
}

export interface WebResearchData {
  company?: WebCompanyData;
  source?: {
    platform: 'web';
    url: string | null;
    retrievedAt: string;
  };
}

export const WEB_PROVIDER_MAX_CONFIDENCE: Record<WebProviderName, ResearchConfidence> = {
  website: 'MEDIUM',
  manual: 'HIGH',
};
