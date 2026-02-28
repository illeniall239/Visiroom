const { Worker } = require('bullmq');
const { redisConnection } = require('../services/queue');
const { executeGeneration } = require('../services/ai');
const { supabase } = require('../services/supabase');
const { logger } = require('../services/logger');

// Function to start the worker.
// generationMap: Map<generationId, socketId> — maintained by index.js.
// When a client reconnects after a cold-start drop, it emits 'rejoin' and
// the gateway updates this map. The worker always looks up the CURRENT
// socketId at emit time rather than using the stale one baked into the job.
function startGenerationWorker(io, generationMap) {
  const worker = new Worker('generation-queue', async job => {
    const { generationId, imageUrl, productData, socketId: originalSocketId } = job.data;

    // Child logger binds generationId and jobId to every log line automatically.
    // In GCP Cloud Logging you can filter jsonPayload.generationId="xyz" to
    // see the full trace of one generation across all steps.
    const jobLog = logger.child({ generationId, jobId: job.id, attempt: job.attemptsMade + 1 });
    jobLog.info('Job started');

    // Resolve the most up-to-date socket ID for this generation.
    // If the client reconnected after a cold-start drop, generationMap will
    // have the new ID; otherwise fall back to the original from job data.
    const getSocketId = () => generationMap?.get(generationId) || originalSocketId;

    const sendUpdate = (stage, message, progress) => {
      const currentSocketId = getSocketId();
      if (currentSocketId) {
        io.to(currentSocketId).emit('generation-progress', {
          generationId,
          stage,
          message,
          progress
        });
      }
    };

    try {
      // Upsert (not insert) so retries don't fail with a duplicate-key error.
      // If this is the first attempt: creates the row.
      // If this is a retry after a stall: updates the existing row back to pending.
      await supabase.from('generations').upsert({
        id: generationId,
        status: 'pending',
        original_image_url: imageUrl
      });

      // Step 1: Scene Analysis
      sendUpdate('analyzing', 'Analyzing your space...', 25);
      jobLog.info({ progress: 25 }, 'Scene analysis started');

      // Simulate calling the Python CV service
      // const cvResponse = await fetch('http://cv-service-url/analyze', { ... })
      await new Promise(r => setTimeout(r, 1500));

      const mockSceneData = {
        lighting: { direction: 'top-left' },
        room_type: 'living_room'
      };

      // Step 2: Prompt Engineering
      sendUpdate('placing', `Placing ${productData.name} in the room...`, 50);
      jobLog.info({ progress: 50, roomType: mockSceneData.room_type }, 'Prompt engineering complete');

      // The image passed to the AI is a composite: the room photo with the product
      // image pasted into the bottom-right corner inside a white reference box.
      // The prompt instructs the model to copy that reference product into the main room.
      const prompt = `A highly realistic, unedited photo of a room. In the bottom right corner of this image there is a reference product: ${productData.name}. Your ONLY job is to copy that exact product from the bottom right corner, make it larger, and place it naturally on the floor in the main room. Ensure the product's shape, color, and texture are 100% IDENTICAL to the reference product in the corner. The lighting on the product matches the room's natural lighting (${mockSceneData.lighting.direction} directional lighting). Do NOT draw the reference box in the final image — only the room with the product placed inside it. Photorealistic, 8k resolution, architectural photography.`;

      // Step 3: AI Generation Execution
      sendUpdate('generating', 'Generating visualization...', 75);
      jobLog.info({ progress: 75 }, 'Calling Google AI');
      const aiResult = await executeGeneration(prompt, imageUrl);

      if (!aiResult.success) {
        throw new Error('AI Generation failed');
      }

      // Step 4: Persist result to Supabase — this is the source of truth.
      // If the Socket.IO connection was lost during processing, the frontend
      // polling fallback will read this row and still deliver the result.
      sendUpdate('finalizing', 'Finalizing image...', 90);
      await supabase.from('generations').update({
        status: 'completed',
        generated_image_url: aiResult.result_url
      }).eq('id', generationId);

      const finalPayload = {
        generationId,
        status: 'completed',
        resultUrl: aiResult.result_url
      };

      const currentSocketId = getSocketId();
      if (currentSocketId) {
        io.to(currentSocketId).emit('generation-complete', finalPayload);
      }

      // Clean up the generationMap entry — this generation is done
      generationMap?.delete(generationId);

      jobLog.info({ latencyMs: aiResult.latency_ms }, 'Job completed successfully');
      return finalPayload;

    } catch (err) {
      // Only mark as failed in Supabase on the final attempt.
      // On earlier attempts, BullMQ will retry — leave status as 'pending'
      // so the frontend polling doesn't incorrectly show an error screen.
      if (job.attemptsMade >= job.opts.attempts - 1) {
        jobLog.error({ err }, 'Job permanently failed — all attempts exhausted');
        await supabase.from('generations').update({ status: 'failed' }).eq('id', generationId);
        const currentSocketId = getSocketId();
        if (currentSocketId) {
          io.to(currentSocketId).emit('generation-error', {
            generationId,
            error: err.message || 'Generation failed'
          });
        }
        generationMap?.delete(generationId);
      } else {
        jobLog.warn({ err, nextAttempt: job.attemptsMade + 2 }, 'Job failed — will retry');
      }

      throw err; // BullMQ catches this and schedules the retry
    }
  }, {
    connection: redisConnection,
    concurrency: 5,
    // lockDuration: how long a job lock lasts before BullMQ considers the job
    // stalled. Must be longer than the slowest possible AI call (~60s).
    // The worker auto-renews the lock every lockDuration/2 ms while running.
    // If the container dies, the lock expires and the job is re-queued.
    lockDuration: 90000,
    // stalledInterval: how often to check for stalled (dead) jobs after restart.
    // Lower = faster recovery. 5s means a cold-started container picks up
    // orphaned jobs within 5 seconds of booting.
    stalledInterval: 5000,
    // maxStalledCount: how many times a job can be stalled before being
    // permanently failed. 3 matches our attempts count.
    maxStalledCount: 3,
  });

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'Worker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job.id, err: err.message }, 'Worker: job failed');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Worker: job stalled — lock expired, will be re-queued');
  });

  return worker;
}

module.exports = { startGenerationWorker };
