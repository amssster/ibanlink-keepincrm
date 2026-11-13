import { pool } from '@/lib/db';
import { noStore } from '@/lib/http';

export async function GET() {
  try {
    await pool().query('SELECT 1');
    return Response.json({ status: 'ok', database: 'ok' }, { status: 200, headers: noStore });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: noStore });
  }
}
