import { D1JobStore, type D1Database } from './d1';
import { MemoryJobStore } from './memory';
import type { JobStore } from './types';
import { UpstashJobStore } from './upstash';

export type StoreKind = 'd1' | 'upstash' | 'memory';

export interface StoreSelection {
  store: JobStore;
  kind: StoreKind;
}

export interface UpstashCredentials {
  url: string;
  token: string;
}

export type StoreTarget =
  | { target: 'worker'; db?: D1Database; now?: () => number }
  | { target: 'node'; upstash: UpstashCredentials | null; now?: () => number; fetchImpl?: typeof fetch }
  | { target: 'dev'; now?: () => number };

export class D1BindingRequiredError extends Error {
  constructor() {
    super('Refusing to start without a D1 database. Bind D1 as DB.');
    this.name = 'D1BindingRequiredError';
  }
}

export class UpstashRequiredError extends Error {
  constructor() {
    super(
      'Upstash Redis REST credentials are required. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).',
    );
    this.name = 'UpstashRequiredError';
  }
}

/** Workers use D1. Node and Vercel use Upstash. `pnpm dev` uses memory. */
export function createJobStore(input: StoreTarget): StoreSelection {
  switch (input.target) {
    case 'worker':
      if (!input.db) throw new D1BindingRequiredError();
      return { kind: 'd1', store: new D1JobStore(input.db, input.now) };
    case 'node':
      if (!input.upstash) throw new UpstashRequiredError();
      return {
        kind: 'upstash',
        store: new UpstashJobStore(input.upstash.url, input.upstash.token, input.fetchImpl, input.now),
      };
    case 'dev':
      return { kind: 'memory', store: new MemoryJobStore(input.now) };
    default: {
      const _never: never = input;
      return _never;
    }
  }
}
