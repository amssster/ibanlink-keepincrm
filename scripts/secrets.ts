import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashPassword } from '../src/lib/security';
let password = process.env.OWNER_SETUP_PASSWORD;
if (!password) {
  const prompt = createInterface({ input: stdin, output: stdout });
  password = await prompt.question('Новий пароль власника (від 16 символів): ');
  prompt.close();
}
if (password.length < 16 || password.length > 256)
  throw new Error('Пароль має містити 16–256 символів');
const random = () => randomBytes(32).toString('hex');
const dbPassword = random(),
  local = process.argv.includes('--local');
const content = [
  `DOMAIN=pay.example.com`,
  `APP_URL=${local ? 'http://localhost:3000' : 'https://pay.example.com'}`,
  `DATABASE_URL=postgresql://iban:${dbPassword}@localhost:55432/iban`,
  `POSTGRES_USER=iban`,
  `POSTGRES_DB=iban`,
  `POSTGRES_PASSWORD=${dbPassword}`,
  `SESSION_SECRET=${random()}`,
  `OWNER_PASSWORD_HASH=${await hashPassword(password)}`,
  `WEBHOOK_ISSUE_SECRET=${random()}`,
  `WEBHOOK_PAYMENT_SECRET=${random()}`,
  '',
].join('\n');
if (process.argv.includes('--write')) {
  await writeFile('.env', content, { flag: 'wx', mode: 0o600 });
  console.log('Створено .env. Наявний файл не перезаписується.');
} else {
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/generated.env', content, { mode: 0o600 });
  console.log('Створено tmp/generated.env. Перенесіть налаштування до .env.');
}
