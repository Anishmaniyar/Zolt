import { Queue } from 'bullmq';
import { workerRedisConnection } from '../workers/worker.js'; // adjust if your path is different

const testQueue = new Queue('jobs', { connection: workerRedisConnection });

async function spamJobs() {
  console.log('🚀 Pushing 10 test jobs with valid UUID syntax...');

  for (let i = 1; i <= 10; i++) {
    // Generates valid UUID syntax (e.g. 00000000-0000-0000-0000-000000000001)
    const mockUuid = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;

    await testQueue.add('execute-job', { jobId: mockUuid });
  }

  console.log('✅ All 10 jobs added successfully!');
  process.exit(0);
}

spamJobs();
