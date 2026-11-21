import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Read JWT signing secret from environment; fail fast if omitted.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }
  return secret;
}

/**
 * Issue a signed 24h JWT access token for an authenticated user.
 */
export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: '24h' }
  );
}

/**
 * Verify Bearer JWT token and populate req.user.
 */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized('Відсутній токен авторизації'));
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next(unauthorized('Порожній токен авторизації'));
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Restrict endpoint access to specific user roles (owner / operator).
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(forbidden('Дія доступна лише для ролі: ' + roles.join(', ')));
    }
    return next();
  };
}
