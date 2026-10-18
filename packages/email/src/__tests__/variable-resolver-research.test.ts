import { describe, expect, it } from 'vitest';
import { resolveVariables, leadToVariableContext } from '../variable-resolver.js';

describe('research namespace in variable resolver', () => {
  const baseContext = {
    email: 'test@example.com',
    first_name: 'Jane',
    research: {
      company_description: 'A SaaS platform for HR analytics',
      services: 'Payroll, Benefits, Recruiting',
      service_area: 'North America',
      specializations: 'Enterprise HR, Analytics',
    },
  };

  it('resolves {{research.company_description}}', () => {
    const result = resolveVariables('About: {{research.company_description}}', baseContext);
    expect(result.text).toBe('About: A SaaS platform for HR analytics');
    expect(result.hasUnresolved).toBe(false);
  });

  it('resolves {{research.services}}', () => {
    const result = resolveVariables('Services: {{research.services}}', baseContext);
    expect(result.text).toBe('Services: Payroll, Benefits, Recruiting');
  });

  it('resolves {{research.service_area}}', () => {
    const result = resolveVariables('Area: {{research.service_area}}', baseContext);
    expect(result.text).toBe('Area: North America');
  });

  it('resolves {{research.specializations}}', () => {
    const result = resolveVariables('Spec: {{research.specializations}}', baseContext);
    expect(result.text).toBe('Spec: Enterprise HR, Analytics');
  });

  it('uses fallback when research variable is missing', () => {
    const result = resolveVariables(
      'Services: {{research.services|your services}}',
      { ...baseContext, research: {} },
    );
    expect(result.text).toBe('Services: your services');
    expect(result.hasUnresolved).toBe(false);
  });

  it('reports unresolved when no fallback and no value', () => {
    const result = resolveVariables('Services: {{research.services}}', {
      ...baseContext,
      research: {},
    });
    expect(result.hasUnresolved).toBe(true);
    expect(result.missingVariables).toContain('{{research.services}}');
  });

  it('resolves without research context', () => {
    const result = resolveVariables('Hi {{first_name}}', { ...baseContext, research: undefined });
    expect(result.text).toBe('Hi Jane');
    expect(result.hasUnresolved).toBe(false);
  });
});

describe('leadToVariableContext — research extraction', () => {
  it('extracts research data from structuredData', () => {
    const ctx = leadToVariableContext({
      email: 'test@example.com',
      firstName: 'Jane',
      research: [
        {
          structuredData: {
            company: {
              description: 'Cloud hosting platform',
              services: ['Hosting', 'DNS', 'CDN'],
              serviceArea: 'Global',
              specializations: ['Edge computing', 'Serverless'],
            },
          },
        },
      ],
    });

    expect(ctx.research).toEqual({
      company_description: 'Cloud hosting platform',
      services: 'Hosting, DNS, CDN',
      service_area: 'Global',
      specializations: 'Edge computing, Serverless',
    });
  });

  it('returns null values when company data is missing', () => {
    const ctx = leadToVariableContext({
      email: 'test@example.com',
      research: [{ structuredData: {} }],
    });

    expect(ctx.research).toEqual({});
  });

  it('returns empty research when no research records exist', () => {
    const ctx = leadToVariableContext({
      email: 'test@example.com',
      research: [],
    });

    expect(ctx.research).toEqual({});
  });

  it('returns empty research when research is null', () => {
    const ctx = leadToVariableContext({
      email: 'test@example.com',
      research: null,
    });

    expect(ctx.research).toEqual({});
  });
});

describe('AI namespace in variable resolver', () => {
  it('resolves {{ai.pain_point}} from context', () => {
    const result = resolveVariables('Pain: {{ai.pain_point}}', {
      ai: { pain_point: 'Manual data entry' },
    });
    expect(result.text).toBe('Pain: Manual data entry');
    expect(result.hasUnresolved).toBe(false);
  });

  it('resolves {{ai.personalization_hook}}', () => {
    const result = resolveVariables('Hook: {{ai.personalization_hook}}', {
      ai: { personalization_hook: 'Your recent expansion into APAC' },
    });
    expect(result.text).toBe('Hook: Your recent expansion into APAC');
  });

  it('resolves {{ai.outreach_angle}}', () => {
    const result = resolveVariables('Angle: {{ai.outreach_angle}}', {
      ai: { outreach_angle: 'Cost reduction through automation' },
    });
    expect(result.text).toBe('Angle: Cost reduction through automation');
  });

  it('resolves AI variables from leadToVariableContext', () => {
    const ctx = leadToVariableContext({
      email: 'test@example.com',
      enrichment: {
        dynamicVariables: {
          pain_point: 'Slow onboarding',
          recommended_service: 'Onboarding automation',
          top_opportunity: 'Self-service portal',
        },
      },
    });

    expect(ctx.ai).toEqual({
      pain_point: 'Slow onboarding',
      recommended_service: 'Onboarding automation',
      top_opportunity: 'Self-service portal',
    });
  });
});
