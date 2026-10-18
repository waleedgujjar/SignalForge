import * as cheerio from 'cheerio';
import type { CrawledPage, ConversionData, Finding } from '../types.js';

const CTA_PATTERNS = [/get started/i, /sign up/i, /free trial/i, /request demo/i, /contact us/i, /book a call/i, /schedule/i, /try free/i, /start now/i, /learn more/i, /buy now/i, /order now/i, /subscribe/i];
const BOOKING_PATTERNS = ['calendly.com', 'hubspot.com/meetings', 'acuityscheduling.com', 'tidycal.com', 'cal.com'];
const CHAT_PATTERNS = ['intercom', 'drift', 'crisp', 'tawk', 'livechat', 'zendesk', 'freshdesk', 'hubspot'];

export function analyzeConversion(pages: CrawledPage[]): ConversionData {
  const findings: Finding[] = [];

  if (pages.length === 0) {
    return {
      findings: [{ category: 'conversion', severity: 'CRITICAL', title: 'No pages to analyze', description: 'No pages available for conversion analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      hasContactForm: false, hasLeadForm: false, ctaCount: 0, hasBookingWidget: false, hasLiveChat: false, hasChatbot: false, hasSocialProof: false, hasTestimonials: false,
    };
  }

  let hasContactForm = false;
  let hasLeadForm = false;
  let ctaCount = 0;
  let hasBookingWidget = false;
  let hasLiveChat = false;
  let hasChatbot = false;
  let hasSocialProof = false;
  let hasTestimonials = false;

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const html = page.html.toLowerCase();

    $('form').each((_, el) => {
      const formHtml = $(el).html()?.toLowerCase() ?? '';
      const hasEmail = formHtml.includes('email') || formHtml.includes('type="email"');
      const hasName = formHtml.includes('name') || formHtml.includes('first') || formHtml.includes('last');
      const hasPhone = formHtml.includes('phone') || formHtml.includes('tel');

      if (hasEmail || hasPhone) {
        if (page.url.toLowerCase().includes('contact') || formHtml.includes('contact') || formHtml.includes('message')) {
          hasContactForm = true;
        } else {
          hasLeadForm = true;
        }
      }
      if (hasEmail && hasName) hasLeadForm = true;
    });

    $('a, button').each((_, el) => {
      const text = $(el).text().trim();
      for (const pattern of CTA_PATTERNS) {
        if (pattern.test(text)) { ctaCount++; break; }
      }
    });

    for (const pattern of BOOKING_PATTERNS) {
      if (html.includes(pattern)) { hasBookingWidget = true; break; }
    }

    for (const pattern of CHAT_PATTERNS) {
      if (html.includes(pattern)) {
        hasLiveChat = true;
        if (pattern === 'intercom' || pattern === 'drift' || pattern === 'crisp') hasChatbot = true;
        break;
      }
    }

    const bodyText = $('body').text().toLowerCase();
    if (bodyText.includes('testimonial') || bodyText.includes('what our clients say') || bodyText.includes('customer review') || bodyText.includes('client says')) {
      hasTestimonials = true;
    }

    if ($('.logo-wall, .client-logos, .partner-logos, .trust-badges').length > 0 ||
        bodyText.includes('trusted by') || bodyText.includes('as seen') || bodyText.includes('featured in')) {
      hasSocialProof = true;
    }
  }

  if (!hasContactForm && !hasLeadForm) {
    findings.push({ category: 'conversion', severity: 'HIGH', title: 'No lead capture forms', description: 'No contact or lead capture forms detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  if (ctaCount === 0) {
    findings.push({ category: 'conversion', severity: 'HIGH', title: 'No calls-to-action', description: 'No CTA buttons detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  } else if (ctaCount < 3) {
    findings.push({ category: 'conversion', severity: 'MEDIUM', title: 'Few CTAs', description: `Only ${ctaCount} CTA(s) found across ${pages.length} page(s).`, confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  if (!hasLiveChat) {
    findings.push({ category: 'conversion', severity: 'LOW', title: 'No live chat', description: 'No live chat widget detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  if (!hasTestimonials && !hasSocialProof) {
    findings.push({ category: 'conversion', severity: 'MEDIUM', title: 'No social proof', description: 'No testimonials, reviews, or client logos detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  return { findings, hasContactForm, hasLeadForm, ctaCount, hasBookingWidget, hasLiveChat, hasChatbot, hasSocialProof, hasTestimonials };
}
