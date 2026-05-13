/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures in AI services by implementing the circuit breaker pattern.
 * When a service fails repeatedly, the circuit breaker "opens" and fails fast without
 * attempting the call, giving the service time to recover.
 * 
 * States:
 * - CLOSED: Normal operation, calls go through
 * - OPEN: Service is failing, calls fail immediately
 * - HALF_OPEN: Testing if service recovered, one call allowed through
 */

import { appLogger } from './logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time (ms) to wait before trying again after opening */
  resetTimeoutMs: number;
  /** Time (ms) before resetting success count */
  successTimeoutMs: number;
  /** Minimum success count in half_open to close circuit */
  successThreshold: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeoutMs: 60_000, // 1 minute
  successTimeoutMs: 300_000, // 5 minutes
  successThreshold: 2,
};

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
    public readonly stats: CircuitBreakerStats
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker for a single service
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = DEFAULT_OPTIONS
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if circuit is open
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        appLogger.info('[CircuitBreaker] Transitioning to HALF_OPEN state', { service: this.name, reason: 'testing recovery' });
      } else {
        const timeSinceFailure = Date.now() - (this.lastFailureTime?.getTime() || 0);
        const remainingMs = this.options.resetTimeoutMs - timeSinceFailure;
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}. Retry in ${Math.ceil(remainingMs / 1000)}s`,
          this.state,
          this.getStats()
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error: any) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    this.successCount++;
    this.totalSuccesses++;
    this.lastSuccessTime = new Date();

    if (this.state === 'HALF_OPEN') {
      if (this.successCount >= this.options.successThreshold) {
        this.reset();
        appLogger.info('[CircuitBreaker] Circuit CLOSED after successful calls', { service: this.name, successCount: this.successCount });
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      if (Date.now() - (this.lastFailureTime?.getTime() || 0) > this.options.successTimeoutMs) {
        this.failureCount = 0;
      }
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(error: Error): void {
    this.failureCount++;
    this.totalFailures++;
    this.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      appLogger.error('[CircuitBreaker] Circuit OPENED', { service: this.name, reason: 'half-open recovery failed' });
    } else if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
      appLogger.error('[CircuitBreaker] Circuit OPENED', { service: this.name, consecutiveFailures: this.failureCount });
    }
  }

  /**
   * Check if circuit should attempt reset (transition from OPEN to HALF_OPEN)
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime.getTime() >= this.options.resetTimeoutMs;
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = new Date();
  }

  /**
   * Force open the circuit (manual override)
   */
  forceOpen(): void {
    this.state = 'OPEN';
    this.lastFailureTime = new Date();
    appLogger.warn('[CircuitBreaker] Circuit force-OPENED', { service: this.name });
  }

  /**
   * Force close the circuit (manual override)
   */
  forceClose(): void {
    this.reset();
    appLogger.info('[CircuitBreaker] Circuit force-CLOSED', { service: this.name });
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Check if circuit is open (blocking calls)
   */
  isOpen(): boolean {
    return this.state === 'OPEN' && !this.shouldAttemptReset();
  }

  /**
   * Check if circuit is closed (allowing calls)
   */
  isClosed(): boolean {
    return this.state === 'CLOSED';
  }
}

/**
 * Circuit Breaker Registry - manages circuit breakers for all services
 */
export class CircuitBreakerRegistry {
  private static breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker for a service
   */
  static get(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, { ...DEFAULT_OPTIONS, ...options }));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker stats
   */
  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  static resetAll(): void {
    for (const [, breaker] of this.breakers) {
      breaker.reset();
    }
  }

  /**
   * Get circuit breaker for Qwen CLI
   */
  static qwenCli(): CircuitBreaker {
    return this.get('qwen_cli', { failureThreshold: 2, resetTimeoutMs: 120_000 });
  }

  /**
   * Get circuit breaker for Gemini CLI
   */
  static geminiCli(): CircuitBreaker {
    return this.get('gemini_cli', { failureThreshold: 2, resetTimeoutMs: 120_000 });
  }

  /**
   * Get circuit breaker for self-healing
   */
  static selfHealing(): CircuitBreaker {
    return this.get('self_healing', { failureThreshold: 5, resetTimeoutMs: 300_000 });
  }
}
