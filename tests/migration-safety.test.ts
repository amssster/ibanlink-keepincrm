import { afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/lib/db';
import { migrateInTransaction } from '../scripts/migrate';

if (
  !process.env.TEST_DATABASE_URL ||
  !/(_test|_e2e)$/.test(new URL(process.env.TEST_DATABASE_URL).pathname)
)
  throw new Error('Потрібна окрема TEST_DATABASE_URL *_test або *_e2e');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8');

afterAll(async () => {
  await pool().end();
});

it('bootstrap створює схему та повторно не змінює задачі', async () => {
  const db = await pool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await migrateInTransaction(db, sql);
    const id = randomUUID();
    await db.query(
      "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'sync',$2,'42','failed')",
      [id, randomUUID()],
    );
    await migrateInTransaction(db, sql);
    expect((await db.query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0].status).toBe(
      'failed',
    );
    expect((await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(3);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

it('upgrade старої схеми зберігає задачі, історію і змінений логотип', async () => {
  const db = await pool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await db.query(sql);
    const id = randomUUID();
    await db.query(
      "INSERT INTO jobs(id,kind,ref_id,deal_id,status) VALUES($1,'sync',$2,'42','failed')",
      [id, randomUUID()],
    );
    await db.query("INSERT INTO recipient_logos(key,data) VALUES('shop','new')");
    await db.query(
      "UPDATE settings SET data='{" +
        '\"recipients\":[{\"key\":\"shop\",\"logo\":\"data:image/png;base64,b2xk\"}],\"apiKey\":\"old\",\"enabled\":true}' +
        "'::jsonb",
    );
    await migrateInTransaction(db, sql);
    expect((await db.query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0].status).toBe(
      'skipped',
    );
    expect((await db.query("SELECT data FROM recipient_logos WHERE key='shop'")).rows[0].data).toBe(
      'new',
    );
    expect((await db.query('SELECT data FROM settings')).rows[0].data).toMatchObject({
      apiKey: 'old',
      enabled: false,
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

it('bootstrap зберігає recipients та legacy recipient разом', async () => {
  const db = await pool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  const data = {
    recipient: { name: 'Legacy' },
    recipients: [
      { key: 'A', name: 'First' },
      { key: 'B', name: 'Second' },
    ],
    purposeTemplate: 'Legacy template',
    linkTtlDays: 14,
  };
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await db.query(
      "CREATE TABLE settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now())",
    );
    await db.query('INSERT INTO settings(id,data) VALUES(true,$1)', [data]);
    await migrateInTransaction(db, sql);
    expect((await db.query('SELECT data FROM settings WHERE id=true')).rows[0].data).toEqual(data);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
it('bootstrap не відновлює видалений логотип із застарілих settings', async () => {
  const db = await pool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await db.query(sql);
    await db.query('UPDATE settings SET data=$1', [
      { recipients: [{ key: 'deleted', logo: 'data:image/png;base64,YQ==' }] },
    ]);
    await migrateInTransaction(db, sql);
    expect((await db.query("SELECT * FROM recipient_logos WHERE key='deleted'")).rowCount).toBe(0);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
it('помилка bootstrap відкочується разом з усією схемою', async () => {
  const db = await pool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await expect(migrateInTransaction(db, `${sql}\nSELECT 1/0;`)).rejects.toThrow();
    await db.query('ROLLBACK');
    expect(
      (await db.query('SELECT to_regnamespace($1) AS schema', [schema])).rows[0].schema,
    ).toBeNull();
  } finally {
    db.release();
  }
});
