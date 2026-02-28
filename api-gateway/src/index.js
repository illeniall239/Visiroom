const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const pinoHttp = require('pino-http');
const { RedisStore } = require('rate-limit-redis');
require('dotenv').config();

const { logger } = require('./services/logger');
const { supabase } = require('./services/supabase');
const { redisConnection } = require('./services/queue');
const uploadRoutes = require('./routes/upload');
const generateRoutes = require('./routes/generate');
const { startGenerationWorker } = require('./workers/generationWorker');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Security hardening
app.use(helmet());

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// HTTP request logging — logs every request with method, url, status, response time.
// In production these are structured JSON lines that GCP Cloud Logging can index.
app.use(pinoHttp({ logger }));

// Rate Limiting backed by Upstash Redis.
// Using in-memory storage (the default) means each Cloud Run container instance
// has its own counter — a user could hit 3 requests per instance, bypassing the
// limit entirely when multiple instances are running. The Redis store shares one
// counter across all instances, making the limit consistent and correct.
const apiLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3,
  message: { error: 'Too many requests from this IP, please try again tomorrow.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // rate-limit-redis delegates raw Redis commands through this function.
    // ioredis exposes .call() for sending arbitrary commands, which is what
    // the RedisStore uses internally (INCR, EXPIRE, etc.).
    sendCommand: (...args) => redisConnection.call(...args),
  }),
});

// Health endpoint — checked by Cloud Run every 10 seconds.
// Returns 200 when all dependencies are reachable, 503 when any are down.
// Cloud Run stops routing traffic to a container that repeatedly returns 503.
app.get('/health', async (req, res) => {
  const checks = { redis: 'ok', supabase: 'ok' };
  let httpStatus = 200;

  try {
    await redisConnection.ping();
  } catch (err) {
    checks.redis = 'error';
    httpStatus = 503;
    logger.warn({ err }, 'Health check: Redis ping failed');
  }

  try {
    const { error } = await supabase.from('generations').select('id').limit(1);
    if (error) throw error;
  } catch (err) {
    checks.supabase = 'error';
    httpStatus = 503;
    logger.warn({ err }, 'Health check: Supabase query failed');
  }

  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services: checks,
  });
});

// Maps generationId → current socketId.
// Updated when a client reconnects after a cold-start drop and emits 'rejoin'.
// The worker reads this map at emit time so it always targets the live socket.
const generationMap = new Map();

// Attach io to req for use in routes if needed
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use('/api/upload', uploadRoutes);
app.use('/api/generate', apiLimiter, generateRoutes);

// Start the worker — pass generationMap so it can resolve current socket IDs
startGenerationWorker(io, generationMap);

// WebSocket connection
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Client connected');

  // Client emits 'rejoin' immediately after reconnecting if it has an active
  // generation in flight. This updates the map so the worker emits to the
  // new socket ID rather than the stale one stored in the Redis job.
  socket.on('rejoin', ({ generationId }) => {
    if (generationId) {
      generationMap.set(generationId, socket.id);
      logger.info({ socketId: socket.id, generationId }, 'Client rejoined generation');
    }
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway started');
});
