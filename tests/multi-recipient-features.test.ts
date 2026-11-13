import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { saveSettings, getSettings } from '../src/lib/settings';
import { receive, extendLink, sendTelegramNotification } from '../src/lib/pipeline';
import { validateRecipientConfig, type RecipientConfig } from '../src/lib/payment';
import { listLinks, formatMoney } from '../src/lib/queries';

if (
  !process.env.TEST_DATABASE_URL ||
  !/(_test|_e2e)$/.test(new URL(process.env.TEST_DATABASE_URL).pathname)
)
  throw new Error('Потрібна окрема TEST_DATABASE_URL *_test або *_e2e');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = 'http://localhost:3000';

const r1: RecipientConfig = {
  key: 'Основний',
  name: 'ФОП Перший Отримувач',
  brand: 'Бренд Один',
  taxId: '00000000',
  iban: 'UA890000000000000000000000000',
  purposeTemplate: 'Оплата за замовлення №{deal_id}',
  note: 'Швидка доставка',
};

const r2: RecipientConfig = {
  key: 'Другий',
  name: 'ТОВ Другий Отримувач',
  brand: 'Бренд Два',
  taxId: '00000000',
  iban: 'UA890000000000000000000000000',
  purposeTemplate: 'Оплата товару за угодою №{deal_id}',
  suspended: false,
};

const settingsValue = {
  recipients: [r1, r2],
  stage: 'Очікує оплати',
  field: 'Посилання на оплату IBAN',
  linkTtlDays: 14,
  telegramBotToken: '123456:fake_token',
  telegramChatId: '987654321',
  enabled: true,
};

const issueEvent = {
  event_id: 'issue-multi-1',
  deal_id: '101',
  event_at: '2026-11-09T10:00:00Z',
  total: '3000',
  paid: '0',
  currency: 'UAH',
  stage: 'Очікує оплати',
  recipient_key: 'Основний',
};

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await pool().query('TRUNCATE jobs,inbox,links,deals,audit RESTART IDENTITY CASCADE');
  await pool().query("UPDATE settings SET data='{}'");
  await saveSettings({ ...settingsValue, enabled: false });
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','true')");
});

afterAll(async () => {
  await pool().end();
});

it('маршрутизація: успішний збіг recipient_key створює лінк із цим отримувачем', async () => {
  const res = await receive('issue', { ...issueEvent, recipient_key: 'Другий' });
  expect(res.status).toBe('processed');
  expect(res.payment_url).toBeTruthy();

  const link = (await pool().query('SELECT * FROM links WHERE deal_id=$1', ['101'])).rows[0];
  expect(link.recipient.key).toBe('Другий');
  expect(link.recipient.brand).toBe('Бренд Два');
  expect(link.purpose).toBe('Оплата товару за угодою №101');
});

it('маршрутизація: порожній або невідомий recipient_key пропускає подію з no_recipient без payment_url', async () => {
  const resNoKey = await receive('issue', { ...issueEvent, event_id: 'issue-no-key', recipient_key: undefined });
  expect(resNoKey.status).toBe('skipped');
  expect(resNoKey.payment_url).toBeUndefined();

  const resUnknown = await receive('issue', { ...issueEvent, event_id: 'issue-unknown', recipient_key: 'Неіснуючий' });
  expect(resUnknown.status).toBe('skipped');
  expect(resUnknown.payment_url).toBeUndefined();

  const inbox = (await pool().query("SELECT result FROM inbox WHERE event_id='issue-no-key'")).rows[0];
  expect(inbox.result).toBe('no_recipient');
});

it('маршрутизація: призупинений отримувач пропускає подію з recipient_suspended', async () => {
  const suspendedSettings = {
    ...settingsValue,
    recipients: [r1, { ...r2, suspended: true }],
    enabled: false,
  };
  await saveSettings(suspendedSettings);
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','true')");

  const res = await receive('issue', { ...issueEvent, recipient_key: 'Другий' });
  expect(res.status).toBe('skipped');
  expect(res.payment_url).toBeUndefined();

  const inbox = (await pool().query('SELECT result FROM inbox WHERE deal_id=$1', ['101'])).rows[0];
  expect(inbox.result).toBe('recipient_suspended');
});

