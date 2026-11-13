import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/lib/db';
import { migrate } from '../scripts/migrate';
import { saveSettings } from '../src/lib/settings';
import { receive, processNotifyInline, disableLink, retryJob, extendLink } from '../src/lib/pipeline';

if (
  !process.env.TEST_DATABASE_URL ||
  !/(_test|_e2e)$/.test(new URL(process.env.TEST_DATABASE_URL).pathname)
)
  throw new Error('Потрібна окрема TEST_DATABASE_URL *_test або *_e2e');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = 'http://localhost:3000';
const base = {
  event_id: 'issue-42-1',
  deal_id: '42',
  event_at: '2026-11-09T08:00:00Z',
  total: '5000',
  paid: '1000',
  currency: 'UAH',
  stage: 'Очікує оплати',
  recipient_key: 'Основний',
};
const value = {
  recipients: [
    {
      key: 'Основний',
      name: 'Тестовий отримувач',
      brand: 'Мій магазин',
      taxId: '00000000',
      iban: 'UA890000000000000000000000000',
      purposeTemplate: 'Оплата за замовлення №{deal_id}',
    },
  ],
  stage: 'Очікує оплати',
  field: 'Посилання на оплату IBAN',
  linkTtlDays: 7,
  enabled: false,
};
const payment = {
  ...base,
  event_id: 'payment-8',
  payment_id: '8',
  event_at: '2026-11-09T08:01:00Z',
  kind: 'debit',
  planned: false,
  paid: '2000',
};
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await pool().query('TRUNCATE jobs,inbox,links,deals,audit RESTART IDENTITY CASCADE');
  await pool().query("UPDATE settings SET data='{}'");
  await saveSettings(value);
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','true')");
});
afterAll(async () => {
  await pool().end();
});
it('часткові платежі кожен створюють snapshot сповіщення', async () => {
  await receive('issue', base);
  await receive('payment', payment);
  await receive('payment', {
    ...payment,
    event_id: 'payment-9',
    payment_id: '9',
    event_at: '2026-11-09T08:02:00Z',
    paid: '3000',
  });
  const jobs = (await pool().query("SELECT notification_link_id FROM jobs WHERE kind='notify'"))
    .rows;
  expect(jobs).toHaveLength(2);
  expect(jobs[0].notification_link_id).toBe(jobs[1].notification_link_id);
});
it('індекс префікса доступний планувальнику на вибірковому наборі', async () => {
  const db = await pool().connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO deals(id) SELECT 'explain-' || n FROM generate_series(1,5000) n ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO links(id,token,deal_id,amount_minor,recipient,purpose,fingerprint,status,expires_at,source_event_at) SELECT gen_random_uuid(), 'explain-' || n, 'explain-' || n, 100, '{}', '', '', 'disabled', now(), now() FROM generate_series(1,5000) n",
    );
    await db.query('ANALYZE links');
    const plan = await db.query(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM links WHERE deal_id LIKE 'explain-1234%'",
    );
    expect(JSON.stringify(plan.rows)).toContain('links_deal_id_pattern');
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
it('паралельні міграції застосовують кожну версію один раз', async () => {
  await Promise.all([migrate(), migrate(), migrate()]);
  expect(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM schema_migrations WHERE version IN ('001_initial','002_notification_snapshot')",
      )
    ).rows[0].n,
  ).toBe(2);
});
it('повторна міграція не змінює актуальні задачі та логотипи', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'sync',$2,'migration-test','failed')",
    [id, randomUUID()],
  );
  await pool().query(
    "INSERT INTO recipient_logos(key,data) VALUES('migration-test','updated') ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data",
  );
  await migrate();
  expect((await pool().query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0].status).toBe(
    'failed',
  );
  expect(
    (await pool().query("SELECT data FROM recipient_logos WHERE key='migration-test'")).rows[0]
      .data,
  ).toBe('updated');
});
it('гонка inline і retry надсилає не більше одного повідомлення', async () => {
  await receive('issue', base);
  const inbox = await receive('payment', payment);
  const job = (
    await pool().query("SELECT id FROM jobs WHERE ref_id=$1 AND kind='notify'", [inbox.id])
  ).rows[0];
  await saveSettings({ ...value, telegramBotToken: '123456:fake_token', telegramChatId: '123' });
  await pool().query("UPDATE jobs SET status='queued' WHERE id=$1", [job.id]);
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    started();
    await gate;
    return new Response('{"ok":true}');
  });
  try {
    const inline = processNotifyInline(inbox.id);
    await startedPromise;
    await expect(retryJob(job.id)).rejects.toThrow();
    release();
    await inline;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    release();
    fetchSpy.mockRestore();
  }
});
it('issue обробляє queued payment і запускає notify після commit', async () => {
  await receive('issue', base);
  const received = await receive('payment', payment);
  await pool().query('DELETE FROM jobs WHERE ref_id=$1', [received.id]);
  await pool().query("UPDATE links SET status='active' WHERE deal_id='42'");
  await pool().query("UPDATE deals SET last_event_at='2026-11-09T08:00:00Z' WHERE id='42'");
  await pool().query("UPDATE inbox SET status='queued',result=NULL WHERE id=$1", [received.id]);
  await receive('issue', {
    ...base,
    event_id: 'issue-after-queued',
    event_at: '2026-11-09T08:02:00Z',
  });
  expect(
    (await pool().query("SELECT status FROM jobs WHERE ref_id=$1 AND kind='notify'", [received.id]))
      .rows[0].status,
  ).toBe('skipped');
});
it('ручний retry event запускає створене notify після commit', async () => {
  await receive('issue', base);
  const received = await receive('payment', payment);
  await pool().query('DELETE FROM jobs WHERE ref_id=$1', [received.id]);
  await pool().query("UPDATE links SET status='active' WHERE deal_id='42'");
  await pool().query("UPDATE deals SET last_event_at='2026-11-09T08:00:00Z' WHERE id='42'");
  await pool().query("UPDATE inbox SET status='failed',result=NULL WHERE id=$1", [received.id]);
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'event',$2,'42','failed')",
    [id, received.id],
  );
  await retryJob(id);
  expect(
    (await pool().query("SELECT status FROM jobs WHERE ref_id=$1 AND kind='notify'", [received.id]))
      .rows[0].status,
  ).toBe('skipped');
});
it('застарілий lease допускає ручний повтор', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status,claimed_at,lease_id) VALUES($1,'sync',$2,'42','processing',now()-interval '3 minutes',$3)",
    [id, randomUUID(), randomUUID()],
  );
  await expect(retryJob(id)).resolves.toMatchObject({ status: 'skipped' });
});
it('невідомий результат Telegram позначається помилкою і попереджає про дубль', async () => {
  await receive('issue', base);
  const inbox = await receive('payment', payment);
  const job = (
    await pool().query("SELECT id FROM jobs WHERE ref_id=$1 AND kind='notify'", [inbox.id])
  ).rows[0];
  await saveSettings({ ...value, telegramBotToken: '123456:fake_token', telegramChatId: '123' });
  await pool().query("UPDATE jobs SET status='failed' WHERE id=$1", [job.id]);
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  try {
    await expect(retryJob(job.id)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('дублікат'),
    });
    expect(
      (await pool().query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status,
    ).toBe('failed');
  } finally {
    fetchSpy.mockRestore();
  }
});
it('два одночасні retry сповіщення виконують один запит', async () => {
  await receive('issue', base);
  const inbox = await receive('payment', payment);
  const job = (
    await pool().query("SELECT id FROM jobs WHERE ref_id=$1 AND kind='notify'", [inbox.id])
  ).rows[0];
  await saveSettings({ ...value, telegramBotToken: '123456:fake_token', telegramChatId: '123' });
  await pool().query("UPDATE jobs SET status='failed' WHERE id=$1", [job.id]);
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    started();
    await gate;
    return new Response('{"ok":true}');
  });
  try {
    const first = retryJob(job.id);
    await startedPromise;
    await expect(retryJob(job.id)).rejects.toThrow();
    release();
    await expect(first).resolves.toMatchObject({ status: 'done' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    release();
    fetchSpy.mockRestore();
  }
});
it('конкурентні retry допускають лише одного власника', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'event',$2,'42','failed')",
    [id, randomUUID()],
  );
  const results = await Promise.allSettled([retryJob(id), retryJob(id)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await pool().query('SELECT attempts FROM jobs WHERE id=$1', [id])).rows[0].attempts).toBe(
    1,
  );
});
it('старий lease не може завершити inline-сповіщення після нового захоплення', async () => {
  await receive('issue', base);
  const inbox = await receive('payment', payment);
  const job = (
    await pool().query("SELECT * FROM jobs WHERE ref_id=$1 AND kind='notify'", [inbox.id])
  ).rows[0];
  await saveSettings({ ...value, telegramBotToken: '123456:fake_token', telegramChatId: '123' });
  await pool().query("UPDATE jobs SET status='queued' WHERE id=$1", [job.id]);
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    started();
    await gate;
    return new Response('{"ok":true}');
  });
  try {
    const pending = processNotifyInline(inbox.id);
    await startedPromise;
    const newLease = randomUUID();
    await pool().query('UPDATE jobs SET lease_id=$1 WHERE id=$2', [newLease, job.id]);
    release();
    await pending;
    expect(
      (await pool().query('SELECT status,lease_id FROM jobs WHERE id=$1', [job.id])).rows[0],
    ).toMatchObject({ status: 'processing', lease_id: newLease });
  } finally {
    release();
    fetchSpy.mockRestore();
  }
});
it('помилка обробки події зберігає failed та аудит після rollback', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'event',$2,'42','failed')",
    [id, randomUUID()],
  );
  const result = await retryJob(id);
  expect(result).toMatchObject({ status: 'failed' });
  expect(
    (await pool().query('SELECT status, last_error FROM jobs WHERE id=$1', [id])).rows[0],
  ).toMatchObject({ status: 'failed', last_error: expect.any(String) });
  expect(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM audit WHERE action='retry' AND target=$1",
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('повтор завершеної задачі не дозволений', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'notify',$2,'42','done')",
    [id, randomUUID()],
  );
  await expect(retryJob(id)).rejects.toThrow();
});
it('повтор використовує отримувача і суму первинного посилання', async () => {
  await receive('issue', base);
  const paymentResult = await receive('payment', payment);
  const job = (
    await pool().query("SELECT id FROM jobs WHERE ref_id=$1 AND kind='notify'", [paymentResult.id])
  ).rows[0];
  await receive('issue', {
    ...base,
    event_id: 'reissue',
    event_at: '2026-11-09T08:02:00Z',
    total: '6000',
    paid: '2000',
  });
  await pool().query(
    "UPDATE links SET recipient=jsonb_set(recipient,'{key}','\"Новий\"') WHERE id=(SELECT link_id FROM deals WHERE id='42')",
  );
  await saveSettings({ ...value, telegramBotToken: '123456:fake_token', telegramChatId: '123' });
  await pool().query("UPDATE jobs SET status='failed' WHERE id=$1", [job.id]);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
  try {
    await expect(retryJob(job.id)).resolves.toMatchObject({ status: 'done' });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.text).toContain('отримувач Основний');
    expect(body.text).toMatch(/2\s000,00/);
  } finally {
    fetchSpy.mockRestore();
  }
});
it('повтор старого сповіщення без snapshot завершується помилкою', async () => {
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'notify',$2,'42','failed')",
    [id, randomUUID()],
  );
  await expect(retryJob(id)).resolves.toMatchObject({
    status: 'failed',
    error: expect.stringContaining('snapshot'),
  });
});
it('сповіщення зберігає посилання обробленого платежу', async () => {
  await receive('issue', base);
  const link = (await pool().query('SELECT id FROM links')).rows[0];
  await receive('payment', payment);
  const job = (await pool().query("SELECT notification_link_id FROM jobs WHERE kind='notify'"))
    .rows[0];
  expect(job.notification_link_id).toBe(link.id);
});
it('повертає готовий URL у відповіді та не потребує фонової доставки в CRM', async () => {
  const result = await receive('issue', base);
  expect(result).toMatchObject({
    status: 'processed',
    payment_url: expect.stringMatching(/^http:\/\/localhost:3000\/p\/[A-Za-z0-9_-]{32}$/),
  });
  expect((await pool().query('SELECT count(*)::int AS n FROM links')).rows[0].n).toBe(1);
});
it('десять одночасних повторів повертають те саме посилання', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => receive('issue', base)));
  expect(new Set(results.map((r) => r.payment_url)).size).toBe(1);
  expect(results[0].payment_url).toBeTruthy();
  expect((await pool().query('SELECT count(*)::int AS n FROM inbox')).rows[0].n).toBe(1);
  expect((await pool().query('SELECT count(*)::int AS n FROM links')).rows[0].n).toBe(1);
});
it('проба повертає безпечну сторінку перевірки, а не платіжну сторінку', async () => {
  await pool().query("UPDATE settings SET data=jsonb_set(data,'{enabled}','false')");
  expect(await receive('issue', base)).toMatchObject({
    status: 'probe',
    payment_url: 'http://localhost:3000/integration-check',
  });
  expect((await pool().query('SELECT count(*)::int AS n FROM links')).rows[0].n).toBe(0);
});
it('повтор робочої події після вимкнення повертає тільки тестову сторінку', async () => {
  await receive('issue', base);
  await saveSettings(value);
  expect(await receive('issue', base)).toMatchObject({
    status: 'probe',
    payment_url: 'http://localhost:3000/integration-check',
  });
});
it('issue з іншим етапом не повертає попередній платіжний URL', async () => {
  await receive('issue', base);
  expect(
    (
      await receive('issue', {
        ...base,
        event_id: 'wrong-stage',
        stage: 'Нова',
        event_at: '2026-11-09T08:02:00Z',
      })
    ).payment_url,
  ).toBeUndefined();
});
it('повтор після втраченої HTTP-відповіді повертає вже збережений URL', async () => {
  const first = await receive('issue', base);
  const second = await receive('issue', base);
  expect(second.payment_url).toBe(first.payment_url);
  expect((await pool().query('SELECT count(*)::int AS n FROM links')).rows[0].n).toBe(1);
});
it('часткова оплата закриває посилання; старий issue не повертає платіжний URL', async () => {
  await receive('issue', base);
  await receive('payment', payment);
  const late = await receive('issue', {
    ...base,
    event_id: 'late',
    event_at: '2026-11-09T08:00:30Z',
  });
  expect((await pool().query('SELECT status FROM links')).rows[0].status).toBe('partial');
  expect(late.payment_url).toBeUndefined();
});
it('платіж, уже прийнятий у чергу, блокує застарілий issue навіть без worker', async () => {
  await receive('issue', base);
  await receive('payment', payment);
  const late = await receive('issue', {
    ...base,
    event_id: 'late-no-worker',
    event_at: '2026-11-09T08:00:30Z',
  });
  expect(late.payment_url).toBeUndefined();
  expect((await pool().query('SELECT status FROM links')).rows[0].status).toBe('partial');
});
it('нова сума повертає новий URL та відключає попередній', async () => {
  const old = await receive('issue', base);
  const next = await receive('issue', {
    ...base,
    event_id: 'changed',
    event_at: '2026-11-09T08:02:00Z',
    total: '6000',
  });
  expect(next.payment_url).toBeTruthy();
  expect(next.payment_url).not.toBe(old.payment_url);
  expect(
    (await pool().query("SELECT amount_minor::int AS amount FROM links WHERE status='active'"))
      .rows[0].amount,
  ).toBe(500000);
  expect(
    (await pool().query("SELECT count(*)::int AS n FROM links WHERE status='replaced'")).rows[0].n,
  ).toBe(1);
});
it('з нульовим залишком не повертається URL для мапінгу в CRM', async () => {
  const result = await receive('issue', { ...base, paid: '5000' });
  expect(result.payment_url).toBeUndefined();
  expect((await pool().query('SELECT count(*)::int AS n FROM links')).rows[0].n).toBe(0);
});
it('той самий ID з іншим вмістом не змінює початкову подію', async () => {
  await receive('issue', base);
  await expect(receive('issue', { ...base, total: '9999' })).rejects.toThrow('конфлікт');
  expect((await pool().query('SELECT payload FROM inbox')).rows[0].payload.totalMinor).toBe(500000);
});
it('повтор вимкненої сторінки не повертає URL', async () => {
  await receive('issue', base);
  await disableLink((await pool().query('SELECT id FROM links')).rows[0].id);
  expect((await receive('issue', base)).payment_url).toBeUndefined();
});
it('застарілий lease старої event-задачі відновлюється ручним повтором', async () => {
  await receive('issue', base);
  const received = await receive('payment', payment);
  await pool().query('DELETE FROM jobs WHERE ref_id=$1', [received.id]);
  await pool().query("UPDATE links SET status='active' WHERE deal_id='42'");
  await pool().query("UPDATE deals SET last_event_at='2026-11-09T08:00:00Z' WHERE id='42'");
  await pool().query("UPDATE inbox SET status='queued',result=NULL WHERE id=$1", [received.id]);
  const id = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status,claimed_at,lease_id) VALUES($1,'event',$2,'42','processing',now()-interval '5 minutes',$3)",
    [id, received.id, randomUUID()],
  );
  await expect(retryJob(id)).resolves.toMatchObject({ status: 'done' });
  expect((await pool().query('SELECT status FROM links')).rows[0].status).toBe('partial');
  expect((await pool().query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0].status).toBe(
    'done',
  );
});
it('фінальна помилка платіжної черги має ручний повтор', async () => {
  await receive('issue', base);
  await receive('payment', payment);
  const job = (await pool().query('SELECT id FROM jobs')).rows[0];
  await pool().query(
    "UPDATE jobs SET status='failed',attempts=8,last_error='test failure' WHERE id=$1",
    [job.id],
  );
  await retryJob(job.id);
  expect((await pool().query('SELECT status FROM links')).rows[0].status).toBe('partial');
});
it('активація працює без API-ключа після двох узгоджених проб', async () => {
  await saveSettings(value);
  await receive('issue', base);
  await receive('payment', payment);
  await expect(saveSettings({ ...value, enabled: true })).resolves.toBeUndefined();
  expect((await pool().query('SELECT data FROM settings')).rows[0].data).not.toHaveProperty(
    'encryptedApiKey',
  );
});
it('активація відхиляє проби різних угод', async () => {
  await saveSettings(value);
  await receive('issue', base);
  await receive('payment', { ...payment, deal_id: '43' });
  await expect(saveSettings({ ...value, enabled: true })).rejects.toThrow('однієї тестової угоди');
});
it('платіж попередньої конфігурації не застосовується після нового підключення', async () => {
  await receive('issue', base);
  await receive('payment', payment);
  // Імітуємо чергу платежу, який не встиг обробитися до зміни налаштувань
  await pool().query("UPDATE inbox SET status='queued', result=NULL WHERE event_id='payment-8'");
  await pool().query(
    "UPDATE jobs SET status='queued' WHERE ref_id=(SELECT id FROM inbox WHERE event_id='payment-8')",
  );
  const next = {
    ...value,
    recipients: [{ ...value.recipients[0], brand: 'Інший бренд' }],
  };
  await saveSettings(next);
  await receive('issue', { ...base, event_id: 'new-probe', event_at: '2026-11-09T09:00:00Z' });
  await receive('payment', {
    ...payment,
    event_id: 'new-probe-payment',
    payment_id: '9',
    event_at: '2026-11-09T09:01:00Z',
  });
  await saveSettings({ ...next, enabled: true });
  const oldEvent = (await pool().query("SELECT id FROM inbox WHERE event_id='payment-8'")).rows[0];
  const eventJob = randomUUID();
  await pool().query(
    "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'event',$2,'42','failed')",
    [eventJob, oldEvent.id],
  );
  await retryJob(eventJob);
  expect(
    (await pool().query("SELECT result FROM inbox WHERE event_id='payment-8'")).rows[0].result,
  ).toBe('configuration_changed');
});

