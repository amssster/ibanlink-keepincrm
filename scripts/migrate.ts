import { readFile } from 'node:fs/promises';
import { pool, transaction } from '../src/lib/db';
import type { PoolClient } from 'pg';
export async function migrate() {
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
    console.log('Vercel preview deployment: пропуск автоматичних міграцій БД');
    return;
  }
  const sql = await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8');
  await transaction((db) => migrateInTransaction(db, sql));
}
export async function migrateInTransaction(db: PoolClient, sql: string) {
  await db.query('SELECT pg_advisory_xact_lock(19621109)');
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = await db.query("SELECT 1 FROM schema_migrations WHERE version='001_initial'");
  if (!applied.rowCount) {
    const logos = await db.query("SELECT to_regclass('recipient_logos') IS NOT NULL AS exists");
    const logoImport = sql.indexOf('INSERT INTO recipient_logos(key, data)');
    if (logoImport < 0) throw new Error('Некоректна міграція логотипів');
    const migrationSql = logos.rows[0].exists ? sql.slice(0, logoImport) : sql;
    await db.query(migrationSql);
    await db.query("INSERT INTO schema_migrations(version) VALUES('001_initial')");
  }
  const legacy = await db.query(
    "SELECT 1 FROM schema_migrations WHERE version='003_legacy_response_guard'",
  );
  if (!legacy.rowCount) {
    const settings = await db.query(
      "SELECT data ? 'apiKey' OR data ? 'encryptedApiKey' AS legacy FROM settings WHERE id=true",
    );
    if (settings.rows[0]?.legacy) {
      await db.query(
        "UPDATE settings SET data=jsonb_set(data,'{enabled}','false'::jsonb) WHERE id=true",
      );
      await db.query(
        "UPDATE inbox i SET status='skipped',result='response_protocol_changed' FROM jobs j WHERE j.ref_id=i.id AND i.kind='issue' AND j.kind='event' AND j.status IN ('queued','processing','failed')",
      );
      await db.query(
        "UPDATE jobs j SET status='skipped',lease_id=NULL,last_error='Перехід на Response: потрібен новий запит з CRM' WHERE j.status IN ('queued','processing','failed') AND (j.kind='sync' OR (j.kind='event' AND EXISTS(SELECT 1 FROM inbox i WHERE i.id=j.ref_id AND i.kind='issue')))",
      );
    }
    await db.query("INSERT INTO schema_migrations(version) VALUES('003_legacy_response_guard')");
  }
  const second = await db.query(
    "SELECT 1 FROM schema_migrations WHERE version='002_notification_snapshot'",
  );
  if (!second.rowCount) {
    await db.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notification_link_id uuid');
    await db.query(
      'CREATE INDEX IF NOT EXISTS links_deal_id_pattern ON links(deal_id text_pattern_ops)',
    );
    const index = await db.query(
      "SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid=to_regclass('links_deal_id_pattern') AND indrelid='links'::regclass AND indisvalid AND indisready",
    );
    if (!index.rows[0]?.definition.includes('(deal_id text_pattern_ops)'))
      throw new Error('Некоректний індекс links_deal_id_pattern');
    await db.query("INSERT INTO schema_migrations(version) VALUES('002_notification_snapshot')");
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/migrate.ts')) {
  await migrate();
  console.log('Міграції застосовано');
  await pool().end();
}
