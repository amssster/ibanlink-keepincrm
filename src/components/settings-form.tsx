'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, CheckCircle2, ArrowRight } from 'lucide-react';
import type { Settings } from '@/lib/settings';

export type SettingsFormProps = {
  initial: Settings & { hasTelegramBotToken?: boolean };
};

export function SettingsForm({ initial }: SettingsFormProps) {
  const router = useRouter(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [clearToken, setClearToken] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    setSaved(false);
    setBusy(true);
    const form = new FormData(formElement);
    const value = {
      stage: form.get('stage'),
      field: form.get('field'),
      linkTtlDays: Number(form.get('linkTtlDays')) || 7,
      telegramBotToken: form.get('telegramBotToken') ?? '',
      clearTelegramBotToken: clearToken,
      telegramChatId: form.get('telegramChatId') ?? '',
      enabled: form.get('enabled') === 'on',
      confirmed: form.get('confirmed') === 'on',
    };
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const tokenInput = formElement.elements.namedItem('telegramBotToken') as HTMLInputElement | null;
      if (tokenInput) tokenInput.value = '';
      setSaved(true);
      setClearToken(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="POST" action="/api/admin/settings" onSubmit={submit} className="settings-form">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Отримувачі платежу</h2>
            <p>Реквізити банківських рахунків для прийому коштів.</p>
          </div>
          <span className="step-label">01</span>
        </div>
        <div className="section-padding stack">
          <div className="recipients-overview-card">
            <div>
              <strong>Налаштовано отримувачів: {initial.recipients?.length ?? 0}</strong>
              <p className="muted small">
                Управління отримувачами (ФОП, ТОВ), їхніми логотипами, призначеннями платежів та
                ключами для CRM.
              </p>
            </div>
            <Link href="/admin/recipients" className="button secondary">
              Налаштувати отримувачів
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>KeepinCRM</h2>
            <p>Параметри взаємодії з CRM.</p>
          </div>
          <span className="step-label">02</span>
        </div>
        <div className="form-grid">
          <p className="notice span-two">
            API-ключ не потрібен. Готове посилання повертається в JSON-відповіді webhook та
            записується у поле угоди через Response → $.payment_url.
          </p>
          <label>
            Етап очікування оплати
            <input name="stage" required defaultValue={initial.stage} />
          </label>
          <label>
            Назва поля для посилання
            <input name="field" required defaultValue={initial.field} />
          </label>
          <label className="span-two">
            Термін дії посилання (днів)
            <input
              type="number"
              name="linkTtlDays"
              required
              min={1}
              max={30}
              defaultValue={initial.linkTtlDays ?? 7}
            />
            <small>Від 1 до 30 днів (за замовчуванням 7 днів).</small>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Сповіщення Telegram</h2>
            <p>Оповіщення про підтверджені оплати у ваш чат.</p>
          </div>
          <span className="step-label">03</span>
        </div>
        <div className="form-grid">
          <p className="notice span-two">
            Необов’язково. Залиште порожнім, якщо сповіщення не потрібні. Токен зберігається у закритій
            базі даних і ніколи не передається клієнтам.
          </p>
          <div>
            <label>
              Токен Telegram-бота
              <input
                type="password"
                name="telegramBotToken"
                defaultValue=""
                placeholder={
                  initial.hasTelegramBotToken && !clearToken
                    ? '•••••••• (токен встановлено; залиште порожнім, щоб не змінювати)'
                    : '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ'
                }
                autoComplete="off"
                disabled={clearToken}
              />
              <small>Отримайте від @BotFather</small>
            </label>
            {initial.hasTelegramBotToken && (
              <label className="checkbox" style={{ marginTop: '0.5rem' }}>
                <input
                  type="checkbox"
                  name="clearTelegramBotToken"
                  checked={clearToken}
                  onChange={(e) => setClearToken(e.target.checked)}
                />
                <span>Видалити збережений токен</span>
              </label>
            )}
          </div>
          <label>
            ID чату Telegram
            <input
              name="telegramChatId"
              defaultValue={initial.telegramChatId ?? ''}
              placeholder="наприклад, 123456789 або -100123456789"
            />
            <small>Ваш Chat ID або ID групи</small>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Активація</h2>
            <p>Спочатку збережіть налаштування та перевірте обидві тестові події нижче.</p>
          </div>
          <span className="step-label">04</span>
        </div>
        <div className="section-padding stack">
          <label className="checkbox">
            <input type="checkbox" name="confirmed" />
            <span>
              Я перевірив суми, валюту, час, обидві події та запис тестового посилання в угоду через
              Response.
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" name="enabled" defaultChecked={initial.enabled} />
            <span>
              <strong>Увімкнути інтеграцію</strong>
              <small>
                Без активації повертається лише тестове посилання без можливості оплати.
              </small>
            </span>
          </label>
          <p className="muted small">
            Зміна платіжних реквізитів або мапінгу потребує повторної перевірки контракту. Вже видані
            сторінки зберігають свої реквізити.
          </p>
        </div>
      </section>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice success" role="status">
          <CheckCircle2 size={18} />
          Налаштування збережено.
        </p>
      )}
      <div className="form-footer">
        <span className="muted small">
          Термін дії нових сторінок — {initial.linkTtlDays ?? 7} днів
        </span>
        <button className="button primary" disabled={busy}>
          <Save size={17} />
          {busy ? 'Зберігаємо…' : 'Зберегти налаштування'}
        </button>
      </div>
    </form>
  );
}
