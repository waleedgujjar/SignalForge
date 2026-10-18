import { loadEnv } from '@signalforge/config';
import type { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  type EmailVerificationQueuePayload,
} from '@signalforge/queue';

let verificationQueue: Queue<EmailVerificationQueuePayload> | null = null;

export function getVerificationQueue(): Queue<EmailVerificationQueuePayload> {
  if (!verificationQueue) {
    const env = loadEnv();
    verificationQueue = createQueue<EmailVerificationQueuePayload>(
      QUEUE_NAMES.EMAIL_VERIFICATION,
      createRedisConnection(env.REDIS_URL),
    );
  }
  return verificationQueue;
}
