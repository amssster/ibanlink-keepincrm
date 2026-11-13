import pg from 'pg';
import { required } from './env';
const globalDb = globalThis as unknown as { ibanPool?: pg.Pool };
export function pool(): pg.Pool {
  const poolMax = Number(process.env.DB_POOL_MAX) || 10;
  if (!globalDb.ibanPool) {
    const p = new pg.Pool({
      connectionString: required('DATABASE_URL'),
      max: poolMax,
      connectionTimeoutMillis: 5000,
      statement_timeout: 20000,
      idleTimeoutMillis: 30000,
    });
    p.on('error', (err) => {
      console.error('Неочікувана помилка в idle-клієнті пулу PostgreSQL:', err);
    });
    globalDb.ibanPool = p;
  }
  return globalDb.ibanPool;
}
export async function transaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function lockDeal(db: pg.PoolClient, id: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`deal:${id}`]);
}
