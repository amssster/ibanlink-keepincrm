import { expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../src/lib/auth', () => ({
  requireOwner: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({
    stage: 'Очікує оплати',
    field: 'Посилання на оплату IBAN',
  }),
}));

vi.mock('../src/lib/env', () => ({
  appUrl: () => 'http://localhost:3000',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { MaskedSecret } from '../src/components/actions';
import WebhooksPage from '../src/app/admin/settings/webhooks/page';

beforeEach(() => {
  vi.stubEnv('WEBHOOK_ISSUE_SECRET', 'issue_secret_1234567890abcdef');
  vi.stubEnv('WEBHOOK_PAYMENT_SECRET', 'payment_secret_1234567890abcdef');
});

it('MaskedSecret за замовчуванням маскує Bearer токен і містить дії перегляду та копіювання', () => {
  const secret = 'Bearer 32a6ed07a33576113b78476181a81165bb2cc1a5f16caebec7f8773424f3a07e';
  const html = renderToStaticMarkup(
    React.createElement(MaskedSecret, { value: secret, copyLabel: 'Копіювати заголовок' }),
  );

  expect(html).toContain('Bearer ••••••••••••••••••••••••••••••••');
  expect(html).not.toContain('32a6ed07a33576113b78476181a81165bb2cc1a5f16caebec7f8773424f3a07e');
  expect(html).toContain('Показати секрет');
  expect(html).toContain('Копіювати заголовок');
});

it('MaskedSecret показує заглушку без кнопок, якщо значення секрету відсутнє', () => {
  const html = renderToStaticMarkup(
    React.createElement(MaskedSecret, {
      value: '',
      placeholder: 'Bearer <WEBHOOK_ISSUE_SECRET>',
    }),
  );

  expect(html).toContain('Bearer &lt;WEBHOOK_ISSUE_SECRET&gt;');
  expect(html).not.toContain('Показати секрет');
  expect(html).not.toContain('Копіювати заголовок');
});

it('WebhooksPage не рендерить відкриті секрети у статичній розмітці за замовчуванням', async () => {
  const pageTree = await WebhooksPage();
  const html = renderToStaticMarkup(pageTree);

  expect(html).toContain('Bearer ••••••••••••••••••••••••••••••••');
  expect(html).not.toContain('issue_secret_1234567890abcdef');
  expect(html).not.toContain('payment_secret_1234567890abcdef');
  expect(html).toContain('Показати секрет');
  expect(html).toContain('Копіювати заголовок');
});
