import { describe, expect, it } from 'vitest';
import { renderWarmupTemplate, templateCount } from './templates.js';

describe('renderWarmupTemplate', () => {
  it('renders subject and body without leaving placeholder tokens', () => {
    const template = renderWarmupTemplate({
      slotIndex: 0,
      fromName: 'Sam Sender',
      fromEmail: 'sam@example.com',
      recipientName: 'Casey Recipient',
      sentDate: new Date('2026-01-05T12:00:00Z'),
    });
    expect(template.subject).toContain('Sam Sender');
    expect(template.body).toContain('Casey');
    expect(template.body).not.toMatch(/\{\{.*\}\}/);
  });

  it('handles null recipient name gracefully', () => {
    const template = renderWarmupTemplate({
      slotIndex: 1,
      fromName: 'Sam Sender',
      fromEmail: 'sam@example.com',
      recipientName: null,
      sentDate: new Date('2026-01-05T12:00:00Z'),
    });
    expect(template.body).not.toMatch(/\{\{.*\}\}/);
    expect(template.body.toLowerCase()).toContain('hi');
  });

  it('rotates through the available templates', () => {
    const t1 = renderWarmupTemplate({
      slotIndex: 0,
      fromName: 'F',
      fromEmail: 'f@example.com',
      recipientName: null,
      sentDate: new Date(),
    });
    const t2 = renderWarmupTemplate({
      slotIndex: 1,
      fromName: 'F',
      fromEmail: 'f@example.com',
      recipientName: null,
      sentDate: new Date(),
    });
    expect(t1.subject).not.toBe(t2.subject);
    expect(templateCount()).toBeGreaterThan(1);
  });
});
