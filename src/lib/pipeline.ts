import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { parseEvent, transition, type CrmEvent, type EventKind } from './domain';
import { pool, transaction, lockDeal } from './db';
import { getSettings, purposeFor } from './settings';
import { nbuPayload, type LinkRecipient } from './payment';
import { appUrl } from './env';
import { formatMoney } from './queries';
interface Job {
  id: string;
  kind: 'event' | 'sync' | 'notify';
  ref_id: string;
  deal_id: string;
  lease_id: string;
  attempts: number;
  notification_link_id: string | null;
}
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function enqueue(
  db: PoolClient,
  kind: 'event' | 'sync' | 'notify',
  refId: string,
  dealId: string,
  notificationLinkId: string,
) {
  await db.query(
    'INSERT INTO jobs(id,kind,ref_id,deal_id,notification_link_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,ref_id) DO NOTHING',
    [randomUUID(), kind, refId, dealId, notificationLinkId],
  );
}
export async function receive(
  type: EventKind,
  input: unknown,
): Promise<{ status: string; id: string; payment_url?: string }> {
  const event = parseEvent(type, input);
  if (event.eventAt > Date.now() + 300000)
    throw new Error('Час події випереджає сервер більше ніж на 5 хвилин');
  const hash = digest(event);
  const pendingNotifications: string[] = [];
  const result = await transaction(async (db) => {
    await lockDeal(db, event.dealId);
    const settings = (await db.query('SELECT data FROM settings WHERE id=true FOR SHARE')).rows[0]
      .data;
    if (type === 'issue') {
      await db.query(
        "SELECT j.id FROM jobs j JOIN inbox i ON i.id=j.ref_id WHERE j.kind='event' AND i.deal_id=$1 AND i.kind='payment' AND i.status IN ('queued','failed') FOR UPDATE OF j",
        [event.dealId],
      );
      const active = await db.query(
        "SELECT 1 FROM inbox i JOIN jobs j ON j.ref_id=i.id AND j.kind='event' WHERE i.deal_id=$1 AND i.kind='payment' AND i.status IN ('queued','failed') AND j.status='processing' AND j.claimed_at>=now()-interval '2 minutes'",
        [event.dealId],
      );
      if (active.rowCount) throw new Error('Платіжна подія обробляється; повторіть запит');
      const failed = await db.query(
        "SELECT 1 FROM inbox WHERE deal_id=$1 AND kind='payment' AND status='failed'",
        [event.dealId],
      );
      if (failed.rowCount) throw new Error('Платіжна подія потребує ручного повтору');
      const pending = await db.query(
        "SELECT id FROM inbox WHERE deal_id=$1 AND kind='payment' AND status='queued' ORDER BY event_at ASC",
        [event.dealId],
      );
      for (const row of pending.rows) {
        await processEvent(db, { ref_id: row.id });
        pendingNotifications.push(row.id);
        await db.query(
          "UPDATE jobs SET status='done',lease_id=NULL,last_error=NULL WHERE kind='event' AND ref_id=$1",
          [row.id],
        );
      }
    }
    const status = settings.enabled ? 'queued' : 'probe',
      id = randomUUID();
    const inserted = await db.query(
      'INSERT INTO inbox(id,kind,event_id,deal_id,event_at,payload,payload_hash,status,config_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(kind,event_id) DO NOTHING RETURNING id,status',
      [
        id,
        type,
        event.eventId,
        event.dealId,
        new Date(event.eventAt),
        event,
        hash,
        status,
        settings.configVersion ?? '',
      ],
    );
    if (!inserted.rowCount) {
      const previous = (
        await db.query('SELECT id,status,payload_hash FROM inbox WHERE kind=$1 AND event_id=$2', [
          type,
          event.eventId,
        ])
      ).rows[0];
      if (previous.payload_hash !== hash)
        throw new Error('конфлікт event_id: отримано інший вміст');
      return responseFor(db, type, previous.id, previous.status, event.dealId, !!settings.enabled);
    }
    if (status === 'queued') {
      if (type === 'issue' || type === 'payment') await processEvent(db, { ref_id: id });
    }
    const current = (await db.query('SELECT status FROM inbox WHERE id=$1', [id])).rows[0];
    return responseFor(db, type, id, current.status, event.dealId, !!settings.enabled);
  });
  if (type === 'payment' && result.status === 'processed') pendingNotifications.push(result.id);
  for (const id of pendingNotifications) {
    try {
      await processNotifyInline(id);
    } catch {}
  }
  return result;
}
async function responseFor(
  db: PoolClient,
  type: EventKind,
  id: string,
  status: string,
  dealId: string,
  enabled: boolean,
) {
  if (type !== 'issue') return { id, status };
  if (!enabled || status === 'probe')
    return { id, status: 'probe', payment_url: `${appUrl()}/integration-check` };
  const record = (await db.query('SELECT result FROM inbox WHERE id=$1', [id])).rows[0];
  if (
    [
      'skip',
      'configuration_changed',
      'response_protocol_changed',
      'no_recipient',
      'recipient_suspended',
    ].includes(record?.result)
  )
    return { id, status: 'skipped' };
  const link = (
    await db.query(
      "SELECT l.token FROM deals d JOIN links l ON l.id=d.link_id WHERE d.id=$1 AND l.status='active' AND l.expires_at>now()",
      [dealId],
    )
  ).rows[0];
  return { id, status, ...(link ? { payment_url: `${appUrl()}/p/${link.token}` } : {}) };
}
async function processEvent(db: PoolClient, job: Pick<Job, 'ref_id'>) {
  const inbox = (await db.query('SELECT * FROM inbox WHERE id=$1', [job.ref_id])).rows[0];
  if (!inbox) throw new Error('Вхідну подію не знайдено');
  const event = inbox.payload as CrmEvent;
  const settings = await getSettings(db);
  if (inbox.config_version !== settings.configVersion) {
    await db.query("UPDATE inbox SET status='skipped',result='configuration_changed' WHERE id=$1", [
      inbox.id,
    ]);
    return;
  }
  if (!settings.enabled) {
    await db.query("UPDATE inbox SET status='probe',result='Інтеграцію призупинено' WHERE id=$1", [
      inbox.id,
    ]);
    return;
  }
  await db.query('INSERT INTO deals(id) VALUES($1) ON CONFLICT DO NOTHING', [event.dealId]);
  const deal = (await db.query('SELECT * FROM deals WHERE id=$1', [event.dealId])).rows[0];
  const link = deal.link_id
    ? (await db.query('SELECT * FROM links WHERE id=$1', [deal.link_id])).rows[0]
    : null;

  if (!event.paymentId) {
    if (event.stage !== settings.stage) {
      await db.query("UPDATE inbox SET status='skipped',result='skip' WHERE id=$1", [inbox.id]);
      return;
    }
    if (deal.last_event_at && event.eventAt <= new Date(deal.last_event_at).getTime()) {
      await db.query("UPDATE inbox SET status='skipped',result='stale' WHERE id=$1", [inbox.id]);
      return;
    }
    const amountMinor = Math.max(0, event.totalMinor - event.paidMinor);
    if (amountMinor === 0) {
      if (link?.status === 'active' || link?.status === 'partial')
        await db.query("UPDATE links SET status='paid' WHERE id=$1", [link.id]);
      await db.query('UPDATE deals SET last_event_at=$1 WHERE id=$2', [
        new Date(event.eventAt),
        event.dealId,
      ]);
      await db.query("UPDATE inbox SET status='processed',result='settle' WHERE id=$1", [inbox.id]);
      return;
    }
    if (!event.recipientKey) {
      await db.query("UPDATE inbox SET status='skipped',result='no_recipient' WHERE id=$1", [
        inbox.id,
      ]);
      return;
    }
    const recipient = settings.recipients.find((r) => r.key === event.recipientKey);
    if (!recipient) {
      await db.query("UPDATE inbox SET status='skipped',result='no_recipient' WHERE id=$1", [
        inbox.id,
      ]);
      return;
    }
    if (recipient.suspended) {
      await db.query("UPDATE inbox SET status='skipped',result='recipient_suspended' WHERE id=$1", [
        inbox.id,
      ]);
      return;
    }
    const recipientSnapshot: LinkRecipient = {
      key: recipient.key,
      name: recipient.name,
      brand: recipient.brand,
      iban: recipient.iban,
      taxId: recipient.taxId,
    };
    const purpose = purposeFor(recipient, event.dealId);
    const fingerprint = digest({
      recipient: recipientSnapshot,
      purpose,
      amount: amountMinor,
      configVersion: settings.configVersion,
    });
    const decision = transition(
      {
        lastEventAt: deal.last_event_at ? new Date(deal.last_event_at).getTime() : null,
        link: link
          ? {
              id: link.id,
              status: link.status,
              amountMinor: Number(link.amount_minor),
              fingerprint: link.fingerprint,
              expiresAt: new Date(link.expires_at).getTime(),
            }
          : null,
      },
      event,
      Date.now(),
      fingerprint,
      settings.stage,
    );
    if (decision.action === 'issue') {
      nbuPayload(recipientSnapshot, decision.amountMinor!, purpose);
      if (link?.status === 'active')
        await db.query("UPDATE links SET status='replaced' WHERE id=$1", [link.id]);
      const id = randomUUID(),
        token = randomBytes(24).toString('base64url');
      const ttl = settings.linkTtlDays || 7;
      await db.query(
        "INSERT INTO links(id,token,deal_id,amount_minor,recipient,purpose,fingerprint,status,expires_at,source_event_at,config_version) VALUES($1,$2,$3,$4,$5,$6,$7,'active',now()+($10 * interval '1 day'),$8,$9)",
        [
          id,
          token,
          event.dealId,
          decision.amountMinor,
          recipientSnapshot,
          purpose,
          fingerprint,
          new Date(event.eventAt),
          settings.configVersion,
          ttl,
        ],
      );
      await db.query('UPDATE deals SET link_id=$1 WHERE id=$2', [id, event.dealId]);
    }
    if (!['stale', 'skip'].includes(decision.action))
      await db.query('UPDATE deals SET last_event_at=$1 WHERE id=$2', [
        new Date(event.eventAt),
        event.dealId,
      ]);
    await db.query('UPDATE inbox SET status=$1,result=$2 WHERE id=$3', [
      ['stale', 'skip'].includes(decision.action) ? 'skipped' : 'processed',
      decision.action,
      inbox.id,
    ]);
  } else {
    const decision = transition(
      {
        lastEventAt: deal.last_event_at ? new Date(deal.last_event_at).getTime() : null,
        link: link
          ? {
              id: link.id,
              status: link.status,
              amountMinor: Number(link.amount_minor),
              fingerprint: link.fingerprint,
              expiresAt: new Date(link.expires_at).getTime(),
            }
          : null,
      },
      event,
      Date.now(),
      '',
      settings.stage,
    );
    if (decision.action === 'settle' || decision.action === 'partial') {
      if (link) {
        if (link.status === 'active' || link.status === 'partial') {
          await db.query('UPDATE links SET status=$1 WHERE id=$2', [
            decision.action === 'settle' ? 'paid' : 'partial',
            link.id,
          ]);
        }
        if (link.status === 'active' || link.status === 'partial' || link.status === 'paid') {
          await enqueue(db, 'notify', inbox.id, event.dealId, link.id);
        }
      }
    }
    if (!['stale', 'skip'].includes(decision.action))
      await db.query('UPDATE deals SET last_event_at=$1 WHERE id=$2', [
        new Date(event.eventAt),
        event.dealId,
      ]);
    await db.query('UPDATE inbox SET status=$1,result=$2 WHERE id=$3', [
      ['stale', 'skip'].includes(decision.action) ? 'skipped' : 'processed',
      decision.action,
      inbox.id,
    ]);
  }
}
export async function sendTelegramNotification(
  job: { ref_id: string; deal_id: string; notification_link_id?: string | null },
  db?: PoolClient,
): Promise<'done' | 'skipped'> {
  const client = db ?? pool();
  const settings = await getSettings(db);
  const inbox = (await client.query('SELECT * FROM inbox WHERE id=$1', [job.ref_id])).rows[0];
  const link = (
    await client.query('SELECT amount_minor, recipient FROM links WHERE id=$1 AND deal_id=$2', [
      job.notification_link_id ?? null,
      job.deal_id,
    ])
  ).rows[0];
  if (
    !inbox ||
    !link ||
    !['partial', 'settle'].includes(inbox.result) ||
    !link.recipient?.key ||
    (inbox.result === 'partial' && !Number.isSafeInteger(inbox.payload?.paidMinor))
  )
    throw new Error('Відсутній однозначний snapshot платежу');
  if (!settings.telegramBotToken || !settings.telegramChatId) return 'skipped';
  const amountMinor =
    inbox?.result === 'partial' && inbox?.payload?.paidMinor != null
      ? Number(inbox.payload.paidMinor)
      : link?.amount_minor
        ? Number(link.amount_minor)
        : 0;
  const recipientKey = link?.recipient?.key ?? 'Основний';
  const statusLabel = inbox?.result === 'settle' ? 'повністю' : 'частково (накопичено)';
  const message = `Оплату підтверджено: угода №${job.deal_id} · сума ${formatMoney(amountMinor)} ₴ · отримувач ${recipientKey} · ${statusLabel}`;

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: message,
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    throw new Error('Результат відправлення невідомий; повтор може створити дублікат');
  }
  if (!res.ok) {
    throw new Error(
      `Telegram Bot API ${res.status}: результат може бути невідомий; повтор може створити дублікат`,
    );
  }
  const body = await res.json().catch(() => null);
  if (body?.ok !== true)
    throw new Error(
      'Некоректна відповідь Telegram; результат невідомий, повтор може створити дублікат',
    );
  return 'done';
}
export async function processNotifyInline(inboxId: string): Promise<void> {
  const job = (
    await pool().query<Job>(
      "UPDATE jobs SET status='processing', claimed_at=now(), lease_id=$2, attempts=attempts+1 WHERE kind='notify' AND ref_id=$1 AND status='queued' RETURNING *",
      [inboxId, randomUUID()],
    )
  ).rows[0];
  if (!job) return;
  try {
    const status = await sendTelegramNotification(job);
    await pool().query(
      "UPDATE jobs SET status=$1,last_error=CASE WHEN $1='skipped' THEN 'Telegram не налаштовано' ELSE NULL END,lease_id=NULL WHERE id=$2 AND lease_id=$3 AND status='processing'",
      [status, job.id, job.lease_id],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'Помилка Telegram';
    await pool().query(
      "UPDATE jobs SET status='failed',last_error=$1,lease_id=NULL WHERE id=$2 AND lease_id=$3 AND status='processing'",
      [msg, job.id, job.lease_id],
    );
  }
}

export async function retryJob(
  id: string,
): Promise<{ status: 'done' | 'skipped' | 'failed'; error?: string }> {
  const job = (
    await pool().query<Job>(
      "UPDATE jobs SET status='processing',claimed_at=now(),attempts=attempts+1,lease_id=$2 WHERE id=$1 AND (status IN ('failed','queued') OR (status='processing' AND claimed_at<now()-interval '2 minutes')) RETURNING *",
      [id, randomUUID()],
    )
  ).rows[0];
  if (!job) throw new Error('Операцію не знайдено або повтор недоступний');

  try {
    if (job.kind === 'notify') {
      const status = await sendTelegramNotification(job);
      const updated = await transaction(async (db) => {
        const result = await db.query(
          "UPDATE jobs SET status=$1,last_error=CASE WHEN $1='skipped' THEN 'Telegram не налаштовано' ELSE NULL END,lease_id=NULL WHERE id=$2 AND lease_id=$3 AND status='processing' RETURNING id",
          [status, id, job.lease_id],
        );
        if (result.rowCount)
          await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', ['retry', id]);
        return result.rowCount;
      });
      if (!updated)
        throw new Error(
          'Право обробки втрачено; результат відправлення невідомий, повтор може створити дублікат',
        );
      return { status };
    }
    const result = await transaction(async (db) => {
      await lockDeal(db, job.deal_id);
      const owned = await db.query(
        "SELECT id FROM jobs WHERE id=$1 AND lease_id=$2 AND status='processing' FOR UPDATE",
        [id, job.lease_id],
      );
      if (!owned.rowCount) throw new Error('Право обробки втрачено');
      if (job.kind === 'event') await processEvent(db, job);
      const eventStatus =
        job.kind === 'event'
          ? (await db.query('SELECT status FROM inbox WHERE id=$1', [job.ref_id])).rows[0]?.status
          : null;
      const status: 'done' | 'skipped' =
        job.kind === 'sync' || eventStatus === 'skipped' || eventStatus === 'probe'
          ? 'skipped'
          : 'done';
      await db.query(
        'UPDATE jobs SET status=$1,last_error=NULL,lease_id=NULL WHERE id=$2 AND lease_id=$3',
        [status, id, job.lease_id],
      );
      await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', ['retry', id]);
      return { status };
    });
    if (job.kind === 'event' && result.status === 'done') {
      try {
        await processNotifyInline(job.ref_id);
      } catch {}
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Помилка обробки';
    const failure =
      job.kind === 'notify' && !message.includes('дублікат') && !message.includes('snapshot')
        ? `${message}; результат відправлення може бути невідомий, повтор може створити дублікат`
        : message;
    const updated = await transaction(async (db) => {
      const result = await db.query(
        "UPDATE jobs SET status='failed',last_error=$1,lease_id=NULL WHERE id=$2 AND lease_id=$3 AND status='processing' RETURNING id",
        [failure, id, job.lease_id],
      );
      if (result.rowCount) {
        if (job.kind === 'event')
          await db.query("UPDATE inbox SET status='failed',result=$1 WHERE id=$2", [
            message,
            job.ref_id,
          ]);
        await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', ['retry', id]);
      }
      return result.rowCount;
    });
    if (!updated)
      throw new Error(
        'Право обробки втрачено; результат операції невідомий, повтор може створити дублікат',
      );
    return { status: 'failed', error: failure };
  }
}
export async function extendLink(id: string): Promise<void> {
  await transaction(async (db) => {
    const link = (await db.query('SELECT deal_id, status FROM links WHERE id=$1', [id])).rows[0];
    if (!link) throw new Error('Посилання не знайдено');
    if (link.status !== 'active')
      throw new Error('Продовжити можна лише активні або протерміновані посилання');
    await lockDeal(db, link.deal_id);
    const settings = await getSettings(db);
    const ttl = settings.linkTtlDays || 7;
    await db.query(
      "UPDATE links SET expires_at=now()+($1 * interval '1 day') WHERE id=$2 AND status='active'",
      [ttl, id],
    );
    await db.query('UPDATE deals SET link_id=$1 WHERE id=$2', [id, link.deal_id]);
    await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', ['extend', id]);
  });
}
export async function disableLink(id: string): Promise<void> {
  await transaction(async (db) => {
    const row = (await db.query('SELECT deal_id FROM links WHERE id=$1', [id])).rows[0];
    if (!row) throw new Error('Посилання не знайдено');
    await lockDeal(db, row.deal_id);
    await db.query("UPDATE links SET status='disabled' WHERE id=$1 AND status='active'", [id]);
    await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', ['disable', id]);
  });
}
