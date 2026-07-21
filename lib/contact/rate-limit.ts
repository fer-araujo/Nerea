// In-memory, per-key fixed-window rate limiter. Deliberately simple (a
// single process-local Map, no external store) — correct for this app's
// real scale (a one-person atelier's contact form), and explicitly NOT
// correct across multiple concurrent server instances: a fixed-window Map
// lives in one process's memory, so a multi-instance/serverless deployment
// gets one independent counter PER INSTANCE, not one shared limit across the
// fleet. That's an accepted tradeoff here (the goal is slowing down casual
// abuse, not a hard multi-instance guarantee) — a deployment that needs a
// real cross-instance guarantee would need a shared store (Redis/Upstash/
// etc.), which is out of scope for this MVP-scale form.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

interface WindowEntry {
  count: number;
  windowStart: number;
}

const hits = new Map<string, WindowEntry>();

// Opportunistic cleanup so the Map can't grow without bound over a long
// server uptime (many distinct IPs, or spoofed X-Forwarded-For values) —
// bounded by actual request volume, not a separate timer/interval.
function pruneExpired(now: number): void {
  for (const [key, entry] of hits) {
    if (now - entry.windowStart >= WINDOW_MS) {
      hits.delete(key);
    }
  }
}

/** `now` is injectable for deterministic tests; defaults to the real clock. */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  pruneExpired(now);

  const entry = hits.get(key);
  if (!entry) {
    hits.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}
