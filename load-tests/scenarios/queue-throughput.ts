import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://:signalforge-redis@localhost:6380';

interface ThroughputResult {
  queueName: string;
  jobCount: number;
  enqueueTimeMs: number;
  drainTimeMs: number | null;
  jobsPerSecond: number | null;
  timedOut: boolean;
}

async function measureThroughput(
  queueName: string,
  jobCount: number,
  timeoutMs = 120_000,
): Promise<ThroughputResult> {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection });
  const queueEvents = new QueueEvents(queueName, { connection: connection.duplicate() });

  // Clean queue first
  await queue.obliterate({ force: true });

  console.log(`  Injecting ${jobCount} jobs into '${queueName}'...`);
  const enqueueStart = Date.now();

  const jobs = Array.from({ length: jobCount }, (_, i) => ({
    name: queueName,
    data: {
      workspaceId: 'perf-ws-001',
      leadId: `perf-lead-${String(i + 1).padStart(4, '0')}`,
      index: i,
    },
  }));
  await queue.addBulk(jobs);
  const enqueueTimeMs = Date.now() - enqueueStart;

  console.log(`  Enqueued in ${enqueueTimeMs}ms. Waiting for drain (timeout ${timeoutMs / 1000}s)...`);

  // Wait for all jobs to complete
  const drainStart = Date.now();
  let completed = 0;
  let timedOut = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);

      queueEvents.on('completed', () => {
        completed++;
        if (completed >= jobCount) {
          clearTimeout(timer);
          resolve();
        }
      });

      queueEvents.on('failed', ({ failedReason }) => {
        completed++;
        console.warn(`  Job failed: ${failedReason}`);
        if (completed >= jobCount) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } catch {
    timedOut = true;
  }

  const drainTimeMs = timedOut ? null : Date.now() - drainStart;
  const jobsPerSecond = drainTimeMs ? jobCount / (drainTimeMs / 1000) : null;

  await queueEvents.close();
  await queue.close();
  await connection.quit();

  return { queueName, jobCount, enqueueTimeMs, drainTimeMs, jobsPerSecond, timedOut };
}

async function run() {
  console.log('=== Queue Throughput Test ===');
  console.log(`Redis: ${REDIS_URL}`);
  console.log('');

  const tests: Array<{ queue: string; counts: number[] }> = [
    { queue: 'campaign-enrollment', counts: [50, 200, 500] },
    { queue: 'email-send', counts: [50, 200, 500] },
    { queue: 'email-verification', counts: [50, 200] },
  ];

  const results: ThroughputResult[] = [];

  for (const test of tests) {
    console.log(`--- ${test.queue} ---`);
    for (const count of test.counts) {
      const result = await measureThroughput(test.queue, count);
      results.push(result);

      if (result.timedOut) {
        console.log(`  ${count} jobs: TIMED OUT (enqueue: ${result.enqueueTimeMs}ms)`);
      } else {
        console.log(
          `  ${count} jobs: ${result.drainTimeMs}ms drain, ${result.jobsPerSecond?.toFixed(1)} jobs/sec`,
        );
      }
    }
    console.log('');
  }

  console.log('=== Results Summary ===');
  console.log('Queue                   | Jobs | Enqueue(ms) | Drain(ms) | Jobs/sec');
  console.log('------------------------|------|-------------|-----------|--------');
  for (const r of results) {
    const drain = r.timedOut ? 'TIMEOUT' : String(r.drainTimeMs);
    const jps = r.jobsPerSecond ? r.jobsPerSecond.toFixed(1) : 'N/A';
    console.log(
      `${r.queueName.padEnd(24)}| ${String(r.jobCount).padEnd(5)}| ${String(r.enqueueTimeMs).padEnd(12)}| ${drain.padEnd(10)}| ${jps}`,
    );
  }
}

run().catch((err) => {
  console.error('Queue throughput test failed:', err);
  process.exit(1);
});
