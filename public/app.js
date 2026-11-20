'use strict';

/* ======================================================================
   AmsReview – giao diện người dùng (JS thuần, không cần build)
   ====================================================================== */

const $main = document.getElementById('main');
const state = {
  meta: null,
  teachers: null,
  home: { q: '', subject: '', sort: 'reviews', limit: 60 },
};

/* ---------------------------------------------------------------- helpers */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val);
        else el.style[p] = val;
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // chỉ dùng cho SVG tĩnh
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại.');
  return data;
}

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

function givenName(name) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

const AVATAR_COLORS = ['#3b5b92', '#7a4f9a', '#2f7d6d', '#b0573a', '#9a3b5d', '#4d6e2f', '#2c6a9a', '#8a6a1f', '#5a5f9e', '#a2442f'];
function avatarColor(key) {
  let x = 0;
  for (const ch of key) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[x % AVATAR_COLORS.length];
}
function avatar(t, lg) {
  return h('span', { class: 'avatar' + (lg ? ' lg' : ''), style: { '--avatar': avatarColor(t.subject) }, 'aria-hidden': 'true' },
    givenName(t.name).charAt(0).toUpperCase());
}

function scoreClass(x) {
  if (x == null) return 'none';
  return x >= 4 ? 'good' : x >= 3 ? 'mid' : 'bad';
}
function fmt(x, d = 1) {
  return x == null ? '–' : Number(x).toFixed(d).replace('.', ',');
}
function scoreBadge(x, n) {
  if (x == null && n) return h('span', { class: 'score none' }, n, h('small', null, 'nhận xét'));
  if (x == null) return h('span', { class: 'score none' }, 'Chưa có');
  return h('span', { class: 'score ' + scoreClass(x), title: `${fmt(x)} / 5 từ ${n} đánh giá` },
    fmt(x), h('small', null, `${n} đánh giá`));
}

