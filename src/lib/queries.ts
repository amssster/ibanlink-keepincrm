import { pool } from './db';
import type { LinkRecipient } from './payment';
export interface LinkRow {
  id: string;
  token: string;
  deal_id: string;
  amount_minor: string;
  recipient: LinkRecipient;
  purpose: string;
  status: string;
  created_at: Date;
  expires_at: Date;
  synced_at: Date | null;
}
function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function linkStatus(link: LinkRow): string {
  return link.status === 'active' && new Date(link.expires_at).getTime() <= Date.now()
    ? 'expired'
    : link.status;
}
export async function publicLink(token: string): Promise<LinkRow | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  return (
    (await pool().query<LinkRow>('SELECT * FROM links WHERE token=$1', [token])).rows[0] ?? null
  );
}
export interface ListLinksOptions {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}
export async function listLinks(
  params: ListLinksOptions | string,
  legacyPage = 1,
): Promise<{ rows: LinkRow[]; total: number }> {
  const options: ListLinksOptions =
    typeof params === 'string' ? { q: params, page: legacyPage } : params;
  const search = (options.q ?? '').trim().slice(0, 30);
  const from = (options.from ?? '').trim();
  const to = (options.to ?? '').trim();
  const status = (options.status ?? '').trim();
  const pageSize = options.pageSize ?? 30;
  const page = Math.max(1, options.page ?? 1);

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let idx = 1;

  if (search) {
    if (/^\d+$/.test(search)) {
      conditions.push(`deal_id LIKE $${idx}`);
      values.push(`${search}%`);
    } else {
      conditions.push(`deal_id ILIKE $${idx}`);
      values.push(`%${search}%`);
    }
    idx++;
  }
  if (isValidDateString(from)) {
    conditions.push(`created_at >= ($${idx}::date AT TIME ZONE 'Europe/Kyiv')`);
    values.push(from);
    idx++;
  }
  if (isValidDateString(to)) {
    conditions.push(`created_at < (($${idx}::date + 1) AT TIME ZONE 'Europe/Kyiv')`);
    values.push(to);
    idx++;
  }
  if (status === 'expired') {
    conditions.push(`status='active' AND expires_at <= now()`);
  } else if (status === 'active') {
    conditions.push(`status='active' AND expires_at > now()`);
  } else if (['paid', 'partial', 'replaced', 'disabled'].includes(status)) {
    conditions.push(`status = $${idx}`);
    values.push(status);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countQuery = `SELECT count(*)::int AS count FROM links ${where}`;
  const total = (await pool().query(countQuery, values)).rows[0]?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;

  const limitIdx = idx;
  const offsetIdx = idx + 1;
  const dataValues = [...values, pageSize, offset];
  const dataQuery = `SELECT * FROM links ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  const rows = (await pool().query<LinkRow>(dataQuery, dataValues)).rows;

  return { rows, total };
}
export async function overview() {
  const result = (
    await pool().query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE status='active' AND expires_at>now())::int AS active,
    count(*) FILTER(WHERE status='paid')::int AS paid,
    coalesce(sum(amount_minor) FILTER(WHERE status='active' AND expires_at>now()),0)::text AS outstanding FROM links`)
  ).rows[0];
  const jobs = (
    await pool().query(
      "SELECT count(*)::int AS waiting,count(*) FILTER(WHERE status='failed' OR (status='processing' AND claimed_at<now()-interval '2 minutes') OR (status='queued' AND available_at<now()-interval '5 minutes'))::int AS attention FROM jobs WHERE status IN ('queued','processing','failed')",
    )
  ).rows[0];
  return {
    ...result,
    ...jobs,
  };
}
export const formatMoney = (minor: number | string) =>
  new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(minor) / 100,
  );
export const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value));
export const statusLabels: Record<string, string> = {
  active: 'Очікує оплати',
  paid: 'Оплату відмічено в CRM',
  partial: 'Часткова оплата',
  expired: 'Термін минув',
  disabled: 'Вимкнено',
  replaced: 'Замінено',
};
