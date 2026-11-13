import { Search } from 'lucide-react';
import { requireOwner } from '@/lib/auth';
import { pool } from '@/lib/db';
import { formatDate, formatMoney } from '@/lib/queries';
import type { CrmEvent } from '@/lib/domain';
import { ActionButton } from '@/components/actions';
import { Pagination } from '@/components/pagination';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireOwner();
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 64);
  const page = Math.max(1, Math.min(100000, Number(params.page) || 1));
  let whereClause = '';
  const filterValues: (string | number)[] = [];
  if (q) {
    if (/^\d+$/.test(q)) {
      whereClause = "WHERE deal_id LIKE $1 || '%' OR event_id ILIKE $2 OR result ILIKE $2";
      filterValues.push(q, `%${q}%`);
    } else {
      whereClause = 'WHERE deal_id ILIKE $1 OR event_id ILIKE $1 OR result ILIKE $1';
      filterValues.push(`%${q}%`);
    }
  }
  const countQuery = `SELECT count(*)::int AS count FROM inbox ${whereClause}`;
  const total = (await pool().query(countQuery, filterValues)).rows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 30));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * 30;
  const eventsQuery = `SELECT * FROM inbox ${whereClause} ORDER BY created_at DESC LIMIT 30 OFFSET $${filterValues.length + 1}`;
  const events = await pool().query<{
    id: string;
    kind: string;
    event_id: string;
    deal_id: string;
    payload: CrmEvent;
    status: string;
    result: string;
    created_at: Date;
  }>(eventsQuery, [...filterValues, offset]);

  const jobs = await pool().query(
    "SELECT *, (status IN ('queued','failed') OR (status='processing' AND claimed_at<now()-interval '2 minutes')) AS retryable FROM jobs WHERE status IN ('queued','processing','failed','skipped') ORDER BY created_at DESC LIMIT 50",
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ЖУРНАЛ ІНТЕГРАЦІЇ</p>
          <h1>Події</h1>
          <p className="muted">Вхідні події KeepinCRM і стан їх обробки.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Операції в черзі</h2>
          <span className="count-pill">{jobs.rows.length}</span>
        </div>
        {!jobs.rows.length ? (
          <p className="section-padding muted">Усі операції оброблено. Черга порожня.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>УГОДА</th>
                  <th>ОПЕРАЦІЯ</th>
                  <th>СТАН / СПРОБИ</th>
                  <th>ПРИЧИНА</th>
                  <th>ДІЯ</th>
                </tr>
              </thead>
              <tbody>
                {jobs.rows.map((job) => (
                  <tr key={job.id}>
                    <td>№{job.deal_id}</td>
                    <td>
                      {job.kind === 'notify'
                        ? 'Telegram-сповіщення'
                        : job.kind === 'sync'
                          ? 'Запис URL у CRM'
                          : 'Обробка події'}
                    </td>
                    <td>
                      {job.status} · {job.attempts}
                    </td>
                    <td className="error-text">{job.last_error ?? '—'}</td>
                    <td>
                      {job.retryable && (
                        <ActionButton
                          url={`/api/admin/jobs/${job.id}/retry`}
                          label="Повторити"
                          retry
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Вхідні події</h2>
        </div>
        <form className="search-form" action="/admin/events">
          <Search size={18} />
          <input
            type="search"
            name="q"
            aria-label="Пошук (номер угоди, ID події, результат)"
            placeholder="Пошук (номер угоди, ID події, результат)"
            defaultValue={q}
            maxLength={64}
          />
          <button className="button secondary compact">Знайти</button>
        </form>
        {!events.rows.length ? (
          <p className="section-padding muted">
            Подій не знайдено. Перевірте фільтр пошуку або виконайте перехід тестової угоди на етап
            оплати.
          </p>
        ) : (
          <div className="event-list">
            {events.rows.map((event) => (
              <article className="event-row" key={event.id}>
                <div className={`event-symbol ${event.status === 'probe' ? 'probe' : ''}`}>
                  {event.kind === 'issue' ? '↗' : '✓'}
                </div>
                <div className="event-details">
                  <strong>
                    {event.kind === 'issue' ? 'Запит на посилання' : 'Проведення платежу'} · угода №
                    {event.deal_id}
                  </strong>
                  <p className="event-id">{event.event_id}</p>
                  <small>
                    {event.payload?.recipientKey
                      ? `Отримувач: ${event.payload.recipientKey} · `
                      : ''}
                    Сума: {formatMoney(event.payload.totalMinor)} ₴ · Сплачено:{' '}
                    {formatMoney(event.payload.paidMinor)} ₴ · Час CRM:{' '}
                    {formatDate(new Date(event.payload.eventAt))}
                  </small>
                </div>
                <div className="event-result">
                  <span className={`badge ${event.status === 'probe' ? 'probe' : ''}`}>
                    {event.status === 'probe' ? 'Перевірка контракту' : event.status}
                  </span>
                  <small>{event.result ?? formatDate(event.created_at)}</small>
                </div>
              </article>
            ))}
          </div>
        )}
        <Pagination
          page={page}
          total={total}
          pageSize={30}
          baseUrl="/admin/events"
          searchParams={{ q }}
        />
      </section>
    </>
  );
}