const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z';
function starSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${STAR_PATH}"/></svg>`;
}
function stars(value, size = 16) {
  const wrap = h('span', { class: 'stars', style: { fontSize: size + 'px' }, role: 'img', 'aria-label': `${fmt(value)} trên 5 sao` });
  for (let i = 1; i <= 5; i++) {
    const fill = Math.max(0, Math.min(1, value - (i - 1)));
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    wrap.append(h('span', {
      html: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}"><stop offset="${fill * 100}%" stop-color="currentColor"/><stop offset="${fill * 100}%" stop-color="var(--line)"/></linearGradient></defs><path fill="url(#${id})" d="${STAR_PATH}"/></svg>`,
      style: { lineHeight: 0 },
    }));
  }
  return wrap;
}

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} ngày trước`;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const GRADE_LABEL = { '10': 'Khối 10', '11': 'Khối 11', '12': 'Khối 12', 'cuu-hs': 'Cựu học sinh' };
const STAR_WORDS = ['', 'Rất tệ', 'Chưa tốt', 'Bình thường', 'Tốt', 'Tuyệt vời'];
const RATINGS = [
  { key: 'attitude', label: 'Thái độ', help: 'Cách thầy/cô đối xử, tôn trọng và quan tâm học sinh' },
  { key: 'teaching', label: 'Khả năng giảng dạy', help: 'Truyền đạt bài giảng có dễ hiểu, hiệu quả không' },
];

// Hiệu trưởng không dạy: chỉ có sao "Thái độ" (không bắt buộc), còn lại là nhận xét tự do
function ratingsFor(t) {
  return t.role === 'principal' ? [{ ...RATINGS[0], optional: true }] : RATINGS;
}

// Tên người Việt: làm nổi bật tên gọi (chữ cuối)
function personName(name, cls = '') {
  const parts = String(name).trim().split(/\s+/);
  const given = parts.pop();
  return h('span', { class: ('pname ' + cls).trim() },
    parts.length ? h('span', { class: 'pname-rest' }, parts.join(' ') + ' ') : null,
    h('span', { class: 'pname-given' }, given));
}

// Dòng nhỏ hiển thị 2 điểm sao của một đánh giá
function ratingLine(r, size = 14) {
  const list = RATINGS.filter((c) => r[c.key] != null);
  if (!list.length) return null;
  return h('div', { class: 'rating-line' },
    list.map((c) => h('span', { class: 'rating-chip' },
      h('span', { class: 'rating-label' }, c.label), stars(r[c.key], size), h('b', null, r[c.key]))));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function setNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === key));
}

function render(...nodes) {
  $main.replaceChildren(...nodes);
}

/* -------------------------------------------------------------- nickname */
const USER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
async function loadMe(force) {
  if (!state.me || force) state.me = await api('/api/me');
  const btn = document.getElementById('nickBtn');
  btn.replaceChildren(h('span', { html: USER_ICON }), h('span', { class: 'nick-text' }, state.me.nickname));
  btn.hidden = false;
  return state.me;
}

function openNickDialog(onDone) {
  const dlg = document.getElementById('nickDialog');
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const input = h('input', { class: 'input', id: 'nickInput', maxlength: 24, value: state.me.nickname, autocomplete: 'off', 'aria-label': 'Biệt danh' });
  const randomBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, '🎲 Ngẫu nhiên');
  const form = h('form', { novalidate: true },
    h('div', { class: 'dialog-head' },
      h('div', null, h('h2', { id: 'nickDialogTitle' }, 'Biệt danh của bạn'),
        h('p', null, 'Hiển thị trên các đánh giá bạn viết, thay cho tên thật.')),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'dialog-body' },
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Biệt danh'),
        h('div', { class: 'nick-row' }, input, randomBtn),
        h('span', { class: 'help' }, '2–24 ký tự. Đổi biệt danh sẽ cập nhật trên mọi đánh giá cũ của bạn. Biệt danh gắn với trình duyệt này; xoá dữ liệu trình duyệt sẽ nhận biệt danh mới.')),
      errorBox),
    h('div', { class: 'dialog-foot' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, 'Huỷ'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Lưu')));
  const save = async (body) => {
    errorBox.hidden = true;
    try {
      state.me = await api('/api/me', { method: 'POST', body });
      await loadMe();
      return true;
    } catch (e) { errorBox.textContent = e.message; errorBox.hidden = false; return false; }
  };
  randomBtn.addEventListener('click', async () => { if (await save({ random: true })) input.value = state.me.nickname; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await save({ nickname: input.value })) { dlg.close(); toast(`Biệt danh mới: ${state.me.nickname}`); onDone && onDone(); }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  input.select();
}

document.getElementById('nickBtn').addEventListener('click', () => openNickDialog(() => router()));

async function loadMeta() {
  if (!state.meta) state.meta = await api('/api/meta');
  return state.meta;
}
async function loadTeachers(force) {
  if (!state.teachers || force) state.teachers = (await api('/api/teachers')).teachers;
  return state.teachers;
}

/* ------------------------------------------------------------------- home */
async function pageHome() {
  setNav('home');
  document.title = 'AmsReview · Đánh giá giáo viên ẩn danh';
  const [teachers, stats] = await Promise.all([loadTeachers(true), api('/api/stats')]);
  const H = state.home;

  const recent = h('section', { class: 'section section-first' },
    h('div', { class: 'section-head' },
      h('h1', { class: 'page-title' }, 'Đánh giá mới nhất'),
      h('span', { class: 'muted', style: { fontSize: '14px' } },
        `${stats.totals.reviews} đánh giá · ${stats.totals.teachers}/${stats.totals.teacherTotal} thầy cô đã được đánh giá`)),
    stats.recent.length
      ? h('div', { class: 'recent' }, stats.recent.map((r) => h('a', { class: 'recent-card', href: `#/gv/${encodeURIComponent(r.teacher.code)}` },
        h('p', { class: 'quote' }, r.content),
        h('span', { class: 'by' }, '— ' + r.nickname),
        h('div', { class: 'who' },
          h('div', { style: { minWidth: 0 } }, h('strong', null, personName(r.teacher.name)),
            h('div', { class: 'muted', style: { fontSize: '13px' } }, `${r.teacher.roleLabel || r.teacher.subject} · ${timeAgo(r.createdAt)}`))),
        ratingLine(r, 12))))
      : h('div', { class: 'empty' }, 'Chưa có đánh giá nào. Hãy chọn một thầy cô bên dưới và viết đánh giá đầu tiên.'));

  const searchInput = h('input', {
    type: 'search', placeholder: 'Tìm tên thầy cô, môn học hoặc lớp… (vd: "thu toan", "11 Anh 2")',
    value: H.q, 'aria-label': 'Tìm giáo viên', autocomplete: 'off',
    oninput: (e) => { H.q = e.target.value; H.limit = 60; drawGrid(); },
  });
  const finder = h('div', { class: 'finder' },
    h('div', { class: 'searchbox' },
      h('span', { html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }),
      searchInput),
    h('div', { class: 'anon-note' },
      h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' }),
      'Không cần đăng nhập · Không lưu tên, email hay IP'));

  // Bộ lọc theo tổ bộ môn
  const subjects = {};
  for (const t of teachers) subjects[t.subject] = (subjects[t.subject] || 0) + 1;
  const subjectList = Object.entries(subjects).sort((a, b) => b[1] - a[1]);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Lọc theo tổ bộ môn' });
  function drawChips() {
    chips.replaceChildren(
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!H.subject), onclick: () => { H.subject = ''; H.limit = 60; drawChips(); drawGrid(); } }, 'Tất cả', h('span', { class: 'n' }, teachers.length)),
      ...subjectList.map(([s, n]) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(H.subject === s),
        onclick: () => { H.subject = H.subject === s ? '' : s; H.limit = 60; drawChips(); drawGrid(); },
      }, s, h('span', { class: 'n' }, n))));
  }
  drawChips();

  const sortSel = h('select', { class: 'select', 'aria-label': 'Sắp xếp', onchange: (e) => { H.sort = e.target.value; drawGrid(); } },
    [['reviews', 'Nhiều đánh giá nhất'], ['top', 'Điểm cao nhất'], ['name', 'Tên A → Z']].map(([v, l]) => h('option', { value: v, selected: H.sort === v }, l)));
  const countLine = h('span', { class: 'count-line' });
  const grid = h('div', { class: 'grid' });
  const more = h('div', { class: 'more' });

  const byName = (a, b) => givenName(a.name).localeCompare(givenName(b.name), 'vi') || a.name.localeCompare(b.name, 'vi');
  // Điểm "Bayes" để giáo viên ít đánh giá không bị đẩy lên đầu quá dễ
  const bayes = (t) => (t.reviewCount ? (t.overall * t.reviewCount + 3.5 * 3) / (t.reviewCount + 3) : -1);

  function drawGrid() {
    const terms = norm(H.q).split(/\s+/).filter(Boolean);
    let list = teachers.filter((t) => {
      if (H.subject && t.subject !== H.subject) return false;
      if (!terms.length) return true;
      const hay = norm([t.name, t.subject, t.teachingSubjects.join(' '), t.classes.join(' '), t.homeroom.join(' '), t.code].join(' '));
      return terms.every((w) => hay.includes(w));
    });
    list = list.slice().sort(
      H.sort === 'name' ? byName
        : H.sort === 'top' ? (a, b) => bayes(b) - bayes(a) || byName(a, b)
          : (a, b) => b.reviewCount - a.reviewCount || byName(a, b));
    countLine.textContent = `${list.length} giáo viên`;
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'Không tìm thấy giáo viên phù hợp. Thử bỏ dấu hoặc gõ ngắn hơn.'));
      more.replaceChildren();
      return;
    }
    grid.replaceChildren(...list.slice(0, H.limit).map(teacherCard));
    more.replaceChildren(list.length > H.limit
      ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { H.limit += 60; drawGrid(); } }, `Xem thêm (${list.length - H.limit})`)
      : '');
  }
  drawGrid();

  render(recent,
    h('section', { class: 'section', 'aria-label': 'Danh sách giáo viên' },
      h('div', { class: 'section-head' }, h('h2', null, 'Tìm giáo viên để đánh giá')),
      finder,
      h('div', { class: 'filters' }, chips, countLine, sortSel),
      grid, more));
  if (H.q) searchInput.focus();
}

