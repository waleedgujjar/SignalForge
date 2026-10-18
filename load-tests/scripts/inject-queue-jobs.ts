import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://:signalforge-redis@localhost:6380';
const QUEUE_NAME = process.argv[2] ?? 'email-verification';
const JOB_COUNT = parseInt(process.argv[3] ?? '100', 10);
const BATCH_SIZE = parseInt(process.argv[4] ?? '50', 10);

async function inject() {
  console.log(`Injecting ${JOB_COUNT} jobs into queue '${QUEUE_NAME}'...`);

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });

  const start = Date.now();

  for (let batch = 0; batch < JOB_COUNT; batch += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, JOB_COUNT - batch);
    const jobs = Array.from({ length: size }, (_, i) => ({
      name: QUEUE_NAME,
      data: {
        workspaceId: 'perf-ws-001',
        leadId: `perf-lead-${String(batch + i + 1).padStart(4, '0')}`,
        timestamp: Date.now(),
        index: batch + i,
      },
    }));

    await queue.addBulk(jobs);
    process.stdout.write(`  Enqueued: ${Math.min(batch + BATCH_SIZE, JOB_COUNT)}/${JOB_COUNT}\r`);
  }

  const enqueueTime = Date.now() - start;
  const depth = await queue.getJobCountByTypes('waiting', 'active', 'delayed');

  const redisInfo = await connection.info('memory');
  const memLine = redisInfo.split('\n').find((l) => l.startsWith('used_memory_human:'));
  const redisMem = memLine?.split(':')[1]?.trim() ?? 'unknown';

  console.log('');
  console.log('=== Injection Complete ===');
  console.log(`  Queue: ${QUEUE_NAME}`);
  console.log(`  Jobs injected: ${JOB_COUNT}`);
  console.log(`  Enqueue time: ${enqueueTime}ms (${(JOB_COUNT / (enqueueTime / 1000)).toFixed(0)} jobs/sec)`);
  console.log(`  Queue depth: ${depth}`);
  console.log(`  Redis memory: ${redisMem}`);

  await queue.close();
  await connection.quit();
}

inject().catch((err) => {
  console.error('Injection failed:', err);
  process.exit(1);
});
