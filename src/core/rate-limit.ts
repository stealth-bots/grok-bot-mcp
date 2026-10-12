import { RATE_LIMIT_CALLS, RATE_LIMIT_WINDOW_MS } from './constants';
import type { RateLimit } from './types';

export interface CallerRateLimitOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

/** Fixed window, per caller, in this process only. */
export class CallerRateLimit implements RateLimit {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: CallerRateLimitOptions = {}) {
    this.limit = options.limit ?? RATE_LIMIT_CALLS;
    this.windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  allow(caller: string): boolean {
    const at = this.now();
    const recent = (this.hits.get(caller) ?? []).filter((stamp) => at - stamp < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(caller, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(caller, recent);
    return true;
  }
}