function teacherCard(t) {
  const sub = [t.roleLabel || t.subject, t.homeroom.length ? `CN ${t.homeroom.join(', ')}` : null].filter(Boolean).join(' · ');
  return h('a', { class: 'tcard', href: `#/gv/${encodeURIComponent(t.code)}` },
    avatar(t),
    h('div', { class: 'info' },
      h('div', { class: 'name' }, personName(t.name)),
      h('div', { class: 'sub' }, sub),
      t.classes.length ? h('div', { class: 'sub' }, 'Dạy: ' + t.classes.slice(0, 4).join(', ') + (t.classes.length > 4 ? '…' : '')) : null),
    scoreBadge(t.overall, t.reviewCount));
}

/* ---------------------------------------------------------------- teacher */
async function pageTeacher(code) {
  setNav('home');
  const tState = { sort: 'new', page: 1 };
  let data;
  try {
    data = await api(`/api/teachers/${encodeURIComponent(code)}`);
  } catch (e) {
    render(h('a', { class: 'back', href: '#/' }, '← Danh sách giáo viên'), h('div', { class: 'empty' }, e.message));
    return;
  }
  const t = data.teacher;
  const isPrincipal = t.role === 'principal';
  document.title = `${t.name} · AmsReview`;
  const reviewsBox = h('div', { class: 'reviews' });
  const pager = h('div', { class: 'pager' });
  const writeBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReviewDialog(t, () => pageTeacher(code)) },
    h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' }),
    'Viết đánh giá');

  // Thẻ thông tin
  const facts = h('dl', { class: 'facts' },
    t.homeroom.length ? h('div', null, h('dt', null, 'Chủ nhiệm'), h('dd', null, t.homeroom.map((c) => h('span', { class: 'pill' }, c)))) : null,
    t.classes.length ? h('div', null, h('dt', null, `Đang dạy (năm học ${state.meta.dataSchoolYear})`), h('dd', null, t.classes.map((c) => h('span', { class: 'pill' }, c)))) : null,
    t.teachingSubjects.length > 1 ? h('div', null, h('dt', null, 'Môn giảng dạy'), h('dd', null, t.teachingSubjects.map((c) => h('span', { class: 'pill' }, c)))) : null);

  const infoCard = h('section', { class: 'card tinfo' },
    h('div', { class: 'who-head' }, avatar(t, true),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('h1', null, personName(t.name)), h('p', { class: 'subject' }, t.roleLabel || `Tổ ${t.subject}`)),
      scoreBadge(t.overall, t.reviewCount)),
    facts,
    h('div', { class: 'cta-row' }, writeBtn,
      h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Ẩn danh hoàn toàn · mất khoảng 2 phút')));

  // Thẻ điểm số
  let scoreCard;
  if (!t.reviewCount) {
    scoreCard = h('section', { class: 'card tscore', style: { display: 'grid', placeItems: 'center', textAlign: 'center', gap: '10px', padding: '32px 20px' } },
      h('div', { style: { fontSize: '40px', lineHeight: 1 }, 'aria-hidden': 'true' }, '✍️'),
      h('h2', { style: { fontSize: '18px' } }, 'Chưa có đánh giá nào'),
      h('p', { class: 'muted' }, `Hãy là người đầu tiên chia sẻ trải nghiệm học cùng ${t.name}.`));
  } else {
    const shown = isPrincipal ? [] : RATINGS;
    scoreCard = h('section', { class: 'card tscore' },
      t.overall != null
        ? h('div', { class: 'score-head' },
          h('span', { class: 'num' }, fmt(t.overall)), h('span', { class: 'of' }, '/ 5'),
          h('span', { class: 'cnt' }, isPrincipal ? `Thái độ · từ ${t.reviewCount} nhận xét` : `trung bình từ ${t.reviewCount} đánh giá`))
        : h('div', { class: 'score-head' },
          h('span', { class: 'num' }, t.reviewCount), h('span', { class: 'of' }, 'nhận xét')),
      shown.length ? h('div', { class: 'two-ratings' },
        shown.map((c) => h('div', { class: 'rating-big' },
          h('div', { class: 'rating-big-top' }, h('span', null, c.label), h('b', null, `${fmt(t[c.key])} / 5`)),
          stars(t[c.key], 22)))) : null);
  }

  const sortSel = h('select', { class: 'select', 'aria-label': 'Sắp xếp đánh giá', onchange: (e) => { tState.sort = e.target.value; tState.page = 1; loadReviews(); } },
    [['new', 'Mới nhất'], ['helpful', 'Hữu ích nhất'], ['high', 'Sao cao nhất'], ['low', 'Sao thấp nhất']].map(([v, l]) => h('option', { value: v }, l)));
  const reviewsTitle = h('h2', null, isPrincipal ? 'Nhận xét từ học sinh' : 'Đánh giá từ học sinh');

  async function loadReviews() {
    reviewsBox.replaceChildren(h('p', { class: 'loading' }, 'Đang tải đánh giá…'));
    const r = await api(`/api/teachers/${encodeURIComponent(code)}/reviews?sort=${tState.sort}&page=${tState.page}`);
    reviewsTitle.textContent = `${isPrincipal ? 'Nhận xét' : 'Đánh giá'} từ học sinh (${r.total})`;
    if (r.hasMine) {
      writeBtn.disabled = true;
      writeBtn.title = 'Bạn đã đánh giá giáo viên này';
      writeBtn.lastChild.textContent = 'Bạn đã đánh giá';
    }
    if (!r.reviews.length) {
      reviewsBox.replaceChildren(h('div', { class: 'empty' }, 'Chưa có đánh giá nào.'));
    } else {
      reviewsBox.replaceChildren(...r.reviews.map((rv) => reviewCard(rv, { onChange: () => pageTeacher(code) })));
    }
    pager.replaceChildren();
    if (r.pages > 1) {
      pager.append(
        h('button', { class: 'btn btn-ghost btn-sm', disabled: tState.page <= 1, onclick: () => { tState.page--; loadReviews(); } }, '← Trước'),
        h('span', null, `Trang ${r.page} / ${r.pages}`),
        h('button', { class: 'btn btn-ghost btn-sm', disabled: tState.page >= r.pages, onclick: () => { tState.page++; loadReviews(); } }, 'Sau →'));
    }
  }

  render(
    h('a', { class: 'back', href: '#/' }, '← Danh sách giáo viên'),
    h('div', { class: 'tlayout' }, infoCard,
      h('section', { class: 'treviews' },
        h('div', { class: 'section-head' }, reviewsTitle, sortSel),
        reviewsBox, pager),
      scoreCard));
  window.scrollTo(0, 0);
  await loadReviews();
}

