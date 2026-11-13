import { z } from 'zod';
export type EventKind = 'issue' | 'payment';
export interface CrmEvent {
  eventId: string;
  dealId: string;
  eventAt: number;
  totalMinor: number;
  paidMinor: number;
  currency: 'UAH';
  stage: string;
  recipientKey?: string;
  paymentId?: string;
  kind?: 'debit' | 'credit' | 'transfer';
  planned?: boolean;
}
export interface DealState {
  lastEventAt: number | null;
  link: null | {
    id: string;
    status: string;
    amountMinor: number;
    fingerprint: string;
    expiresAt: number;
  };
}
export interface Decision {
  action: 'issue' | 'reuse' | 'settle' | 'partial' | 'skip' | 'stale';
  amountMinor?: number;
}
export function money(input: unknown): number {
  if (typeof input !== 'string' && typeof input !== 'number') throw new Error('Сума відсутня');
  const text = String(input);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text))
    throw new Error('Очікується невід’ємна сума з крапкою та максимум двома знаками');
  const [whole, decimal = ''] = text.split('.');
  const value = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) throw new Error('Сума завелика');
  return value;
}
function text(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`Некоректне поле ${label}`);
  return value;
}
export function parseEvent(type: EventKind, input: unknown): CrmEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Очікується JSON-об’єкт');
  const o = input as Record<string, unknown>;
  const eventId = text(o.event_id, 'event_id', /^[A-Za-z0-9_.:+-]{1,180}$/);
  const dealId = text(String(o.deal_id ?? ''), 'deal_id', /^[1-9]\d{0,14}$/);
  const stamp = text(
    o.event_at,
    'event_at',
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/,
  );
  const eventAt = Date.parse(stamp);
  if (!Number.isFinite(eventAt) || !z.iso.datetime({ offset: true }).safeParse(stamp).success)
    throw new Error('Некоректний час події');
  if (o.currency !== 'UAH') throw new Error('Підтримується лише UAH');
  const event: CrmEvent = {
    eventId,
    dealId,
    eventAt,
    totalMinor: money(o.total),
    paidMinor: money(o.paid),
    currency: 'UAH',
    stage: typeof o.stage === 'string' ? o.stage.slice(0, 160) : '',
  };
  if (o.recipient_key !== undefined && o.recipient_key !== null) {
    if (typeof o.recipient_key === 'string' && o.recipient_key.length <= 64) {
      event.recipientKey = o.recipient_key;
    } else {
      throw new Error('Некоректний recipient_key');
    }
  }
  if (type === 'issue' && !event.stage) throw new Error('Відсутній етап');
  if (type === 'payment') {
    event.paymentId = text(String(o.payment_id ?? ''), 'payment_id', /^[1-9]\d{0,14}$/);
    if (!['debit', 'credit', 'transfer'].includes(String(o.kind)))
      throw new Error('Некоректний kind');
    if (![true, false, 'true', 'false'].includes(o.planned as boolean))
      throw new Error('Некоректний planned');
    event.kind = o.kind as CrmEvent['kind'];
    event.planned = o.planned === true || o.planned === 'true';
  }
  return event;
}
export function transition(
  state: DealState,
  event: CrmEvent,
  now: number,
  fingerprint: string,
  stage: string,
): Decision {
  if (event.paymentId && (event.planned || event.kind !== 'debit')) return { action: 'skip' };
  if (!event.paymentId && event.stage !== stage) return { action: 'skip' };
  if (state.lastEventAt !== null && event.eventAt <= state.lastEventAt) return { action: 'stale' };
  const amountMinor = Math.max(0, event.totalMinor - event.paidMinor);
  if (amountMinor === 0) return { action: 'settle' };
  if (event.paymentId) return { action: 'partial' };
  if (
    state.link?.status === 'active' &&
    state.link.expiresAt > now &&
    state.link.fingerprint === fingerprint &&
    state.link.amountMinor === amountMinor
  )
    return { action: 'reuse', amountMinor };
  return { action: 'issue', amountMinor };
}
