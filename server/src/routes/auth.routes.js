import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { unauthorized } from '../lib/errors.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { createLoginRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';

const loginBodySchema = z.object({
  email: z.string().email('Некоректний email'),
  password: z.string().min(1, 'Введіть пароль'),
});

export function createAuthRouter({ enableRateLimit = true } = {}) {
  const router = Router();
  const limiter = enableRateLimit ? createLoginRateLimiter() : (_req, _res, next) => next();

  router.post(
    '/login',
    limiter,
    validate({ body: loginBodySchema }),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

      if (!user) {
        throw unauthorized('Невірний email або пароль');
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        throw unauthorized('Невірний email або пароль');
      }

      const token = signToken(user);
      await logAudit({
        userId: user.id,
        action: 'USER_LOGIN',
        entity: 'user',
        entityId: user.id,
      });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    })
  );

  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
      if (!user) {
        throw unauthorized('Користувача не знайдено');
      }
      res.json({ user });
    })
  );

  return router;
}
