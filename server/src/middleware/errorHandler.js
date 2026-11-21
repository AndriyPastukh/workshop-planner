import { ZodError } from 'zod';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req, _res, next) {
  next(notFound('Endpoint not found'));
}

/**
 * Centralized Express error handler mapping domain, Zod, JWT, and Prisma errors to JSON responses.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Помилка валідації вхідних даних',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Недійсний або протермінований токен авторизації',
      },
    });
  }

  // Prisma well-known request error codes
  if (typeof err?.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Запис із такими унікальними значеннями вже існує',
          details: err.meta,
        },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Запитуваний запис не знайдено',
        },
      });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        error: {
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Посилання на неіснуючий пов’язаний запис або обмеження цілісності',
        },
      });
    }
  }

  logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled API error');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Внутрішня помилка сервера',
    },
  });
}
