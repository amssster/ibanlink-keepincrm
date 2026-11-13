import { expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/lib/db', () => ({
  pool: () => ({ query }),
  transaction: async (fn: (db: { query: typeof query }) => Promise<void>) => fn({ query }),
}));

vi.mock('../src/lib/auth', () => ({
  authorizeMutation: vi.fn().mockResolvedValue(null),
}));

import { POST as settingsPost } from '../src/app/api/admin/settings/route';
import { POST as recipientsPost } from '../src/app/api/admin/recipients/route';

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('APP_URL', 'http://localhost:3000');
});

it('якщо інтеграція вже активна, збереження безпечних полів успішне без confirmed', async () => {
  const activeSettings = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '',
    telegramChatId: '111',
    enabled: true,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM settings')) return { rows: [{ data: activeSettings }] };
    return { rows: [] };
  });

  const req = new Request('http://localhost:3000/api/admin/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    body: JSON.stringify({
      stage: 'Очікує оплати',
      field: 'Посилання на оплату IBAN',
      linkTtlDays: 14,
      telegramChatId: '222',
      enabled: true,
      confirmed: false,
    }),
  });

  const res = await settingsPost(req);
  expect(res.status).toBe(200);
});

it('при первинній активації інтеграції confirmed обов’язковий', async () => {
  const inactiveSettings = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '',
    telegramChatId: '111',
    enabled: false,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM settings')) return { rows: [{ data: inactiveSettings }] };
    return { rows: [] };
  });

  const req = new Request('http://localhost:3000/api/admin/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    body: JSON.stringify({
      stage: 'Очікує оплати',
      field: 'Посилання на оплату IBAN',
      enabled: true,
      confirmed: false,
    }),
  });

  const res = await settingsPost(req);
  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toContain('Підтвердьте перевірку');
});

it('при зміні критичних реквізитів recipients/route повертає integrationDisabled: true', async () => {
  const stored = {
    recipients: [{
      key: 'Основний',
      name: 'ФОП Старий',
      brand: 'Бренд',
      iban: 'UA890000000000000000000000000',
      taxId: '00000000',
      purposeTemplate: 'Оплата {deal_id}',
    }],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '',
    telegramChatId: '',
    enabled: true,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM settings')) return { rows: [{ data: stored }] };
    return { rows: [] };
  });

  const req = new Request('http://localhost:3000/api/admin/recipients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    body: JSON.stringify({
      recipients: [{
        key: 'Основний',
        name: 'ФОП Новий',
        brand: 'Бренд',
        iban: 'UA890000000000000000000000000',
        taxId: '00000000',
        purposeTemplate: 'Оплата {deal_id}',
      }],
    }),
  });

  const res = await recipientsPost(req);
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.integrationDisabled).toBe(true);
});
