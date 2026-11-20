# AmsReview – Đánh giá giáo viên ẩn danh

Trang web để học sinh **THPT Chuyên Hà Nội – Amsterdam** đánh giá thầy cô một cách ẩn danh, lấy cảm hứng từ [nguoiditruoc.com](https://www.nguoiditruoc.com/). Danh sách 210 giáo viên (môn, lớp đang dạy, lớp chủ nhiệm) lấy từ [tkbams.mrtee.vn](https://tkbams.mrtee.vn).

## Tính năng

- **Trang chủ**: các đánh giá mới nhất hiển thị đầu tiên, bên dưới là ô tìm kiếm và danh sách giáo viên.
- **Danh sách giáo viên**: tìm kiếm không cần dấu (“thu toan”, “11 Anh 2”), lọc theo tổ bộ môn, sắp xếp theo số đánh giá / điểm / tên.
- **Trang giáo viên**: các đánh giá viết hiển thị ngay dưới tên thầy cô; bên cạnh là điểm trung bình hai tiêu chí **Thái độ** và **Khả năng giảng dạy**.
- **Viết đánh giá ẩn danh**: phần nhận xét viết là chính (10–5000 ký tự, không lọc từ ngữ), kèm chấm 1–5 sao cho Thái độ và Khả năng giảng dạy, tuỳ chọn ghi khối (không ghi lớp).
- **Biệt danh ẩn danh**: mỗi trình duyệt tự nhận một biệt danh ngẫu nhiên (vd: “Cáo Lém Lỉnh 427”) hiển thị trên các đánh giá; bấm vào biệt danh ở góc trên để đổi (2–24 ký tự, không trùng người khác).
- **Bình chọn** “Hữu ích / Không hữu ích”, **báo cáo** đánh giá vi phạm.
- **Kiểm duyệt**:
  - Không lọc từ ngữ; chỉ tự động chặn số điện thoại, email và đường link (tránh lộ thông tin cá nhân, spam).
  - Đánh giá bị **3 người** báo cáo sẽ tự động ẩn.
  - Trang quản trị (`/#/quan-tri`) để duyệt, ẩn, hiện lại hoặc xoá.
  - Tuỳ chọn bắt buộc duyệt trước khi hiển thị.
- Giao diện tiếng Việt, hỗ trợ điện thoại và chế độ tối.

## Ẩn danh hoạt động thế nào?

- Không có đăng ký/đăng nhập, không hỏi tên, email, lớp.
- **Không lưu địa chỉ IP** (IP chỉ dùng tạm trong bộ nhớ để chống spam, không ghi xuống đĩa).
- Mỗi trình duyệt nhận một mã ngẫu nhiên trong cookie; máy chủ chỉ lưu **bản băm HMAC** của mã đó. Mã này dùng để: chặn đánh giá trùng một giáo viên, cho phép người viết xoá đánh giá của mình, và ghi nhận bình chọn.
- Hạn chế: người cố tình có thể xoá cookie / dùng trình duyệt khác để đánh giá nhiều lần. Nếu cần chặt chẽ hơn, hãy bật `REQUIRE_APPROVAL=1` để duyệt tay.

## Chạy thử trên máy

Cần **Node.js 22.13 trở lên** (dùng SQLite có sẵn trong Node, không cần `npm install`).

```bash
ADMIN_PASSWORD=mat-khau-cua-ban npm start
```

Mở http://localhost:3000. Dữ liệu được lưu trong `data/reviews.db`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng máy chủ |
| `ADMIN_PASSWORD` | *(trống)* | Mật khẩu trang quản trị. Để trống = tắt quản trị |
| `REQUIRE_APPROVAL` | `0` | `1` = đánh giá mới phải được duyệt mới hiển thị |
| `AUTO_HIDE_REPORTS` | `3` | Số báo cáo để tự động ẩn một đánh giá |
| `DATA_DIR` | `./data` | Thư mục chứa CSDL và khoá bí mật |
| `APP_SECRET` | *(tự sinh)* | Khoá để băm mã thiết bị. Nếu không đặt, tự sinh và lưu ở `DATA_DIR/secret.key` |
| `TRUST_PROXY` | `0` | `1` khi chạy sau reverse proxy / nền tảng hosting (để đọc IP & HTTPS đúng) |

## Đưa lên mạng (công khai cho mọi người)

Ứng dụng là **một tiến trình Node + một tệp SQLite**, nên cần nơi chạy có **ổ đĩa bền vững** để không mất dữ liệu. Không dùng Vercel / Netlify / GitHub Pages (không chạy được máy chủ lâu dài hoặc không giữ được tệp CSDL).

### Cách dễ nhất: Railway

1. **Đưa mã lên GitHub**: tạo một repository (nên để *Private*), rồi tải toàn bộ thư mục này lên.
2. Vào **railway.com** → đăng nhập bằng GitHub → **New Project** → **Deploy from GitHub repo** → chọn repo vừa tạo. Railway tự nhận `Dockerfile` và build.
3. Trong service vừa tạo → **Volumes** (hoặc chuột phải → *Attach volume*) → mount path: **`/data`**. Đây là nơi lưu CSDL – thiếu bước này dữ liệu sẽ mất mỗi lần cập nhật.
4. Tab **Variables**, thêm:
   - `ADMIN_PASSWORD` = một mật khẩu dài, khó đoán
   - `TRUST_PROXY` = `1`
   - (khuyên dùng lúc mới ra mắt) `REQUIRE_APPROVAL` = `1`
5. Tab **Settings → Networking → Generate Domain** để có địa chỉ dạng `ten-gi-do.up.railway.app`. Có thể gắn tên miền riêng (mua ở Namecheap, Cloudflare, Mắt Bão…) ở cùng chỗ.
6. Mở địa chỉ đó, vào `/#/quan-tri` đăng nhập thử. Xong!

Railway tính phí theo mức dùng (gói Hobby, thường vài USD/tháng cho trang nhỏ) – xem bảng giá hiện tại trên trang của họ.

**Cập nhật trang**: sửa mã → đẩy lên GitHub → Railway tự build lại; dữ liệu trong `/data` được giữ nguyên.

**Sao lưu**: định kỳ tải tệp `/data/reviews.db` về (Railway có chức năng backup cho volume).

### Cách khác

- **Render**: Web Service từ repo (Docker) + *Persistent Disk* mount ở `/data` (cần gói trả phí, gói miễn phí không có ổ đĩa).
- **Fly.io**: `fly launch` (dùng Dockerfile) + `fly volumes create data` mount ở `/data`.
- **VPS** (Vultr, DigitalOcean, Vietnix…): cài Node 22, chạy `npm start` bằng `pm2`/`systemd`, đặt Caddy hoặc Nginx phía trước để có HTTPS.

```bash
docker build -t amsreview .
docker run -d -p 3000:3000 -v amsreview-data:/data -e ADMIN_PASSWORD=mat-khau -e TRUST_PROXY=1 amsreview
```

### Về ẩn danh khi đã lên mạng

- Máy chủ AmsReview **không lưu IP**, tên hay email. Nhưng nhà cung cấp hosting (Railway, Cloudflare…) có thể ghi nhật ký truy cập ở tầng của họ.
- Mọi đánh giá từ cùng một trình duyệt mang cùng một biệt danh, nên người đọc biết chúng do cùng một người viết (dù không biết là ai). Ai muốn tách hẳn có thể đổi biệt danh hoặc dùng trình duyệt khác.

## Cập nhật danh sách giáo viên

Khi nhà trường có thời khoá biểu mới:

```bash
npm run update-teachers
```

Rồi khởi động lại máy chủ. Đánh giá được gắn với **mã giáo viên** trong TKB (ví dụ `T1`, `N4`); script sẽ dừng lại và cảnh báo nếu một mã cũ nay thuộc về người khác, để tránh gán nhầm đánh giá.

## Cấu trúc

```
server.js               Máy chủ HTTP + API + SQLite (không phụ thuộc thư viện ngoài)
public/index.html       Khung trang
public/app.js           Giao diện (JS thuần, định tuyến bằng #hash)
public/styles.css       Giao diện, sáng/tối
data/teachers.json      Danh sách giáo viên
scripts/update-teachers.js
```

## Lưu ý trước khi công khai

Đây là trang đánh giá **những người thật, có tên thật**. Trước khi chia sẻ rộng rãi, nên:

1. Có ít nhất 2–3 người kiểm duyệt thường xuyên vào trang quản trị.
2. Cân nhắc bật `REQUIRE_APPROVAL=1` trong giai đoạn đầu.
3. Cân nhắc trao đổi với nhà trường / Đoàn trường – một trang được nhà trường biết đến sẽ bền vững và được thầy cô đón nhận tốt hơn.
