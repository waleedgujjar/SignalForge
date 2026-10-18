import * as cheerio from 'cheerio';
import type { CrawledPage, AISignalsData, Finding } from '../types.js';

const CHATBOT_PATTERNS = ['intercom', 'drift', 'crisp', 'tidio', 'chatfuel', 'manychat', 'dialogflow', 'watson-assistant', 'ada.cx', 'landbot'];
const AI_PATTERNS = ['openai', 'chatgpt', 'copilot', 'ai-powered', 'artificial intelligence', 'machine learning', 'gpt', 'llm'];
const CRM_PATTERNS = ['hubspot', 'salesforce', 'pipedrive', 'zoho', 'freshsales', 'close.com'];
const SCHEDULING_PATTERNS = ['calendly', 'acuityscheduling', 'hubspot.com/meetings', 'cal.com', 'tidycal', 'savvycal', 'zcal'];
const KB_PATTERNS = ['help-center', 'knowledge-base', 'helpdesk', 'support-center', '/help', '/faq', '/docs', 'gitbook', 'readme.io', 'notion.site'];
const PORTAL_PATTERNS = ['customer-portal', 'client-portal', 'my-account', '/dashboard', '/portal', '/app'];

export function analyzeAISignals(pages: CrawledPage[]): AISignalsData {
  const findings: Finding[] = [];

  if (pages.length === 0) {
    return {
      findings: [{ category: 'ai-signals', severity: 'INFO', title: 'No pages to analyze', description: 'No pages available for AI signals analysis.', confidence: 'HIGH', source: 'DETERMINISTIC' }],
      hasChatbot: false, hasAIAssistant: false, hasCRMForms: false, hasScheduling: false, hasKnowledgeBase: false, hasCustomerPortal: false,
    };
  }

  let hasChatbot = false;
  let hasAIAssistant = false;
  let hasCRMForms = false;
  let hasScheduling = false;
  let hasKnowledgeBase = false;
  let hasCustomerPortal = false;

  for (const page of pages) {
    const html = page.html.toLowerCase();
    const $ = cheerio.load(page.html);
    const bodyText = $('body').text().toLowerCase();

    for (const p of CHATBOT_PATTERNS) {
      if (html.includes(p)) { hasChatbot = true; break; }
    }

    for (const p of AI_PATTERNS) {
      if (html.includes(p) || bodyText.includes(p)) { hasAIAssistant = true; break; }
    }

    for (const p of CRM_PATTERNS) {
      if (html.includes(p)) { hasCRMForms = true; break; }
    }

    for (const p of SCHEDULING_PATTERNS) {
      if (html.includes(p)) { hasScheduling = true; break; }
    }

    for (const p of KB_PATTERNS) {
      if (html.includes(p) || page.url.toLowerCase().includes('/help') || page.url.toLowerCase().includes('/faq')) {
        hasKnowledgeBase = true; break;
      }
    }

    for (const p of PORTAL_PATTERNS) {
      if (html.includes(p)) { hasCustomerPortal = true; break; }
    }
  }

  if (!hasChatbot) {
    findings.push({ category: 'ai-signals', severity: 'INFO', title: 'No chatbot detected', description: 'No chatbot or conversational widget found.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  if (!hasScheduling) {
    findings.push({ category: 'ai-signals', severity: 'INFO', title: 'No scheduling tool', description: 'No online scheduling/booking integration detected.', confidence: 'MEDIUM', source: 'HEURISTIC' });
  }

  if (!hasCRMForms) {
    findings.push({ category: 'ai-signals', severity: 'INFO', title: 'No CRM integration', description: 'No CRM form integration detected.', confidence: 'LOW', source: 'HEURISTIC' });
  }

  return { findings, hasChatbot, hasAIAssistant, hasCRMForms, hasScheduling, hasKnowledgeBase, hasCustomerPortal };
}
