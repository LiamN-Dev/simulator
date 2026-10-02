require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const { DATABASE_URL, ADMIN_PIN, JWT_SECRET, PORT = 3000 } = process.env;
if (!DATABASE_URL || !ADMIN_PIN || !JWT_SECRET) {
  console.error('Missing DATABASE_URL, ADMIN_PIN, or JWT_SECRET'); process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
const fs = require('fs');
const pub = path.join(__dirname, 'public');
app.use(express.static(pub));
app.get('/', (req, res) => {
  const f = path.join(pub, 'index.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(500).send(
    'index.html not found.\nApp folder: ' + fs.readdirSync(__dirname).join(', ') +
    '\npublic folder: ' + (fs.existsSync(pub) ? fs.readdirSync(pub).join(', ') : 'MISSING')
  );
});

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

function detectType(url) {
  const u = url.toLowerCase();
  if (u.includes('docs.google.com/document')) return 'doc';
  if (u.includes('docs.google.com/presentation')) return 'slides';
  if (u.includes('docs.google.com/spreadsheets')) return 'sheet';
  if (u.includes('quizlet.com')) return 'quizlet';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'video';
  if (u.split('?')[0].endsWith('.pdf')) return 'pdf';
  return 'link';
}
const validUrl = s => { try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; } };

function requireAdmin(req, res, next) {
  try { jwt.verify(req.cookies.admin || '', JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Admin login required' }); }
}

/* ---------- Auth ---------- */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: { error: 'Too many attempts. Try again in 15 minutes.' } });

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const a = Buffer.from(String(req.body.pin || ''));
  const b = Buffer.from(ADMIN_PIN);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Wrong PIN' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('admin', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('admin'); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => {
  try { jwt.verify(req.cookies.admin || '', JWT_SECRET); res.json({ admin: true }); } catch { res.json({ admin: false }); }
});

/* ---------- Public ---------- */
app.get('/api/subjects', wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM subjects ORDER BY sort_order, name')).rows);
}));

app.get('/api/posts', wrap(async (req, res) => {
  const { subject, unit, q } = req.query;
  const where = [], vals = [];
  if (subject) { vals.push(subject); where.push(`s.slug = $${vals.length}`); }
  if (unit)    { vals.push(unit);    where.push(`p.unit = $${vals.length}`); }
  if (q)       { vals.push(`%${q}%`); where.push(`(p.title ILIKE $${vals.length} OR p.description ILIKE $${vals.length} OR p.unit ILIKE $${vals.length})`); }
  const sql = `SELECT p.*, s.slug AS subject_slug, s.name AS subject_name, s.color
               FROM posts p JOIN subjects s ON s.id = p.subject_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY p.pinned DESC, p.created_at DESC`;
  res.json((await pool.query(sql, vals)).rows);
}));

app.get('/api/due-next', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, s.slug AS subject_slug, s.name AS subject_name, s.color
    FROM posts p JOIN subjects s ON s.id = p.subject_id
    WHERE p.pinned OR (p.due_date >= CURRENT_DATE AND p.due_date <= CURRENT_DATE + 7)
    ORDER BY p.due_date NULLS LAST, p.created_at DESC`);
  res.json(rows);
}));

app.post('/api/requests', rateLimit({ windowMs: 60 * 1000, max: 5 }), wrap(async (req, res) => {
  const { subject_id, text, date_needed } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Describe what you need' });
  const { rows } = await pool.query(
    'INSERT INTO requests (subject_id, text, date_needed) VALUES ($1,$2,$3) RETURNING id',
    [subject_id || null, text.trim().slice(0, 500), date_needed || null]);
  res.status(201).json(rows[0]);
}));

/* ---------- Admin ---------- */
app.post('/api/posts', requireAdmin, wrap(async (req, res) => {
  const { subject_id, title, url, link_type, unit, description, due_date, pinned } = req.body;
  if (!subject_id || !title || !validUrl(url)) return res.status(400).json({ error: 'Subject, title, and a valid http(s) URL are required' });
  const { rows } = await pool.query(
    `INSERT INTO posts (subject_id,title,url,link_type,unit,description,due_date,pinned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [subject_id, title.trim(), url.trim(), link_type || detectType(url), unit || null, description || null, due_date || null, !!pinned]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/posts/:id', requireAdmin, wrap(async (req, res) => {
  const allowed = ['subject_id', 'title', 'url', 'link_type', 'unit', 'description', 'due_date', 'pinned'];
  const keys = allowed.filter(k => k in req.body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
  if ('url' in req.body && !validUrl(req.body.url)) return res.status(400).json({ error: 'Invalid URL' });
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const { rows } = await pool.query(`UPDATE posts SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
    [...keys.map(k => req.body[k]), req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
}));

app.delete('/api/posts/:id', requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/requests', requireAdmin, wrap(async (req, res) => {
  res.json((await pool.query(`SELECT r.*, s.name AS subject_name FROM requests r
    LEFT JOIN subjects s ON s.id = r.subject_id ORDER BY r.status, r.created_at DESC`)).rows);
}));

app.patch('/api/requests/:id', requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
    [req.body.status === 'fulfilled' ? 'fulfilled' : 'open', req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
}));

app.get('/healthz', (req, res) => res.send('ok'));
app.listen(PORT, () => console.log(`ClassDeck running on :${PORT}`));
