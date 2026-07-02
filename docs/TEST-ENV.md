# Môi trường TEST dùng chung

Trước khi tự dựng server riêng, bạn có thể test ngay trên server **đang chạy thật** của chủ dự án —
không cần cài đặt gì. Server này có agent + máy in thật đang kết nối, nên hãy dùng cẩn thận (xem lưu ý
bên dưới).

## Thông tin server

- **URL:** `http://160.250.133.192:3000`
- **Đây KHÔNG phải server production của bạn** — đây là server thật của chủ dự án (repo owner), dùng
  chung để bạn test nhanh trước khi tự host. Có branch/agent/máy in **thật** đang kết nối vào server này.

> ⚠️ **Dùng cẩn thận:**
> - **Đừng spam job in** — mỗi job gửi lên có thể in ra giấy thật ở một chi nhánh thật. Chỉ gửi job
>   test khi cần thiết, và ưu tiên chọn branch/printer được đánh dấu rõ là "test" (hỏi chủ dự án nếu
>   không chắc).
> - Đừng thay đổi cấu hình branch/printer của người khác (rename, xoá, đổi approved...).
> - Server có thể được chủ dự án restart/maintain bất cứ lúc nào — không phụ thuộc vào uptime của nó.

## Lấy client_id / client_secret

Bạn cần một cặp `client_id` + `client_secret` để gọi API (giống như một HQ/ERP client thật). Cặp này
**không tự đăng ký được** — liên hệ chủ dự án (repo owner) để xin, họ sẽ mint bằng:

```bash
OUTPUT_FILE=install.json node server/scripts/gen-client.js "Tên client test của bạn"
```

Bạn sẽ nhận lại `client_id` + `client_secret` (và có thể cả `install.json` nếu bạn cũng cần test agent
Windows tự đăng ký chi nhánh — xem `docs/DEV-ONBOARDING.md` bước 3).

## Luồng test khuyến nghị

1. **Login lấy JWT:**
   ```bash
   curl -s -X POST http://160.250.133.192:3000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"client_id":"<client_id>","client_secret":"<client_secret>"}'
   # → { "token": "<jwt>", "token_type": "Bearer", "expires_in": "7d" }
   ```

2. **Liệt kê chi nhánh + máy in đang online** (để biết nơi nào an toàn để gửi job test):
   ```bash
   curl -s "http://160.250.133.192:3000/api/branches?status=online" \
     -H "Authorization: Bearer <jwt>"

   curl -s "http://160.250.133.192:3000/api/printers?status=online&approved=1" \
     -H "Authorization: Bearer <jwt>"
   ```
   Chỉ gửi job tới `branch_id`/máy in đã được xác nhận là "test" với chủ dự án.

3. **Gửi 1 job in** (multipart, kèm `metadata.user_id` bắt buộc):
   ```bash
   curl -s -X POST http://160.250.133.192:3000/api/print-jobs \
     -H "Authorization: Bearer <jwt>" \
     -F branch_id=<branch_id> \
     -F 'metadata={"user_id":"test-dev"}' \
     -F pdf=@your-test-file.pdf
   # → 201 { "job_id": "...", "status": "queued" }
   ```

4. **Theo dõi kết quả** — poll trạng thái job, hoặc đăng ký webhook để nhận callback thay vì poll:
   ```bash
   curl -s http://160.250.133.192:3000/api/print-jobs/<job_id> \
     -H "Authorization: Bearer <jwt>"
   ```
   Chi tiết webhook + toàn bộ API xem `docs/API.md`.

## Đây không phải production của bạn

Môi trường này chỉ để bạn làm quen nhanh với API. Khi sẵn sàng triển khai thật (server riêng, chi
nhánh riêng, agent riêng), làm theo:

- `server/HANDOVER.md` — tự deploy server (VPS + PostgreSQL + MQTT broker + HTTPS)
- `README.md` — tổng quan quick start
- `docs/DEV-ONBOARDING.md` — lộ trình đầy đủ từ test tới self-host tới tích hợp ERP
