import Link from 'next/link';

export function Pagination({
  page,
  total,
  pageSize = 30,
  baseUrl,
  searchParams = {},
}: {
  page: number;
  total: number;
  pageSize?: number;
  baseUrl: string;
  searchParams?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  if (total === 0) {
    return (
      <div className="pagination">
        <span className="pagination-count">Показано 0 із 0</span>
      </div>
    );
  }

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);

  function hrefFor(p: number) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== '' && k !== 'page') {
        sp.set(k, v);
      }
    }
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${baseUrl}?${qs}` : baseUrl;
  }

  const pages: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('…');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      if (i > 1 && i < totalPages) pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="pagination">
      <span className="pagination-count">
        Показано {from}–{to} із {total}
      </span>
      <div className="pagination-controls">
        {currentPage > 1 ? (
          <Link
            href={hrefFor(currentPage - 1)}
            className="pagination-arrow"
            aria-label="Попередня сторінка"
          >
            ←
          </Link>
        ) : (
          <span className="pagination-arrow disabled" aria-disabled="true">
            ←
          </span>
        )}
        {pages.map((p, idx) =>
          typeof p === 'number' ? (
            p === currentPage ? (
              <span key={idx} className="pagination-number current" aria-current="page">
                {p}
              </span>
            ) : (
              <Link key={idx} href={hrefFor(p)} className="pagination-number">
                {p}
              </Link>
            )
          ) : (
            <span key={idx} className="pagination-ellipsis">
              …
            </span>
          ),
        )}
        {currentPage < totalPages ? (
          <Link
            href={hrefFor(currentPage + 1)}
            className="pagination-arrow"
            aria-label="Наступна сторінка"
          >
            →
          </Link>
        ) : (
          <span className="pagination-arrow disabled" aria-disabled="true">
            →
          </span>
        )}
      </div>
    </div>
  );
}
