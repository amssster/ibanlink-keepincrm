import { beforeEach, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ pool: () => ({ query }) }));

import { GET } from '../src/app/api/health/route';

beforeEach(() => {
  vi.clearAllMocks();
});

it('перевіряє лише доступність бази без обробки задач', async () => {
  query.mockResolvedValueOnce({});
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(query).toHaveBeenCalledWith('SELECT 1');
});

it('повертає 503 при недоступності бази', async () => {
  query.mockRejectedValueOnce(new Error('database unavailable'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toContain('no-store');
});
