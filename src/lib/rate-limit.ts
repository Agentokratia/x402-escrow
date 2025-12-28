/**
 * Rate Limiting for x402 API
 *
 * Simple in-memory rate limiter with sliding window.
 * For production, consider using Redis or a dedicated rate limiting service.
 */

// Skip rate limiting in test environment
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

// =============================================================================
// Types
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Max requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// =============================================================================
// In-Memory Rate Limiter
// =============================================================================

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60_000);
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    // No entry or expired - allow and start new window
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + this.config.windowMs;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: this.config.max - 1,
        resetAt,
      };
    }

    // Within window - check limit
    if (entry.count >= this.config.max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    // Increment and allow
    entry.count++;
    return {
      allowed: true,
      remaining: this.config.max - entry.count,
      resetAt: entry.resetAt,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }
}

// =============================================================================
// Default Rate Limiters
// =============================================================================

// =============================================================================
// Production Rate Limits
// =============================================================================
// These are tuned for a payment facilitator handling real traffic.
// Consider using Redis for distributed rate limiting in production.

// /api/supported - public discovery endpoint
// Higher limit since it's just returning config, cached anyway
const supportedLimiter = new RateLimiter({
  max: 60, // 60 requests per minute (1/sec sustained)
  windowMs: 60_000,
});

// /api/verify and /api/settle - authenticated payment operations
// Per API key - HIGH LIMIT for session-based payments
// Session usage is cheap (DB only, no blockchain), so we allow high throughput
// This is the main value prop of escrow - fast, frequent payments
const authLimiter = new RateLimiter({
  max: 6000, // 6000 requests per minute (100/sec sustained)
  windowMs: 60_000,
});

// Failed auth attempts - prevent brute force on API keys
// Strict but allows for legitimate retry logic
const authFailureLimiter = new RateLimiter({
  max: 20, // 20 failures before lockout
  windowMs: 900_000, // 15 minute window (gives time to fix issues)
});

// /api/auth/nonce - SIWE nonce generation
// One per login attempt is normal
const nonceLimiter = new RateLimiter({
  max: 20, // 20 nonces per minute (handles page refreshes, retries)
  windowMs: 60_000,
});

// /api/auth/verify - SIWE signature verification
// Strict to prevent brute force, but allow retries
const siweVerifyLimiter = new RateLimiter({
  max: 10, // 10 attempts per minute
  windowMs: 60_000,
});

// JWT-authenticated management endpoints (dashboard, sessions list)
// Higher limit for UI that makes multiple calls
const managementLimiter = new RateLimiter({
  max: 120, // 120 requests per minute (2/sec sustained)
  windowMs: 60_000,
});

// Reclaim operations (on-chain transactions, gas costs)
// Keep strict - these trigger actual blockchain transactions
const reclaimLimiter = new RateLimiter({
  max: 5, // 5 reclaims per 10 minutes
  windowMs: 600_000,
});

// =============================================================================
// Rate Limit Functions
// =============================================================================

// Bypass result for test environment
const testBypass: RateLimitResult = {
  allowed: true,
  remaining: 999999,
  resetAt: Date.now() + 60_000,
};

/**
 * Check rate limit for /api/supported endpoint (by IP).
 */
export function checkSupportedRateLimit(ip: string): RateLimitResult {
  if (isTest) return testBypass;
  return supportedLimiter.check(`supported:${ip}`);
}

/**
 * Check rate limit for authenticated endpoints (by API key hash).
 */
export function checkAuthRateLimit(apiKeyHash: string): RateLimitResult {
  if (isTest) return testBypass;
  return authLimiter.check(`auth:${apiKeyHash}`);
}

/**
 * Check rate limit for failed auth attempts (by IP).
 */
export function checkAuthFailureRateLimit(ip: string): RateLimitResult {
  if (isTest) return testBypass;
  return authFailureLimiter.check(`auth-fail:${ip}`);
}

/**
 * Check rate limit for nonce generation (by IP).
 */
export function checkNonceRateLimit(ip: string): RateLimitResult {
  if (isTest) return testBypass;
  return nonceLimiter.check(`nonce:${ip}`);
}

/**
 * Check rate limit for SIWE verification (by IP).
 */
export function checkSiweVerifyRateLimit(ip: string): RateLimitResult {
  if (isTest) return testBypass;
  return siweVerifyLimiter.check(`siwe:${ip}`);
}

/**
 * Check rate limit for management endpoints (by user ID).
 */
export function checkManagementRateLimit(userId: string): RateLimitResult {
  if (isTest) return testBypass;
  return managementLimiter.check(`mgmt:${userId}`);
}

/**
 * Check rate limit for reclaim operations (by wallet).
 */
export function checkReclaimRateLimit(wallet: string): RateLimitResult {
  if (isTest) return testBypass;
  return reclaimLimiter.check(`reclaim:${wallet}`);
}

/**
 * Get client IP from request (handles proxies).
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Create rate limit response headers.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.allowed ? result.remaining + 1 : 0),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}
