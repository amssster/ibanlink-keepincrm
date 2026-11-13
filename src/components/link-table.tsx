import Link from 'next/link';
import { ArrowUpRight, Link2 } from 'lucide-react';
import { formatDate, formatMoney, linkStatus, statusLabels, type LinkRow } from '@/lib/queries';
import { appUrl } from '@/lib/env';
import { CopyButton, ActionButton } from './actions';
export function LinkTable({ links }: { links: LinkRow[] }) {
  if (!links.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Link2 size={27} />
        </span>
        <h3>Тут з’являться ваші посилання</h3>
        <p>Переведіть тестову угоду на етап оплати після підключення KeepinCRM.</p>
        <Link className="button secondary" href="/admin/settings">
          Налаштувати підключення
          <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ЗАМОВЛЕННЯ / ДАТА</th>
            <th className="num">СУМА ДО ОПЛАТИ</th>
            <th>СТАН</th>
            <th>ПОСИЛАННЯ</th>
            <th>
              <span className="sr-only">Дії</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const status = linkStatus(link);
            return (
              <tr key={link.id}>
                <td>
                  <strong>Угода №{link.deal_id}</strong>
                  <small>
                    {formatDate(link.created_at)} · {link.recipient?.key || 'Основний'}
                  </small>
                </td>
                <td className="money-cell">
                  {formatMoney(link.amount_minor)} <span>₴</span>
                </td>
                <td>
                  <span className={`badge ${status}`}>
                    <span className="status-dot" />
                    {statusLabels[status] ?? status}
                  </span>
                  <small>Передавання через Response</small>
                </td>
                <td>
                  <div className="inline-actions">
                    <a
                      className="text-link"
                      href={`/p/${link.token}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Відкрити
                      <ArrowUpRight size={14} />
                    </a>
                    <a
                      className="text-link"
                      href={`/api/pay/${link.token}/qr`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      QR
                    </a>
                    <CopyButton
                      value={`${appUrl()}/p/${link.token}`}
                      label={`Копіювати посилання угоди ${link.deal_id}`}
                      small
                    />
                  </div>
                </td>
                <td>
                  <div className="inline-actions">
                    {link.status === 'active' && (
                      <ActionButton
                        url={`/api/admin/links/${link.id}/extend`}
                        label="Продовжити"
                      />
                    )}
                    {status === 'active' && (
                      <ActionButton
                        url={`/api/admin/links/${link.id}/disable`}
                        label="Вимкнути"
                        danger
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
