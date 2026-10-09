// GET /api/admin-logs?login=&student=&cls=&from=YYYY-MM-DD&to=YYYY-MM-DD&kind=week|month&limit=
// Header x-admin-password = ADMIN_PASSWORD. Trả về các lần lưu đã gộp theo req_id.
import { getSql, ensureSchema } from './_db.js';
import { timingSafeEqual } from 'node:crypto';

function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!safeEq(req.headers['x-admin-password'], process.env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800)); // chậm lại khi đoán sai mật khẩu
    return res.status(401).json({ error: 'Sai mật khẩu' });
  }
  const q = req.query || {};
  const where = [], params = [];
  const P = v => { params.push(v); return '$' + params.length; };
  if (q.login) where.push(`lower(login) = lower(${P(String(q.login).trim())})`);
  if (q.student) { const p = P(String(q.student).trim()); where.push(`(student_id = ${p} OR student_name ILIKE '%' || ${p} || '%')`); }
  if (q.cls) where.push(`class_code ILIKE '%' || ${P(String(q.cls).trim())} || '%'`);
  if (q.kind === 'week' || q.kind === 'month') where.push(`kind = ${P(q.kind)}`);
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) where.push(`at >= (${P(q.from)}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) where.push(`at < ((${P(q.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 500, 1), 5000);

  try {
    await ensureSchema();
    const sql = getSql();
    // Lấy các req_id khớp điều kiện, rồi lấy đủ mọi sự kiện của các req_id đó
    const idRows = await sql.query(
      `SELECT req_id, max(at) AS last_at FROM save_log
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY req_id ORDER BY last_at DESC LIMIT ${limit}`, params);
    const ids = idRows.map(r => r.req_id).filter(Boolean);
    if (!ids.length) return res.status(200).json({ items: [] });
    const rows = await sql.query(
      `SELECT id, at, source, event, req_id, login, kind, period, file_id, row_index, student_id, student_name,
              class_code, status, error, content, client_time, ip
         FROM save_log WHERE req_id = ANY($1) ORDER BY at ASC, id ASC`, [ids]);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.req_id)) map.set(r.req_id, { reqId: r.req_id, events: [] });
      const g = map.get(r.req_id);
      g.events.push(r);
      for (const k of ['login', 'kind', 'period', 'student_id', 'student_name', 'class_code']) if (!g[k] && r[k]) g[k] = r[k];
      if (r.event === 'attempt') { g.attemptAt = g.attemptAt || r.at; g.content = g.content || r.content; }
      if (r.event === 'written' && r.status === 'mismatch') { g.mismatchAt = r.at; g.mismatch = r.error; g.row = r.row_index; }
      else if (r.event === 'written') { g.writtenAt = r.at; g.row = r.row_index; }
      if (r.event === 'result') { g.result = r.status; g.error = r.error || g.error; g.resultAt = r.at; }
    }
    const items = ids.map(id => map.get(id)).filter(Boolean);
    return res.status(200).json({ items });
  } catch (err) {
    console.error('admin-logs error', err);
    return res.status(500).json({ error: 'Lỗi đọc log' });
  }
}