function reviewCard(rv, { onChange, admin } = {}) {
  const helpfulBtn = h('button', { class: 'vote', type: 'button', 'aria-pressed': String(rv.myVote === 1), 'aria-label': 'Hữu ích' }, '👍 Hữu ích ', h('span', null, rv.helpful));
  const unhelpfulBtn = h('button', { class: 'vote', type: 'button', 'aria-pressed': String(rv.myVote === -1), 'aria-label': 'Không hữu ích' }, '👎 ', h('span', null, rv.unhelpful));
  async function vote(v) {
    try {
      const r = await api(`/api/reviews/${rv.id}/vote`, { method: 'POST', body: { value: v } });
      helpfulBtn.lastChild.textContent = r.helpful;
      unhelpfulBtn.lastChild.textContent = r.unhelpful;
      helpfulBtn.setAttribute('aria-pressed', String(r.myVote === 1));
      unhelpfulBtn.setAttribute('aria-pressed', String(r.myVote === -1));
    } catch (e) { toast(e.message); }
  }
  helpfulBtn.addEventListener('click', () => vote(1));
  unhelpfulBtn.addEventListener('click', () => vote(-1));

  const meta = h('div', { class: 'review-meta' },
    h('span', { class: 'nick' }, rv.nickname),
    rv.mine ? h('span', { class: 'badge mine' }, 'Đánh giá của bạn') : null,
    rv.status === 'pending' ? h('span', { class: 'badge warn' }, 'Đang chờ duyệt') : null,
    rv.status === 'hidden' ? h('span', { class: 'badge warn' }, 'Đang bị ẩn') : null,
    rv.grade ? h('span', { class: 'badge' }, GRADE_LABEL[rv.grade]) : null,
    rv.schoolYear ? h('span', null, `Năm học ${rv.schoolYear}`) : null,
    h('span', null, '· ' + timeAgo(rv.createdAt)));

  let actions;
  if (admin) {
    actions = admin;
  } else {
    actions = h('div', { class: 'review-actions' });
    if (!rv.mine && rv.status === 'visible') actions.append(helpfulBtn, unhelpfulBtn);
    actions.append(h('span', { class: 'spacer' }));
    if (rv.mine) {
      actions.append(h('button', {
        class: 'linkbtn', type: 'button',
        onclick: async () => {
          if (!confirm('Xoá đánh giá này? Bạn có thể viết lại sau.')) return;
          try { await api(`/api/reviews/${rv.id}`, { method: 'DELETE' }); toast('Đã xoá đánh giá.'); onChange && onChange(); } catch (e) { toast(e.message); }
        },
      }, 'Xoá đánh giá'));
    } else if (rv.status === 'visible') {
      const repBtn = h('button', { class: 'linkbtn', type: 'button', disabled: rv.myReport }, rv.myReport ? 'Đã báo cáo' : 'Báo cáo');
      repBtn.addEventListener('click', () => openReportDialog(rv.id, () => { repBtn.textContent = 'Đã báo cáo'; repBtn.disabled = true; }));
      actions.append(repBtn);
    }
  }

  return h('article', { class: 'review' + (rv.mine ? ' is-mine' : '') },
    h('p', { class: 'review-text' }, rv.content),
    ratingLine(rv),
    meta,
    actions);
}

