import { expect } from 'vitest';

export interface FakeRedis {
  commands: string[][];
  ttls: Map<string, number>;
  fetchImpl: typeof fetch;
}

export function fakeRedis(clock: { now: () => number } = { now: () => Date.now() }): FakeRedis {
  const saved = new Map<string, string>();
  const expiresAt = new Map<string, number>();
  const ttls = new Map<string, number>();
  const commands: string[][] = [];

  function live(key: string): string | undefined {
    const expiry = expiresAt.get(key);
    if (expiry !== undefined && clock.now() >= expiry) {
      saved.delete(key);
      expiresAt.delete(key);
      ttls.delete(key);
      return undefined;
    }
    return saved.get(key);
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const command = JSON.parse(String(init?.body)) as string[];
    commands.push(command);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
    expect(String(input)).toBe('https://redis.example');
    const op = command[0];
    if (op === 'SET' && command.includes('NX')) {
      const key = command[1] ?? '';
      if (live(key) !== undefined) return Response.json({ result: null });
      saved.set(key, command[2] ?? '');
      const ex = command.indexOf('EX');
      const seconds = Number(command[ex + 1]);
      ttls.set(key, seconds);
      expiresAt.set(key, clock.now() + seconds * 1000);
      return Response.json({ result: 'OK' });
    }
    if (op === 'SET') {
      const key = command[1] ?? '';
      saved.set(key, command[2] ?? '');
      return Response.json({ result: 'OK' });
    }
    if (op === 'GET') return Response.json({ result: live(command[1] ?? '') ?? null });
    if (op === 'EVAL') {
      const key = command[3] ?? '';
      const next = command[4] ?? '';
      const current = live(key);
      if (current === undefined) return Response.json({ result: 'missing' });
      const parsed = JSON.parse(current) as { status?: string };
      if (parsed.status !== 'pending') return Response.json({ result: 'not_pending' });
      saved.set(key, next);
      return Response.json({ result: 'updated' });
    }
    return Response.json({ error: 'bad command' }, { status: 200 });
  };
  return { commands, ttls, fetchImpl };
}
