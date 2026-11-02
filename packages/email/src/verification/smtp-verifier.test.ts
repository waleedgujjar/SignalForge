import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyRcptReply,
  isSmtpUnavailable,
  noteReachable,
  noteUnreachable,
  resetSmtpStateForTests,
} from './smtp-verifier.js';

describe('classifyRcptReply', () => {
  it.each([
    // Real-world replies, by provider.
    [250, '2.1.5 OK x1si123 - gsmtp', 'ACCEPTED'],
    [251, 'User not local; will forward', 'ACCEPTED'],
    [550, "5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address", 'REJECTED'],
    [550, '5.4.1 Recipient address rejected: Access denied. AS(201806281)', 'REJECTED'],
    [550, '5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup', 'REJECTED'],
    [550, 'No such user here', 'REJECTED'],
    [553, 'sorry, that domain isn\'t in my list of allowed rcpthosts', 'UNKNOWN'],
    [550, '5.7.1 Service unavailable, Client host [1.2.3.4] blocked using Spamhaus', 'BLOCKED'],
    [554, '5.7.1 Message rejected due to poor IP reputation', 'BLOCKED'],
    [550, '5.2.1 The email account that you tried to reach is disabled', 'REJECTED'],
    [552, '5.2.2 The email account that you tried to reach is over quota', 'MAILBOX_FULL'],
    [452, '4.2.2 Mailbox full', 'MAILBOX_FULL'],
    [450, '4.2.0 Greylisted, please try again later', 'TEMPORARY_FAILURE'],
    [421, '4.7.0 Try again later, closing connection', 'TEMPORARY_FAILURE'],
    [550, 'Requested action not taken', 'UNKNOWN'],
  ] as const)('%i %s -> %s', (code, text, expected) => {
    expect(classifyRcptReply({ code, text })).toBe(expected);
  });
});

describe('port 25 circuit breaker', () => {
  beforeEach(() => resetSmtpStateForTests());

  it('trips when several hosts fail and none has answered (port blocked)', () => {
    for (const host of ['a.mx', 'b.mx', 'c.mx', 'd.mx']) noteUnreachable(host);
    expect(isSmtpUnavailable()).toBe(false);
    noteUnreachable('e.mx');
    expect(isSmtpUnavailable()).toBe(true);
  });

  it('never trips while another mail server has answered recently', () => {
    // e.g. Gmail answered, then a batch of slow small-business hosts timed out.
    noteReachable();
    for (let i = 0; i < 20; i++) noteUnreachable(`slow${i}.mx`);
    expect(isSmtpUnavailable()).toBe(false);
  });

  it('trips again once the last success is old', () => {
    noteReachable(Date.now() - 31 * 60 * 1000);
    for (let i = 0; i < 5; i++) noteUnreachable(`h${i}.mx`);
    expect(isSmtpUnavailable()).toBe(true);
  });

  it('counts the same host once', () => {
    for (let i = 0; i < 10; i++) noteUnreachable('same.mx');
    expect(isSmtpUnavailable()).toBe(false);
  });
});
