import { MAX_KEY_NAME_CHARS } from './constants';
import type { NamedKey } from './types';

const KEY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function parseApiKeys(raw: string | undefined): NamedKey[] {
  if (!raw) return [];
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const colon = part.indexOf(':');
    if (colon <= 0) {
      return { name: `key-${index + 1}`, secret: part };
    }
    const name = part.slice(0, colon).trim();
    const secret = part.slice(colon + 1).trim();
    if (!secret || !isKeyName(name)) {
      throw new Error(
        `MCP_API_KEY entry ${index + 1} must be name:secret. Names are 1-${MAX_KEY_NAME_CHARS} characters and use letters, numbers, ".", "_", or "-".`,
      );
    }
    return { name, secret };
  });
}

function isKeyName(name: string): boolean {
  return name.length <= MAX_KEY_NAME_CHARS && KEY_NAME.test(name);
}

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

/** Compares the token with every configured key so a match does not stop the loop early. */
export async function matchApiKey(token: string, keys: readonly NamedKey[]): Promise<string | null> {
  let matched: string | null = null;
  for (const key of keys) {
    const same = await timingSafeEqual(token, key.secret);
    if (same && matched === null) matched = key.name;
  }
  return matched;
}