it('issue-подія з нульовим залишком переводить partial-посилання в paid', async () => {
  await receive('issue', base);
  await receive('payment', {
    ...payment,
    event_id: 'part-pay',
    payment_id: '10',
    total_paid: '500.00',
    amount: '500.00',
  });
  const linkBefore = (await pool().query("SELECT id, status FROM links WHERE deal_id='42'")).rows[0];
  expect(linkBefore.status).toBe('partial');

  await receive('issue', {
    ...base,
    event_id: 'issue-settle',
    paid: '5000',
    event_at: '2026-11-09T08:05:00Z',
  });
  const linkAfter = (await pool().query('SELECT status FROM links WHERE id=$1', [linkBefore.id])).rows[0];
  expect(linkAfter.status).toBe('paid');
});

it('збереження некритичних налаштувань зберігає enabled без нових проб', async () => {
  expect((await pool().query('SELECT data FROM settings WHERE id=true')).rows[0].data.enabled).toBe(true);

  // Оновлюємо некритичне поле (linkTtlDays), enabled має залишитися true
  await saveSettings({
    ...value,
    linkTtlDays: 14,
    enabled: true,
  });
  const updated = (await pool().query('SELECT data FROM settings WHERE id=true')).rows[0].data;
  expect(updated.enabled).toBe(true);
  expect(updated.linkTtlDays).toBe(14);
});

it('extendLink продовжує активне посилання', async () => {
  await receive('issue', base);
  const link = (await pool().query("SELECT id, expires_at FROM links WHERE deal_id='42'")).rows[0];
  await extendLink(link.id);
  const extended = (await pool().query('SELECT expires_at FROM links WHERE id=$1', [link.id])).rows[0];
  expect(new Date(extended.expires_at).getTime()).toBeGreaterThan(new Date(link.expires_at).getTime());
});
