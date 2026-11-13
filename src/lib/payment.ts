export interface Recipient {
  name: string;
  taxId: string;
  iban: string;
  brand: string;
  key?: string;
}
export interface LinkRecipient {
  key: string;
  name: string;
  brand: string;
  iban: string;
  taxId: string;
}
export interface RecipientConfig extends LinkRecipient {
  purposeTemplate: string;
  logo?: string;
  note?: string;
  suspended?: boolean;
}
function singleLine(value: string, max: number): boolean {
  return !!value.trim() && [...value].length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
export function validateRecipient(recipient: Recipient): Recipient {
  const iban = recipient.iban.replace(/\s/g, '').toUpperCase();
  if (!/^UA\d{27}$/.test(iban) || Number(iban.slice(2, 4)) < 2 || Number(iban.slice(2, 4)) > 98)
    throw new Error('IBAN: UA та 27 цифр, контрольні цифри 02–98');
  const digits = iban.slice(4) + '3010' + iban.slice(2, 4);
  let mod = 0;
  for (const digit of digits) mod = (mod * 10 + Number(digit)) % 97;
  if (mod !== 1) throw new Error('Некоректна контрольна сума IBAN');
  if (!singleLine(recipient.name, 70) || !singleLine(recipient.brand, 70))
    throw new Error('Назва має бути одним рядком до 70 символів');
  if (!/^\d{8}(\d{2})?$/.test(recipient.taxId)) throw new Error('Код отримувача: 8 або 10 цифр');
  return { ...recipient, iban };
}
export function validateRecipientConfig(recipient: RecipientConfig): RecipientConfig {
  const base = validateRecipient(recipient);
  const key = typeof recipient.key === 'string' ? recipient.key : '';
  if (!key || key.length > 64 || /[\x00-\x1f\x7f]/.test(key))
    throw new Error('Ключ отримувача: непорожній рядок до 64 символів без керуючих знаків');
  const purposeTemplate = recipient.purposeTemplate ?? '';
  if (!singleLine(purposeTemplate, 140))
    throw new Error('Призначення: один рядок до 140 символів');
  if (!purposeTemplate.includes('{deal_id}') || /\{(?!deal_id\})/.test(purposeTemplate))
    throw new Error('Призначення має містити {deal_id}; інші змінні не підтримуються');
  nbuPayload(base, 100, purposeTemplate.replaceAll('{deal_id}', '999999999999999'));

  let logo = recipient.logo;
  if (logo) {
    if (
      typeof logo !== 'string' ||
      (!logo.startsWith('/api/recipients/') &&
        (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 307200))
    ) {
      throw new Error('Логотип: зображення PNG, JPEG або WebP формату data URL розміром до 300 КБ');
    }
  } else {
    logo = undefined;
  }

  let note = recipient.note;
  if (note) {
    if (typeof note !== 'string' || note.length > 200 || /[\x00-\x08\x0b-\x1f\x7f]/.test(note))
      throw new Error('Нотатка покупцю: текст до 200 символів');
  } else {
    note = undefined;
  }

  return {
    ...base,
    key,
    purposeTemplate,
    logo,
    note,
    suspended: !!recipient.suspended,
  };
}
export function nbuPayload(recipient: Recipient, amount: number, purpose: string): string {
  const r = validateRecipient(recipient);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999)
    throw new Error('Сума поза межами формату НБУ');
  if (!singleLine(purpose, 140)) throw new Error('Призначення: один рядок до 140 символів');
  const decimal = `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
  const clear = [
    'BCD',
    '002',
    '1',
    'UCT',
    '',
    r.name,
    r.iban,
    'UAH' + decimal,
    r.taxId,
    '',
    '',
    purpose,
    '',
  ].join('\n');
  const encoded = Buffer.from(clear, 'utf8').toString('base64url');
  if (encoded.length > 475)
    throw new Error('Реквізити та призначення перевищують обсяг QR НБУ; скоротіть текст');
  return 'https://qr.bank.gov.ua/' + encoded;
}
export function bankUrl(
  bank: 'mono' | 'privat',
  platform: 'android' | 'ios' | 'desktop',
  payload: string,
): string {
  if (!payload.startsWith('https://qr.bank.gov.ua/') || !/^[A-Za-z0-9_-]+$/.test(payload.slice(23)))
    throw new Error('Некоректний QR payload');
  const code = payload.slice(23);
  if (bank === 'mono') {
    const monoUrl = `https://mbnk.app/qr/${code}`;
    return platform === 'android'
      ? `intent://mbnk.app/qr/${code}#Intent;scheme=https;package=com.ftband.mono;S.browser_fallback_url=${encodeURIComponent(monoUrl)};end`
      : monoUrl;
  }
  const privatUrl = `https://next.privat24.ua/rd/send_qr/nbu/${code}`;
  return platform === 'android'
    ? `intent://next.privat24.ua/rd/send_qr/nbu/${code}#Intent;scheme=https;package=ua.privatbank.ap24;S.browser_fallback_url=${encodeURIComponent(privatUrl)};end`
    : privatUrl;
}
