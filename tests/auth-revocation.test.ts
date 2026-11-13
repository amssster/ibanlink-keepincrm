import { beforeEach, expect, it, vi } from 'vitest';

const { query, cookieStore } = vi.hoisted(() => ({
  query: vi.fn(),
  cookieStore: { get: vi.fn(), delete: vi.fn() },
}));

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../src/lib/db', () => ({ pool: () => ({ query }) }));

import { isOwner } from '../src/lib/auth';
import { signSession } from '../src/lib/security';
import { POST } from '../src/app/api/auth/logout/route';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  query.mockReset();
  cookieStore.get.mockReset();
  cookieStore.delete.mockReset();
});

it('відкликає скопійовану cookie після виходу, не відкликаючи іншу сесію', async () => {
  const first = signSession('a'.repeat(64));
  const second = signSession('a'.repeat(64));
  const revoked = new Set<string>();
  cookieStore.get.mockReturnValue({ value: first });
  query.mockImplementation(async (sql: string, params: string[]) => {
    if (sql.includes('INSERT INTO login_attempts')) revoked.add(params[0]);
    if (sql.includes('SELECT')) return { rows: revoked.has(params[0]) ? [{ revoked: true }] : [] };
    return { rows: [] };
  });
  expect(await isOwner()).toBe(true);
  expect((await POST(new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin: 'http://localhost:3000' },
  }))).status).toBe(303);
  expect(await isOwner()).toBe(false);
  cookieStore.get.mockReturnValue({ value: second });
  expect(await isOwner()).toBe(true);
});

it('не видаляє cookie, якщо відкликання не збережено', async () => {
  cookieStore.get.mockReturnValue({ value: signSession('a'.repeat(64)) });
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('database unavailable'));
  await expect(POST(new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin: 'http://localhost:3000' },
  }))).rejects.toThrow('database unavailable');
  expect(cookieStore.delete).not.toHaveBeenCalled();
});
