// AMS Review – Đánh giá giáo viên ẩn danh cho học sinh THPT Chuyên Hà Nội – Amsterdam
// Chạy: node server.js   (Node.js >= 22.13, không cần cài thêm thư viện)

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'reviews.db');
const TEACHERS_PATH = path.join(__dirname, 'data', 'teachers.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// REQUIRE_APPROVAL=1 → đánh giá mới phải được quản trị viên duyệt mới hiển thị
const REQUIRE_APPROVAL = process.env.REQUIRE_APPROVAL === '1';
// Số lượt báo cáo để tự động ẩn một đánh giá
const AUTO_HIDE_REPORTS = Number(process.env.AUTO_HIDE_REPORTS) || 3;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

fs.mkdirSync(DATA_DIR, { recursive: true });

// Khoá bí mật dùng để băm mã thiết bị – không bao giờ lưu mã gốc.
function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();

// ---------------------------------------------------------------------------
// Dữ liệu giáo viên (nguồn: tkbams.mrtee.vn)
// ---------------------------------------------------------------------------
const teacherData = JSON.parse(fs.readFileSync(TEACHERS_PATH, 'utf8'));
const TEACHERS = teacherData.teachers;
const TEACHER_BY_CODE = new Map(TEACHERS.map((t) => [t.code, t]));

// Ban Giám hiệu (data/roles.json): Hiệu trưởng có "góc góp ý tự do" riêng, không chấm điểm giảng dạy.
const ROLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roles.json'), 'utf8'));
for (const [code, r] of Object.entries(ROLES)) {
  if (code.startsWith('_')) continue;
  const t = TEACHER_BY_CODE.get(code);
  if (!t) { console.warn(`roles.json: không có giáo viên mã ${code}`); continue; }
  if (r.name && r.name !== t.name) { console.warn(`roles.json: mã ${code} giờ là ${t.name}, không phải ${r.name} – bỏ qua`); continue; }
  Object.assign(t, { role: r.role, roleLabel: r.label, subject: 'Ban Giám hiệu' });
}

// ---------------------------------------------------------------------------
// Chấm điểm: chỉ 2 tiêu chí – Thái độ & Khả năng giảng dạy (1–5 sao)
// ---------------------------------------------------------------------------
const GRADES = ['10', '11', '12', 'cuu-hs'];
const MIN_LEN = 10;
const MAX_LEN = 5000;
// Không lọc từ ngữ. Chỉ chặn số điện thoại / email / link để tránh lộ thông tin cá nhân và spam.
const CONTACT_RE = /(https?:\/\/|www\.|\b0\d{9}\b|\+84\d{9}|[\w.+-]+@[\w-]+\.[\w.]+|facebook\.com|fb\.com)/i;

// ---------------------------------------------------------------------------
// Cơ sở dữ liệu
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
{
  const cols = db.prepare(`SELECT name FROM pragma_table_info('reviews')`).all().map((c) => c.name);
  if (cols.length && !cols.includes('attitude')) {
    console.error(`CSDL ${DB_PATH} dùng cấu trúc cũ (nhiều tiêu chí). Hãy sao lưu rồi xoá tệp này để tạo CSDL mới.`);
    process.exit(1);
  }
}
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_code TEXT    NOT NULL,
    attitude     INTEGER CHECK (attitude BETWEEN 1 AND 5),   -- Thái độ (tuỳ chọn với Hiệu trưởng)
    teaching     INTEGER CHECK (teaching BETWEEN 1 AND 5),   -- Khả năng giảng dạy (NULL với Hiệu trưởng)
    content      TEXT    NOT NULL,
    grade        TEXT,               -- '10' | '11' | '12' | 'cuu-hs' | NULL
    school_year  TEXT,
    status       TEXT    NOT NULL DEFAULT 'visible', -- visible | hidden | pending
    helpful      INTEGER NOT NULL DEFAULT 0,
    unhelpful    INTEGER NOT NULL DEFAULT 0,
    report_count INTEGER NOT NULL DEFAULT 0,
    author_hash  TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews(teacher_code, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_author ON reviews(teacher_code, author_hash);
  CREATE TABLE IF NOT EXISTS profiles (
    author_hash TEXT PRIMARY KEY,          -- bản băm mã trình duyệt
    nickname    TEXT NOT NULL,             -- biệt danh hiển thị
    nick_key    TEXT NOT NULL UNIQUE,      -- dạng chuẩn hoá để chống trùng
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS votes (
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    voter_hash TEXT    NOT NULL,
    value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
    PRIMARY KEY (review_id, voter_hash)
  );
  CREATE TABLE IF NOT EXISTS reports (
    review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    reporter_hash TEXT    NOT NULL,
    reason        TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (review_id, reporter_hash)
  );
`);

const q = {
  teacherStats: db.prepare(`
    SELECT teacher_code AS code, COUNT(*) AS n, AVG(attitude) AS attitude, AVG(teaching) AS teaching,
           AVG((attitude + teaching) / 2.0) AS overall
    FROM reviews WHERE status = 'visible' GROUP BY teacher_code`),
  oneTeacherStats: db.prepare(`
    SELECT COUNT(*) AS n, AVG(attitude) AS attitude, AVG(teaching) AS teaching,
           AVG((attitude + teaching) / 2.0) AS overall
    FROM reviews WHERE status = 'visible' AND teacher_code = ?`),
  insert: db.prepare(`
    INSERT INTO reviews (teacher_code, attitude, teaching, content, grade, school_year, status, author_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byAuthor: db.prepare(`SELECT id, status FROM reviews WHERE teacher_code = ? AND author_hash = ?`),
  get: db.prepare(`SELECT * FROM reviews WHERE id = ?`),
  del: db.prepare(`DELETE FROM reviews WHERE id = ?`),
  getVote: db.prepare(`SELECT value FROM votes WHERE review_id = ? AND voter_hash = ?`),
  upsertVote: db.prepare(`
    INSERT INTO votes (review_id, voter_hash, value) VALUES (?, ?, ?)
    ON CONFLICT (review_id, voter_hash) DO UPDATE SET value = excluded.value`),
  delVote: db.prepare(`DELETE FROM votes WHERE review_id = ? AND voter_hash = ?`),
  recount: db.prepare(`
    UPDATE reviews SET
      helpful   = (SELECT COUNT(*) FROM votes WHERE review_id = reviews.id AND value = 1),
      unhelpful = (SELECT COUNT(*) FROM votes WHERE review_id = reviews.id AND value = -1)
    WHERE id = ?`),
  addReport: db.prepare(`INSERT OR IGNORE INTO reports (review_id, reporter_hash, reason) VALUES (?, ?, ?)`),
  recountReports: db.prepare(`
    UPDATE reviews SET report_count = (SELECT COUNT(*) FROM reports WHERE review_id = reviews.id) WHERE id = ?`),
  setStatus: db.prepare(`UPDATE reviews SET status = ? WHERE id = ?`),
  clearReports: db.prepare(`DELETE FROM reports WHERE review_id = ?`),
  reportReasons: db.prepare(`SELECT reason, created_at FROM reports WHERE review_id = ? ORDER BY created_at DESC`),
  totals: db.prepare(`
    SELECT COUNT(*) AS reviews, COUNT(DISTINCT teacher_code) AS teachers
    FROM reviews WHERE status = 'visible'`),
  recent: db.prepare(`
    SELECT r.id, r.teacher_code, r.attitude, r.teaching, r.content, r.created_at, p.nickname
    FROM reviews r LEFT JOIN profiles p ON p.author_hash = r.author_hash
    WHERE r.status = 'visible' ORDER BY r.id DESC LIMIT 9`),
};

function reviewsQuery(sort) {
  const order = {
    new: 'id DESC',
    helpful: '(helpful - unhelpful) DESC, id DESC',
    high: '(attitude + teaching) DESC, id DESC',
    low: '(attitude + teaching) ASC, id DESC',
  }[sort] || 'id DESC';
  return db.prepare(`
    SELECT r.*, p.nickname, v.value AS my_vote, (rp.reporter_hash IS NOT NULL) AS my_report
    FROM reviews r
    LEFT JOIN profiles p ON p.author_hash = r.author_hash
    LEFT JOIN votes v   ON v.review_id = r.id AND v.voter_hash = ?
    LEFT JOIN reports rp ON rp.review_id = r.id AND rp.reporter_hash = ?
    WHERE r.teacher_code = ? AND (r.status = 'visible' OR r.author_hash = ?)
    ORDER BY ${order} LIMIT ? OFFSET ?`);
}
const REVIEW_QUERIES = Object.fromEntries(['new', 'helpful', 'high', 'low'].map((s) => [s, reviewsQuery(s)]));
const countVisible = db.prepare(`
  SELECT COUNT(*) AS n FROM reviews WHERE teacher_code = ? AND (status = 'visible' OR author_hash = ?)`);

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------
function currentSchoolYear(d = new Date()) {
  const y = d.getFullYear();
  return d.getMonth() >= 7 ? `${y}–${y + 1}` : `${y - 1}–${y}`; // năm học bắt đầu từ tháng 8
}

function hmac(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// Mỗi trình duyệt có một mã ngẫu nhiên (cookie). Máy chủ chỉ lưu bản băm của mã đó,
// không lưu IP, tên, email hay bất kỳ thông tin nhận dạng nào.
function deviceHash(req, res) {
  const cookies = parseCookies(req);
  let id = cookies.amsr_id;
  if (!id || !/^[a-f0-9]{48}$/.test(id)) {
    id = crypto.randomBytes(24).toString('hex');
    res.appendHeader(
      'Set-Cookie',
      `amsr_id=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`
    );
  }
  return hmac('device:' + id);
}

// Giới hạn tần suất trong bộ nhớ (theo IP, không lưu xuống đĩa)
const buckets = new Map();
function rateLimit(req, key, max, windowMs) {
  const k = key + '|' + clientIp(req);
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) b = { count: 0, reset: now + windowMs };
  b.count++;
  buckets.set(k, b);
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref();

// Phiên quản trị
const adminSessions = new Map();
function isAdmin(req) {
  const t = parseCookies(req).amsr_admin;
  const exp = t && adminSessions.get(t);
  if (!exp) return false;
  if (Date.now() > exp) {
    adminSessions.delete(t);
    return false;
  }
  return true;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 32 * 1024) {
        reject(new HttpError(413, 'Nội dung quá dài.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Dữ liệu gửi lên không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

function round(x, d = 2) {
  return x == null ? null : Math.round(x * 10 ** d) / 10 ** d;
}

function publicReview(r, viewerHash) {
  return {
    id: r.id,
    nickname: r.nickname || 'Ẩn danh',
    attitude: r.attitude,
    teaching: r.teaching,
    content: r.content,
    grade: r.grade,
    schoolYear: r.school_year,
    createdAt: r.created_at,
    helpful: r.helpful,
    unhelpful: r.unhelpful,
    status: r.status,
    mine: viewerHash != null && r.author_hash === viewerHash,
    myVote: r.my_vote || 0,
    myReport: !!r.my_report,
  };
}

function teacherSummary(t, s) {
  return {
    code: t.code,
    name: t.name,
    subject: t.subject,
    role: t.role || null,
    roleLabel: t.roleLabel || null,
    teachingSubjects: t.teachingSubjects,
    classes: t.classes,
    homeroom: t.homeroom,
    reviewCount: s ? s.n : 0,
    overall: s ? round(t.role === 'principal' ? s.attitude : s.overall) : null,
    attitude: s ? round(s.attitude) : null,
    teaching: s ? round(s.teaching) : null,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/meta', () => ({
  schoolYear: currentSchoolYear(),
  dataSource: teacherData.source,
  dataSchoolYear: teacherData.schoolYear,
  minLength: MIN_LEN,
  maxLength: MAX_LEN,
  requireApproval: REQUIRE_APPROVAL,
  adminEnabled: !!ADMIN_PASSWORD,
}));

route('GET', '/api/teachers', () => {
  const stats = new Map(q.teacherStats.all().map((s) => [s.code, s]));
  return { teachers: TEACHERS.map((t) => teacherSummary(t, stats.get(t.code))) };
});

route('GET', '/api/stats', () => {
  const totals = q.totals.get();
  const recent = q.recent.all().map((r) => {
    const t = TEACHER_BY_CODE.get(r.teacher_code);
    return {
      id: r.id,
      teacher: t ? { code: t.code, name: t.name, subject: t.subject, role: t.role || null, roleLabel: t.roleLabel || null } : null,
      attitude: r.attitude,
      teaching: r.teaching,
      content: r.content.length > 600 ? r.content.slice(0, 597) + '…' : r.content,
      nickname: r.nickname || 'Ẩn danh',
      createdAt: r.created_at,
    };
  });
  return { totals: { ...totals, teacherTotal: TEACHERS.length }, recent };
});

route('GET', '/api/teachers/:code', ({ params }) => {
  const t = TEACHER_BY_CODE.get(params.code);
  if (!t) throw new HttpError(404, 'Không tìm thấy giáo viên.');
  const s = q.oneTeacherStats.get(t.code);
  return { teacher: teacherSummary(t, s.n ? s : null) };
});

route('GET', '/api/teachers/:code/reviews', ({ params, url, req, res }) => {
  const t = TEACHER_BY_CODE.get(params.code);
  if (!t) throw new HttpError(404, 'Không tìm thấy giáo viên.');
  const me = deviceHash(req, res);
  const sort = url.searchParams.get('sort') || 'new';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = 10;
  const stmt = REVIEW_QUERIES[sort] || REVIEW_QUERIES.new;
  const rows = stmt.all(me, me, t.code, me, size, (page - 1) * size);
  const total = countVisible.get(t.code, me).n;
  const mine = q.byAuthor.get(t.code, me);
  return {
    reviews: rows.map((r) => publicReview(r, me)),
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    total,
    hasMine: !!mine,
  };
});

function intIn(v, lo, hi, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `Vui lòng chấm điểm "${name}".`);
  return n;
}

route('POST', '/api/teachers/:code/reviews', async ({ params, req, res }) => {
  const t = TEACHER_BY_CODE.get(params.code);
  if (!t) throw new HttpError(404, 'Không tìm thấy giáo viên.');
  if (!rateLimit(req, 'review', 8, 60 * 60 * 1000))
    throw new HttpError(429, 'Bạn gửi quá nhiều đánh giá. Vui lòng thử lại sau.');
  const me = deviceHash(req, res);
  const b = await readJson(req);

  if (b.website) throw new HttpError(400, 'Không gửi được đánh giá.'); // bẫy bot
  const content = String(b.content || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (content.length < MIN_LEN) throw new HttpError(400, `Hãy viết nhận xét (ít nhất ${MIN_LEN} ký tự).`);
  if (content.length > MAX_LEN) throw new HttpError(400, `Nhận xét tối đa ${MAX_LEN} ký tự.`);
  if (CONTACT_RE.test(content))
    throw new HttpError(400, 'Không đưa số điện thoại, email hay đường link vào nhận xét.');
  const isPrincipal = t.role === 'principal';
  // Hiệu trưởng: góp ý tự do – không chấm giảng dạy, sao Thái độ là tuỳ chọn
  const attitude = isPrincipal && (b.attitude == null || b.attitude === '') ? null : intIn(b.attitude, 1, 5, 'Thái độ');
  const teaching = isPrincipal ? null : intIn(b.teaching, 1, 5, 'Khả năng giảng dạy');
  const grade = GRADES.includes(b.grade) ? b.grade : null;
  if (q.byAuthor.get(t.code, me))
    throw new HttpError(409, 'Bạn đã đánh giá giáo viên này rồi. Hãy xoá đánh giá cũ nếu muốn viết lại.');

  const status = REQUIRE_APPROVAL ? 'pending' : 'visible';
  ensureProfile(me);
  const info = q.insert.run(t.code, attitude, teaching, content, grade, currentSchoolYear(), status, me);
  return { ok: true, id: Number(info.lastInsertRowid), status };
});

route('DELETE', '/api/reviews/:id', ({ params, req, res }) => {
  const me = deviceHash(req, res);
  const r = q.get.get(Number(params.id));
  if (!r || r.author_hash !== me) throw new HttpError(404, 'Không tìm thấy đánh giá của bạn.');
  q.del.run(r.id);
  return { ok: true };
});

route('POST', '/api/reviews/:id/vote', async ({ params, req, res }) => {
  if (!rateLimit(req, 'vote', 60, 60 * 1000)) throw new HttpError(429, 'Thao tác quá nhanh, thử lại sau.');
  const me = deviceHash(req, res);
  const { value } = await readJson(req);
  const r = q.get.get(Number(params.id));
  if (!r || r.status !== 'visible') throw new HttpError(404, 'Không tìm thấy đánh giá.');
  if (r.author_hash === me) throw new HttpError(400, 'Bạn không thể bình chọn đánh giá của chính mình.');
  const v = Number(value);
  const prev = q.getVote.get(r.id, me);
  if (v === 0 || (prev && prev.value === v)) q.delVote.run(r.id, me);
  else if (v === 1 || v === -1) q.upsertVote.run(r.id, me, v);
  else throw new HttpError(400, 'Giá trị không hợp lệ.');
  q.recount.run(r.id);
  const after = q.get.get(r.id);
  const mine = q.getVote.get(r.id, me);
  return { helpful: after.helpful, unhelpful: after.unhelpful, myVote: mine ? mine.value : 0 };
});

const REPORT_REASONS = ['Xúc phạm, thô tục', 'Thông tin sai sự thật', 'Tiết lộ thông tin cá nhân', 'Spam / không liên quan', 'Khác'];
route('POST', '/api/reviews/:id/report', async ({ params, req, res }) => {
  if (!rateLimit(req, 'report', 20, 60 * 60 * 1000)) throw new HttpError(429, 'Thao tác quá nhiều, thử lại sau.');
  const me = deviceHash(req, res);
  const { reason } = await readJson(req);
  if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, 'Vui lòng chọn lý do báo cáo.');
  const r = q.get.get(Number(params.id));
  if (!r || r.status !== 'visible') throw new HttpError(404, 'Không tìm thấy đánh giá.');
  if (r.author_hash === me) throw new HttpError(400, 'Bạn không thể báo cáo đánh giá của chính mình.');
  q.addReport.run(r.id, me, reason);
  q.recountReports.run(r.id);
  const after = q.get.get(r.id);
  if (after.report_count >= AUTO_HIDE_REPORTS && after.status === 'visible') q.setStatus.run('hidden', r.id);
  return { ok: true };
});

// --- Biệt danh ẩn danh ----------------------------------------------------
// Mỗi trình duyệt có một biệt danh ngẫu nhiên (vd: "Cáo Lém Lỉnh 427"), có thể tự đổi.
const NICK_ANIMALS = ['Cáo', 'Cú Mèo', 'Cá Heo', 'Gấu Trúc', 'Chim Sẻ', 'Mèo Mướp', 'Rái Cá', 'Hươu Cao Cổ', 'Chim Cánh Cụt',
  'Sóc', 'Thỏ', 'Hải Ly', 'Tê Giác', 'Lạc Đà', 'Chuồn Chuồn', 'Bướm', 'Ốc Sên', 'Cá Voi', 'Hổ', 'Gấu Koala', 'Vịt', 'Chim Ưng',
  'Kỳ Lân', 'Rùa', 'Cá Mập', 'Hà Mã', 'Sư Tử', 'Ngựa Vằn', 'Đom Đóm', 'Bạch Tuộc'];
const NICK_ADJ = ['Tím', 'Xanh', 'Vàng', 'Bí Ẩn', 'Lém Lỉnh', 'Chăm Chỉ', 'Mơ Màng', 'Tinh Nghịch', 'Trầm Tính', 'Vui Vẻ',
  'Dũng Cảm', 'Ngái Ngủ', 'Thông Thái', 'Lạc Quan', 'Nhanh Nhẹn', 'Hiền Lành', 'Tò Mò', 'Điềm Tĩnh', 'Hài Hước', 'Bình Tĩnh'];
const RESERVED_NICKS = ['admin', 'quản trị', 'quản trị viên', 'ban quản trị', 'hiệu trưởng', 'hiệu phó', 'phó hiệu trưởng',
  'giáo viên', 'ẩn danh', 'amsreview', 'moderator', 'mod'];
const nickKey = (s) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const qp = {
  get: db.prepare(`SELECT nickname FROM profiles WHERE author_hash = ?`),
  byKey: db.prepare(`SELECT author_hash FROM profiles WHERE nick_key = ?`),
  insert: db.prepare(`INSERT INTO profiles (author_hash, nickname, nick_key) VALUES (?, ?, ?)`),
  update: db.prepare(`UPDATE profiles SET nickname = ?, nick_key = ? WHERE author_hash = ?`),
};
function randomNickname() {
  for (let i = 0; i < 50; i++) {
    const n = `${NICK_ANIMALS[crypto.randomInt(NICK_ANIMALS.length)]} ${NICK_ADJ[crypto.randomInt(NICK_ADJ.length)]} ${crypto.randomInt(10, 1000)}`;
    if (!qp.byKey.get(nickKey(n))) return n;
  }
  return 'Học Sinh ' + crypto.randomInt(10000, 100000);
}
function ensureProfile(me) {
  const p = qp.get.get(me);
  if (p) return p.nickname;
  const n = randomNickname();
  qp.insert.run(me, n, nickKey(n));
  return n;
}

route('GET', '/api/me', ({ req, res }) => ({ nickname: ensureProfile(deviceHash(req, res)) }));

route('POST', '/api/me', async ({ req, res }) => {
  if (!rateLimit(req, 'nick', 10, 60 * 60 * 1000)) throw new HttpError(429, 'Bạn đổi biệt danh quá nhiều lần. Thử lại sau.');
  const me = deviceHash(req, res);
  ensureProfile(me);
  const b = await readJson(req);
  let nick;
  if (b.random) {
    nick = randomNickname();
  } else {
    nick = String(b.nickname || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (nick.length < 2 || nick.length > 24) throw new HttpError(400, 'Biệt danh cần dài từ 2 đến 24 ký tự.');
    if (!/^[\p{L}\p{N} ._-]+$/u.test(nick)) throw new HttpError(400, 'Biệt danh chỉ gồm chữ, số, dấu cách và . _ -');
    if (RESERVED_NICKS.includes(nickKey(nick))) throw new HttpError(400, 'Biệt danh này không được dùng.');
    const owner = qp.byKey.get(nickKey(nick));
    if (owner && owner.author_hash !== me) throw new HttpError(409, 'Biệt danh này đã có người dùng.');
  }
  qp.update.run(nick, nickKey(nick), me);
  return { nickname: nick };
});

// --- Quản trị -------------------------------------------------------------
route('POST', '/api/admin/login', async ({ req }) => {
  if (!ADMIN_PASSWORD) throw new HttpError(403, 'Chức năng quản trị chưa được bật (thiếu ADMIN_PASSWORD).');
  if (!rateLimit(req, 'login', 10, 15 * 60 * 1000)) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần.');
  const { password } = await readJson(req);
  const a = Buffer.from(hmac('pw:' + String(password || '')));
  const b = Buffer.from(hmac('pw:' + ADMIN_PASSWORD));
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Sai mật khẩu.');
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  return [
    { ok: true },
    { 'Set-Cookie': `amsr_admin=${token}; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict${isSecure(req) ? '; Secure' : ''}` },
  ];
});

route('POST', '/api/admin/logout', ({ req }) => {
  adminSessions.delete(parseCookies(req).amsr_admin);
  return [{ ok: true }, { 'Set-Cookie': 'amsr_admin=; Path=/; Max-Age=0' }];
});

route('GET', '/api/admin/session', ({ req }) => ({ admin: isAdmin(req), enabled: !!ADMIN_PASSWORD }));

const ADMIN_FILTERS = {
  reported: `report_count > 0`,
  hidden: `status = 'hidden'`,
  pending: `status = 'pending'`,
  all: `1 = 1`,
};
route('GET', '/api/admin/reviews', ({ req, url }) => {
  if (!isAdmin(req)) throw new HttpError(401, 'Cần đăng nhập quản trị.');
  const filter = ADMIN_FILTERS[url.searchParams.get('filter')] ? url.searchParams.get('filter') : 'reported';
  const rows = db
    .prepare(`SELECT r.*, p.nickname FROM reviews r LEFT JOIN profiles p ON p.author_hash = r.author_hash
      WHERE ${ADMIN_FILTERS[filter]} ORDER BY report_count DESC, id DESC LIMIT 200`)
    .all();
  const counts = {};
  for (const [k, where] of Object.entries(ADMIN_FILTERS))
    counts[k] = db.prepare(`SELECT COUNT(*) AS n FROM reviews WHERE ${where}`).get().n;
  return {
    counts,
    reviews: rows.map((r) => {
      const t = TEACHER_BY_CODE.get(r.teacher_code);
      return {
        ...publicReview(r, null),
        reportCount: r.report_count,
        reports: q.reportReasons.all(r.id),
        teacher: t ? { code: t.code, name: t.name, subject: t.subject } : { code: r.teacher_code, name: r.teacher_code },
      };
    }),
  };
});

route('POST', '/api/admin/reviews/:id', async ({ req, params }) => {
  if (!isAdmin(req)) throw new HttpError(401, 'Cần đăng nhập quản trị.');
  const { action } = await readJson(req);
  const r = q.get.get(Number(params.id));
  if (!r) throw new HttpError(404, 'Không tìm thấy đánh giá.');
  if (action === 'show') {
    q.setStatus.run('visible', r.id);
    q.clearReports.run(r.id);
    q.recountReports.run(r.id);
  } else if (action === 'hide') q.setStatus.run('hidden', r.id);
  else if (action === 'delete') q.del.run(r.id);
  else throw new HttpError(400, 'Thao tác không hợp lệ.');
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Tệp tĩnh
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad Request'); }
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      return serveStatic(req, res, url.pathname);
    }
    // Chặn yêu cầu ghi đến từ trang web khác (CSRF)
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Yêu cầu không hợp lệ.');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler({ req, res, url, params });
      if (Array.isArray(out)) return send(res, 200, out[0], out[1]);
      return send(res, 200, out);
    }
    throw new HttpError(404, 'Không tìm thấy.');
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
  }
});

server.listen(PORT, () => {
  console.log(`AMS Review đang chạy tại http://localhost:${PORT}`);
  console.log(`- ${TEACHERS.length} giáo viên, CSDL: ${DB_PATH}`);
  console.log(`- Quản trị: ${ADMIN_PASSWORD ? 'đã bật' : 'TẮT (đặt ADMIN_PASSWORD để bật)'}; duyệt trước: ${REQUIRE_APPROVAL ? 'có' : 'không'}`);
});
