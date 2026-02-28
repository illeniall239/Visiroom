const request = require('supertest');
const express = require('express');

// uuid@13 is ESM-only — mock it so Jest (CommonJS mode) can require upload.js
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-1234') }));

// Mock Supabase before requiring the route
const mockUpload = jest.fn().mockResolvedValue({ data: { path: 'uploads/test.jpg' }, error: null });
const mockGetPublicUrl = jest.fn().mockReturnValue({
  data: { publicUrl: 'https://test.supabase.co/storage/v1/object/public/visual-commerce/uploads/test.jpg' }
});
const mockFrom = jest.fn(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));

jest.mock('../../services/supabase', () => ({
  supabase: { storage: { from: mockFrom } }
}));
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

const uploadRoutes = require('../../routes/upload');

const app = express();
app.use('/api/upload', uploadRoutes);

describe('POST /api/upload', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when no file is attached', async () => {
    // POST with no file — multer processes nothing, req.file is undefined
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No image/);
  });

  test('returns 400 for non-image MIME types (PDF)', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('image', Buffer.from('fake pdf content'), {
        filename: 'document.pdf',
        contentType: 'application/pdf'
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/);
  });

  test('accepts JPEG and returns success with url and generationId', async () => {
    const fakeJpeg = Buffer.alloc(1024); // 1KB fake image buffer
    mockFrom.mockReturnValue({ upload: mockUpload, getPublicUrl: mockGetPublicUrl });

    const res = await request(app)
      .post('/api/upload')
      .attach('image', fakeJpeg, { filename: 'room.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.url).toContain('visual-commerce');
    expect(res.body.key).toContain('uploads/');
    expect(res.body.generationId).toBeDefined();
  });

  test('accepts PNG file type', async () => {
    const fakePng = Buffer.alloc(512);
    const res = await request(app)
      .post('/api/upload')
      .attach('image', fakePng, { filename: 'product.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 500 when Supabase upload returns an error', async () => {
    mockFrom.mockReturnValueOnce({
      upload: jest.fn().mockResolvedValue({ data: null, error: new Error('Storage quota exceeded') }),
      getPublicUrl: mockGetPublicUrl
    });
    const fakeJpeg = Buffer.alloc(1024);
    const res = await request(app)
      .post('/api/upload')
      .attach('image', fakeJpeg, { filename: 'room.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(500);
  });
});
