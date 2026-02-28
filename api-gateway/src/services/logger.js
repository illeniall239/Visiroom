const pino = require('pino');

// Single shared logger instance for the entire api-gateway service.
//
// Production (NODE_ENV=production):
//   Outputs newline-delimited JSON to stdout. GCP Cloud Logging ingests this
//   automatically and maps pino's numeric `level` field to GCP severity levels,
//   `time` to the log timestamp, and every other field becomes a queryable label.
//   This means you can filter logs in Cloud Logging by generationId, jobId, etc.
//
// Development:
//   pino-pretty formats the same JSON into human-readable coloured output.
//   No code changes needed between environments — just the NODE_ENV variable.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  // `base` fields appear on every log line — useful for identifying which
  // service emitted a log when multiple services write to the same sink.
  base: { service: 'api-gateway' },
});

module.exports = { logger };
