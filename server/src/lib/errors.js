/**
 * Application error with explicit HTTP status code and machine-readable error code.
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, code = 'BAD_REQUEST', details = undefined) {
  return new AppError(400, code, message, details);
}

export function unauthorized(message = 'Потрібна авторизація', code = 'UNAUTHORIZED') {
  return new AppError(401, code, message);
}

export function forbidden(message = 'Недостатньо прав доступу', code = 'FORBIDDEN') {
  return new AppError(403, code, message);
}

export function notFound(message = 'Ресурс не знайдено', code = 'NOT_FOUND') {
  return new AppError(404, code, message);
}

export function conflict(message, code = 'CONFLICT', details = undefined) {
  return new AppError(409, code, message, details);
}
