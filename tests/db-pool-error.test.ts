import { expect, it, vi } from 'vitest';
import pg from 'pg';

process.env.DATABASE_URL = 'postgresql://iban:test@localhost:5432/iban_test';

it('пул реєструє обробник події error для запобігання unhandled error', async () => {
  delete (globalThis as { ibanPool?: unknown }).ibanPool;
  const fakePool = {
    on: vi.fn(),
  };
  vi.spyOn(pg, 'Pool').mockImplementation(function () {
    return fakePool as unknown as pg.Pool;
  });

  const { pool } = await import('../src/lib/db');
  const instance = pool();
  expect(instance).toBeDefined();
  expect(fakePool.on).toHaveBeenCalledWith('error', expect.any(Function));

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const errorHandler = fakePool.on.mock.calls.find(([event]) => event === 'error')?.[1] as
    | ((err: Error) => void)
    | undefined;
  expect(errorHandler).toBeDefined();
  expect(() => errorHandler!(new Error('idle socket error'))).not.toThrow();
  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});
