import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/security';
const db = process.env.TEST_DATABASE_URL;
if (!db || !/(_test|_e2e)$/.test(new URL(db).pathname))
  throw new Error('Потрібна окрема TEST_DATABASE_URL з назвою *_test або *_e2e');
const password = randomBytes(24).toString('hex');
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: db,
    APP_URL: 'http://localhost:3100',
    OWNER_PASSWORD_HASH: await hashPassword(password),
    E2E_OWNER_PASSWORD: password,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    WEBHOOK_ISSUE_SECRET: randomBytes(32).toString('hex'),
    WEBHOOK_PAYMENT_SECRET: randomBytes(32).toString('hex'),
  },
});
child.on('exit', (code) => (process.exitCode = code ?? 1));