/* -------------------------------------------------------- review dialog */
function starPicker(c, values) {
  const name = 'rate-' + c.key;
  const valText = h('span', { class: 'rate-val', 'aria-hidden': 'true' }, '');
  const fs = h('fieldset', { class: 'starpick' }, h('legend', { class: 'sr-only' }, c.label));
  for (let i = 5; i >= 1; i--) {
    const id = `${name}-${i}`;
    fs.append(
      h('input', { type: 'radio', name, id, value: i, onchange: () => { values[c.key] = i; valText.textContent = STAR_WORDS[i]; } }),
      h('label', { for: id, title: STAR_WORDS[i], html: starSvg() + `<span class="sr-only">${i} – ${STAR_WORDS[i]}</span>` }));
  }
  return h('div', { class: 'rate-row' },
    h('span', { class: 'label' }, c.label, c.optional ? h('small', null, 'Không bắt buộc') : null),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, valText, fs));
}

function openReviewDialog(t, onDone) {
  const dlg = document.getElementById('reviewDialog');
  const MIN = state.meta.minLength || 10;
  const MAX = state.meta.maxLength || 5000;
  const values = {};
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const counter = h('div', { class: 'counter' }, `0 / ${MAX}`);
  const textarea = h('textarea', {
    name: 'content', id: 'reviewContent', maxlength: MAX, required: true, class: 'big-text',
    oninput: () => {
      const n = textarea.value.trim().length;
      counter.textContent = n > 0 && n < MIN ? `${n} / ${MAX} · cần thêm ${MIN - n} ký tự` : `${n} / ${MAX}`;
      counter.classList.toggle('warn', n > 0 && n < MIN);
    },
  });
  const seg = (name, opts) => h('div', { class: 'seg', role: 'radiogroup' },
    opts.map(([v, l], i) => h('label', null, h('input', { type: 'radio', name, value: v, checked: i === 0 }), l)));
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Gửi đánh giá');

  const form = h('form', { method: 'dialog', novalidate: true },
    h('div', { class: 'dialog-head' },
      h('div', null, h('h2', { id: 'reviewDialogTitle' }, `Đánh giá ${t.name}`),
        h('p', null, `Tổ ${t.subject} · Hoàn toàn ẩn danh`)),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'dialog-body' },
      h('label', { class: 'field' },
        h('span', { class: 'label label-lg' }, 'Nhận xét của bạn'),
        textarea, counter),
      h('div', { class: 'field' }, ratingsFor(t).map((c) => starPicker(c, values))),
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Bạn đang là'), h('span', { class: 'help' }, 'Không bắt buộc – chỉ ghi khối, không ghi lớp để giữ ẩn danh'),
        seg('grade', [['', 'Không nói'], ['10', 'Khối 10'], ['11', 'Khối 11'], ['12', 'Khối 12'], ['cuu-hs', 'Cựu HS']])),
      h('label', { class: 'hp', 'aria-hidden': 'true' }, 'Website', h('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
      errorBox),
    h('div', { class: 'dialog-foot' },
      h('span', { class: 'post-as' }, 'Đăng với tên ', h('b', null, state.me ? state.me.nickname : 'Ẩn danh')),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, 'Huỷ'),
      submitBtn));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const showErr = (m) => { errorBox.textContent = m; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'nearest' }); };
    if (textarea.value.trim().length < MIN) { textarea.focus(); return showErr(`Hãy viết nhận xét (ít nhất ${MIN} ký tự).`); }
    const missing = ratingsFor(t).find((c) => !c.optional && !values[c.key]);
    if (missing) return showErr(`Vui lòng chấm sao cho "${missing.label}".`);
    const fd = new FormData(form);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang gửi…';
    try {
      const r = await api(`/api/teachers/${encodeURIComponent(t.code)}/reviews`, {
        method: 'POST',
        body: { attitude: values.attitude || null, teaching: values.teaching || null, content: textarea.value, grade: fd.get('grade') || null, website: fd.get('website') || '' },
      });
      dlg.close();
      toast(r.status === 'pending' ? 'Cảm ơn bạn! Đánh giá sẽ hiển thị sau khi được duyệt.' : 'Cảm ơn bạn đã chia sẻ đánh giá!');
      onDone && onDone();
    } catch (err) {
      showErr(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Gửi đánh giá';
    }
  });

  dlg.replaceChildren(form);
  dlg.showModal();
  textarea.focus();
}

