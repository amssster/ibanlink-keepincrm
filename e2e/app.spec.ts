import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { migrate } from '../scripts/migrate';
import { pool } from '../src/lib/db';
import { saveSettings } from '../src/lib/settings';
import { receive } from '../src/lib/pipeline';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
async function checkContrast(page: Page) {
  await page.addScriptTag({ path: axePath });
  const issues = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: unknown[] }> } }).axe;
    return (await axe.run({ runOnly: { type: 'rule', values: ['color-contrast'] } })).violations;
  });
  expect(issues).toEqual([]);
}

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !/(_test|_e2e)$/.test(new URL(process.env.TEST_DATABASE_URL).pathname)
  )
    throw new Error('Використовуйте тестову БД');
  await migrate();
  await pool().query(
    'TRUNCATE jobs,inbox,links,deals,audit,login_attempts RESTART IDENTITY CASCADE',
  );
  await pool().query("UPDATE settings SET data='{}'");
  await saveSettings({
    recipients: [
      {
        key: 'Основний',
        name: 'Тестовий ФОП',
        brand: 'Добрі речі',
        iban: 'UA890000000000000000000000000',
        taxId: '00000000',
        purposeTemplate: 'Оплата за замовлення №{deal_id}',
        note: 'Дякуємо за покупку!',
      },
      {
        key: 'Другий',
        name: 'ТОВ Другий Отримувач',
        brand: 'Другий Бренд',
        iban: 'UA890000000000000000000000000',
        taxId: '00000000',
        purposeTemplate: 'Оплата товару за угодою №{deal_id}',
      },
    ],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    enabled: false,
  });
});

test.afterAll(async () => {
  await pool().end();
});

test('HTTP логотипи зберігають спеціальні символи ключа', async ({ request }) => {
  const keys = ['%', '%20', 'Кирилиця', 'Пробіл ключ'];
  const data = 'data:image/png;base64,aGVsbG8=';
  for (const key of keys) {
    await pool().query('INSERT INTO recipient_logos(key, data) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET data=$2', [key, data]);
    const response = await request.get(`/api/recipients/${encodeURIComponent(key)}/logo`);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(Buffer.from('hello'));
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  }
  await pool().query('DELETE FROM recipient_logos WHERE key = ANY($1)', [keys]);
});

test('корінь та login показують вхід і підтримку', async ({ page }) => {
  for (const path of ['/', '/login']) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByLabel('Пароль')).toBeVisible();
    await expect(page.locator('a[href="https://ibanlink.online"]')).toBeVisible();
  }
  await page.goto('/');
  await checkContrast(page);
  await page.getByLabel('Пароль').fill('incorrect password');
  await page.getByRole('button', { name: 'Увійти до кабінету' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Неправильний пароль' })).toBeVisible();
  await checkContrast(page);
  await page.getByLabel('Пароль').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Увійти до кабінету' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/admin$/);
});

for (const width of [375, 768, 1440]) {
  test(`вхід адаптується до ширини ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByLabel('Пароль')).toBeVisible();
    await expect(page.locator('a[href="https://ibanlink.online"]')).toBeVisible();
    if (width === 375) {
      const button = await page.getByRole('button', { name: 'Увійти до кабінету' }).boundingBox();
      expect(button!.width).toBeGreaterThanOrEqual(44);
      expect(button!.height).toBeGreaterThanOrEqual(44);
      const borderContrast = await page.getByLabel('Пароль').evaluate((input) => {
        const luminance = (color: string) => {
          const [r, g, b] = color.match(/\d+/g)!.slice(0, 3).map(Number).map((value) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(input);
        const border = luminance(style.borderTopColor);
        const background = luminance(style.backgroundColor);
        return (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05);
      });
      expect(borderContrast).toBeGreaterThanOrEqual(3);
    }
    await page.screenshot({ path: `test-results/login-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus-visible');
    await expect(focused).toBeVisible();
    const color = await focused.evaluate((element) => getComputedStyle(element).outlineColor);
    const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(3);
  });
}

