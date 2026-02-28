const express = require('express');
const { enqueueGenerationJob } = require('../services/queue');
const { logger } = require('../services/logger');

const router = express.Router();

/**
 * POST /api/generate
 * Validates the request, enqueues a BullMQ generation job, and returns
 * immediately. The actual result is delivered asynchronously via Socket.IO.
 */
router.post('/', async (req, res) => {
  try {
    const { generationId, imageKey, productData, socketId } = req.body;

    if (!generationId || !imageKey || !productData) {
      return res.status(400).json({ error: 'generationId, imageKey, and productData are required' });
    }

    // Determine user priority based on session/auth (mocked to 3 for anonymous)
    const priority = 3;

    await enqueueGenerationJob(generationId, {
      generationId,
      imageUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/visual-commerce/${imageKey}`,
      productData,
      socketId
    }, priority);

    logger.info({ generationId, socketId }, 'Generation job enqueued');

    res.json({
      success: true,
      message: 'Generation job enqueued successfully',
      generationId
    });

  } catch (err) {
    logger.error({ err }, 'Failed to enqueue generation job');
    res.status(500).json({ error: 'Failed to start generation process' });
  }
});

module.exports = router;
