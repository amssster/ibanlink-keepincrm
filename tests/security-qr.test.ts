import { expect, it } from 'vitest';
import { hashPassword, verifyPassword, signSession, verifySession } from '../src/lib/security';
import { nbuPayload, validateRecipient, bankUrl } from '../src/lib/payment';

const recipient = {
  name: 'ТОВ «Стоматологія»',
  taxId: '00000000',
  iban: 'UA890000000000000000000000000',
  brand: 'Мій магазин',
};
it('перевіряє пароль та підпис і строк сесії', async () => {
  const hash = await hashPassword('test password 123');
  expect(await verifyPassword('test password 123', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
  const cookie = signSession('a'.repeat(64), 1000);
  expect(verifySession(cookie, 'a'.repeat(64), 1001)).toBe(true);
  expect(verifySession(cookie, 'b'.repeat(64), 1001)).toBe(false);
  expect(verifySession(cookie, 'a'.repeat(64), 1000 + 8 * 3600 * 1000)).toBe(false);
});
it('формує НБУ 002 з точними полями, кирилицею та копійками', () => {
  const url = nbuPayload(recipient, 103428, 'Стоматологічні послуги');
  expect(url.startsWith('https://qr.bank.gov.ua/')).toBe(true);
  const clear = Buffer.from(url.slice('https://qr.bank.gov.ua/'.length), 'base64url').toString(
    'utf8',
  );
  expect(clear).toBe(
    'BCD\n002\n1\nUCT\n\nТОВ «Стоматологія»\nUA890000000000000000000000000\nUAH1034.28\n00000000\n\n\nСтоматологічні послуги\n',
  );
});
it('перевіряє контрольну суму IBAN та забороняє ін’єкції рядків у QR', () => {
  expect(validateRecipient(recipient).iban).toBe(recipient.iban);
  expect(() =>
    validateRecipient({ ...recipient, iban: 'UA000000000000000000000000000' }),
  ).toThrow();
  expect(() => nbuPayload({ ...recipient, name: 'Назва\nІнше' }, 100, 'Оплата')).toThrow();
  expect(() => nbuPayload(recipient, 100, 'я'.repeat(400))).toThrow();
});
it('Android intent містить платіжні дані і вибраний пакет банку', () => {
  const url = nbuPayload(recipient, 100, 'Оплата');
  expect(bankUrl('mono', 'android', url)).toContain('package=com.ftband.mono');
  expect(bankUrl('privat', 'android', url)).toContain('package=ua.privatbank.ap24');
  expect(bankUrl('mono', 'ios', url)).toContain('https://mbnk.app/qr/');
  expect(bankUrl('privat', 'desktop', url)).toContain('https://next.privat24.ua/rd/send_qr/nbu/');
});
