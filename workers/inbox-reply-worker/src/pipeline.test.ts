import { describe, expect, it, vi, beforeEach } from 'vitest';

const findFirstMessageMock = vi.fn();
const findFirstWorkspaceMock = vi.fn();
const findFirstMailboxMock = vi.fn();
const findManyMessagesMock = vi.fn();
const updateMessageMock = vi.fn();
const transactionMock = vi.fn();

const sendMock = vi.fn(async () => ({ messageId: '<reply@example.com>' }));
const decryptSecretMock = vi.fn(() => 'password');
const createSmtpProviderMock = vi.fn(() => ({ send: sendMock }));

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:4000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'a'.repeat(48),
    ENCRYPTION_KEY: 'a'.repeat(64),
    REDIS_URL: 'redis://localhost:6379',
  }),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    conversationMessage: {
      findFirst: findFirstMessageMock,
      findMany: findManyMessagesMock,
      update: updateMessageMock,
    },
    workspace: {
      findFirst: findFirstWorkspaceMock,
    },
    mailbox: {
      findFirst: findFirstMailboxMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@signalforge/email', () => ({
  decryptSecret: decryptSecretMock,
  createSmtpProvider: createSmtpProviderMock,
}));

vi.mock('@signalforge/inbox', () => ({
  logInboxEvent: vi.fn(),
}));

const basePayload = {
  conversationMessageId: 'msg_out_1',
  workspaceId: 'ws_1',
  mailboxId: 'mb_1',
  conversationId: 'conv_1',
};

const deferredMessage = {
  id: 'msg_out_1',
  workspaceId: 'ws_1',
  conversationId: 'conv_1',
  mailboxId: 'mb_1',
  direction: 'OUTBOUND',
  status: 'DEFERRED',
  subject: 'Re: Hello',
  textBody: 'Thanks for reaching out.',
  htmlBodySanitized: null,
  toRecipients: [{ email: 'lead@example.com' }],
  inReplyTo: '<inbound@example.com>',
};

describe('processInboxReplyJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        conversationMessage: { update: vi.fn(async () => undefined) },
        conversation: { update: vi.fn(async () => undefined) },
        conversationActivity: { create: vi.fn(async () => undefined) },
      }),
    );
  });

  it('returns MESSAGE_NOT_DEFERRED when the outbound message is missing', async () => {
    findFirstMessageMock.mockResolvedValueOnce(null);
    const { processInboxReplyJob } = await import('./pipeline.js');

    const outcome = await processInboxReplyJob(basePayload);

    expect(outcome).toEqual({ ok: false, reason: 'MESSAGE_NOT_DEFERRED' });
    expect(findFirstWorkspaceMock).not.toHaveBeenCalled();
  });

  it('returns WORKSPACE_NOT_FOUND when the workspace does not exist', async () => {
    findFirstMessageMock.mockResolvedValueOnce(deferredMessage);
    findFirstWorkspaceMock.mockResolvedValueOnce(null);
    const { processInboxReplyJob } = await import('./pipeline.js');

    const outcome = await processInboxReplyJob(basePayload);

    expect(outcome).toEqual({ ok: false, reason: 'WORKSPACE_NOT_FOUND' });
  });

  it('returns MISSING_SMTP_CONFIGURATION when mailbox credentials are unavailable', async () => {
    findFirstMessageMock.mockResolvedValueOnce(deferredMessage);
    findFirstWorkspaceMock.mockResolvedValueOnce({ id: 'ws_1' });
    findFirstMailboxMock.mockResolvedValueOnce({ id: 'mb_1', credential: null });
    const { processInboxReplyJob } = await import('./pipeline.js');

    const outcome = await processInboxReplyJob(basePayload);

    expect(outcome).toEqual({ ok: false, reason: 'MISSING_SMTP_CONFIGURATION' });
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: 'msg_out_1' },
      data: { status: 'FAILED' },
    });
  });

  it('sends the reply with thread headers and marks the message as sent', async () => {
    findFirstMessageMock.mockResolvedValueOnce(deferredMessage);
    findFirstWorkspaceMock.mockResolvedValueOnce({ id: 'ws_1' });
    findFirstMailboxMock.mockResolvedValueOnce({
      id: 'mb_1',
      emailAddress: 'sender@example.com',
      fromName: 'Sender',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUsername: 'sender@example.com',
      encryptionType: 'TLS',
      credential: { encryptedPayload: 'enc', keyVersion: 1 },
    });
    findManyMessagesMock.mockResolvedValueOnce([
      { internetMessageId: '<inbound@example.com>', direction: 'INBOUND' },
      { internetMessageId: null, direction: 'OUTBOUND' },
    ]);

    const { processInboxReplyJob } = await import('./pipeline.js');
    const outcome = await processInboxReplyJob(basePayload);

    expect(outcome).toEqual({ ok: true, providerMessageId: '<reply@example.com>' });
    expect(decryptSecretMock).toHaveBeenCalledWith('enc', 'a'.repeat(64));
    expect(createSmtpProviderMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith({
      to: 'lead@example.com',
      subject: 'Re: Hello',
      body: 'Thanks for reaching out.',
      html: undefined,
      inReplyTo: '<inbound@example.com>',
      references: ['<inbound@example.com>'],
    });
    expect(transactionMock).toHaveBeenCalled();
  });
});