test('маркетингові маршрути відсутні у сервісі', async ({ request }) => {
  for (const path of ['/integrations', '/privacy', '/terms']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});

test('сервіс забороняє індексацію усіх маршрутів', async ({ request }) => {
  for (const path of ['/', '/login', '/admin', '/p/not-a-real-token', '/api/health']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()['x-robots-tag']).toMatch(/noindex.*nofollow/i);
  }
});

test('незахищений доступ і підроблені webhooks відхиляються', async ({ request, page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin/settings/webhooks');
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.post('/api/webhooks/keepincrm/issue', { data: {} })).status()).toBe(401);
  expect(
    (
      await request.post('/api/auth/login', {
        data: { password: 'wrong' },
        headers: { Origin: 'https://evil.example' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/admin/settings', {
        data: {},
        headers: { Origin: 'http://localhost:3100' },
      })
    ).status(),
  ).toBe(401);
});

test('вхід без JavaScript не передає пароль у URL', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: 'http://localhost:3100',
  });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Пароль').fill(process.env.E2E_OWNER_PASSWORD!);
    await page.getByRole('button', { name: 'Увійти до кабінету' }).click();
    await expect(page).toHaveURL('http://localhost:3100/admin');
    await expect(page.getByRole('heading', { name: 'Огляд оплат' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('прийнятий webhook зберігається як проба; відсутня сплачена сума відхиляється', async ({
  request,
}) => {
  const headers = { Authorization: `Bearer ${process.env.WEBHOOK_ISSUE_SECRET}` };
  const event = {
    event_id: 'probe-17',
    deal_id: '17',
    event_at: new Date().toISOString(),
    total: '2500',
    paid: '500',
    currency: 'UAH',
    stage: 'Очікує оплати',
    recipient_key: 'Основний',
  };
  const accepted = await request.post('/api/webhooks/keepincrm/issue', { data: event, headers });
  expect(accepted.status()).toBe(200);
  const result = await accepted.json();
  expect(result).toMatchObject({
    status: 'probe',
    payment_url: 'http://localhost:3100/integration-check',
  });
  expect((await request.get(result.payment_url)).status()).toBe(200);
  expect(
    (
      await request.post('/api/webhooks/keepincrm/issue', {
        data: { ...event, paid: undefined },
        headers,
      })
    ).status(),
  ).toBe(400);
});

test('власник входить, бачить пробу і налаштування без розкриття API-ключа', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/login');
  await page.getByLabel('Пароль').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Увійти до кабінету' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Огляд оплат' })).toBeVisible();
  await checkContrast(page);
  await expect(page.getByRole('link', { name: 'На сайт' })).toHaveAttribute('href', 'https://ibanlink.online');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Огляд оплат' })).toBeVisible();
    await page.screenshot({ path: `test-results/admin-${width}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Події', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  const searchButton = await page.getByRole('button', { name: 'Знайти' }).boundingBox();
  expect(searchButton!.height).toBeGreaterThanOrEqual(44);
  expect(searchButton!.width).toBeGreaterThanOrEqual(44);
  await expect(page.getByText('probe-17', { exact: true })).toBeVisible();
  await checkContrast(page);
  await page.getByRole('link', { name: 'Отримувачі', exact: true }).click();
  await expect(page.getByText('Добрі речі')).toBeVisible();
  await expect(page.getByText('Другий Бренд')).toBeVisible();
  await checkContrast(page);
  await page.getByRole('link', { name: 'Підключення', exact: true }).click();
  const badge = page.locator('.badge.probe');
  await expect(badge).toBeVisible();
  await checkContrast(page);
  const contrasts = await badge.evaluate((element) => {
    const luminance = (color: string) => {
      const rgb = color.match(/\d+/g)!.slice(0, 3).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const clone = element.cloneNode(true) as HTMLElement;
    document.body.appendChild(clone);
    const results = ['badge', 'badge active', 'badge paid', 'badge partial', 'badge probe', 'badge expired', 'badge disabled', 'badge replaced'].map((name) => {
      clone.className = name;
      const style = getComputedStyle(clone);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return [name, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)] as const;
    });
    clone.remove();
    return results;
  });
  for (const [name, contrast] of contrasts) expect(contrast, name).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByLabel('API-ключ', { exact: true })).toHaveCount(0);
  await expect(page.locator('code').filter({ hasText: /^\$\.payment_url$/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Налаштувати webhooks' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/webhooks$/);
  await checkContrast(page);
  await expect(page.locator('code').filter({ hasText: /^\$\.payment_url$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Копіювати шаблон JSON' })).toHaveCount(2);
  await expect(page.locator('code').filter({ hasText: /^Bearer •{32}$/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Показати секрет' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Копіювати заголовок' })).toHaveCount(2);
  await expect(page.getByText(process.env.WEBHOOK_ISSUE_SECRET!)).toHaveCount(0);
  await page.getByRole('button', { name: 'Показати секрет' }).first().click();
  await expect(page.getByText(`Bearer ${process.env.WEBHOOK_ISSUE_SECRET!}`)).toBeVisible();
  await page.getByRole('button', { name: 'Сховати секрет' }).first().click();
  await expect(page.getByText(process.env.WEBHOOK_ISSUE_SECRET!)).toHaveCount(0);
  await expect(page.getByText('Підключення', { exact: true })).toHaveClass(/selected/);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('link', { name: 'Повернутися до підключення' }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await page.screenshot({ path: 'test-results/admin-settings.png', fullPage: true });
  await page.getByRole('link', { name: 'Посилання', exact: true }).click();
  await checkContrast(page);
  await expect(page.getByLabel('Від', { exact: true })).toBeVisible();
  await expect(page.getByLabel('До', { exact: true })).toBeVisible();
  await page.getByLabel('Від', { exact: true }).fill('2025-01-01');
  await page.getByLabel('До', { exact: true }).fill('2025-12-31');
  await page.getByRole('button', { name: 'Фільтрувати' }).click();
  await expect(page).toHaveURL(/from=2025-01-01.*to=2025-12-31/);
  await page.setViewportSize({ width: 320, height: 800 });
  const filterButton = await page.getByRole('button', { name: 'Фільтрувати' }).boundingBox();
  expect(filterButton!.height).toBeGreaterThanOrEqual(44);
  for (const field of await page.locator('.filter-form input, .filter-form select').all()) {
    const bounds = await field.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('button', { name: 'Вийти' }).filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Отримувачі', exact: true }).click();
  await expect(page.locator('.recipient-card')).toHaveCount(2);
  for (const button of await page.locator('.recipient-card .card-actions button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  for (const card of await page.locator('.recipient-card').all()) {
    await expect(card.locator('.card-actions button')).toHaveCount(3);
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    for (const button of await card.locator('.card-actions button').all()) {
      const buttonBounds = await button.boundingBox();
      expect(buttonBounds).not.toBeNull();
      expect(buttonBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    }
  }
  await page.getByRole('button', { name: 'Вийти' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

test('мобільна сторінка показує залишок, нотатку, завантаження QR; оплата блокує посилання', async ({
  page,
  request,
}) => {
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','true')");
  const event = {
    event_id: 'live-42',
    deal_id: '42',
    event_at: new Date(Date.now() - 10000).toISOString(),
    total: '5000',
    paid: '1000',
    currency: 'UAH',
    stage: 'Очікує оплати',
    recipient_key: 'Основний',
  };
  const created = await request.post('/api/webhooks/keepincrm/issue', {
    data: event,
    headers: { Authorization: `Bearer ${process.env.WEBHOOK_ISSUE_SECRET}` },
  });
  expect(created.status()).toBe(200);
  expect((await created.json()).payment_url).toMatch(/^http:\/\/localhost:3100\/p\//);
  const link = (await pool().query('SELECT token FROM links WHERE deal_id=$1', ['42'])).rows[0];
  const longName = 'ДовгийТестовийОтримувач'.repeat(3);
  expect([...longName].length).toBeLessThanOrEqual(70);
  await pool().query("UPDATE links SET recipient = jsonb_set(recipient, '{name}', to_jsonb($1::text)) WHERE token=$2", [longName, link.token]);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/p/${link.token}`);
    await expect(page.getByTestId('amount')).toBeVisible();
    await checkContrast(page);
    await page.screenshot({ path: `test-results/payment-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/p/${link.token}`);
    await expect(page.getByText(longName, { exact: true })).toBeVisible();
    await expect(page.getByText('UA890000000000000000000000000', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await page.getByText(longName, { exact: true }).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${link.token}`);
  await page.screenshot({ path: 'test-results/payment-demo.png', fullPage: true });
  await expect(page.getByRole('heading', { name: 'Оплата замовлення №42' })).toBeVisible();
  await expect(page.getByTestId('amount')).toHaveText(/4\s?000,00/);
  await expect(page.getByText('Дякуємо за покупку!')).toBeVisible();
  await expect(page.getByRole('link', { name: /Monobank/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Приват24/ })).toBeVisible();
  expect((await request.get(`/api/pay/${link.token}/qr`)).status()).toBe(200);

  await page.evaluate(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    Object.assign(window, { qrBlobUrls: { created, revoked } });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити QR (PNG)' }).click();
  const download = await downloadPromise;
  const png = await readFile((await download.path())!);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(1000);
  expect(png.readUInt32BE(20)).toBe(1000);
  await expect.poll(() => page.evaluate(() => {
    const urls = (window as unknown as { qrBlobUrls: { created: string[]; revoked: string[] } }).qrBlobUrls;
    return [urls.created.length, urls.revoked.length, urls.created.every((url) => urls.revoked.includes(url))];
  })).toEqual([2, 2, true]);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    Object.assign(window, { originalToBlob: original });
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
  });
  await page.getByRole('button', { name: 'Завантажити QR (PNG)' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не вдалося завантажити QR-код' })).toBeVisible();
  await checkContrast(page);
  await expect.poll(() => page.evaluate(() => {
    const urls = (window as unknown as { qrBlobUrls: { created: string[]; revoked: string[] } }).qrBlobUrls;
    return [urls.created.length, urls.revoked.length, urls.created.every((url) => urls.revoked.includes(url))];
  })).toEqual([3, 3, true]);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = (window as unknown as { originalToBlob: typeof HTMLCanvasElement.prototype.toBlob }).originalToBlob;
    const originalClick = HTMLAnchorElement.prototype.click;
    Object.assign(window, { originalAnchorClick: originalClick });
    HTMLAnchorElement.prototype.click = () => { throw new Error('download failed'); };
  });
  await page.getByRole('button', { name: 'Завантажити QR (PNG)' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не вдалося завантажити QR-код' })).toBeVisible();
  await checkContrast(page);
  await expect.poll(() => page.evaluate(() => {
    const urls = (window as unknown as { qrBlobUrls: { created: string[]; revoked: string[] } }).qrBlobUrls;
    return [urls.created.length, urls.revoked.length, urls.created.every((url) => urls.revoked.includes(url))];
  })).toEqual([5, 5, true]);
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = (window as unknown as { originalAnchorClick: typeof HTMLAnchorElement.prototype.click }).originalAnchorClick;
  });

  await page.screenshot({ path: 'test-results/payment-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/payment-desktop.png', fullPage: true });

  await receive('payment', {
    ...event,
    event_id: 'paid-42',
    event_at: new Date().toISOString(),
    payment_id: '5',
    kind: 'debit',
    planned: false,
    paid: '5000',
  });
  await page.reload();
  await expect(page.getByText('Оплату відмічено в CRM', { exact: true })).toBeVisible();
  await checkContrast(page);
  await expect(page.getByRole('link', { name: /Monobank/ })).toHaveCount(0);
  expect((await request.get(`/api/pay/${link.token}/qr`)).status()).toBe(410);
  expect(
    (
      await request.post('/api/webhooks/keepincrm/issue', {
        data: event,
        headers: { Authorization: `Bearer ${process.env.WEBHOOK_ISSUE_SECRET}` },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await request.get(`/api/pay/${link.token}/open?bank=mono`, { maxRedirects: 0 })).status(),
  ).toBe(410);
  for (const [status, label] of [['disabled', 'Вимкнено'], ['expired', 'Термін минув']] as const) {
    await pool().query("UPDATE links SET status=$1, expires_at=CASE WHEN $1='active' THEN now() - interval '1 day' ELSE expires_at END WHERE token=$2", [status === 'expired' ? 'active' : status, link.token]);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkContrast(page);
    }
  }
});

test('мультотримувачі: маршрутизація, призупинення та заміна отримувача', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${process.env.WEBHOOK_ISSUE_SECRET}` };

  // 1. Подія без поля recipient_key повертає skipped без URL
  const noKeyRes = await request.post('/api/webhooks/keepincrm/issue', {
    data: {
      event_id: 'multi-no-key',
      deal_id: '88',
      event_at: new Date().toISOString(),
      total: '1000',
      paid: '0',
      currency: 'UAH',
      stage: 'Очікує оплати',
    },
    headers,
  });
  expect(noKeyRes.status()).toBe(409);
  const noKeyBody = await noKeyRes.json();
  expect(noKeyBody.status).toBe('skipped');
  expect(noKeyBody.payment_url).toBeUndefined();

  // 2. Подія з другим отримувачем
  const secondRes = await request.post('/api/webhooks/keepincrm/issue', {
    data: {
      event_id: 'multi-second-1',
      deal_id: '88',
      event_at: new Date().toISOString(),
      total: '1000',
      paid: '0',
      currency: 'UAH',
      stage: 'Очікує оплати',
      recipient_key: 'Другий',
    },
    headers,
  });
  expect(secondRes.status()).toBe(200);
  const secondBody = await secondRes.json();
  expect(secondBody.payment_url).toBeTruthy();

  await page.goto(secondBody.payment_url);
  await expect(page.getByRole('heading', { name: 'Оплата замовлення №88' })).toBeVisible();
  await expect(page.getByText('Другий Бренд', { exact: true })).toBeVisible();

  // 3. Зміна отримувача на тій самій угоді створює новий лінк
  const replacedRes = await request.post('/api/webhooks/keepincrm/issue', {
    data: {
      event_id: 'multi-second-2',
      deal_id: '88',
      event_at: new Date(Date.now() + 5000).toISOString(),
      total: '1000',
      paid: '0',
      currency: 'UAH',
      stage: 'Очікує оплати',
      recipient_key: 'Основний',
    },
    headers,
  });
  expect(replacedRes.status()).toBe(200);
  const replacedBody = await replacedRes.json();
  expect(replacedBody.payment_url).toBeTruthy();
  expect(replacedBody.payment_url).not.toBe(secondBody.payment_url);

  // Старий лінк тепер replaced
  await page.goto(secondBody.payment_url);
  await expect(page.getByText('Це посилання більше не діє')).toBeVisible();

  // Новий лінк показує Бренд Один
  await page.goto(replacedBody.payment_url);
  await expect(page.getByText('Добрі речі', { exact: true })).toBeVisible();

  // 4. Призупинення отримувача
  await pool().query(
    `UPDATE settings SET data = jsonb_set(
      data,
      '{recipients,0,suspended}',
      'true'
    )`
  );

  // Відкриття чинного лінка призупиненого отримувача показує відповідний стан
  await page.goto(replacedBody.payment_url);
  await expect(page.getByRole('heading', { name: 'Отримувача призупинено' })).toBeVisible();

  // Відновлюємо отримувача
  await pool().query(
    `UPDATE settings SET data = jsonb_set(
      data,
      '{recipients,0,suspended}',
      'false'
    )`
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Оплата замовлення №88' })).toBeVisible();
});
