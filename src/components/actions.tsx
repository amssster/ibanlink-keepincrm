'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
export function CopyButton({
  value,
  label = 'Копіювати',
  small = false,
}: {
  value: string;
  label?: string;
  small?: boolean;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  }
  return (
    <span className="copy-wrap">
      <button
        type="button"
        className={small ? 'icon-button' : 'button secondary'}
        aria-label={copied ? 'Скопійовано' : label}
        title={copied ? 'Скопійовано' : label}
        onClick={copy}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
        {!small && (copied ? 'Скопійовано' : label)}
      </button>
      {error && <small role="alert">Не вдалося скопіювати. Виділіть текст вручну.</small>}
    </span>
  );
}
export function MaskedSecret({
  value,
  placeholder,
  maskedValue,
  copyLabel = 'Копіювати заголовок',
}: {
  value?: string;
  placeholder?: string;
  maskedValue?: string;
  copyLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  if (!value) {
    return (
      <div className="code-line">
        <code>{placeholder || '—'}</code>
      </div>
    );
  }
  const mask =
    maskedValue ??
    (value.startsWith('Bearer ')
      ? 'Bearer ••••••••••••••••••••••••••••••••'
      : '••••••••••••••••••••••••••••••••');
  return (
    <div className="code-line">
      <code>{visible ? value : mask}</code>
      <div className="inline-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={visible ? 'Сховати секрет' : 'Показати секрет'}
          title={visible ? 'Сховати секрет' : 'Показати секрет'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <CopyButton value={value} label={copyLabel} small />
      </div>
    </div>
  );
}
export function ActionButton({
  url,
  label,
  danger = false,
  retry = false,
}: {
  url: string;
  label: string;
  danger?: boolean;
  retry?: boolean;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [completed, setCompleted] = useState(false);
  async function run() {
    if (
      retry &&
      !window.confirm(
        'Якщо результат попереднього відправлення невідомий, повтор може створити дублікат. Продовжити?',
      )
    )
      return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      let response: Response;
      try {
        response = await fetch(url, { method: 'POST' });
      } catch (e) {
        if (retry) throw new Error('Результат операції невідомий. Повтор може створити дублікат.');
        throw e;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ??
            (retry ? 'Результат операції невідомий. Повтор може створити дублікат.' : 'Помилка'),
        );
      }
      if (retry) {
        const body = await response.json().catch(() => null);
        if (body?.status !== 'done' && body?.status !== 'skipped')
          throw new Error('Результат операції невідомий. Повтор може створити дублікат.');
        setNotice(body.status === 'skipped' ? 'Операцію пропущено' : 'Операцію виконано');
        setCompleted(true);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="action-wrap">
      <button
        disabled={busy || completed}
        className={`button compact ${danger ? 'subtle-danger' : 'secondary'}`}
        onClick={run}
      >
        {busy ? 'Зачекайте…' : label}
      </button>
      {error && <small role="alert">{error}</small>}
      {notice && <small role="status">{notice}</small>}
    </span>
  );
}
