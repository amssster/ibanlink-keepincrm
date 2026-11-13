import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import config from '../next.config';

const require = createRequire(import.meta.url);
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (path: string) => RegExp;
};

it('правило private, no-store у next.config.ts виключає маршрути логотипів та QR, зберігаючи безпекові заголовки', async () => {
  const headers = await config.headers!();
  expect(headers).toBeDefined();

  const noStoreRules = headers.filter((h) =>
    h.headers.some((header) => header.key === 'Cache-Control' && header.value.includes('no-store')),
  );
  expect(noStoreRules.length).toBeGreaterThan(0);

  for (const rule of noStoreRules) {
    const matcher = pathToRegexp(rule.source);
    expect(matcher.test('/admin/links')).toBe(true);
    expect(matcher.test('/p/abc123')).toBe(true);
    expect(matcher.test('/api/recipients/Main/logo')).toBe(false);
    expect(matcher.test('/api/pay/someToken/qr')).toBe(false);
    expect(matcher.test('/api/recipients/Main/logos')).toBe(true);
    expect(matcher.test('/api/pay/someToken/qrcode')).toBe(true);
  }

  const securityRule = headers.find((h) => h.source === '/:path*');
  expect(securityRule).toBeDefined();
  expect(securityRule!.headers.some((h) => h.key === 'X-Content-Type-Options' && h.value === 'nosniff')).toBe(true);
});
