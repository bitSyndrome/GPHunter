import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth.ts";

interface Bucket {
  tokens: number;
  last: number; // epoch ms of last refill
}

export interface RateLimitOptions {
  capacity: number; // max burst
  refillPerSec: number; // sustained rate
}

/**
 * In-memory token-bucket rate limiter (no external infra).
 * Keyed by user id (falls back to client IP for unauthenticated hits).
 * Allows bursts up to `capacity`, then `refillPerSec` sustained.
 */
export function rateLimit({ capacity, refillPerSec }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  function prune(now: number): void {
    // Drop idle (fully refilled) buckets to bound memory.
    if (buckets.size < 10_000) return;
    for (const [k, b] of buckets) {
      const refilled = b.tokens + ((now - b.last) / 1000) * refillPerSec;
      if (refilled >= capacity) buckets.delete(k);
    }
  }

  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.userId != null ? `u:${req.userId}` : `ip:${req.ip}`;

    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      buckets.set(key, b);
      prune(now);
    } else {
      b.tokens = Math.min(
        capacity,
        b.tokens + ((now - b.last) / 1000) * refillPerSec,
      );
      b.last = now;
    }

    if (b.tokens < 1) {
      const retry = Math.ceil((1 - b.tokens) / refillPerSec);
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: "rate limited", retry_after_sec: retry });
      return;
    }

    b.tokens -= 1;
    next();
  };
}
