// POST /api/log  — ghi log lưu nhận xét
//  • Từ app (trình duyệt GV): không cần khoá, source = 'app'
//  • Từ Apps Script: header x-log-secret = LOG_SECRET, source = 'server' (đáng tin, GV không làm giả được)
import { getSql, ensureSchema, cut } from './_db.js';
import { timingSafeEqual } from 'node:crypto';

function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const ALLOWED_EVENTS = new Set(['attempt', 'result', 'written']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-log-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'JSON không hợp lệ' }); } }
  const events = Array.isArray(body && body.events) ? body.events : (body ? [body] : []);
  if (!events.length) return res.status(400).json({ error: 'Không có sự kiện' });
  if (events.length > 200) return res.status(413).json({ error: 'Quá nhiều sự kiện' });

  const secretHeader = req.headers['x-log-secret'];
  let source = 'app';
  if (secretHeader !== undefined) {
    if (!safeEq(secretHeader, process.env.LOG_SECRET)) return res.status(401).json({ error: 'Sai LOG_SECRET' });
    source = 'server';
  }

  const ip = cut((req.headers['x-forwarded-for'] || '').split(',')[0].trim(), 64);
  const ua = cut(req.headers['user-agent'], 300);

  try {
    await ensureSchema();
    const sql = getSql();
    const rows = [];
    for (const e of events) {
      if (!e || !ALLOWED_EVENTS.has(e.event)) continue;
      // Chỉ server mới được ghi sự kiện 'written'
      if (e.event === 'written' && source !== 'server') continue;
      let content = null;
      if (e.content && typeof e.content === 'object') {
        const json = JSON.stringify(e.content);
        content = json.length > 40000 ? { truncated: json.slice(0, 40000) } : e.content;
      }
      rows.push({
        source, event: e.event, req_id: cut(e.reqId, 80), login: cut(e.login, 80), kind: cut(e.kind, 10),
        period: cut(e.period, 80), file_id: cut(e.fileId, 120),
        row_index: Number.isFinite(Number(e.row)) && e.row !== null && e.row !== '' ? Math.trunc(Number(e.row)) : null,
        student_id: cut(e.studentId, 40), student_name: cut(e.studentName, 160), class_code: cut(e.classCode, 60),
        status: cut(e.status || (e.event === 'written' ? 'ok' : null), 20), error: cut(e.error, 500), content,
        client_time: cut(e.clientTime || e.serverTime, 40), ip, ua,
      });
    }
    if (!rows.length) return res.status(200).json({ ok: true, saved: 0 });
    // MỘT câu lệnh cho cả lô (trước đây mỗi sự kiện 1 lệnh → lô lớn bị quá thời gian, hàng chờ log bị kẹt).
    // Bỏ qua sự kiện đã có (app gửi lại cùng lô sau khi lỗi mạng).
    const r = await sql.query(
      `INSERT INTO save_log (source, event, req_id, login, kind, period, file_id, row_index, student_id,
         student_name, class_code, status, error, content, client_time, ip, ua)
       SELECT x.source, x.event, x.req_id, x.login, x.kind, x.period, x.file_id, x.row_index, x.student_id,
         x.student_name, x.class_code, x.status, x.error, x.content, x.client_time, x.ip, x.ua
         FROM jsonb_to_recordset($1::jsonb) AS x(source text, event text, req_id text, login text, kind text,
           period text, file_id text, row_index int, student_id text, student_name text, class_code text,
           status text, error text, content jsonb, client_time text, ip text, ua text)
        WHERE NOT EXISTS (SELECT 1 FROM save_log s WHERE s.req_id = x.req_id AND s.event = x.event
           AND s.source = x.source AND s.client_time IS NOT DISTINCT FROM x.client_time
           AND s.status IS NOT DISTINCT FROM x.status)
       RETURNING id`, [JSON.stringify(rows)]);
    return res.status(200).json({ ok: true, saved: r.length });
  } catch (err) {
    console.error('log error', err);
    return res.status(500).json({ error: 'Lỗi ghi log' });
  }
}
