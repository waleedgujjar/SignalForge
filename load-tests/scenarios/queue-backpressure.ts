import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://:signalforge-redis@localhost:6380';
const QUEUE_NAME = process.argv[2] ?? 'email-verification';
const TOTAL_JOBS = parseInt(process.argv[3] ?? '1000', 10);
const INJECT_RATE = parseInt(process.argv[4] ?? '50', 10); // jobs per batch
const INTERVAL_MS = parseInt(process.argv[5] ?? '1000', 10); // ms between batches

async function backpressureTest() {
  console.log('=== Queue Backpressure Test ===');
  console.log(`Queue: ${QUEUE_NAME}`);
  console.log(`Total jobs: ${TOTAL_JOBS}, Rate: ${INJECT_RATE} jobs every ${INTERVAL_MS}ms`);
  console.log('');

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });

  let injected = 0;
  const snapshots: Array<{
    time: number;
    injected: number;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    redisMem: string;
  }> = [];

  const startTime = Date.now();

  while (injected < TOTAL_JOBS) {
    const batchSize = Math.min(INJECT_RATE, TOTAL_JOBS - injected);
    const jobs = Array.from({ length: batchSize }, (_, i) => ({
      name: QUEUE_NAME,
      data: {
        workspaceId: 'perf-ws-001',
        leadId: `perf-lead-${String(injected + i + 1).padStart(4, '0')}`,
        index: injected + i,
      },
    }));

    await queue.addBulk(jobs);
    injected += batchSize;

    // Snapshot queue state
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getJobCountByTypes('waiting'),
      queue.getJobCountByTypes('active'),
      queue.getJobCountByTypes('completed'),
      queue.getJobCountByTypes('failed'),
    ]);

    const redisInfo = await connection.info('memory');
    const memLine = redisInfo.split('\n').find((l) => l.startsWith('used_memory_human:'));
    const redisMem = memLine?.split(':')[1]?.trim() ?? 'unknown';

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    snapshots.push({
      time: Date.now() - startTime,
      injected,
      waiting,
      active,
      completed,
      failed,
      redisMem,
    });

    console.log(
      `  [${elapsed}s] injected=${injected} waiting=${waiting} active=${active} completed=${completed} failed=${failed} redis=${redisMem}`,
    );

    if (injected < TOTAL_JOBS) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  // Wait a bit for drain
  console.log('');
  console.log('  Waiting 30s for workers to drain...');
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getJobCountByTypes('waiting'),
      queue.getJobCountByTypes('active'),
      queue.getJobCountByTypes('completed'),
      queue.getJobCountByTypes('failed'),
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `  [${elapsed}s] waiting=${waiting} active=${active} completed=${completed} failed=${failed}`,
    );

    if (waiting === 0 && active === 0) break;
  }

  console.log('');
  console.log('=== Backpressure Test Complete ===');
  console.log(`  Total injected: ${injected}`);
  console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`  Peak waiting: ${Math.max(...snapshots.map((s) => s.waiting))}`);

  await queue.close();
  await connection.quit();
}

backpressureTest().catch((err) => {
  console.error('Backpressure test failed:', err);
  process.exit(1);
});
