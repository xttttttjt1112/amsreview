# AmsReview – ghi chú cho Claude

## Triển khai (quan trọng)

- Trang thật chạy trên **Railway**, tự động deploy mỗi khi nhánh `main` trên GitHub (`xttttttjt1112/amsreview`) thay đổi.
- **Sau mỗi thay đổi đã kiểm tra xong: commit và push thẳng lên `main`** để trang Railway được cập nhật. Không cần hỏi lại, không tạo nhánh hay pull request riêng, trừ khi người dùng yêu cầu.
- Trước khi push: `node --check server.js && node --check public/app.js`, và chạy thử `PORT=3000 DATA_DIR=/tmp/amsr-test node server.js` nếu thay đổi chạm tới máy chủ.
- Không commit `data/reviews.db*` hay `data/secret.key` (đã có trong `.gitignore`).
- Dữ liệu đánh giá nằm trên volume Railway mount ở `/data`. Thay đổi cấu trúc bảng `reviews` cần tính đến dữ liệu đã có (máy chủ sẽ dừng nếu gặp CSDL cấu trúc cũ – xem đầu `server.js`).

## Cấu trúc

- `server.js` – máy chủ HTTP + API + SQLite (`node:sqlite`, Node ≥ 22.13, không có thư viện ngoài).
- `public/` – giao diện JS thuần, định tuyến bằng `#/…`; toàn bộ chữ trên trang bằng tiếng Việt.
- `data/teachers.json` – danh sách giáo viên (cập nhật bằng `npm run update-teachers`).
- `data/roles.json` – Ban Giám hiệu: Hiệu trưởng chỉ nhận nhận xét tự do (sao Thái độ tuỳ chọn, không chấm giảng dạy).

## Quy ước sản phẩm

- Đánh giá: nhận xét viết là chính; chỉ 2 tiêu chí sao – Thái độ và Khả năng giảng dạy.
- Không lọc từ ngữ; chỉ chặn số điện thoại, email, link.
- Mỗi trình duyệt có một biệt danh ngẫu nhiên, đổi được.
- Tên người: làm nổi bật tên gọi (chữ cuối) bằng `personName()`.
