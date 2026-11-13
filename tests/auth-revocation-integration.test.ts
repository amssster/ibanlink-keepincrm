import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { pool } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { isOwner, revokeSession } from '../src/lib/auth';
import { signSession } from '../src/lib/security';
import { POST } from '../src/app/api/auth/logout/route';

if (!process.env.TEST_DATABASE_URL || !/(_test|_e2e)$/.test(new URL(process.env.TEST_DATABASE_URL).pathname))
  throw new Error('Потрібна окрема TEST_DATABASE_URL *_test або *_e2e');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SESSION_SECRET = 'a'.repeat(64);
process.env.APP_URL = 'http://localhost:3000';
const buckets: string[] = [];
const bucket = (value: string) => `revoked:${createHash('sha256').update(value).digest('hex')}`;

beforeAll(async () => { await migrate(); });
afterAll(async () => {
  vi.restoreAllMocks();
  await pool().query('DELETE FROM login_attempts WHERE bucket=ANY($1::text[])', [buckets]);
  await pool().end();
});

it('зберігає відкликання за випередження годинника PostgreSQL і наступного logout', async () => {
  const now = Date.now() - 24 * 3600 * 1000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const first = signSession(process.env.SESSION_SECRET!, now);
  const second = signSession(process.env.SESSION_SECRET!, now);
  buckets.push(bucket(first), bucket(second));
  cookieStore.get.mockReturnValue({ value: first });
  const request = () => new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin: 'http://localhost:3000' },
  });
  expect(await isOwner()).toBe(true);
  expect((await POST(request())).status).toBe(303);
  expect(await isOwner()).toBe(false);
  expect((await POST(request())).status).toBe(401);
  await revokeSession(second);
  expect(await isOwner()).toBe(false);
  expect((await pool().query('SELECT 1 FROM login_attempts WHERE bucket=$1', [bucket(first)])).rowCount).toBe(1);
  clock.mockRestore();
});

it('відхиляє повторний logout з простроченою cookie і стороннім origin', async () => {
  const expired = signSession(process.env.SESSION_SECRET!, Date.now() - 9 * 3600 * 1000);
  cookieStore.get.mockReturnValue({ value: expired });
  const request = (origin: string) => new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin },
  });
  expect((await POST(request('http://localhost:3000'))).status).toBe(401);
  expect((await POST(request('https://evil.example'))).status).toBe(403);
});
