import { readUpstash, type EnvMap } from './config';
import { KvJobStore, type KvBinding } from './kv-store';
import { MemoryJobStore } from './memory-store';
import { UpstashJobStore } from './upstash-store';
import type { JobStore } from './types';

export type StoreKind = 'upstash' | 'kv' | 'memory';

export interface StoreSelection {
  store: JobStore;
  kind: StoreKind;
}

export class DurableStoreRequiredError extends Error {
  constructor() {
    super(
      'Refusing to start without a durable job store. Set Upstash Redis REST credentials or bind Workers KV as JOBS.',
    );
    this.name = 'DurableStoreRequiredError';
  }
}

export function createStore(
  env: EnvMap,
  options?: { kv?: KvBinding; now?: () => number; fetchImpl?: typeof fetch; allowMemory?: boolean },
): StoreSelection {
  const now = options?.now;
  const upstash = readUpstash(env);
  if (upstash) {
    return {
      kind: 'upstash',
      store: new UpstashJobStore(upstash.url, upstash.token, options?.fetchImpl, now),
    };
  }
  if (options?.kv) {
    return { kind: 'kv', store: new KvJobStore(options.kv, now) };
  }
  if (options?.allowMemory) {
    return { kind: 'memory', store: new MemoryJobStore(now) };
  }
  throw new DurableStoreRequiredError();
}
