# Onboarding cho Dev — từ test tới production

Tài liệu này là điểm bắt đầu duy nhất khi bạn mới nhận repo này. Đi theo đúng thứ tự 5 bước dưới đây.

---

## Bước 1 — Test ngay trên server có sẵn (không cần cài gì)

Chủ dự án (repo owner) đang giữ 1 server thật đang chạy, có agent + máy in thật kết nối, để bạn dùng
thử API trước khi tự dựng gì cả. Chi tiết đầy đủ: **[docs/TEST-ENV.md](TEST-ENV.md)**.

Tóm tắt luồng:

1. Xin `client_id` + `client_secret` từ chủ dự án (họ mint bằng `server/scripts/gen-client.js`).
2. `POST /api/auth/login` → nhận JWT.
3. Liệt kê trạm/máy in đang sẵn sàng để chọn nơi in:
   - `GET /api/branches?status=online`
   - `GET /api/printers?status=online&approved=1` (không cần `branch_id` — trả máy in mọi trạm kèm
     `branch_id`/`branch_name`, đủ để dựng picker "chọn cửa hàng → chọn máy in" trong 1 request)
4. `POST /api/print-jobs` (multipart: file `pdf` + `branch_id` + `metadata.user_id` bắt buộc) để gửi
   job in thử — **cẩn thận, job có thể in ra giấy thật**, xem lưu ý trong TEST-ENV.md.
5. Theo dõi kết quả: poll `GET /api/print-jobs/:id`, hoặc đăng ký webhook để nhận callback.

Xem thêm chi tiết API: [docs/API.md](API.md) §9 (Hướng dẫn tích hợp ERP).

---

## Bước 2 — Tự dựng server riêng

Khi đã quen API, dựng server production của riêng bạn theo **[server/HANDOVER.md](../server/HANDOVER.md)**
(và `README.md` cho quick start local). Tóm tắt hạ tầng cần có:

- 1 VPS (Ubuntu khuyến nghị) — RAM 512MB+ là đủ cho quy mô nhỏ.
- **PostgreSQL** — database chính.
- **MQTT broker** (Mosquitto) — kênh real-time server ↔ agent, TLS bắt buộc.
- File `.env` (copy từ `server/.env.example`, điền `JWT_SECRET`, `AGENT_TOKEN_SECRET`, `MQTT_PASS`,
  `DATABASE_URL`...).
- (Tuỳ chọn) HTTPS cho API nếu agent kết nối qua internet công cộng — xem `server/HANDOVER.md` §10.4
  hoặc dùng cert self-signed đơn giản hơn (mặc định, xem `agent/CA_INSTALL.md`).

### ⚠️ Bước bắt buộc đầu tiên — tạo client đầu tiên qua CLI

Server mới dựng **chưa có client nào**, và endpoint tạo client qua API (`POST /api/v2/clients`) lại
**cần JWT của một client đã tồn tại** để gọi — con gà quả trứng. Vì vậy, **CLI là cách bootstrap duy
nhất** cho client đầu tiên:

```bash
cd server
SERVER_PUBLIC_URL=https://your-server.example.com \
  OUTPUT_FILE=install.json node scripts/gen-client.js "<tên client>"
```

Lệnh này in ra `client_id` + `client_secret` **một lần duy nhất** (lưu ngay vào secret manager), và
với `OUTPUT_FILE` sẽ ghi thêm file `install.json` — dùng để tự động đăng ký chi nhánh (xem Bước 3).
Từ client đầu tiên này, các client sau có thể tạo qua API (`POST /api/v2/clients`, cần JWT của client
đã có quyền) nếu bạn muốn tự động hoá thêm.

---

## Bước 3 — Cài agent tại cửa hàng

Mỗi chi nhánh/cửa hàng cần 1 máy Windows chạy Print Agent, kết nối tới server của bạn.

1. Từ server, gửi cho chi nhánh: thư mục `agent/` (source code) + file `install.json` (sinh ở Bước 2)
   + `root_ca.crt` (CA cert của server — xem `agent/CA_INSTALL.md` để lấy).
2. Tại máy Windows chi nhánh, chạy (installer tự xin quyền UAC):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json
   ```
3. Installer tự động: cài Node.js/SumatraPDF/NSSM nếu thiếu → chạy
   `node agent.js --register install.json` (agent **tự đăng ký** chi nhánh qua
   `POST /api/setup/register-branch`, nhận `branch_id` + `agent_token`) → cài Windows Service
   `PrintAgent-<branch_id>` → chạy smoke test.
4. Máy in vật lý ở chi nhánh được agent **tự động phát hiện** (auto-discovery) và xuất hiện trên web
   admin ở trạng thái **chờ duyệt** (`approved: 0`) — HQ phải duyệt (`approved: 1`) trước khi máy in đó
   nhận job.

Chi tiết đầy đủ + troubleshooting: **[agent/docs/README.md](../agent/docs/README.md)** và runbook E2E
từng bước: **[agent/docs/E2E-WINDOWS.md](../agent/docs/E2E-WINDOWS.md)**.

---

## Bước 4 — Tích hợp ERP

Toàn bộ luồng gửi lệnh in từ ERP đi qua REST API, không cần dùng web UI. Spec đầy đủ:
**[docs/API.md](API.md) §9 — Hướng dẫn tích hợp ERP**.

### Trạng thái máy in mà server theo dõi

`online | out_of_paper | paper_jam | low_toner | no_toner | offline | unknown` — trong đó
`low_toner`/`no_toner` là **mới** (agent map từ WMI `Win32_Printer.DetectedErrorState`, mã 5/6).

**Lưu ý quan trọng:** phát hiện mực/giấy phụ thuộc vào driver Windows báo cáo **best-effort** — nhiều
máy in tiêu dùng (đặc biệt máy in phun giá rẻ) không bao giờ báo `DetectedErrorState` chính xác, chỉ
trả "No Error" dù thực tế đã hết mực/giấy. Đừng thiết kế logic nghiệp vụ phụ thuộc hoàn toàn vào các
trạng thái này — coi là tín hiệu tham khảo, không phải nguồn sự thật tuyệt đối. SNMP polling (đọc trực
tiếp từ máy in qua mạng, chính xác hơn WMI) đang nằm trong roadmap, xem `ROADMAP.md`.

---

## Bước 5 — Trang admin web (`web/`)

React + Vite, dùng để HQ quản lý trạm/máy in/client/cảnh báo (KHÔNG dùng để gửi job in — xem Bước 4).

```bash
cd web
npm install
npm run dev   # cần biến VITE_API_BASE_URL trỏ tới server của bạn
```

Xem [web/README.md](../web/README.md) để biết chi tiết cấu hình.

---

## Tài liệu tham khảo nhanh

| Việc cần làm | Đọc gì |
|---|---|
| Test nhanh API trên server có sẵn | [docs/TEST-ENV.md](TEST-ENV.md) |
| Tự dựng server production | [server/HANDOVER.md](../server/HANDOVER.md) |
| Cài agent Windows tại chi nhánh | [agent/docs/README.md](../agent/docs/README.md), [agent/docs/E2E-WINDOWS.md](../agent/docs/E2E-WINDOWS.md) |
| API reference đầy đủ + tích hợp ERP | [docs/API.md](API.md) |
| Kiến trúc tổng thể | [docs/ARCHITECTURE.md](ARCHITECTURE.md) |
| Roadmap | [ROADMAP.md](../ROADMAP.md) |
