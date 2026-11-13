'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  Landmark,
  X,
  Upload,
} from 'lucide-react';
import type { RecipientConfig } from '@/lib/payment';
import { CopyButton } from './actions';

export function RecipientsManager({ initial }: { initial: RecipientConfig[] }) {
  const router = useRouter();
  const [recipients, setRecipients] = useState<RecipientConfig[]>(initial);
  const [editing, setEditing] = useState<RecipientConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [disabledWarning, setDisabledWarning] = useState(false);

  // Form fields
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [taxId, setTaxId] = useState('');
  const [iban, setIban] = useState('');
  const [purposeTemplate, setPurposeTemplate] = useState('Оплата за замовлення №{deal_id}');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [suspended, setSuspended] = useState(false);

  function startAdd() {
    setKey('');
    setName('');
    setBrand('');
    setTaxId('');
    setIban('');
    setPurposeTemplate('Оплата за замовлення №{deal_id}');
    setLogo(undefined);
    setNote('');
    setSuspended(false);
    setIsNew(true);
    setEditing({} as RecipientConfig);
    setError('');
    setSaved(false);
  }

  function startEdit(r: RecipientConfig) {
    setKey(r.key);
    setName(r.name);
    setBrand(r.brand);
    setTaxId(r.taxId);
    setIban(r.iban);
    setPurposeTemplate(r.purposeTemplate);
    setLogo(r.logo);
    setNote(r.note ?? '');
    setSuspended(!!r.suspended);
    setIsNew(false);
    setEditing(r);
    setError('');
    setSaved(false);
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Підтримуються формати PNG, JPEG або WebP');
      return;
    }
    if (file.size > 220000) {
      setError('Файл завеликий (максимум ~200 КБ, до 300 КБ у base64)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (result.length > 307200) {
        setError('Розмір логотипа перевищує ліміт 300 КБ');
        return;
      }
      setLogo(result);
      setError('');
    };
    reader.readAsDataURL(file);
  }

  async function persist(newList: RecipientConfig[]) {
    setBusy(true);
    setError('');
    setSaved(false);
    setDisabledWarning(false);
    try {
      const res = await fetch('/api/admin/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: newList }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Помилка збереження');
      }
      const body = await res.json();
      setRecipients(body.recipients);
      setSaved(true);
      if (body.integrationDisabled) {
        setDisabledWarning(true);
      }
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate: RecipientConfig = {
      key: key.trim(),
      name: name.trim(),
      brand: brand.trim(),
      taxId: taxId.trim(),
      iban: iban.replace(/\s/g, '').toUpperCase(),
      purposeTemplate: purposeTemplate.trim(),
      logo: logo || undefined,
      note: note.trim() || undefined,
      suspended,
    };

    if (!candidate.key) {
      setError('Вкажіть ключ отримувача');
      return;
    }

    if (isNew) {
      if (recipients.some((r) => r.key === candidate.key)) {
        setError(`Отримувач із ключем «${candidate.key}» вже існує`);
        return;
      }
      persist([...recipients, candidate]);
    } else {
      const originalKey = editing?.key;
      if (candidate.key !== originalKey && recipients.some((r) => r.key === candidate.key)) {
        setError(`Отримувач із ключем «${candidate.key}» вже існує`);
        return;
      }
      const updated = recipients.map((r) => (r.key === originalKey ? candidate : r));
      persist(updated);
    }
  }

  function toggleSuspend(r: RecipientConfig) {
    const updated = recipients.map((item) =>
      item.key === r.key ? { ...item, suspended: !item.suspended } : item,
    );
    persist(updated);
  }

  function deleteRecipient(keyToDelete: string) {
    if (!confirm(`Видалити отримувача «${keyToDelete}»?`)) return;
    const updated = recipients.filter((r) => r.key !== keyToDelete);
    persist(updated);
  }

  return (
    <div className="recipients-view">
      <div className="section-header-actions">
        <p className="muted">
          Кожен отримувач відповідає опції в полі вибору CRM «Отримувач платежу».
        </p>
        {!editing && (
          <button type="button" className="button primary compact" onClick={startAdd}>
            <Plus size={16} />
            Додати отримувача
          </button>
        )}
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice success" role="status">
          <CheckCircle2 size={18} />
          Зміни успішно збережено.
        </p>
      )}
      {disabledWarning && (
        <div className="notice warning" role="alert">
          Увага: через зміну платіжних реквізитів інтеграцію переведено в режим перевірки.
          Перейдіть до розділу <Link href="/admin/settings">Підключення</Link>, щоб повторно
          активувати сервіс.
        </div>
      )}

      {editing && (
        <section className="panel recipient-modal">
          <div className="panel-heading">
            <div>
              <h2>{isNew ? 'Новий отримувач' : `Редагування: ${editing.key}`}</h2>
              <p>Заповніть реквізити та налаштування отримувача.</p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setEditing(null)}
              aria-label="Закрити"
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleFormSubmit} className="section-padding stack">
            <div className="form-grid">
              <label>
                Ключ отримувача (значення для CRM)
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                  maxLength={64}
                  placeholder="наприклад, Основний або ФОП Іванов"
                />
                <small>Точно як у випадному списку KeepinCRM</small>
              </label>
              <label>
                Назва бренду / магазину
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  required
                  maxLength={70}
                  placeholder="Мій магазин"
                />
              </label>
              <label>
                Юридична назва
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={70}
                  placeholder="ФОП Прізвище Ім’я По батькові"
                />
              </label>
              <label>
                ЄДРПОУ / РНОКПП
                <input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  required
                  pattern="[0-9]{8}([0-9]{2})?"
                  placeholder="8 або 10 цифр"
                />
              </label>
              <label className="span-two">
                IBAN
                <input
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  required
                  placeholder="UA…"
                  spellCheck={false}
                />
              </label>
              <label className="span-two">
                Шаблон призначення платежу
                <input
                  value={purposeTemplate}
                  onChange={(e) => setPurposeTemplate(e.target.value)}
                  required
                  maxLength={140}
                  placeholder="Оплата за замовлення №{deal_id}"
                />
                <small>Обов’язково містить змінну {'{deal_id}'}</small>
              </label>
              <label className="span-two">
                Нотатка для покупця (показується над реквізитами)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="Наприклад: Після оплати надішліть квитанцію у Viber."
                />
                <small>Необов’язково, до 200 символів</small>
              </label>
              <div className="span-two logo-upload-field">
                <span className="field-label">Логотип отримувача (необов’язково, до 300 КБ)</span>
                <div className="logo-preview-row">
                  {logo ? (
                    <div className="logo-box">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo} alt="Попередній перегляд" className="logo-preview-img" />
                      <button
                        type="button"
                        className="button compact subtle-danger"
                        onClick={() => setLogo(undefined)}
                      >
                        Видалити логотип
                      </button>
                    </div>
                  ) : (
                    <label className="button secondary compact file-label">
                      <Upload size={16} />
                      Завантажити логотип (PNG/JPEG/WebP)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoUpload}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
              </div>
              <label className="checkbox span-two">
                <input
                  type="checkbox"
                  checked={suspended}
                  onChange={(e) => setSuspended(e.target.checked)}
                />
                <span>
                  <strong>Призупинити цього отримувача</strong>
                  <small>
                    Запити на нові посилання будуть пропущені, а відкриті посилання покажуть
                    повідомлення про призупинення.
                  </small>
                </span>
              </label>
            </div>
            <div className="form-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Скасувати
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? 'Зберігаємо…' : 'Зберегти отримувача'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="recipients-grid">
        {!recipients.length ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Users size={27} />
            </span>
            <h3>Немає налаштованих отримувачів</h3>
            <p>Додайте першого отримувача, щоб почати випускати платіжні посилання.</p>
          </div>
        ) : (
          recipients.map((r) => (
            <div
              className={`panel recipient-card ${r.suspended ? 'suspended' : ''}`}
              key={r.key}
            >
              <div className="card-top">
                <div className="merchant-identity">
                  {r.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.logo}
                      alt={r.brand}
                      className="recipient-logo-sm"
                    />
                  ) : (
                    <span className="merchant-mark">
                      <Landmark size={20} />
                    </span>
                  )}
                  <div>
                    <h3>{r.brand}</h3>
                    <p className="muted small">{r.name}</p>
                  </div>
                </div>
                <span className={`badge ${r.suspended ? 'disabled' : 'active'}`}>
                  <span className="status-dot" />
                  {r.suspended ? 'Призупинено' : 'Активний'}
                </span>
              </div>
              <div className="key-box">
                <span className="key-label">Ключ CRM:</span>
                <code className="key-code">{r.key}</code>
                <CopyButton value={r.key} label={`Копіювати ключ ${r.key}`} small />
                <span className="key-hint">Скопіюйте у select-поле CRM</span>
              </div>
              <div className="recipient-props">
                <div>
                  <span className="prop-name">ЄДРПОУ:</span>
                  <span>{r.taxId}</span>
                </div>
                <div>
                  <span className="prop-name">IBAN:</span>
                  <span className="iban-mono">{r.iban}</span>
                </div>
                <div>
                  <span className="prop-name">Призначення:</span>
                  <span className="small">{r.purposeTemplate}</span>
                </div>
                {r.note && (
                  <div>
                    <span className="prop-name">Нотатка:</span>
                    <span className="small muted">«{r.note}»</span>
                  </div>
                )}
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => toggleSuspend(r)}
                  disabled={busy}
                >
                  {r.suspended ? (
                    <>
                      <PlayCircle size={14} /> Відновити
                    </>
                  ) : (
                    <>
                      <PauseCircle size={14} /> Призупинити
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => startEdit(r)}
                  disabled={busy}
                >
                  <Pencil size={14} /> Редагувати
                </button>
                <button
                  type="button"
                  className="button compact subtle-danger"
                  onClick={() => deleteRecipient(r.key)}
                  disabled={busy}
                >
                  <Trash2 size={14} /> Видалити
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
