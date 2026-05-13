import { retryStep } from '../../tests/playwright/playwright-self-healing';

describe('retryStep', () => {
  it('succeeds on first attempt without retrying', async () => {
    let callCount = 0;
    await retryStep(async () => {
      callCount++;
    });
    expect(callCount).toBe(1);
  });

  it('retries on failure and succeeds', async () => {
    let callCount = 0;
    await retryStep(
      async () => {
        callCount++;
        if (callCount < 2) throw new Error('transient failure');
      },
      { maxRetries: 2, backoffMs: 10 },
    );
    expect(callCount).toBe(2);
  });

  it('throws after all retries are exhausted', async () => {
    let callCount = 0;
    await expect(
      retryStep(
        async () => {
          callCount++;
          throw new Error('persistent failure');
        },
        { maxRetries: 2, backoffMs: 10 },
      ),
    ).rejects.toThrow('persistent failure');
    // 1 initial + 2 retries = 3 total attempts
    expect(callCount).toBe(3);
  });

  it('uses default values when options not provided', async () => {
    let callCount = 0;
    await retryStep(async () => {
      callCount++;
    });
    expect(callCount).toBe(1);
  });

  it('respects maxRetries=0 (no retries)', async () => {
    let callCount = 0;
    await expect(
      retryStep(
        async () => {
          callCount++;
          throw new Error('immediate failure');
        },
        { maxRetries: 0, backoffMs: 10 },
      ),
    ).rejects.toThrow('immediate failure');
    expect(callCount).toBe(1);
  });

  it('succeeds on last retry', async () => {
    let callCount = 0;
    await retryStep(
      async () => {
        callCount++;
        if (callCount < 3) throw new Error('flaky');
      },
      { maxRetries: 2, backoffMs: 10 },
    );
    expect(callCount).toBe(3);
  });
});
