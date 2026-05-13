/**
 * RedisService Mock
 * Bypasses ioredis dependency issues while maintaining API compatibility.
 */
export class RedisService {
  private static instance: RedisService;

  public constructor() {
    console.log('[Redis] Mock Service Initialized');
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async get(key: string): Promise<any | null> { return null; }
  public async set(key: string, value: any, expirySeconds?: number): Promise<void> {}
  public async del(key: string): Promise<void> {}

  // Added for UniversalPageModelService compatibility
  public async getDetectionCache(key: string): Promise<any | null> { return null; }
  public async setDetectionCache(key: string, value: any, expirySeconds?: number): Promise<void> {}
}
