// Mock global fetch before the module loads so ai.js picks it up
global.fetch = jest.fn();

jest.mock('../../services/logger', () => ({
  logger: {
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }))
  }
}));

const { executeGeneration } = require('../../services/ai');

const MOCK_PROMPT = 'Place the sofa in the living room with matching lighting';
const MOCK_IMAGE_URL = 'https://test.supabase.co/storage/v1/object/public/visual-commerce/uploads/composite.jpg';

// Helper: a successful image download response
const mockImageDownload = () => ({
  ok: true,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  headers: { get: () => 'image/jpeg' }
});

// Helper: a Google AI response with an image part
const mockAiImageResponse = (base64 = 'aW1hZ2VkYXRh') => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({
    candidates: [{
      content: {
        parts: [{ inlineData: { mimeType: 'image/png', data: base64 } }]
      }
    }]
  })
});

describe('executeGeneration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_AI_STUDIO_API_KEY;
  });

  test('returns mock image and skips fetch when API key is not set', async () => {
    const result = await executeGeneration(MOCK_PROMPT, MOCK_IMAGE_URL);
    expect(result.success).toBe(true);
    expect(result.result_url).toContain('unsplash');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('returns success:true on 429 rate limit (graceful degradation, not failure)', async () => {
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'real-api-key';
    fetch
      .mockResolvedValueOnce(mockImageDownload()) // image download succeeds
      .mockResolvedValueOnce({ status: 429, ok: false }); // Google AI rate limits

    const result = await executeGeneration(MOCK_PROMPT, MOCK_IMAGE_URL);
    expect(result.success).toBe(true);
    expect(result.result_url).toContain('unsplash'); // falls back to placeholder
  });

  test('returns base64 data URL when Google AI returns an image part', async () => {
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'real-api-key';
    const fakeBase64 = 'aVZCT1J3MEtHZ289';
    fetch
      .mockResolvedValueOnce(mockImageDownload())
      .mockResolvedValueOnce(mockAiImageResponse(fakeBase64));

    const result = await executeGeneration(MOCK_PROMPT, MOCK_IMAGE_URL);
    expect(result.success).toBe(true);
    expect(result.result_url).toBe(`data:image/png;base64,${fakeBase64}`);
  });

  test('falls back to placeholder when Google AI returns text only (no image part)', async () => {
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'real-api-key';
    fetch
      .mockResolvedValueOnce(mockImageDownload())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'I cannot generate images in this context.' }] } }]
        })
      });

    const result = await executeGeneration(MOCK_PROMPT, MOCK_IMAGE_URL);
    expect(result.success).toBe(true);
    expect(result.result_url).toContain('unsplash'); // placeholder, not a base64 url
  });

  test('returns success:false when composite image download fails', async () => {
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'real-api-key';
    fetch.mockResolvedValueOnce({ ok: false, status: 403 }); // Supabase denies access

    const result = await executeGeneration(MOCK_PROMPT, MOCK_IMAGE_URL);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/403/);
  });
});
