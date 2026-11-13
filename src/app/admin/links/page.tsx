import { Search } from 'lucide-react';
import { requireOwner } from '@/lib/auth';
import { listLinks } from '@/lib/queries';
import { LinkTable } from '@/components/link-table';
import { Pagination } from '@/components/pagination';

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; status?: string; page?: string }>;
}) {
  await requireOwner();
  const params = await searchParams,
    q = params.q ?? '',
    from = params.from ?? '',
    to = params.to ?? '',
    status = params.status ?? '',
    page = Math.max(1, Math.min(100000, Number(params.page) || 1)),
    { rows, total } = await listLinks({ q, from, to, status, page, pageSize: 30 });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ІСТОРІЯ ЗАПИТІВ НА ОПЛАТУ</p>
          <h1>Платіжні посилання</h1>
          <p className="muted">Знайдіть посилання, скопіюйте або припиніть його дію.</p>
        </div>
      </div>
      <section className="panel">
        <form className="search-form filter-form" action="/admin/links">
          <div className="search-group">
            <Search size={18} />
            <input
              type="search"
              name="q"
              aria-label="Номер угоди"
              placeholder="Номер угоди"
              defaultValue={q}
              maxLength={15}
            />
          </div>
          <label className="filter-date">
            <span>Від</span>
            <input type="date" name="from" defaultValue={from} />
          </label>
          <label className="filter-date">
            <span>До</span>
            <input type="date" name="to" defaultValue={to} />
          </label>
          <select name="status" defaultValue={status} aria-label="Статус">
            <option value="">Усі статуси</option>
            <option value="active">Очікує оплати</option>
            <option value="paid">Оплату відмічено</option>
            <option value="partial">Часткова оплата</option>
            <option value="expired">Термін минув</option>
            <option value="replaced">Замінено</option>
            <option value="disabled">Вимкнено</option>
          </select>
          <button className="button secondary compact">Фільтрувати</button>
        </form>
        <LinkTable links={rows} />
        <Pagination
          page={page}
          total={total}
          pageSize={30}
          baseUrl="/admin/links"
          searchParams={{ q, from, to, status }}
        />
      </section>
    </>
  );
}