it('TTL посилання: створюється з терміном з налаштувань linkTtlDays', async () => {
  await receive('issue', issueEvent);
  const link = (await pool().query('SELECT expires_at, created_at FROM links WHERE deal_id=$1', ['101'])).rows[0];
  const diffDays = Math.round(
    (new Date(link.expires_at).getTime() - new Date(link.created_at).getTime()) / (1000 * 3600 * 24),
  );
  expect(diffDays).toBe(14);
});

it('продовжити термін (extendLink): оновлює expires_at тільки для active лінка', async () => {
  await receive('issue', issueEvent);
  const link = (await pool().query('SELECT id, expires_at FROM links WHERE deal_id=$1', ['101'])).rows[0];

  // Зробимо лінк протермінованим (active в БД, але expires_at в минулому)
  await pool().query("UPDATE links SET expires_at=now()-interval '1 hour' WHERE id=$1", [link.id]);
  await extendLink(link.id);

  const updated = (await pool().query('SELECT expires_at FROM links WHERE id=$1', [link.id])).rows[0];
  expect(new Date(updated.expires_at).getTime()).toBeGreaterThan(Date.now());

  // Для disabled лінка extend повинен кидати помилку
  await pool().query("UPDATE links SET status='disabled' WHERE id=$1", [link.id]);
  await expect(extendLink(link.id)).rejects.toThrow('активні або протерміновані');
});

it('валідація логотипа та нотатки отримувача', () => {
  // Валідний логотип
  const valid = validateRecipientConfig({
    ...r1,
    logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  });
  expect(valid.logo).toBeTruthy();

  // Невалідний MIME тип логотипа
  expect(() =>
    validateRecipientConfig({
      ...r1,
      logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    }),
  ).toThrow('PNG, JPEG або WebP');

  // Завеликий рядок логотипа
  expect(() =>
    validateRecipientConfig({
      ...r1,
      logo: 'data:image/png;base64,' + 'A'.repeat(307200),
    }),
  ).toThrow('300 КБ');

  // Нотатка понад 200 символів
  expect(() =>
    validateRecipientConfig({
      ...r1,
      note: 'А'.repeat(201),
    }),
  ).toThrow('200 символів');
});

