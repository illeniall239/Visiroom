const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../services/queue', () => ({
  enqueueGenerationJob: jest.fn().mockResolvedValue({ id: 'job-123' })
}));
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }))
  }
}));

const { enqueueGenerationJob } = require('../../services/queue');
const generateRoutes = require('../../routes/generate');

const app = express();
app.use(express.json());
app.use('/api/generate', generateRoutes);

describe('POST /api/generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when generationId is missing', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ imageKey: 'uploads/test.jpg', productData: { name: 'Sofa' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/generationId/);
  });

  test('returns 400 when imageKey is missing', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ generationId: 'gen-123', productData: { name: 'Sofa' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/imageKey/);
  });

  test('returns 400 when productData is missing', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ generationId: 'gen-123', imageKey: 'uploads/test.jpg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/productData/);
  });

  test('enqueues job and returns 200 with generationId on valid request', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    const res = await request(app)
      .post('/api/generate')
      .send({
        generationId: 'gen-123',
        imageKey: 'uploads/composite.jpg',
        productData: { name: 'Sofa', category: 'Furniture' },
        socketId: 'socket-abc'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.generationId).toBe('gen-123');
    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      'gen-123',
      expect.objectContaining({
        generationId: 'gen-123',
        socketId: 'socket-abc',
        imageUrl: expect.stringContaining('uploads/composite.jpg')
      }),
      3
    );
  });

  test('returns 500 when enqueueGenerationJob throws (Redis down)', async () => {
    enqueueGenerationJob.mockRejectedValueOnce(new Error('Redis connection refused'));
    const res = await request(app)
      .post('/api/generate')
      .send({
        generationId: 'gen-123',
        imageKey: 'uploads/test.jpg',
        productData: { name: 'Sofa' }
      });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
