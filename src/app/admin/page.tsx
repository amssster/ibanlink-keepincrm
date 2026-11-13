import Link from 'next/link';
import { ArrowUpRight, Link2, Clock3, CheckCheck, Wallet, ArrowRight } from 'lucide-react';
import { requireOwner } from '@/lib/auth';
import { overview, listLinks, formatMoney } from '@/lib/queries';
import { getSettings } from '@/lib/settings';
import { LinkTable } from '@/components/link-table';
export default async function Admin() {
  await requireOwner();
  const [stats, linksData, settings] = await Promise.all([overview(), listLinks(''), getSettings()]);
  const hasPlaintextPassword = !process.env.OWNER_PASSWORD_HASH && !!process.env.OWNER_PASSWORD;
  const cards = [
    { label: 'Усього посилань', value: stats.total, Icon: Link2, hint: 'За весь час' },
    {
      label: 'Очікують оплати',
      value: stats.active,
      Icon: Clock3,
      hint: 'Активні платіжні сторінки',
    },
    { label: 'Оплату відмічено', value: stats.paid, Icon: CheckCheck, hint: 'За даними KeepinCRM' },
    {
      label: 'До отримання',
      value: formatMoney(stats.outstanding) + ' ₴',
      Icon: Wallet,
      hint: 'За активними посиланнями',
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ВАШ БІЗНЕС У ЦИФРАХ</p>
          <h1>Огляд оплат</h1>
          <p className="muted">Усі платіжні посилання — на одній сторінці.</p>
        </div>
        <Link href="/admin/settings" className="button secondary">
          Підключення CRM
          <ArrowUpRight size={17} />
        </Link>
      </div>
      {hasPlaintextPassword && (
        <div className="notice warning" role="alert">
          Ви використовуєте <code>OWNER_PASSWORD</code> у відкритому вигляді. Для безпеки згенеруйте хеш командою <code>npm run secrets</code> та задайте <code>OWNER_PASSWORD_HASH</code> у змінних оточення.
        </div>
      )}
      {!settings.enabled && (
        <div className="setup-banner">
          <div className="setup-number">01</div>
          <div>
            <h3>Підключімо вашу KeepinCRM</h3>
            <p>Збережіть реквізити, перевірте дві тестові події та активуйте створення посилань.</p>
          </div>
          <Link href="/admin/settings" className="button primary">
            Налаштувати
            <ArrowRight size={17} />
          </Link>
        </div>
      )}
      {stats.attention > 0 && (
        <div className="notice error" role="status">
          Є операції, що потребують уваги: {stats.attention}.{' '}
          <Link href="/admin/events">Переглянути журнал →</Link>
        </div>
      )}
      <div className="stat-grid">
        {cards.map(({ label, value, Icon, hint }) => (
          <section className="stat-card" key={label}>
            <div className="stat-head">
              <span className="stat-label">{label}</span>
              <span className="stat-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
            </div>
            <div className="stat-value">{value}</div>
            <small className="stat-hint">{hint}</small>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Останні посилання</h2>
            <p>Оплата починається з простого посилання.</p>
          </div>
          <Link className="text-link" href="/admin/links">
            Усі посилання
            <ArrowRight size={15} />
          </Link>
        </div>
        <LinkTable links={linksData.rows.slice(0, 8)} />
      </section>
      <div className="info-line">
        <span className="status-dot" />
        Кошти надходять безпосередньо на ваш банківський рахунок. Оплати перевіряєте ви.
      </div>
    </>
  );
}