it('Telegram-сповіщення: черга створює задачу notify при оплаті та надсилає Bot API', async () => {
  await receive('issue', issueEvent);
  await receive('payment', {
    ...issueEvent,
    event_id: 'payment-multi-1',
    event_at: '2026-11-09T10:01:00Z',
    payment_id: '55',
    paid: '3000',
    kind: 'debit',
    planned: false,
  });

  const notifyJob = (await pool().query("SELECT * FROM jobs WHERE kind='notify'")).rows[0];
  expect(notifyJob).toBeTruthy();
  expect(notifyJob.deal_id).toBe('101');

  // Мокаємо глобальний fetch для Telegram
  const originalFetch = globalThis.fetch;
  let sentBody: { chat_id?: string; text?: string } | undefined;
  globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
    if (String(url).includes('api.telegram.org')) {
      sentBody = JSON.parse(init.body as string) as { chat_id?: string; text?: string };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, init);
  });

  try {
    const dbClient = await pool().connect();
    try {
      await sendTelegramNotification(notifyJob, dbClient);
    } finally {
      dbClient.release();
    }
    const captured = sentBody as { chat_id?: string; text?: string } | undefined;
    expect(captured?.chat_id).toBe('987654321');
    expect(captured?.text).toContain('Оплату підтверджено: угода №101');
    expect(captured?.text).toContain('отримувач Основний');
    expect(captured?.text).toContain('повністю');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('повторна міграція не змінює links.recipient після bootstrap', async () => {
  // Записуємо старий формат settings без recipients
  await pool().query(
    `UPDATE settings SET data = jsonb_build_object(
      'recipient', jsonb_build_object('name','Старий ФОП','brand','Старий Бренд','iban','UA890000000000000000000000000','taxId','00000000'),
      'purposeTemplate', 'Оплата №{deal_id}',
      'stage', 'Очікує оплати',
      'field', 'Поле',
      'enabled', true
    )`
  );

  // Створюємо угоду і лінк без key в recipient
  await pool().query("INSERT INTO deals(id) VALUES('999') ON CONFLICT DO NOTHING");
  const linkId = randomUUID();
  await pool().query(
    `INSERT INTO links(id, token, deal_id, amount_minor, recipient, purpose, fingerprint, status, expires_at, source_event_at, config_version)
     VALUES($1, 'token-backfill-test-32charslong!!', '999', 1000, $2, 'П', 'fp', 'active', now()+interval '7 days', now(), 'v1')`,
    [
      linkId,
      JSON.stringify({ name: 'Старий ФОП', brand: 'Старий Бренд', iban: 'UA890000000000000000000000000', taxId: '00000000' }),
    ],
  );

  // Запускаємо міграцію
  await migrate();

  // Перевіряємо settings
  const settings = await getSettings();
  expect(settings.recipients.length).toBeGreaterThan(0);
  expect(settings.recipients[0].key).toBe('Основний');
  expect(settings.recipients[0].brand).toBe('Старий Бренд');

  // Перевіряємо лінк
  const link = (await pool().query('SELECT recipient FROM links WHERE id=$1', [linkId])).rows[0];
  expect(link.recipient.key).toBeUndefined();
});

it('часткова оплата і подальша повна закриває лінк як paid та створює notify', async () => {
  await receive('issue', issueEvent);
  // Перша оплата - часткова (1000 з 3000)
  await receive('payment', {
    ...issueEvent,
    event_id: 'payment-partial-1',
    event_at: '2026-11-09T10:01:00Z',
    payment_id: '61',
    paid: '1000',
    kind: 'debit',
    planned: false,
  });
  const linkPartial = (await pool().query('SELECT status FROM links WHERE deal_id=$1', ['101'])).rows[0];
  expect(linkPartial.status).toBe('partial');

  // Друга оплата - повна (3000 з 3000)
  await receive('payment', {
    ...issueEvent,
    event_id: 'payment-full-2',
    event_at: '2026-11-09T10:02:00Z',
    payment_id: '62',
    paid: '3000',
    kind: 'debit',
    planned: false,
  });
  const linkFull = (await pool().query('SELECT status FROM links WHERE deal_id=$1', ['101'])).rows[0];
  expect(linkFull.status).toBe('paid');

  const notifyJobs = (await pool().query("SELECT * FROM jobs WHERE kind='notify'")).rows;
  expect(notifyJobs.length).toBe(2);
});

it('Telegram-сповіщення: при частковій оплаті виводить фактично сплачену суму, а не номінал', async () => {
  await receive('issue', issueEvent);
  await receive('payment', {
    ...issueEvent,
    event_id: 'payment-partial-msg-test',
    event_at: '2026-11-09T10:01:00Z',
    payment_id: '71',
    paid: '1000',
    kind: 'debit',
    planned: false,
  });

  const notifyJob = (
    await pool().query(
      "SELECT * FROM jobs WHERE kind='notify' AND deal_id='101' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];

  const originalFetch = globalThis.fetch;
  let sentBody: { chat_id?: string; text?: string } | undefined;
  globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
    if (String(url).includes('api.telegram.org')) {
      sentBody = JSON.parse(init.body as string) as { chat_id?: string; text?: string };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, init);
  });

  try {
    await sendTelegramNotification(notifyJob);
    expect(sentBody?.text).toContain(`сума ${formatMoney(100000)} ₴`);
    expect(sentBody?.text).toContain('частково');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('listLinks клампить сторінку більшу за totalPages на останню валідну', async () => {
  await receive('issue', issueEvent);
  const result = await listLinks({ page: 999, pageSize: 30 });
  expect(result.total).toBe(1);
  expect(result.rows.length).toBe(1);
  expect(result.rows[0].deal_id).toBe('101');
});

it('ендпоінт /api/health повертає 200 та status: ok', async () => {
  const { GET } = await import('../src/app/api/health/route');
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ status: 'ok', database: 'ok' });
});

it('перейменовує та переставляє логотипи без втрати даних', async () => {
  const first = 'data:image/png;base64,YQ==';
  const second = 'data:image/png;base64,Yg==';
  await saveSettings({ ...settingsValue, enabled: false, recipients: [{ ...r1, logo: first }, { ...r2, logo: second }] });
  const before = await getSettings();
  await saveSettings({ ...settingsValue, enabled: false, recipients: [
    { ...before.recipients[0], key: r2.key },
    { ...before.recipients[1], key: r1.key },
  ] });
  const rows = (await pool().query('SELECT key, data FROM recipient_logos WHERE key = ANY($1)', [[r1.key, r2.key]])).rows;
  expect(Object.fromEntries(rows.map((row) => [row.key, row.data]))).toEqual({ [r1.key]: second, [r2.key]: first });
  const swapped = await getSettings();
  await saveSettings({ ...settingsValue, enabled: false, recipients: [{ ...swapped.recipients[0], key: 'Новий' }] });
  const renamed = (await pool().query('SELECT key, data FROM recipient_logos')).rows;
  expect(renamed).toEqual([{ key: 'Новий', data: first }]);
});

it('паралельне збереження налаштувань не спричиняє deadlock', async () => {
  const results = await Promise.allSettled([
    saveSettings({ ...settingsValue, enabled: false, recipients: [r1] }),
    saveSettings({ ...settingsValue, enabled: false, recipients: [r2] }),
  ]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
});

it('відкочує логотипи та налаштування при помилці транзакції', async () => {
  const original = 'data:image/png;base64,YQ==';
  await saveSettings({ ...settingsValue, enabled: false, recipients: [{ ...r1, logo: original }] });
  const before = await getSettings();
  await expect(saveSettings({ ...settingsValue, enabled: true, recipients: [{ ...r1, logo: 'data:image/png;base64,Yg==', brand: 'Змінено', name: 'Інша назва' }] })).rejects.toThrow();
  expect(await getSettings()).toEqual(before);
  expect((await pool().query('SELECT data FROM recipient_logos WHERE key=$1', [r1.key])).rows[0].data).toBe(original);
});

it('ендпоінт /api/recipients/[key]/logo повертає бінарний логотип з кешуванням', async () => {
  const { GET } = await import('../src/app/api/recipients/[key]/logo/route');
  const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const logoUrl = `data:image/png;base64,${base64Data}`;

  await saveSettings({
    recipients: [{ ...r1, logo: logoUrl }],
    stage: 'Очікує оплати',
    field: 'Посилання',
    linkTtlDays: 7,
    enabled: false,
  });
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','true')");

  const res = await GET(new Request('http://localhost:3000/api/recipients/Основний/logo'), {
    params: Promise.resolve({ key: 'Основний' }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('image/png');
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
  const buffer = await res.arrayBuffer();
  expect(buffer.byteLength).toBeGreaterThan(0);

  const res404 = await GET(new Request('http://localhost:3000/api/recipients/none/logo'), {
    params: Promise.resolve({ key: 'none' }),
  });
  expect(res404.status).toBe(404);
});

it('ендпоінт /api/pay/[token]/qr повертає кешовані заголовки для активного посилання', async () => {
  const { GET } = await import('../src/app/api/pay/[token]/qr/route');
  const issueEvent = {
    event_id: `qr-cache-issue-${randomUUID()}`,
    deal_id: '9001',
    event_at: new Date().toISOString(),
    total: 1000,
    paid: 0,
    currency: 'UAH',
    stage: 'Очікує оплати',
    recipient_key: 'Основний',
  };
  const resIssue = await receive('issue', issueEvent);
  const token = resIssue.payment_url!.split('/p/')[1];

  const res = await GET(new Request(`http://localhost:3000/api/pay/${token}/qr`), {
    params: Promise.resolve({ token }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
  const svg = await res.text();
  expect(svg).toContain('<svg');
});

it('healthcheck зберігає старі події та ключі дедуплікації', async () => {
  const { GET } = await import('../src/app/api/health/route');
  const oldId = randomUUID();
  const eventId = `old-event-${oldId}`;
  await pool().query(
    "INSERT INTO inbox(id,kind,event_id,deal_id,event_at,payload,payload_hash,status,created_at) VALUES($1,'issue',$2,'old-deal',now() - interval '100 days','{}','hash','processed',now() - interval '100 days')",
    [oldId, eventId],
  );
  expect((await GET()).status).toBe(200);
  const check = await pool().query('SELECT event_id FROM inbox WHERE id=$1', [oldId]);
  expect(check.rows[0].event_id).toBe(eventId);
});
