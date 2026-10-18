import type {
  DeliverabilityProtectionLevel,
  DeliveryCounters,
  DeliveryRates,
  DnsCheckStatus,
  DomainAuthResult,
} from './types.js';

/**
 * Rule-based recommendations.
 *
 * Every string here is emitted only when a specific measured signal is present,
 * so the UI never shows boilerplate advice on a healthy mailbox.
 */

export interface RecommendationInput {
  counters: DeliveryCounters;
  rates: DeliveryRates;
  level: DeliverabilityProtectionLevel;
}

export function buildRecommendations(input: RecommendationInput): string[] {
  const recommendations: string[] = [];
  const { counters, rates, level } = input;

  if (counters.hardBounces > 0) {
    recommendations.push(
      'Review recently imported leads — hard bounces usually indicate stale or unverified contact data.',
    );
    recommendations.push('Verify email addresses before enrolling them in a campaign.');
  }
  if (counters.softBounces >= 3) {
    recommendations.push(
      'Several recipients are failing temporarily. Check whether those mailboxes are full or the receiving domain is throttling.',
    );
  }
  if (rates.failureRate > 0 && counters.failed > 0) {
    recommendations.push(
      'Investigate recent send failures in the mailbox activity log; repeated SMTP errors often point to credentials or connection limits.',
    );
  }
  if (rates.unsubscribeRate > 0 && counters.unsubscribes > 0) {
    recommendations.push(
      'Review targeting and message relevance for this segment — unsubscribes are being recorded.',
    );
  }
  if (level === 'CRITICAL') {
    recommendations.push('Reduce sending volume temporarily until bounce and failure rates recover.');
  }
  if (counters.attempted > 0 && counters.uniqueRepliedLeads === 0) {
    recommendations.push('No replies recorded in this period — review subject lines and targeting.');
  }

  return recommendations;
}

export function buildDomainRecommendations(
  domain: Pick<DomainAuthResult, 'domain' | 'spfStatus' | 'dkimStatus' | 'dmarcStatus' | 'mxStatus'>,
): string[] {
  const recommendations: string[] = [];
  const needsAttention = (status: DnsCheckStatus) => status === 'FAIL' || status === 'INVALID';

  if (needsAttention(domain.spfStatus)) {
    recommendations.push(
      `Check the SPF configuration for ${domain.domain} — publish a single v=spf1 TXT record that authorizes your sending provider.`,
    );
  }
  if (needsAttention(domain.dkimStatus)) {
    recommendations.push(
      `Check the DKIM configuration for ${domain.domain} — publish the selector TXT record supplied by your provider.`,
    );
  }
  if (domain.dkimStatus === 'UNKNOWN') {
    recommendations.push(
      `Add a DKIM selector for ${domain.domain} so authentication can be verified. Without a selector DKIM cannot be checked.`,
    );
  }
  if (needsAttention(domain.dmarcStatus)) {
    recommendations.push(
      `Check the DMARC configuration for ${domain.domain} — publish a _dmarc TXT record with an explicit policy.`,
    );
  }
  if (needsAttention(domain.mxStatus)) {
    recommendations.push(`No MX records resolved for ${domain.domain}; confirm the domain can receive mail.`);
  }

  return recommendations;
}
