import { expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/lib/db', () => ({
  pool: () => ({ query }),
}));

vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({
    telegramBotToken: 'token123',
    telegramChatId: 'chat456',
  }),
}));

import { sendTelegramNotification } from '../src/lib/pipeline';
import { formatMoney } from '../src/lib/queries';

beforeEach(() => {
  query.mockReset();
});

it('формує зрозумілий текст сповіщення для часткової оплати із зазначенням накопиченої суми', async () => {
  query.mockResolvedValueOnce({
    rows: [{
      result: 'partial',
      payload: { paidMinor: 50000, totalMinor: 150000 },
    }],
  });
  query.mockResolvedValueOnce({
    rows: [{
      amount_minor: 100000,
      recipient: { key: 'Основний' },
    }],
  });

  let sentBody: { chat_id?: string; text?: string } | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
    sentBody = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  try {
    await sendTelegramNotification({ ref_id: 'inbox1', deal_id: '105' });
    expect(sentBody?.text).toContain('Оплату підтверджено: угода №105');
    expect(sentBody?.text).toContain('сума 500,00 ₴');
    expect(sentBody?.text).toContain('частково (накопичено)');
    expect(sentBody?.text).toContain('отримувач Основний');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('формує зрозумілий текст сповіщення для повної оплати', async () => {
  query.mockResolvedValueOnce({
    rows: [{
      result: 'settle',
      payload: { paidMinor: 150000, totalMinor: 150000 },
    }],
  });
  query.mockResolvedValueOnce({
    rows: [{
      amount_minor: 150000,
      recipient: { key: 'Основний' },
    }],
  });

  let sentBody: { chat_id?: string; text?: string } | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
    sentBody = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  try {
    await sendTelegramNotification({ ref_id: 'inbox2', deal_id: '106' });
    expect(sentBody?.text).toContain('Оплату підтверджено: угода №106');
    expect(sentBody?.text).toContain(`сума ${formatMoney(150000)} ₴`);
    expect(sentBody?.text).toContain('повністю');
    expect(sentBody?.text).toContain('отримувач Основний');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
