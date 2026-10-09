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
    let n = 0;
    for (const e of events) {
      if (!e || !ALLOWED_EVENTS.has(e.event)) continue;
      // Chỉ server mới được ghi sự kiện 'written'
      if (e.event === 'written' && source !== 'server') continue;
      let content = null;
      if (e.content && typeof e.content === 'object') {
        const json = JSON.stringify(e.content);
        content = json.length > 40000 ? JSON.stringify({ truncated: json.slice(0, 40000) }) : json;
      }
      await sql.query(
        `INSERT INTO save_log (source, event, req_id, login, kind, period, file_id, row_index, student_id,
           student_name, class_code, status, error, content, client_time, ip, ua)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`,
        [source, e.event, cut(e.reqId, 80), cut(e.login, 80), cut(e.kind, 10), cut(e.period, 80), cut(e.fileId, 120),
         Number.isFinite(Number(e.row)) && e.row !== null && e.row !== '' ? Math.trunc(Number(e.row)) : null,
         cut(e.studentId, 40), cut(e.studentName, 160), cut(e.classCode, 60),
         cut(e.status || (e.event === 'written' ? 'ok' : null), 20), cut(e.error, 500), content,
         cut(e.clientTime || e.serverTime, 40), ip, ua]
      );
      n++;
    }
    return res.status(200).json({ ok: true, saved: n });
  } catch (err) {
    console.error('log error', err);
    return res.status(500).json({ error: 'Lỗi ghi log' });
  }
}
