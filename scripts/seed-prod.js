import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../server/src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedScriptPath = path.resolve(__dirname, '../server/prisma/seed.js');

async function main() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`Production seed skipped: database already contains ${userCount} user(s).`);
    return;
  }

  console.log('Empty database detected. Seeding initial demo data...');
  execFileSync(process.execPath, [seedScriptPath], { stdio: 'inherit' });
}

main()
  .catch((err) => {
    console.error('Production seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
