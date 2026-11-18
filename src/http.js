// Polite HTTP client: at most 4 concurrent requests per host, timeouts,
// retries with exponential backoff and jitter on 429, 5xx and network errors.

export const USER_AGENT = 'ats-job-feed/0.1';
const MAX_PER_HOST = 4;
const slots = new Map(); // host -> { active, waiting: [] }

async function withHostSlot(host, fn) {
    let s = slots.get(host);
    if (!s) slots.set(host, (s = { active: 0, waiting: [] }));
    if (s.active >= MAX_PER_HOST) await new Promise((resolve) => s.waiting.push(resolve));
    else s.active++;
    try {
        return await fn();
    } finally {
        const next = s.waiting.shift();
        if (next) next(); // hand the slot over without releasing it
        else s.active--;
    }
}

export class HttpError extends Error {
    constructor(status, url) {
        super(`HTTP ${status} for ${url}`);
        this.status = status;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a URL and return { url, body }; body is parsed JSON when type is 'json', else text.
 * Throws HttpError for non-retryable statuses (e.g. 404) or after the last retry.
 */
export async function get(url, { type = 'json', timeoutMs = 60000, retries = 4, retryBaseMs = 1000 } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
        let status = 0;
        let retryAfter = null;
        try {
            const result = await withHostSlot(host, async () => {
                const res = await fetch(url, {
                    headers: { 'user-agent': USER_AGENT, accept: type === 'json' ? 'application/json' : 'text/html,*/*' },
                    signal: AbortSignal.timeout(timeoutMs),
                });
                status = res.status;
                retryAfter = Number(res.headers.get('retry-after')) || null;
                if (!res.ok) {
                    await res.body?.cancel();
                    return null;
                }
                return { url: res.url, body: type === 'json' ? await res.json() : await res.text() };
            });
            if (result) return result;
        } catch (err) {
            if (attempt >= retries) throw err;
            status = 0; // network error, timeout or truncated body: retry
        }
        const retryable = status === 0 || status === 429 || status >= 500;
        if (!retryable || attempt >= retries) throw new HttpError(status, url);
        const backoff = retryAfter ? Math.min(retryAfter, 60) * 1000 : retryBaseMs * 2 ** attempt;
        await sleep(backoff + Math.random() * retryBaseMs);
    }
}
