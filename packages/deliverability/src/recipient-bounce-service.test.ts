import { describe, expect, it } from 'vitest';

import { evaluateRecipientStatus, normalizeEmail } from './recipient-bounce-service.js';
import { DEFAULT_THRESHOLDS } from './types.js';

const thresholds = {
  softBounceThreshold: DEFAULT_THRESHOLDS.softBounceThreshold,
  softBounceSuppressThreshold: DEFAULT_THRESHOLDS.softBounceSuppressThreshold,
};

describe('normalizeEmail', () => {
  it('lowercases and trims so a recipient is tracked once', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com');
  });
});

describe('evaluateRecipientStatus', () => {
  it('suppresses immediately on a single hard bounce', () => {
    expect(evaluateRecipientStatus({ softBounceCount: 0, hardBounceCount: 1 }, thresholds)).toBe(
      'SUPPRESSED',
    );
  });

  it('keeps a recipient active below the soft bounce threshold', () => {
    expect(evaluateRecipientStatus({ softBounceCount: 2, hardBounceCount: 0 }, thresholds)).toBe(
      'ACTIVE',
    );
  });

  it('marks a recipient at risk at the soft bounce threshold', () => {
    expect(evaluateRecipientStatus({ softBounceCount: 3, hardBounceCount: 0 }, thresholds)).toBe(
      'AT_RISK',
    );
  });

  it('suppresses after repeated soft bounces', () => {
    expect(evaluateRecipientStatus({ softBounceCount: 6, hardBounceCount: 0 }, thresholds)).toBe(
      'SUPPRESSED',
    );
  });

  it('never suppresses on soft bounces when the suppress threshold is disabled', () => {
    expect(
      evaluateRecipientStatus(
        { softBounceCount: 50, hardBounceCount: 0 },
        { softBounceThreshold: 3, softBounceSuppressThreshold: 0 },
      ),
    ).toBe('AT_RISK');
  });
});
