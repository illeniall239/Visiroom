// Mock BullMQ Worker to capture the processor function without real Redis
let capturedProcessor;
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((queueName, processor) => {
    capturedProcessor = processor;
    return { on: jest.fn() };
  })
}));

// Mock all external service dependencies
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockUpdateEq = jest.fn().mockResolvedValue({ error: null });
const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));
jest.mock('../../services/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert, update: mockUpdate }))
  }
}));

const mockExecuteGeneration = jest.fn().mockResolvedValue({
  success: true,
  result_url: 'https://example.com/generated-result.jpg',
  latency_ms: 1500
});
jest.mock('../../services/ai', () => ({ executeGeneration: mockExecuteGeneration }));

jest.mock('../../services/queue', () => ({ redisConnection: {} }));

jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
  }
}));

const { startGenerationWorker } = require('../../workers/generationWorker');

describe('generationWorker', () => {
  let mockIo, generationMap, mockJob;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;

    generationMap = new Map();

    // mockIo: io.to(socketId).emit(event, payload)
    const mockEmit = jest.fn();
    mockIo = { to: jest.fn(() => ({ emit: mockEmit })) };

    mockJob = {
      id: 'job-1',
      attemptsMade: 0,
      opts: { attempts: 3 },
      data: {
        generationId: 'gen-abc',
        imageUrl: 'https://test.supabase.co/storage/uploads/composite.jpg',
        productData: { name: 'Sofa', category: 'Furniture' },
        socketId: 'socket-original'
      }
    };

    startGenerationWorker(mockIo, generationMap);
  });

  test('emits generation-progress events and generation-complete on success', async () => {
    generationMap.set('gen-abc', 'socket-current');
    await capturedProcessor(mockJob);

    // Should have called io.to() multiple times (at least 4 progress + 1 complete)
    expect(mockIo.to).toHaveBeenCalledTimes(5);
    // All calls should target the current socket, not the stale one
    mockIo.to.mock.calls.forEach(([socketId]) => {
      expect(socketId).toBe('socket-current');
    });
  });

  test('uses generationMap socketId over stale job.data.socketId (reconnect scenario)', async () => {
    generationMap.set('gen-abc', 'socket-new'); // client reconnected, new socket
    mockJob.data.socketId = 'socket-old';       // stale socket in job data

    await capturedProcessor(mockJob);

    expect(mockIo.to).not.toHaveBeenCalledWith('socket-old');
    expect(mockIo.to).toHaveBeenCalledWith('socket-new');
  });

  test('falls back to job.data.socketId when generationMap has no entry', async () => {
    // generationMap is empty — no reconnect happened
    await capturedProcessor(mockJob);

    expect(mockIo.to).toHaveBeenCalledWith('socket-original');
    expect(mockIo.to).not.toHaveBeenCalledWith(undefined);
  });

  test('upserts to Supabase with status:pending (idempotent on retry, not insert)', async () => {
    generationMap.set('gen-abc', 'socket-current');
    await capturedProcessor(mockJob);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gen-abc', status: 'pending' })
    );
  });

  test('updates Supabase to status:completed with resultUrl on success', async () => {
    generationMap.set('gen-abc', 'socket-current');
    await capturedProcessor(mockJob);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        generated_image_url: 'https://example.com/generated-result.jpg'
      })
    );
  });

  test('does NOT mark Supabase failed on first attempt (attemptsMade=0, 2 retries remain)', async () => {
    mockExecuteGeneration.mockRejectedValueOnce(new Error('AI timeout'));
    mockJob.attemptsMade = 0; // first attempt (0-indexed), 2 retries left

    await expect(capturedProcessor(mockJob)).rejects.toThrow('AI timeout');

    // update({ status: 'failed' }) must NOT have been called — BullMQ will retry
    expect(mockUpdate).not.toHaveBeenCalledWith({ status: 'failed' });
  });

  test('marks Supabase failed and emits generation-error on final attempt (attemptsMade=2)', async () => {
    mockExecuteGeneration.mockRejectedValueOnce(new Error('AI permanently broken'));
    mockJob.attemptsMade = 2; // third attempt, 0-indexed — no retries left
    generationMap.set('gen-abc', 'socket-current');

    await expect(capturedProcessor(mockJob)).rejects.toThrow('AI permanently broken');

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'failed' });

    // Should have emitted generation-error to the client
    const emitCalls = mockIo.to.mock.results.map(r => r.value.emit.mock.calls).flat();
    const errorEmit = emitCalls.find(([event]) => event === 'generation-error');
    expect(errorEmit).toBeDefined();
    expect(errorEmit[1]).toMatchObject({ generationId: 'gen-abc', error: 'AI permanently broken' });
  });
});
