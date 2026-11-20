// Cập nhật danh sách giáo viên từ tkbams.mrtee.vn → data/teachers.json
// Chạy: npm run update-teachers   (sau đó khởi động lại máy chủ)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const res = await fetch('https://tkbams.mrtee.vn/api/timetable');
  if (!res.ok) throw new Error('Không tải được dữ liệu: HTTP ' + res.status);
  const d = await res.json();
  const homeroom = {};
  for (const c of d.classes || []) {
    const t = c.homeroomTeacher;
    if (t && t.code) (homeroom[t.code] ||= []).push(c.displayName);
  }
  const teachers = (d.teachers || []).map((t) => {
    const classes = new Map();
    for (const s of t.schedules || []) {
      const key = s.parentClassName || s.className;
      classes.set(key, s.classDisplayName || key);
    }
    return {
      code: t.code,
      name: String(t.name).trim(),
      subject: t.subject,
      teachingSubjects: t.teachingSubjects || [],
      classes: [...classes.values()].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
      homeroom: homeroom[t.code] || [],
    };
  });
  const file = path.join(__dirname, '..', 'data', 'teachers.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).teachers : [];
  const newCodes = new Set(teachers.map((t) => t.code));
  const oldByCode = new Map(old.map((t) => [t.code, t.name]));
  const changed = teachers.filter((t) => oldByCode.has(t.code) && oldByCode.get(t.code) !== t.name);
  if (changed.length && !process.argv.includes('--force')) {
    console.error('CẢNH BÁO: các mã giáo viên sau đã đổi tên – đánh giá cũ sẽ bị gán sang người khác:');
    for (const t of changed) console.error(`  ${t.code}: ${oldByCode.get(t.code)} → ${t.name}`);
    console.error('Hãy kiểm tra lại. Chạy với --force nếu chắc chắn muốn ghi đè.');
    process.exit(1);
  }
  // Giữ lại giáo viên cũ không còn trong TKB để không mất các đánh giá đã có
  for (const t of old) if (!newCodes.has(t.code)) teachers.push({ ...t, classes: [], homeroom: [] });
  fs.writeFileSync(file, JSON.stringify({ source: 'https://tkbams.mrtee.vn', schoolYear: d.meta?.schoolYear, teachers }, null, 1));
  console.log(`Đã lưu ${teachers.length} giáo viên vào data/teachers.json`);
})().catch((e) => { console.error(e.message); process.exit(1); });
