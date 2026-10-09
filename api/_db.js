// Kết nối Postgres (Neon) — biến DATABASE_URL do Vercel tự thêm khi kết nối Neon
import { neon } from '@neondatabase/serverless';

let _sql = null;
export function getSql() {
  if (globalThis.__TEST_SQL__) return globalThis.__TEST_SQL__;
  if (!_sql) _sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  return _sql;
}

let ready = false;
export async function ensureSchema() {
  if (ready) return;
  const sql = getSql();
  await sql.query(`CREATE TABLE IF NOT EXISTS save_log (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source      TEXT NOT NULL,          -- 'app' (trình duyệt GV) | 'server' (Apps Script, đã xác thực)
    event       TEXT NOT NULL,          -- attempt | result | written
    req_id      TEXT,
    login       TEXT,
    kind        TEXT,                   -- week | month
    period      TEXT,                   -- tên tab tuần / tháng
    file_id     TEXT,
    row_index   INTEGER,
    student_id  TEXT,
    student_name TEXT,
    class_code  TEXT,
    status      TEXT,
    error       TEXT,
    content     JSONB,
    client_time TEXT,
    ip          TEXT,
    ua          TEXT
  )`, []);
  await sql.query(`CREATE INDEX IF NOT EXISTS save_log_login_at ON save_log (lower(login), at DESC)`, []);
  await sql.query(`CREATE INDEX IF NOT EXISTS save_log_student ON save_log (student_id)`, []);
  await sql.query(`CREATE INDEX IF NOT EXISTS save_log_req ON save_log (req_id)`, []);
  ready = true;
}

export function cut(v, n) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) : s;
}
