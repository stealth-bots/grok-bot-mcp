export interface WebhookPayload {
  job_id: string;
  thread_id: string | null;
  caller: string;
  message: string;
  reply_url: string;
}

export type WebhookResult = { ok: true } | { ok: false; status?: number; reason: 'status' | 'timeout' | 'network' };

export async function postWebhook(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  payload: WebhookPayload,
  timeoutMs: number,
): Promise<WebhookResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'x-automation-key': key,
      },
      body: JSON.stringify(payload),
      signal,
      redirect: 'manual',
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 200) return { ok: false, status: response.status, reason: 'status' };
    return { ok: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network' };
  }
}
