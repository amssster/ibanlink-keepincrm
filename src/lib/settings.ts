import type { RecipientConfig } from './payment';
import { validateRecipientConfig } from './payment';
import { pool, transaction } from './db';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';

export interface Settings {
  recipients: RecipientConfig[];
  stage: string;
  field: string;
  linkTtlDays: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  enabled: boolean;
}
export interface StoredSettings extends Settings {
  contractSince: string;
  contractVerifiedAt?: string;
  configVersion: string;
}
const defaults: StoredSettings = {
  recipients: [],
  stage: 'Очікує оплати',
  field: 'Посилання на оплату IBAN',
  linkTtlDays: 7,
  telegramBotToken: '',
  telegramChatId: '',
  enabled: false,
  contractSince: new Date(0).toISOString(),
  configVersion: '',
};

export async function getRecipientLogo(key: string, db?: PoolClient): Promise<string | null> {
  const client = db ?? pool();
  try {
    const row = (await client.query('SELECT data FROM recipient_logos WHERE key = $1', [key])).rows[0];
    if (row?.data) return row.data;
  } catch {
    // fallback if table not yet created
  }
  const settings = await getSettings(db);
  const r = settings.recipients.find((item) => item.key === key);
  return r?.logo && r.logo.startsWith('data:image/') ? r.logo : null;
}

export async function getSettings(db?: PoolClient, forUpdate = false): Promise<StoredSettings> {
  const row = (
    await (db ?? pool()).query(
      'SELECT data FROM settings WHERE id=true' + (db ? (forUpdate ? ' FOR UPDATE' : ' FOR SHARE') : ''),
    )
  ).rows[0]?.data;
  const raw = { ...defaults, ...row };
  if (!row?.recipients && raw.recipient && raw.recipient.iban) {
    raw.recipients = [
      {
        key: 'Основний',
        ...raw.recipient,
        purposeTemplate: raw.purposeTemplate ?? 'Оплата за замовлення №{deal_id}',
      },
    ];
  }
  return raw;
}
export function purposeFor(recipient: { purposeTemplate: string }, dealId: string): string {
  return recipient.purposeTemplate.replaceAll('{deal_id}', dealId);
}
export function paymentCritical(r: RecipientConfig) {
  return {
    key: r.key,
    name: r.name,
    iban: r.iban,
    taxId: r.taxId,
    purposeTemplate: r.purposeTemplate,
  };
}

export type SettingsInput =
  | Settings
  | (Partial<Settings> & {
      recipient?: Record<string, unknown>;
      purposeTemplate?: string;
    });

