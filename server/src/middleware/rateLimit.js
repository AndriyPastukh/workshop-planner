import rateLimit from 'express-rate-limit';

/**
 * Create a rate limiter for authentication attempts to mitigate brute-force attacks.
 */
export function createLoginRateLimiter({ max = 20, windowMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Забагато спроб входу. Спробуйте пізніше.',
        },
      });
    },
  });
}
