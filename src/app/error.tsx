'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="closed-shell">
      <section className="closed-card">
        <h1>Тимчасово недоступно</h1>
        <p>Не вдалося завантажити дані. Спробуйте ще раз за кілька хвилин.</p>
        <button className="button secondary" onClick={reset}>
          Спробувати ще раз
        </button>
      </section>
    </main>
  );
}
