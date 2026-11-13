import Image from 'next/image';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowDown, ShieldCheck, CheckCircle2, CircleAlert, Landmark } from 'lucide-react';
import { publicLink, linkStatus, formatMoney, formatDate, statusLabels } from '@/lib/queries';
import { getSettings } from '@/lib/settings';
import { CopyButton } from '@/components/actions';
import { PaymentActions } from '@/components/payment-actions';
import { QrDownloadButton } from '@/components/qr-download-button';
export const dynamic = 'force-dynamic';
export default async function Payment({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params,
    link = await publicLink(token);
  if (!link) notFound();
  const status = linkStatus(link);
  const agent = (await headers()).get('user-agent') ?? '';
  const settings = await getSettings();
  const recipientConfig = settings.recipients.find((r) => r.key === link.recipient.key);
  const brand = recipientConfig?.brand || link.recipient.brand;

  if (status !== 'active')
    return (
      <main className="closed-shell">
        <div className="closed-card">
          {status === 'paid' ? (
            <CheckCircle2 className="closed-icon" size={48} />
          ) : (
            <CircleAlert className="closed-icon" size={48} />
          )}
          <h1>{statusLabels[status]}</h1>
          <p>
            {status === 'paid'
              ? 'Продавець відмітив повну оплату цього замовлення. Дякуємо!'
              : status === 'partial'
                ? 'Продавець відмітив часткову оплату. Зверніться до нього за новим посиланням на залишок.'
                : 'Це посилання більше не діє. Зверніться до продавця, щоб отримати нове.'}
          </p>
          <span className="closed-brand">{brand}</span>
        </div>
      </main>
    );

  if (recipientConfig?.suspended) {
    return (
      <main className="closed-shell">
        <div className="closed-card">
          <CircleAlert className="closed-icon" size={48} />
          <h1>Отримувача призупинено</h1>
          <p>Отримувача призупинено, зв&apos;яжіться з продавцем.</p>
          <span className="closed-brand">{brand}</span>
        </div>
      </main>
    );
  }

  const fields = [
    { label: 'Отримувач', value: link.recipient.name },
    { label: 'ЄДРПОУ / РНОКПП', value: link.recipient.taxId },
    { label: 'IBAN', value: link.recipient.iban },
    { label: 'Сума', value: `${(Number(link.amount_minor) / 100).toFixed(2)}` },
    { label: 'Призначення платежу', value: link.purpose },
  ];
  return (
    <main className="payment-shell">
      <header className="payment-header">
        <div className="merchant">
          {recipientConfig?.logo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={recipientConfig.logo}
              alt={brand}
              className="merchant-header-logo"
            />
          ) : (
            <span className="merchant-mark">
              <Landmark size={22} />
            </span>
          )}
          <strong>{brand}</strong>
        </div>
        <span className="secure-note">
          <ShieldCheck size={16} />
          Переказ за реквізитами
        </span>
      </header>
      <div className="payment-grid">
        <section className="payment-summary">
          <span className="payment-order">ЗАМОВЛЕННЯ №{link.deal_id}</span>
          <h1>Оплата замовлення №{link.deal_id}</h1>
          <p className="muted">Дякуємо, що обрали {brand}.</p>
          <div className="amount-block">
            <span>До сплати</span>
            <div className="payment-amount">
              <strong data-testid="amount">{formatMoney(link.amount_minor)}</strong>
              <span>₴</span>
            </div>
            <p>Кошти надійдуть безпосередньо отримувачу.</p>
          </div>
          <PaymentActions
            token={token}
            embedded={/Telegram|Viber|FBAN|FBAV|Instagram/i.test(agent)}
            ios={/iPhone|iPad/i.test(agent)}
          />
          <a className="manual-anchor" href="#details">
            Оплатити за реквізитами
            <ArrowDown size={15} />
          </a>
        </section>
        <aside className="qr-panel">
          <div className="qr-corner-label">ІНШИЙ ЗРУЧНИЙ СПОСІБ</div>
          <h2>Скануйте та оплачуйте</h2>
          <p>Відкрийте сканер у банківському застосунку та наведіть на QR-код.</p>
          <div className="qr-frame">
            <Image
              src={`/api/pay/${token}/qr`}
              width={372}
              height={372}
              unoptimized
              loading="eager"
              alt="QR-код з реквізитами платежу за стандартом НБУ"
            />
          </div>
          <QrDownloadButton token={token} dealId={link.deal_id} />
          <span className="qr-standard">
            <ShieldCheck size={14} />
            QR за стандартом НБУ
          </span>
          <div className="qr-footnote">
            Сума й реквізити підставляться автоматично.
            <br />
            Вам залишиться підтвердити платіж.
          </div>
        </aside>
      </div>
      <section className="payment-details" id="details">
        <div className="details-heading">
          <div>
            <h2>Реквізити платежу</h2>
            <span>Для оплати в будь-якому банку</span>
          </div>
          <QrDownloadButton
            token={token}
            dealId={link.deal_id}
            className="button secondary compact"
            label="Завантажити QR"
            iconSize={15}
          />
        </div>
        {recipientConfig?.note && (
          <div className="payment-note">
            <strong>Зверніть увагу!</strong>
            <p>{recipientConfig.note}</p>
          </div>
        )}
        <div className="details-list">
          {fields.map((field) => (
            <div className="detail-row" key={field.label}>
              <div>
                <span>{field.label}</span>
                <p className={field.label === 'IBAN' ? 'iban-value' : ''}>{field.value}</p>
              </div>
              <CopyButton value={field.value} label={`Копіювати: ${field.label}`} small />
            </div>
          ))}
        </div>
        <p className="details-expiry">
          Посилання діє до {formatDate(link.expires_at)}. Після переказу повідомте продавця.
        </p>
      </section>
      <footer className="payment-footer">
        <ShieldCheck size={16} />
        <span>Оплата підтверджується у вашому банку. Не вводьте дані картки на цій сторінці.</span>
      </footer>
    </main>
  );
}
