export interface WarmupTemplate {
  subject: string;
  body: string;
}

/**
 * Simple neutral templates used to establish normal sending patterns on a new
 * mailbox. These messages are intentionally short, do not solicit engagement,
 * and do not include tracking pixels or links. Recipients are authorized
 * warmup partners who consented to receive them.
 */
const TEMPLATES: WarmupTemplate[] = [
  {
    subject: 'Warmup check-in from {{fromName}}',
    body: [
      'Hi{{recipientNameSuffix}},',
      '',
      'This is a warmup message from {{fromName}}. It helps establish a normal',
      'sending pattern for a newly connected mailbox. No response is needed.',
      '',
      'Sent {{sentDate}}',
    ].join('\n'),
  },
  {
    subject: 'Mailbox warmup update — {{sentDate}}',
    body: [
      'Hi{{recipientNameSuffix}},',
      '',
      'You are receiving this as part of an authorized email warmup process.',
      'It confirms that outbound sending from {{fromEmail}} is healthy.',
      '',
      'Thanks for helping.',
    ].join('\n'),
  },
  {
    subject: 'Routine warmup ping',
    body: [
      'Hi{{recipientNameSuffix}},',
      '',
      'Nothing to do here — just a routine warmup message from {{fromEmail}}.',
      'These messages help build steady sending history over time.',
      '',
      '{{fromName}}',
    ].join('\n'),
  },
];

export interface RenderTemplateInput {
  slotIndex: number;
  fromName: string;
  fromEmail: string;
  recipientName: string | null;
  sentDate: Date;
}

export function renderWarmupTemplate(input: RenderTemplateInput): WarmupTemplate {
  const template = TEMPLATES[input.slotIndex % TEMPLATES.length] ?? TEMPLATES[0]!;
  const nameSuffix = input.recipientName ? ` ${input.recipientName.split(' ')[0]}` : '';
  const sentDate = input.sentDate.toISOString().slice(0, 10);
  const replace = (value: string) =>
    value
      .replaceAll('{{fromName}}', input.fromName)
      .replaceAll('{{fromEmail}}', input.fromEmail)
      .replaceAll('{{recipientNameSuffix}}', nameSuffix)
      .replaceAll('{{sentDate}}', sentDate);
  return { subject: replace(template.subject), body: replace(template.body) };
}

export function templateCount(): number {
  return TEMPLATES.length;
}
