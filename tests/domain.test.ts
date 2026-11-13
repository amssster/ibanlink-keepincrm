import { describe, expect, it } from 'vitest';
import { money, parseEvent, transition, type DealState } from '../src/lib/domain';

const raw = {
  event_id: 'issue-42-1',
  deal_id: '42',
  event_at: '2026-11-09T08:00:00.000Z',
  total: '5000.00',
  paid: '1000.00',
  currency: 'UAH',
  stage: 'Очікує оплати',
};
const state = (): DealState => ({ lastEventAt: null, link: null });

describe('суми та контракт CRM', () => {
  it('не приймає неіснуючу календарну дату', () => {
    expect(() => parseEvent('issue', { ...raw, event_at: '2026-02-31T08:00:00Z' })).toThrow();
  });
  it('не втрачає копійки на десяткових значеннях', () => {
    expect(money('123.45')).toBe(12345);
    expect(money('0.29')).toBe(29);
    expect(money('5000')).toBe(500000);
  });
  it.each(['', '-1', '1e3', '1.234', '1,25', 'NaN', '9007199254740992', null, undefined])(
    'відхиляє неоднозначну суму %s',
    (value) => {
      expect(() => money(value)).toThrow();
    },
  );
  it('не трактує відсутню сплачену суму як нуль', () => {
    expect(() => parseEvent('issue', { ...raw, paid: undefined })).toThrow();
    expect(() => parseEvent('issue', { ...raw, currency: 'USD' })).toThrow();
    expect(() => parseEvent('issue', { ...raw, event_at: '2026-11-09 10:00:00' })).toThrow();
  });
});
describe('життєвий цикл посилань', () => {
  it('виставляє лише неоплачений залишок', () => {
    const result = transition(state(), parseEvent('issue', raw), 100, 'same', 'Очікує оплати');
    expect(result.action).toBe('issue');
    expect(result.amountMinor).toBe(400000);
  });
  it('не створює посилання на нульовий залишок та на іншому етапі', () => {
    expect(
      transition(
        state(),
        parseEvent('issue', { ...raw, paid: '5000' }),
        100,
        'same',
        'Очікує оплати',
      ).action,
    ).toBe('settle');
    expect(
      transition(
        state(),
        parseEvent('issue', { ...raw, stage: 'Нова' }),
        100,
        'same',
        'Очікує оплати',
      ).action,
    ).toBe('skip');
  });
  it('повторно використовує активну сторінку, але замінює її після зміни суми або строку', () => {
    const current: DealState = {
      lastEventAt: Date.parse(raw.event_at) - 1000,
      link: {
        id: 'one',
        status: 'active',
        amountMinor: 400000,
        fingerprint: 'same',
        expiresAt: 200,
      },
    };
    expect(transition(current, parseEvent('issue', raw), 100, 'same', 'Очікує оплати').action).toBe(
      'reuse',
    );
    expect(
      transition(
        current,
        parseEvent('issue', { ...raw, total: '6000' }),
        100,
        'other',
        'Очікує оплати',
      ).action,
    ).toBe('issue');
    expect(transition(current, parseEvent('issue', raw), 201, 'same', 'Очікує оплати').action).toBe(
      'issue',
    );
  });
  it('не дає запізнілому запиту відкрити вже оплачену сторінку', () => {
    const current: DealState = {
      lastEventAt: Date.parse(raw.event_at) + 1000,
      link: { id: 'one', status: 'paid', amountMinor: 400000, fingerprint: 'same', expiresAt: 200 },
    };
    expect(transition(current, parseEvent('issue', raw), 100, 'same', 'Очікує оплати').action).toBe(
      'stale',
    );
  });
  it('часткова оплата закриває старе посилання і не створює нове', () => {
    const event = parseEvent('payment', {
      ...raw,
      event_id: 'payment-8',
      payment_id: '8',
      kind: 'debit',
      planned: 'false',
      paid: '2000',
    });
    expect(transition(state(), event, 100, 'same', 'Очікує оплати').action).toBe('partial');
  });
  it('заплановані платежі та витрати не закривають сторінку', () => {
    for (const extra of [
      { kind: 'debit', planned: true },
      { kind: 'credit', planned: false },
    ]) {
      const event = parseEvent('payment', {
        ...raw,
        event_id: 'payment-8',
        payment_id: '8',
        ...extra,
      });
      expect(transition(state(), event, 100, 'same', 'Очікує оплати').action).toBe('skip');
    }
  });
  it('однаковий час різних подій не дозволяє повторне відкриття', () => {
    expect(
      transition(
        { ...state(), lastEventAt: Date.parse(raw.event_at) },
        parseEvent('issue', raw),
        100,
        'same',
        'Очікує оплати',
      ).action,
    ).toBe('stale');
  });
});
