import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load local root .env if present; in production env vars are injected by the host platform.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const prisma = new PrismaClient();
