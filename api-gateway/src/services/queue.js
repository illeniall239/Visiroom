const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

// Upstash requires rediss:// (with an s) for TLS connections
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  // Recommended settings for Upstash/remote redis to prevent connection drops
  enableReadyCheck: false,
  keepAlive: 10000 
});

// The generation queue
const generationQueue = new Queue('generation-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s → 4s → 8s between retries
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});

/**
 * Add a job to the generation queue
 * @param {string} jobId 
 * @param {object} jobData 
 * @param {number} priority 
 */
async function enqueueGenerationJob(jobId, jobData, priority = 3) {
  // Priority: 1 (highest) to 3 (lowest)
  // timeout: 120s — Google AI generation can take 30-60s; 30s was too short
  // and would time out the job before the AI call finished.
  await generationQueue.add('generate-image', jobData, {
    jobId,
    priority,
    timeout: 120000
  });
}

module.exports = {
  redisConnection,
  generationQueue,
  enqueueGenerationJob
};