import { expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/lib/db', () => ({
  pool: () => ({ query }),
}));

import { listLinks } from '../src/lib/queries';

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ count: 0 }] });
});

it('ігнорує календарно невалідні дати у фільтрі from/to без передачі їх у SQL', async () => {
  await listLinks({ from: '2025-02-31', to: '2025-99-99' });

  const calls = query.mock.calls;
  const countSql = calls[0][0];
  const countParams = calls[0][1];

  expect(countSql).not.toContain('created_at >=');
  expect(countSql).not.toContain('created_at <');
  expect(countParams).not.toContain('2025-02-31');
  expect(countParams).not.toContain('2025-99-99');
});

it('передає валідну календарну дату у SQL', async () => {
  await listLinks({ from: '2026-11-09', to: '2026-11-10' });

  const calls = query.mock.calls;
  const countSql = calls[0][0];
  const countParams = calls[0][1];

  expect(countSql).toContain('created_at >=');
  expect(countSql).toContain('created_at <');
  expect(countParams).toContain('2026-11-09');
  expect(countParams).toContain('2026-11-10');
});
