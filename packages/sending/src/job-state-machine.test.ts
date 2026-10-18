import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, isActive, isTerminal } from './job-state-machine.js';

describe('canTransition', () => {
  it('allows PENDING -> SCHEDULED', () => {
    expect(canTransition('PENDING', 'SCHEDULED')).toBe(true);
  });

  it('allows SCHEDULED -> PROCESSING', () => {
    expect(canTransition('SCHEDULED', 'PROCESSING')).toBe(true);
  });

  it('allows PROCESSING -> SENT', () => {
    expect(canTransition('PROCESSING', 'SENT')).toBe(true);
  });

  it('allows PROCESSING -> RETRYING for transient failures', () => {
    expect(canTransition('PROCESSING', 'RETRYING')).toBe(true);
  });

  it('rejects transitions out of terminal SENT', () => {
    expect(canTransition('SENT', 'SCHEDULED')).toBe(false);
    expect(canTransition('SENT', 'CANCELLED')).toBe(false);
  });

  it('rejects transitions out of CANCELLED', () => {
    expect(canTransition('CANCELLED', 'SCHEDULED')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws for invalid transitions', () => {
    expect(() => assertTransition('SENT', 'PENDING')).toThrow();
  });

  it('does not throw for valid transitions', () => {
    expect(() => assertTransition('PAUSED', 'SCHEDULED')).not.toThrow();
  });
});

describe('isTerminal / isActive', () => {
  it('marks SENT and CANCELLED as terminal', () => {
    expect(isTerminal('SENT')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(false);
  });

  it('marks in-flight states as active', () => {
    expect(isActive('PENDING')).toBe(true);
    expect(isActive('SCHEDULED')).toBe(true);
    expect(isActive('PROCESSING')).toBe(true);
    expect(isActive('RETRYING')).toBe(true);
    expect(isActive('SENT')).toBe(false);
  });
});
