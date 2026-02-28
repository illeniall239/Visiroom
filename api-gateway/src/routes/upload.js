const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase');
const { logger } = require('../services/logger');
const path = require('path');

const router = express.Router();

// Use memory storage for Multer instead of disk storage
// so we can directly pass the buffer to Supabase
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed'));
    }
  }
});

/**
 * POST /api/upload
 * Accept a multipart/form-data image upload and save it to Supabase Storage
 */
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const generationId = uuidv4();
    const fileExtension = path.extname(req.file.originalname);
    const fileName = `uploads/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;

    const { data, error } = await supabase.storage
      .from('visual-commerce')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) {
      logger.error({ err: error, fileName }, 'Supabase storage upload failed');
      throw new Error('Failed to upload image to storage');
    }

    const { data: publicUrlData } = supabase.storage
      .from('visual-commerce')
      .getPublicUrl(fileName);

    logger.info({ generationId, fileName, sizeBytes: req.file.size }, 'Image uploaded to storage');

    res.json({
      success: true,
      url: publicUrlData.publicUrl,
      key: fileName,
      generationId: generationId
    });

  } catch (err) {
    logger.error({ err }, 'Upload route error');
    res.status(500).json({ error: err.message || 'Failed to process image upload' });
  }
});

// Error handling middleware for Multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.warn({ err: err.message, code: err.code }, 'Multer validation error');
    return res.status(400).json({ error: err.message });
  } else if (err) {
    logger.warn({ err: err.message }, 'Upload validation error');
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
