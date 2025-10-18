export function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

export function normalizeBaseUrl(input: string): string {
    // Will throw if invalid
    const url = new URL(input);
    // Keep protocol + host + optional pathname, but remove trailing slash(es)
    return url.toString().replace(/\/+$/, '');
}

export async function safeJson<T = any>(res: any): Promise<T> {
    try {
        return (await res.json()) as T;
    } catch (e) {
        throw new Error(`Failed to parse JSON from ${res.url || 'response'} (status ${res.status})`);
    }
}

export function getTimeoutMs(): number {
    const env = process.env.N8N_FETCH_TIMEOUT_MS || process.env.N8N_TIMEOUT_MS;
    const ms = Number(env);
    return Number.isFinite(ms) && ms > 0 ? ms : 10_000;
}

export async function fetchWithTimeout(url: string, init: any = {}, timeoutMs = getTimeoutMs()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return res as any;
    } finally {
        clearTimeout(timer);
    }
}
