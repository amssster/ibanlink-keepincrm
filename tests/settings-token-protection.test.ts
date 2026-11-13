import { expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/lib/db', () => ({
  pool: () => ({ query }),
  transaction: async (fn: (db: { query: typeof query }) => Promise<void>) => fn({ query }),
}));

vi.mock('../src/lib/auth', () => ({
  authorizeMutation: vi.fn().mockResolvedValue(null),
  requireOwner: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/components/settings-form', () => ({
  SettingsForm: () => null,
}));

import { POST } from '../src/app/api/admin/settings/route';
import SettingsPage from '../src/app/admin/settings/page';
import { SettingsForm } from '../src/components/settings-form';

function findPropsFor(node: unknown, target: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const el = node as { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
  if (el.type === target) return el.props;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPropsFor(item, target);
      if (found) return found;
    }
    return undefined;
  }
  if (el.props?.children) return findPropsFor(el.props.children, target);
  return undefined;
}

beforeEach(() => {
  query.mockReset();
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('APP_URL', 'http://localhost:3000');
});

it('SettingsPage не передає telegramBotToken клієнту, а передає hasTelegramBotToken', async () => {
  const existing = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '123456:secret_bot_token',
    telegramChatId: '123456789',
    enabled: false,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });

  const tree = await SettingsPage();
  const formProps = findPropsFor(tree, SettingsForm) as { initial: Record<string, unknown> } | undefined;
  expect(formProps).toBeDefined();
  expect(formProps!.initial.telegramBotToken).toBeUndefined();
  expect(formProps!.initial.hasTelegramBotToken).toBe(true);
});

it('якщо токен порожній, старий токен зберігається без змін', async () => {
  const existing = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '123456:secret_bot_token',
    telegramChatId: '123456789',
    enabled: false,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({});
  query.mockResolvedValueOnce({});

  const req = new Request('http://localhost:3000/api/admin/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
    },
    body: JSON.stringify({
      stage: 'Очікує оплати',
      field: 'Посилання на оплату IBAN',
      linkTtlDays: 7,
      telegramBotToken: '',
      telegramChatId: '123456789',
      enabled: false,
    }),
  });

  const res = await POST(req);
  expect(res.status).toBe(200);

  const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE settings'));
  expect(updateCall).toBeDefined();
  const savedData = updateCall![1][0];
  expect(savedData.telegramBotToken).toBe('123456:secret_bot_token');
});

it('якщо передано прапорець clearTelegramBotToken, токен очищується', async () => {
  const existing = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '123456:secret_bot_token',
    telegramChatId: '123456789',
    enabled: false,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({});
  query.mockResolvedValueOnce({});

  const req = new Request('http://localhost:3000/api/admin/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
    },
    body: JSON.stringify({
      stage: 'Очікує оплати',
      field: 'Посилання на оплату IBAN',
      linkTtlDays: 7,
      telegramBotToken: '',
      clearTelegramBotToken: true,
      telegramChatId: '123456789',
      enabled: false,
    }),
  });

  const res = await POST(req);
  expect(res.status).toBe(200);

  const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE settings'));
  const savedData = updateCall![1][0];
  expect(savedData.telegramBotToken).toBe('');
});

it('якщо введено новий непорожній токен, він оновлюється з trim', async () => {
  const existing = {
    recipients: [],
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
    linkTtlDays: 7,
    telegramBotToken: '123456:old_token',
    telegramChatId: '123456789',
    enabled: false,
    contractSince: new Date(0).toISOString(),
    configVersion: 'v1',
  };
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [{ data: existing }] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({});
  query.mockResolvedValueOnce({});

  const req = new Request('http://localhost:3000/api/admin/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
    },
    body: JSON.stringify({
      stage: 'Очікує оплати',
      field: 'Посилання на оплату IBAN',
      linkTtlDays: 7,
      telegramBotToken: '  999888:new_token  ',
      telegramChatId: '123456789',
      enabled: false,
    }),
  });

  const res = await POST(req);
  expect(res.status).toBe(200);

  const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE settings'));
  const savedData = updateCall![1][0];
  expect(savedData.telegramBotToken).toBe('999888:new_token');
});