export async function saveSettings(value: SettingsInput): Promise<void> {
  let recipientsList = value.recipients;
  if (!recipientsList && 'recipient' in value && value.recipient) {
    const r = value.recipient;
    const purposeTemplate =
      'purposeTemplate' in value && typeof value.purposeTemplate === 'string'
        ? value.purposeTemplate
        : 'Оплата за замовлення №{deal_id}';
    recipientsList = [
      {
        key: typeof r.key === 'string' ? r.key : 'Основний',
        name: typeof r.name === 'string' ? r.name : '',
        brand: typeof r.brand === 'string' ? r.brand : '',
        iban: typeof r.iban === 'string' ? r.iban : '',
        taxId: typeof r.taxId === 'string' ? r.taxId : '',
        purposeTemplate,
      },
    ];
  }
  if (!Array.isArray(recipientsList)) {
    throw new Error('Очікується список отримувачів');
  }
  const recipients = recipientsList.map(validateRecipientConfig);
  const keys = recipients.map((r) => r.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Ключі отримувачів мають бути унікальними');
  }
  const stage = value.stage ?? 'Очікує оплати';
  const field = value.field ?? 'Посилання на оплату IBAN';
  for (const f of [stage, field]) {
    if (!f || f.length > 160 || /[\x00-\x1f]/.test(f))
      throw new Error('Перевірте назви полів та етап');
  }
  const linkTtlDays = Number(value.linkTtlDays ?? 7);
  if (!Number.isInteger(linkTtlDays) || linkTtlDays < 1 || linkTtlDays > 30) {
    throw new Error('Термін дії посилання: від 1 до 30 днів');
  }
  const telegramBotToken =
    typeof value.telegramBotToken === 'string' ? value.telegramBotToken.trim().slice(0, 200) : '';
  const telegramChatId =
    typeof value.telegramChatId === 'string' ? value.telegramChatId.trim().slice(0, 100) : '';

  await transaction(async (db) => {
    const old = await getSettings(db, true);
    const criticalOld = (old.recipients ?? []).map(paymentCritical);
    const criticalNext = recipients.map(paymentCritical);
    const recipientsChanged = JSON.stringify(criticalOld) !== JSON.stringify(criticalNext);
    const changed =
      recipientsChanged ||
      old.stage !== stage ||
      old.field !== field;

    const existingLogos = await db.query('SELECT key, data FROM recipient_logos');
    const logoData = new Map<string, string>(existingLogos.rows.map((row) => [row.key, row.data]));
    const storedRecipients = [];
    for (const r of recipients) {
      let data = r.logo;
      if (data && !data.startsWith('data:image/')) {
        const previous = old.recipients.find((item) => item.logo === data);
        if (!previous) throw new Error('Логотип отримувача не знайдено');
        data = logoData.get(previous.key) ?? (previous.logo?.startsWith('data:image/') ? previous.logo : undefined);
        if (!data) throw new Error('Логотип отримувача не знайдено');
      }
      if (data) {
        await db.query(
          'INSERT INTO recipient_logos(key, data, updated_at) VALUES($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
          [r.key, data],
        );
      } else {
        await db.query('DELETE FROM recipient_logos WHERE key = $1', [r.key]);
      }
      const version = data ? createHash('sha256').update(data).digest('hex') : '';
      storedRecipients.push({ ...r, logo: data ? `/api/recipients/${encodeURIComponent(r.key)}/logo?v=${version}` : undefined });
    }
    await db.query('DELETE FROM recipient_logos WHERE NOT (key = ANY($1))', [keys]);

    const next: StoredSettings = {
      recipients: storedRecipients,
      stage,
      field,
      linkTtlDays,
      telegramBotToken,
      telegramChatId,
      enabled: false,
      contractSince:
        changed || (old.enabled && !value.enabled) ? new Date().toISOString() : old.contractSince,
      configVersion: changed || old.enabled !== value.enabled ? randomUUID() : old.configVersion,
      contractVerifiedAt: changed ? undefined : old.contractVerifiedAt,
    };
    if (value.enabled) {
      if (old.enabled && !changed) {
        next.enabled = true;
        next.contractVerifiedAt = old.contractVerifiedAt;
      } else {
        if (changed)
          throw new Error(
            'Зміна етапу або поля потребує нової перевірки контракту: спочатку вимкніть «Увімкнути інтеграцію», збережіть зміни та проведіть тестові події CRM',
          );
        const proof = await db.query(
          "SELECT DISTINCT ON (kind) kind,payload FROM inbox WHERE created_at >= $1 AND status='probe' ORDER BY kind,created_at DESC",
          [next.contractSince],
        );
        if (proof.rows.length !== 2)
          throw new Error('Потрібні тестові події створення посилання та проведеної оплати');
        const issue = proof.rows.find((row) => row.kind === 'issue')!.payload;
        const payment = proof.rows.find((row) => row.kind === 'payment')!.payload;
        if (issue.dealId !== payment.dealId) throw new Error('Потрібні події однієї тестової угоди');
        if (
          issue.stage !== next.stage ||
          payment.totalMinor !== issue.totalMinor ||
          payment.paidMinor <= issue.paidMinor ||
          payment.eventAt < issue.eventAt
        )
          throw new Error('Перевірте зв’язок сум і часу тестової угоди та платежу');
        if (payment.kind !== 'debit' || payment.planned)
          throw new Error('Перевірте подію фактичного вхідного платежу');
        if (!issue.recipientKey || !recipients.some((r) => r.key === issue.recipientKey))
          throw new Error('Тестова подія створення посилання повинна містити ключ отримувача з налаштувань');
        next.enabled = true;
        next.contractVerifiedAt = new Date().toISOString();
      }
    }
    await db.query('UPDATE settings SET data=$1,updated_at=now() WHERE id=true', [next]);
    await db.query('INSERT INTO audit(action,target) VALUES($1,$2)', [
      'settings',
      next.enabled ? 'enabled' : 'probe',
    ]);
  });
}
