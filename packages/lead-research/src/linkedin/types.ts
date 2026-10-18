/// LinkedIn-specific shapes: the structured data a provider may fill, the
/// provider names, health results and the per-provider confidence ceiling.

import type { ResearchConfidence } from '@signalforge/database';

import type { ProviderAuthenticationStatus, ProviderHealthStatus } from '../types.js';

export type LinkedInProviderName = 'manual' | 'public' | 'agent-reach' | 'authorized-api';

/// Only fields that are actually observed are set — nothing is fabricated and
/// nothing derived from a name (no emails, phones, follower counts, revenue).
export interface LinkedInCompanyData {
  name?: string;
  url?: string;
  tagline?: string;
  industry?: string;
  location?: string;
  employeeRange?: string;
  website?: string;
}

export interface LinkedInPersonData {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  company?: string;
  location?: string;
  profileUrl?: string;
}

export interface LinkedInSignals {
  decisionMaker?: boolean;
  hiring?: boolean;
  growthSignal?: boolean;
  technologySignal?: boolean;
}

export interface LinkedInResearchData {
  company?: LinkedInCompanyData;
  person?: LinkedInPersonData;
  signals?: LinkedInSignals;
  source?: {
    platform: 'linkedin';
    url: string | null;
    retrievedAt: string;
  };
}

export interface ProviderHealth {
  provider: LinkedInProviderName;
  displayName: string;
  status: ProviderHealthStatus;
  authentication: ProviderAuthenticationStatus;
  /// ISO timestamp.
  checkedAt: string;
  /// Sanitized, bounded lines for the settings page. Never env values.
  details: string[];
}

/// Everything the settings screen needs to render the provider list.
export interface ProviderDescriptor {
  provider: LinkedInProviderName;
  displayName: string;
  /// An adapter exists and can run.
  implemented: boolean;
  /// Flags/config present, so it can run right now.
  configured: boolean;
  note?: string;
}

/// A provider can never report more confidence than its evidence deserves:
/// public pages are unauthenticated reads (at most MEDIUM, and INFERRED until a
/// human marks them); manual entry and a partner API are first-hand.
export const PROVIDER_MAX_CONFIDENCE: Record<LinkedInProviderName, ResearchConfidence> = {
  manual: 'HIGH',
  public: 'MEDIUM',
  'agent-reach': 'MEDIUM',
  'authorized-api': 'HIGH',
};