const REPORT_REASONS = ['Xúc phạm, thô tục', 'Thông tin sai sự thật', 'Tiết lộ thông tin cá nhân', 'Spam / không liên quan', 'Khác'];
function openReportDialog(id, onDone) {
  const dlg = document.getElementById('reportDialog');
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'dialog-head' },
      h('div', null, h('h2', { id: 'reportDialogTitle' }, 'Báo cáo đánh giá'), h('p', null, 'Đánh giá bị nhiều người báo cáo sẽ tự động bị ẩn để xem xét.')),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'dialog-body' },
      h('div', { class: 'reasons' }, REPORT_REASONS.map((r, i) => h('label', null, h('input', { type: 'radio', name: 'reason', value: r, checked: i === 0 }), r))),
      errorBox),
    h('div', { class: 'dialog-foot' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, 'Huỷ'),
      h('button', { class: 'btn btn-danger', type: 'submit' }, 'Gửi báo cáo')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/reviews/${id}/report`, { method: 'POST', body: { reason: new FormData(form).get('reason') } });
      dlg.close();
      toast('Cảm ơn bạn đã báo cáo. Chúng tôi sẽ xem xét.');
      onDone && onDone();
    } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}


/* ------------------------------------------------------------------ admin */
async function pageAdmin() {
  setNav('');
  document.title = 'Quản trị · AmsReview';
  const s = await api('/api/admin/session');
  if (!s.enabled) {
    render(h('div', { class: 'card login' }, h('h1', { style: { fontSize: '22px' } }, 'Quản trị'),
      h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Chức năng quản trị chưa được bật. Hãy đặt biến môi trường ADMIN_PASSWORD khi chạy máy chủ.')));
    return;
  }
  if (!s.admin) {
    const err = h('div', { class: 'form-error', hidden: true, style: { marginTop: '12px' } });
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'Mật khẩu quản trị', autocomplete: 'current-password', required: true });
    const form = h('form', { class: 'card login' },
      h('h1', { style: { fontSize: '22px' } }, 'Đăng nhập quản trị'), pw, err,
      h('button', { class: 'btn btn-primary', type: 'submit', style: { marginTop: '12px', width: '100%' } }, 'Đăng nhập'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/login', { method: 'POST', body: { password: pw.value } }); pageAdmin(); } catch (x) { err.textContent = x.message; err.hidden = false; }
    });
    render(form);
    pw.focus();
    return;
  }

  let filter = 'reported';
  const tabs = h('div', { class: 'admin-tabs' });
  const list = h('div', { class: 'reviews' });
  const LABELS = { reported: 'Bị báo cáo', hidden: 'Đang ẩn', pending: 'Chờ duyệt', all: 'Tất cả' };

  async function load() {
    const d = await api(`/api/admin/reviews?filter=${filter}`);
    tabs.replaceChildren(...Object.keys(LABELS).map((k) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(k === filter), onclick: () => { filter = k; load(); },
    }, LABELS[k], h('span', { class: 'n' }, d.counts[k]))));
    if (!d.reviews.length) return list.replaceChildren(h('div', { class: 'empty' }, 'Không có đánh giá nào trong mục này.'));
    list.replaceChildren(...d.reviews.map((rv) => {
      const act = async (action) => {
        if (action === 'delete' && !confirm('Xoá vĩnh viễn đánh giá này?')) return;
        try { await api(`/api/admin/reviews/${rv.id}`, { method: 'POST', body: { action } }); toast('Đã cập nhật.'); load(); } catch (e) { toast(e.message); }
      };
      const bar = h('div', { class: 'review-actions' },
        h('a', { href: `#/gv/${encodeURIComponent(rv.teacher.code)}`, style: { fontWeight: 600 } }, personName(rv.teacher.name), ` (${rv.teacher.subject || ''})`),
        h('span', { class: 'spacer' }),
        rv.status !== 'visible' || rv.reportCount
          ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => act('show') }, rv.status === 'pending' ? 'Duyệt' : 'Hiện & bỏ báo cáo') : null,
        rv.status !== 'hidden' ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => act('hide') }, 'Ẩn') : null,
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => act('delete') }, 'Xoá'));
      const card = reviewCard(rv, { admin: bar });
      card.classList.add('admin-review');
      if (rv.reports.length) {
        card.insertBefore(h('div', { class: 'reports' }, `${rv.reportCount} báo cáo: ` + rv.reports.map((x) => x.reason).join(' · ')), bar);
      }
      return card;
    }));
  }

  render(
    h('div', { class: 'section-head', style: { marginTop: '28px' } },
      h('h1', { style: { fontSize: '26px' } }, 'Kiểm duyệt đánh giá'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { await api('/api/admin/logout', { method: 'POST' }); pageAdmin(); } }, 'Đăng xuất')),
    tabs, list);
  await load();
}

/* ----------------------------------------------------------------- router */
async function router() {
  const hash = location.hash.replace(/^#/, '') || '/';
  try {
    await Promise.all([loadMeta(), loadMe()]);
    let m;
    if ((m = hash.match(/^\/gv\/([^/?]+)/))) await pageTeacher(decodeURIComponent(m[1]));
    else if (hash.startsWith('/quan-tri')) await pageAdmin();
    else await pageHome();
  } catch (e) {
    render(h('div', { class: 'empty', style: { marginTop: '40px' } }, e.message || 'Không tải được dữ liệu.'));
  }
}

window.addEventListener('hashchange', router);
router();
