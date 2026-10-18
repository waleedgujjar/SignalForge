import { describe, expect, it } from 'vitest';
import { mapReplyToStopReason } from './reply-actions.js';

describe('mapReplyToStopReason', () => {
  it('maps unsubscribe to UNSUBSCRIBED', () => {
    expect(mapReplyToStopReason('UNSUBSCRIBE')).toBe('UNSUBSCRIBED');
  });

  it('maps negative classifications', () => {
    expect(mapReplyToStopReason('NOT_INTERESTED')).toBe('NEGATIVE_REPLY');
    expect(mapReplyToStopReason('WRONG_PERSON')).toBe('NEGATIVE_REPLY');
  });

  it('maps positive classifications', () => {
    expect(mapReplyToStopReason('INTERESTED')).toBe('POSITIVE_REPLY');
    expect(mapReplyToStopReason('QUESTION')).toBe('POSITIVE_REPLY');
  });

  it('maps unknown replies to REPLIED', () => {
    expect(mapReplyToStopReason('UNKNOWN')).toBe('REPLIED');
    expect(mapReplyToStopReason('NEUTRAL')).toBe('REPLIED');
  });
});
