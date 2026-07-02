# Print System — REST API Reference & ERP Integration Guide

Tài liệu tham chiếu API và hướng dẫn tích hợp cho **ERP developer** cần gửi lệnh in (PDF) vào hệ thống print-system.

> **TL;DR cho ERP:** Bạn gửi PDF in **HOÀN TOÀN qua API**, **KHÔNG cần web UI**. Web UI chỉ dùng cho HQ quản trị trạm/máy in/client/cảnh báo. Xem [Hướng dẫn tích hợp ERP](#9-huong-dan-tich-hop-erp).

---

## Mục lục

- [1. Tổng quan & Routing](#1-tong-quan--routing)
- [2. Xác thực (Authentication)](#2-xac-thuc-authentication)
- [3. Quy ước chung (Conventions)](#3-quy-uoc-chung-conventions)
- [4. Auth API](#4-auth-api)
- [5. Resource: Branches (trạm)](#5-resource-branches-tram)
- [6. Resource: Clients](#6-resource-clients)
- [7. Resource: Printers (máy in)](#7-resource-printers-may-in)
- [8. Resource: Print Jobs (lệnh in)](#8-resource-print-jobs-lenh-in)
- [9. Hướng dẫn tích hợp ERP](#9-huong-dan-tich-hop-erp)
- [10. Resource: Webhooks](#10-resource-webhooks)
- [11. Resource: Alerts (cảnh báo)](#11-resource-alerts-canh-bao)
- [12. Resource: Audit Log](#12-resource-audit-log)
- [13. Resource: Admin](#13-resource-admin)
- [14. Config / Health / Setup](#14-config--health--setup)
- [15. Cross-cutting: Rate limit, Ownership, Lifecycle](#15-cross-cutting-rate-limit-ownership-lifecycle)

---

## 1. Tổng quan & Routing

Tham chiếu: `src/app.js:46-52`.

| Mount | Mô tả |
|-------|-------|
| `/health` | Health check (KHÔNG có prefix `/api`). |
| `/api/v1` | API version 1. |
| `/api/v2` | API version 2 (feature mới). |
| `/api` | **Alias** trỏ về v1 (back-compat client cũ). |

**Hệ quả quan trọng:** mọi route v1 truy cập được ở **CẢ HAI** đường dẫn:
`/api/<route>` **và** `/api/v1/<route>`. Trong tài liệu này, các route v1 ghi dưới dạng `/api/...` cho gọn — bạn có thể thay bằng `/api/v1/...` tương đương.

Các route v2 **chỉ** truy cập ở `/api/v2/...`.

**Sub-mount:**

- **v1** (`v1.js`): `/auth`, `/print-jobs`, `/branches`, `/printers`, `/admin`, `/setup`, `/config`
- **v2** (`v2.js`): `/print-jobs`, `/audit-log`, `/alerts`, `/webhooks`, `/clients`

**Body & lỗi toàn cục:**

- JSON body cap toàn cục: **1KB** (`express.json({ limit: '1kb' })`). Endpoint upload PDF dùng `multipart/form-data` nên **không bị** giới hạn này (đi qua multer).
- 404 → `{ "error": "Not found", "path": "<path>" }`
- Lỗi không bắt được → error handler trả `{ "error": "<message>" }`

---

## 2. Xác thực (Authentication)

Tham chiếu: `src/middleware/auth.js`.

Hệ thống có **3 cấp** truy cập:

### 2.1 `verifyClient` — JWT của Client (dùng cho ERP)

- Header: `Authorization: Bearer <JWT>`
- Lấy JWT qua [`POST /api/auth/login`](#post-apiauthlogin).
- JWT payload: `{ sub: <client.id>, name, type: 'client' }`, ký **HS256** bằng env `JWT_SECRET`, hết hạn theo env `JWT_EXPIRES_IN` (mặc định `'7d'`).
- Set `req.client = { id, name }`.
- Lỗi: `401 Missing Authorization header` / `401 Invalid or expired token`.

> **Đây là cơ chế ERP dùng.**

### 2.2 `verifyAgent` — Token của Windows print agent (KHÔNG dùng cho ERP)

- Headers: `X-Agent-Token: <token>` + `X-Branch-Id: <branch_id>`
- So khớp SHA-256 timing-safe với `branches.agent_token_hash`.
- Lỗi: `401 Missing X-Agent-Token` / `401 Missing X-Branch-Id` / `401 Invalid branch` / `401 Invalid agent token`.

> **Chỉ dành cho Windows print agent** (thiết bị tại trạm). ERP **KHÔNG** dùng cơ chế này.

### 2.3 `public` — không middleware

Một số endpoint công khai (login, health, config, setup register-branch). Một số được bảo vệ thêm bằng rate limit hoặc credential trong body.

---

## 3. Quy ước chung (Conventions)

- **Content-Type:** JSON cho hầu hết endpoint; **`multipart/form-data`** cho upload PDF.
- **Định dạng lỗi:** `{ "error": "<message>" }`. Lỗi validation job có thêm `details: [...]`.
- **Thời gian:** các tham số `from`/`to` ở các endpoint list dùng **ms epoch** (millisecond).
- **Secret/token hiển thị một lần:** `agent_token`, client `secret`, webhook `secret` chỉ trả về **đúng một lần** lúc tạo/rotate — không thể đọc lại.
- **Host trong ví dụ:** dùng placeholder `http://localhost:3000`.

---

## 4. Auth API

Tham chiếu: `src/api/auth.js`.

### POST /api/auth/login

- **Auth:** public + `loginLimiter` (cửa sổ 60s, mặc định **5 req/phút/IP** → `429 Too many login attempts, try again later`).
- **Body (JSON):** `{ "client_id": "...", "client_secret": "..." }` — cả hai bắt buộc.
- **Lỗi:**
  - `400 client_id and client_secret are required`
  - `401 Invalid credentials`
- **200:**
  ```json
  {
    "token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": "7d"
  }
  ```

> ⚠️ **Lưu ý:** `expires_in` là **CHUỖI** `"7d"` (giá trị env `JWT_EXPIRES_IN`), **KHÔNG phải số giây**. Đừng parse thành integer.

### GET /api/auth/me

- **Auth:** `verifyClient`.
- **200:** `{ "client": { "id": "...", "name": "..." } }`

---

## 5. Resource: Branches (trạm)

Tham chiếu: `src/api/branches.js`. Tất cả route **`verifyClient`**.

> ## ⚠️ Lưu ý bảo mật — Branches KHÔNG cô lập theo tenant
>
> Các route **READ / PATCH / regen-token / transfer-client** của branch **KHÔNG** giới hạn theo `client_id`. `getBranchById` **không** kiểm tra quyền sở hữu, nên **bất kỳ client đã xác thực nào cũng có thể đọc / sửa / xoay token / chuyển** **BẤT KỲ** branch nào nếu biết `id`.
>
> Điều này **khác** với jobs/webhooks/alerts/audit (vốn được scope theo `client_id`). **Đừng** coi branches là cô lập đa-tenant khi thiết kế tích hợp.

### GET /api/branches

- **Query:** `status`? — lọc theo trạng thái trạm, chỉ nhận `online` hoặc `offline`. Bỏ trống = trả tất cả.
- **Lỗi:** `400 status phải là 'online' hoặc 'offline'` (giá trị `status` không hợp lệ).
- **200:** `{ "branches": [ { "id", "name", "location", "status", "last_seen_at", "created_at" } ] }` (đã loại bỏ token hash).

### POST /api/branches

- **Body:** `{ "id"?, "name" (bắt buộc, 1-100), "location"? }`. `id` mặc định `br_<6 số cuối của Date.now()>`.
- **Lỗi:** `400` validation; `409 Branch '<id>' already exists`.
- **201:** `{ "id", "name", "location", "agent_token" }` — `agent_token` là **plaintext, hiển thị một lần**.

### GET /api/branches/:id

- **Lỗi:** `404 Branch not found`.
- **200:** đầy đủ branch (loại `agent_token_hash`).

### POST /api/branches/:id/regen-token

- **Lỗi:** `404`.
- **200:** `{ "id", "name", "agent_token", "warning" }` — token plaintext mới (token cũ bị vô hiệu).

### PATCH /api/branches/:id

- **Body:** `{ "name"? (1-100), "location"? }`.
- **Lỗi:** `404`; `400 Cần ít nhất name hoặc location`; `409` (trùng name).
- **200:** `{ "id", "name", "location" }`.

### POST /api/branches/:id/transfer-client

Chuyển branch sang client khác.

- **Body:** `{ "target_client_id" (bắt buộc) }`.
- **Lỗi:** `404 Branch not found` / `404 Client đích không tồn tại`; `400 Trạm đã thuộc client này` / `400 Client đích không hoạt động`; `409`.
- **200:** `{ "id", "name", "client_id" }`.

---

## 6. Resource: Clients

Tham chiếu: `src/api/clients.js`. **`verifyClient`**, mount tại **`/api/v2`**.

### GET /api/v2/clients

- **200:** `{ "clients": [ { "id", "name", "is_active", "created_at", "branch_count" } ] }`.

### POST /api/v2/clients

- **Body:** `{ "name" (bắt buộc, 1-100), "id"? }`. `id` mặc định `cli_<16 hex>`, phải khớp regex `^[a-z0-9][a-z0-9_-]{1,63}$`.
- **Lỗi:** `400 INVALID_CLIENT_ID`; `409 CLIENT_ID_EXISTS` / trùng name.
- **201:** `{ "id", "name", "secret", "is_active" }` — `secret` plaintext **hiển thị một lần**.

### PATCH /api/v2/clients/:id

- **Body:** `{ "is_active": 0 | 1 }`.
- **Lỗi:** `400 is_active phải là 0 hoặc 1`; `400` (chặn tự vô hiệu hóa chính mình); `404`.
- **200:** `{ "id", "is_active" }`.

### POST /api/v2/clients/:id/rotate-secret

- **Lỗi:** `404`.
- **200:** `{ "id", "secret" }` — secret plaintext mới.

---

## 7. Resource: Printers (máy in)

Tham chiếu: `src/api/printers.js`.

### GET /api/printers

- **Auth:** `verifyClient`.
- **Query (tất cả tùy chọn, kết hợp được với nhau):**
  - `branch_id`? — có: liệt kê máy in của trạm đó (hành vi cũ, giữ nguyên); **bỏ trống: liệt kê máy in của TẤT CẢ trạm**, mỗi máy in kèm thêm `branch_id`, `branch_name` và `branch_status` (trạng thái của trạm).
  - `status`? — lọc theo trạng thái máy in (`online | out_of_paper | paper_jam | low_toner | no_toner | offline | unknown`).
  - `approved`? — lọc theo cờ duyệt, chỉ nhận `0` hoặc `1`.
- **Lỗi:** `404 Branch '<id>' not found` (khi có `branch_id`); `400 Invalid status: <value>`; `400 approved must be 0 or 1`.
- **200:** `{ "printers": [ ... ] }` — shape không đổi; các field `branch_name`/`branch_status` chỉ xuất hiện khi gọi **không** kèm `branch_id` (additive).

### POST /api/printers

- **Auth:** `verifyClient`.
- **Body:** `{ "id"?, "branch_id" (bắt buộc), "name" (bắt buộc, 1-100), "is_default"? }`. `id` mặc định `prn_<8 hex>`.
- **Lỗi:** `404` (branch); `409` (đã tồn tại).
- **201:** `{ "id", "branch_id", "name", "is_default", "source": "manual", "approved": 1 }`.

### POST /api/printers/heartbeat

- **Auth:** `verifyAgent` (chỉ Windows agent).
- **Body:** `{ "printers": [ { "name", "status" } ] }`. `status` hợp lệ: `online | out_of_paper | paper_jam | low_toner | no_toner | offline | unknown`.
- Trạng thái mực: agent map từ WMI `Win32_Printer.DetectedErrorState` — `5` → `low_toner` (Low Toner), `6` → `no_toner` (No Toner). **Best-effort theo driver**: nhiều driver không báo mã 5/6 (chỉ trả `2`/No Error) nên không phải máy in nào cũng phát hiện được mực.
- Chuyển trạng thái vào `low_toner`/`no_toner` bắn alert edge-triggered `printer.low_toner`/`printer.no_toner` (giống `out_of_paper`/`paper_jam`); quay về `online` bắn `printer.online` (recovery).
- **Lỗi:** `400 printers must be an array`.
- **200:** `{ "ok": true, "updated", "discovered" }`.

### PATCH /api/printers/:id

- **Auth:** `verifyClient`.
- **Body:** `{ "is_default"?, "approved"? }` (kiểu number).
- **Lỗi:** `404`; `400` (lỗi kiểu).
- **200:** row đã cập nhật.

### DELETE /api/printers/:id

- **Auth:** `verifyClient`.
- **Lỗi:** `404`.
- **200:** `{ "ok": true }`.

---

## 8. Resource: Print Jobs (lệnh in)

### 8.1 Jobs v1

Tham chiếu: `src/api/jobs.js`.

#### POST /api/print-jobs  ⭐ (endpoint chính cho ERP)

- **Auth:** `verifyClient` → `clientRateLimit` (mặc định **30 req/phút/client** → `429 Too many requests, slow down`) → `multer pdfUpload`.
- **Content-Type:** `multipart/form-data`.
- **Fields:**

| Field | Bắt buộc | Mô tả |
|-------|----------|-------|
| `pdf` | có | File đơn, mimetype `application/pdf`, tối đa **50MB** (→ `413 PDF exceeds <n> bytes`). |
| `branch_id` | có | String — trạm đích. |
| `printer` | không | String — bỏ trống = dùng máy in mặc định của Windows tại trạm. |
| `metadata` | có (về thực chất) | JSON string, **phải chứa `user_id` không rỗng** → nếu thiếu: `400 metadata.user_id is required`. |

- **Kiểm tra PDF magic-byte:** 5 byte đầu phải là `%PDF-`, nếu không: `400 Invalid PDF: missing %PDF- magic bytes`; file < 8 byte: `400 PDF too small (< 8 bytes)`.
- **Thiếu file:** `400 File field 'pdf' is required`.
- **Lỗi validation gộp:** `400 { "error": "Validation failed", "details": [ ... ] }`.
- **Branch không tồn tại:** `404 Branch '<id>' not found`.
- **201:** `{ "job_id": "...", "status": "queued" }`

> **Lưu ý trạng thái:** DB lưu status là `pending`, nhưng API gắn nhãn `queued` trong response này. Hai từ chỉ cùng một trạng thái khởi tạo.

#### GET /api/print-jobs?branch_id=

- **Auth:** `verifyAgent` (dùng khi agent reconnect — liệt kê job status `pending`, `sent`).
- **Lỗi:** `400` (thiếu `branch_id`); `403 Branch mismatch`.
- **200:** `{ "jobs": [ ... ] }`.

#### GET /api/print-jobs/:id

- **Auth:** `verifyClient`.
- **Lỗi:** `404 Job not found`.
- **200:** full job row:
  ```json
  {
    "id", "branch_id", "printer", "file_path", "status",
    "metadata", "error", "created_at", "sent_at", "printed_at",
    "failed_at", "retry_count", "client_id"
  }
  ```
  Vòng đời status: `pending → sent → printed | failed`. Cột `error` được điền khi thất bại.

#### POST /api/print-jobs/:id/status

- **Auth:** `verifyAgent` (callback của agent).
- **Body:** `{ "status": "printed" | "failed", "error"? }`.
- **Lỗi:** `400 status must be 'printed' or 'failed'`; `404`; `403 Branch mismatch`.
- Khi `failed` lưu `error` (mặc định `'unknown'`). Kích hoạt **outbound ERP webhook**.
- **200:** `{ "ok": true }`.

#### GET /api/print-jobs/:id/file

- **Auth:** `verifyAgent`.
- Stream `application/pdf`.
- **Lỗi:** `404`; `403`; `410 Job status is '<status>', file no longer available` (nếu không còn `pending`/`sent`); `404 PDF file missing`.

### 8.2 Jobs v2

Tham chiếu: `src/api/jobs-v2.js`. **`verifyClient`**, mount tại **`/api/v2`**.

#### GET /api/v2/print-jobs

- **Query:** `branch_id`, `status`, `from`, `to` (ms epoch), `limit` (mặc định 50, khoảng 1-200), `offset` (≥ 0).
- **Lỗi:** `400 from/to phải là số (ms epoch)`.
- **Scope:** theo `client_id` (cô lập tenant).
- **200:** `{ "jobs": [...], "total", "limit", "offset" }`.

#### POST /api/v2/print-jobs/bulk

- **Auth:** `verifyClient` → `clientRateLimit` → `multer pdfUploadBulk` → `bulkRateLimit` (tính theo **tổng số file**; vượt: `429 Vượt hạn mức tạo job (bulk), thử lại sau`).
- **Content-Type:** `multipart/form-data`.
- **Fields:**
  - Nhiều file `pdf` (tối đa **20** → `413 Too many files (max 20)`, mỗi file ≤ 50MB).
  - `items` = chuỗi JSON **array**; `items[i]` khớp `files[i]` theo **chỉ số (index)**. Mỗi phần tử: `{ "branch_id", "printer"?, "metadata": { "user_id" } }`.
- **Lỗi:** `400 Cần ít nhất 1 file field pdf` / `400 Field items phải là JSON array` / `400` (lệch số lượng file vs items).
- **201** nếu tất cả OK, **207** nếu có phần tử lỗi:
  ```json
  {
    "created": [ { "index", "branch_id", "job_id" } ],
    "failed":  [ { "index", "branch_id", "error" } ]
  }
  ```

#### POST /api/v2/print-jobs/:id/retry

- **Auth:** `verifyClient` → `clientRateLimit`.
- Chỉ retry được job `failed`.
- **Lỗi:** `404` (cũng trả `404` khi không phải chủ sở hữu — cô lập tenant ẩn sự tồn tại); `409 Chỉ retry được job 'failed'...`; `410 PDF file đã bị cleanup...`.
- **200:** `{ "ok": true, "job_id", "status": "sent" }`.

---

## 9. Hướng dẫn tích hợp ERP

> ## ✅ Trả lời thẳng: Gửi PDF in HOÀN TOÀN qua API, KHÔNG cần web UI
>
> Web UI **chỉ** để HQ quản trị trạm / máy in / client / cảnh báo. Toàn bộ luồng ERP gửi lệnh in được thực hiện qua REST API dưới đây.

### Bước 0 — Lấy danh sách cửa hàng / máy in đang online để chọn nơi in

Trước khi submit job, ERP nên cho người dùng chọn **trạm** (cửa hàng) và **máy in** đang sẵn sàng. Hai endpoint dưới đây (cần Bearer token — xem Bước 2) hỗ trợ lọc trực tiếp:

```bash
# Danh sách cửa hàng đang online
curl -s "http://localhost:3000/api/branches?status=online" \
  -H "Authorization: Bearer <JWT>"
# → {"branches":[{"id":"<BRANCH_ID>","name":"Cửa hàng Q1","status":"online",...}]}

# Danh sách máy in đang online + đã duyệt, trên TẤT CẢ trạm (không cần branch_id)
curl -s "http://localhost:3000/api/printers?status=online&approved=1" \
  -H "Authorization: Bearer <JWT>"
# → {"printers":[{"id":"prn_…","name":"HP-LJ","status":"online","approved":1,
#                 "branch_id":"<BRANCH_ID>","branch_name":"Cửa hàng Q1","branch_status":"online",...}]}
```

- Gọi `GET /api/printers` **không kèm** `branch_id` để lấy máy in mọi trạm, mỗi máy kèm `branch_id`/`branch_name`/`branch_status` — đủ dữ liệu dựng picker "chọn cửa hàng → chọn máy in" trong 1 request.
- Lọc thêm theo trạm cụ thể: thêm `&branch_id=<BRANCH_ID>` (kết hợp được với `status`/`approved`).
- `approved=1` loại các máy in auto-discovery chưa được HQ duyệt.

### Bước 1 — Lấy credential (client_id + client_secret)

- HQ cấp `client_id` + `client_secret` qua script `server/scripts/gen-client.js`.
  - `client_id` dạng `cli_<16 hex>`.
  - `secret` = `randomBytes(32)` mã hóa **base64url**, lưu dưới dạng **bcrypt (cost 10)** trong DB.
  - Secret **hiển thị duy nhất một lần** lúc tạo — lưu an toàn ngay.
- **Phân biệt rõ với `agent_token`:** `agent_token` là credential **per-branch của thiết bị** (header `X-Agent-Token`), thuộc về **Windows print agent**, **KHÔNG** dùng cho ERP.

### Bước 2 — Đăng nhập lấy Bearer token

```
POST /api/auth/login
Body: { "client_id": "...", "client_secret": "..." }
→ 200 { "token": "<JWT>", "token_type": "Bearer", "expires_in": "7d" }
```

Tái sử dụng Bearer token cho mọi request tiếp theo. Khi nhận `401` (token hết hạn/không hợp lệ) thì login lại. Nhớ: `expires_in` là chuỗi `"7d"`, không phải số giây.

### Bước 3 — Gửi lệnh in (submit job)

```
POST /api/print-jobs   (multipart/form-data)
Authorization: Bearer <JWT>
  pdf       = <file PDF ≤ 50MB, đúng magic bytes %PDF->
  branch_id = <BRANCH_ID>            (bắt buộc)
  printer   = <tên máy in>           (tùy chọn — bỏ trống = máy in mặc định Windows)
  metadata  = {"user_id":"<ai in>"}  (JSON string, bắt buộc có user_id cho audit)
→ 201 { "job_id": "...", "status": "queued" }
```

### Bước 4 — Vòng đời job & tra cứu trạng thái

Vòng đời:

```
queued/pending → sent → printed
                      ↘ failed
```

| Status | Ý nghĩa |
|--------|---------|
| `pending` (API: `queued`) | Job đã nhận, chờ đẩy xuống trạm. |
| `sent` | Đã publish xuống agent qua MQTT thành công. |
| `printed` | Agent báo in xong (cột `error` được clear). |
| `failed` | In lỗi; cột `error` chứa lý do (mặc định `unknown`). |

Tra cứu trạng thái — chọn 1 trong 2:

- **Một job:** `GET /api/print-jobs/:id` (`verifyClient`) → full job row gồm `status`, `error`, `printed_at`, `failed_at`, `retry_count`...
- **Danh sách (lọc + phân trang, scope theo client):** `GET /api/v2/print-jobs?branch_id=&status=&from=&to=&limit=&offset=`.

### Bước 5 — Gửi hàng loạt (bulk)

```
POST /api/v2/print-jobs/bulk   (multipart/form-data)
  pdf   = file #0
  pdf   = file #1            (tối đa 20 file, mỗi file ≤ 50MB)
  items = '[{"branch_id":"<B0>","metadata":{"user_id":"u1"}},
            {"branch_id":"<B1>","printer":"HP-LJ","metadata":{"user_id":"u1"}}]'
→ 201 (tất cả OK) hoặc 207 (một phần lỗi)
  { "created":[{"index","branch_id","job_id"}], "failed":[{"index","branch_id","error"}] }
```

`items[i]` khớp `files[i]` theo chỉ số. Số phần tử `items` phải bằng số file `pdf`.

### Bước 6 — Lỗi thường gặp & cách xử lý

| HTTP | Nguyên nhân | Xử lý |
|------|-------------|-------|
| `401` | Token hết hạn / thiếu Authorization header | Login lại (Bước 2). |
| `400` | Thiếu field / PDF sai magic bytes / `metadata.user_id` thiếu | Kiểm tra payload; xem `details[]`. |
| `404` | `Branch '<id>' not found` / `Job not found` | Xác nhận `branch_id`/`job_id`. |
| `413` | PDF > 50MB (hoặc bulk > 20 file) | Giảm kích thước / chia nhỏ. |
| `429` | Rate limit | Chậm lại. Login 5/phút/IP; ghi job 30/phút/client; bulk theo số file. |

- **Trạm offline:** job **vẫn được nhận** (trạng thái `queued`/`sent`); agent sẽ in khi online trở lại — không cần ERP retry chỉ vì trạm offline.
- **Nhận trạng thái dạng push thay vì poll:** đăng ký **outbound webhook** (`POST /api/v2/webhooks`) để hệ thống gọi về ERP kèm chữ ký **HMAC** mỗi khi job đổi trạng thái. Xem [Webhooks](#10-resource-webhooks).

### Bước 7 — Ví dụ (placeholder — thay số thật khi chạy)

> Các ví dụ dưới đây dùng placeholder: `<CLIENT_ID>`, `<CLIENT_SECRET>`, `<BRANCH_ID>`, `<JWT>`, `<JOB_ID>`. Cú pháp và tên field **đúng 100%** theo spec ở trên.
>
> ✅ **Đã verify chạy thật trên server** (tạo client throwaway → gọi API → dọn sạch). Response thật khớp tài liệu:
> - `POST /api/auth/login` → `{"token":"…","token_type":"Bearer","expires_in":"7d"}`
> - `GET /api/auth/me` → `{"client":{"id":"…","name":"…"}}`
> - Thiếu `metadata.user_id` → `400 {"error":"Validation failed","details":["metadata.user_id is required"]}`
> - `branch_id` không tồn tại → `404 {"error":"Branch '<id>' not found"}`
>
> (Bước submit→in thật xuống trạm chưa chạy ở đây để tránh kích hoạt máy in vật lý trên hệ thống live — nên verify ở môi trường staging/trạm test.)

**curl — login → submit → poll status**

```bash
# 1) Login → lấy Bearer token
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"<CLIENT_ID>","client_secret":"<CLIENT_SECRET>"}'
# → {"token":"<JWT>","token_type":"Bearer","expires_in":"7d"}

# 2) Submit job (multipart) — dùng <JWT> ở bước 1
curl -s -X POST http://localhost:3000/api/print-jobs \
  -H 'Authorization: Bearer <JWT>' \
  -F 'pdf=@/duong/dan/hoa-don.pdf;type=application/pdf' \
  -F 'branch_id=<BRANCH_ID>' \
  -F 'printer=' \
  -F 'metadata={"user_id":"erp-user-001"}'
# → {"job_id":"<JOB_ID>","status":"queued"}

# 3) Poll trạng thái job
curl -s http://localhost:3000/api/print-jobs/<JOB_ID> \
  -H 'Authorization: Bearer <JWT>'
# → {"id":"<JOB_ID>","status":"printed", ...}
```

**Node.js (fetch + FormData) — login + submit**

```js
// Node 18+ (fetch & FormData/Blob có sẵn). Đây là MẪU — thay placeholder bằng số thật.
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:3000';

// 1) Login
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: '<CLIENT_ID>', client_secret: '<CLIENT_SECRET>' }),
});
const { token } = await loginRes.json();

// 2) Submit job
const pdf = await readFile('/duong/dan/hoa-don.pdf');
const form = new FormData();
form.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'hoa-don.pdf');
form.append('branch_id', '<BRANCH_ID>');
form.append('metadata', JSON.stringify({ user_id: 'erp-user-001' }));

const jobRes = await fetch(`${BASE}/api/print-jobs`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }, // KHÔNG tự set Content-Type — FormData tự thêm boundary
  body: form,
});
console.log(await jobRes.json()); // { job_id, status: 'queued' }
```

**Python (requests) — login + submit (thay thế tương đương)**

```python
# pip install requests. Đây là MẪU — thay placeholder bằng số thật.
import requests

BASE = "http://localhost:3000"

# 1) Login
r = requests.post(f"{BASE}/api/auth/login",
                  json={"client_id": "<CLIENT_ID>", "client_secret": "<CLIENT_SECRET>"})
token = r.json()["token"]

# 2) Submit job (multipart)
with open("/duong/dan/hoa-don.pdf", "rb") as f:
    files = {"pdf": ("hoa-don.pdf", f, "application/pdf")}
    data = {"branch_id": "<BRANCH_ID>", "metadata": '{"user_id":"erp-user-001"}'}
    r = requests.post(f"{BASE}/api/print-jobs",
                      headers={"Authorization": f"Bearer {token}"},
                      files=files, data=data)
print(r.json())  # { "job_id": ..., "status": "queued" }
```

---

## 10. Resource: Webhooks

Tham chiếu: `src/api/webhooks.js`. **`verifyClient`**, mount tại **`/api/v2`**. Scope theo tenant.

### POST /api/v2/webhooks

- **Body:** `{ "url" (bắt buộc), "events"? (mặc định `'job.status'`) }`.
- **Lỗi:** `400 url không hợp lệ: <reason>`.
- **201:** `{ "id", "url", "events", "secret" }` — `secret` HMAC **hiển thị một lần**.

### GET /api/v2/webhooks

- **200:** `{ "webhooks": [ { "id", "url", "events", "is_active", "created_at" } ] }` (secret **không bao giờ** trả lại).

### DELETE /api/v2/webhooks/:id

- Scope theo tenant.
- **Lỗi:** `404`.
- **200:** `{ "ok": true }`.

---

## 11. Resource: Alerts (cảnh báo)

Tham chiếu: `src/api/alerts.js`. **`verifyClient`**, mount tại **`/api/v2`**. Scope theo tenant.

### GET /api/v2/alerts

- **Query:** `alert_type`, `branch_id`, `from`, `to`, `limit`, `offset`.
- **200:** `{ "alerts": [...], "total", "limit", "offset" }`.

### DELETE /api/v2/alerts/:id

- Scope theo tenant.
- **Lỗi:** `404 Alert không tồn tại`.
- **204:** No Content.

---

## 12. Resource: Audit Log

Tham chiếu: `src/api/audit.js`. **`verifyClient`**, mount tại **`/api/v2`**. Scope theo tenant.

### GET /api/v2/audit-log

- **Query:** `actor_id`, `action`, `from`, `to`, `limit`, `offset`.
- **200:** `{ "entries": [...], "total", "limit", "offset" }`.

---

## 13. Resource: Admin

Tham chiếu: `src/api/admin.js`. **`verifyClient`**.

### POST /api/admin/agents

Tạo branch hàng loạt.

- **Body:** `{ "count" (bắt buộc, 1-100), "prefix"? (mặc định `'br_'`), "name_template"? (mặc định `'Branch {n}'`) }`.
- **Lỗi:** `400 count must be 1..100`.
- **201:** `{ "created": <n>, "branches": [ { "id", "name", "agent_token" } ] }`.

---

## 14. Config / Health / Setup

### GET /api/config

- **Auth:** public.
- **200:** `{ "presence": { "freshMs": <n> } }`.

### GET /health

- **Auth:** public. Mount tại `/health` (KHÔNG có `/api`).
- **200:** `{ "status": "ok" | "degraded", "mqtt", "db", "uptime_seconds", "env" }`.

### POST /api/setup/register-branch

Đăng ký branch qua credential (không cần JWT trước).

- **Auth:** public, gated bằng credential trong body + `registerLimiter` (cửa sổ 1 giờ, mặc định **5 req/giờ/IP** → `429`).
- **Body:** `{ "client_id", "client_secret", "branch_name" (1-100), "location"? }`.
- **Idempotent re-register:** nếu `branch_name` đã tồn tại và branch đó thuộc **chính client đang xác thực** → không lỗi nữa; server **xoay token** của branch hiện có (token cũ vô hiệu ngay) và trả `200 { "branch_id" (của branch cũ), "agent_token" (mới), "topic_prefix" }` — cùng shape với đăng ký mới. Cho phép cài lại agent trên máy đã đăng ký mà không cần HQ can thiệp. Sự kiện được audit (`branch.reregister`).
- **Lỗi:** `401 Invalid client credentials`; `409` (trùng tên nhưng branch thuộc **client khác**, kèm `branch_id`; hoặc va chạm id hiếm gặp — retry); `400` (vi phạm khóa ngoại FK).
- **201:** `{ "branch_id", "agent_token", "topic_prefix" }` (đăng ký mới).

---

## 15. Cross-cutting: Rate limit, Ownership, Lifecycle

### 15.1 Rate limit (giá trị thực)

| Phạm vi | Hạn mức | Endpoint áp dụng |
|---------|---------|------------------|
| Login | 5/phút/IP | `POST /api/auth/login` |
| Ghi của client | 30/phút/client | `POST /api/print-jobs`, bulk, retry, ghi branch/printer |
| Bulk | Tính theo số file (tối đa **20 file/request**, mỗi file ≤ 50MB) | `POST /api/v2/print-jobs/bulk` |
| Register branch | 5/giờ/IP | `POST /api/setup/register-branch` |

- Backend dùng **Redis** nếu có env `REDIS_URL`, ngược lại đếm in-process.
- **Fail-open:** nếu Redis lỗi, request được cho qua (không chặn).

### 15.2 Audit logging

Tự động qua middleware `auditLog` (`src/app.js:44`) — ghi mọi thao tác ghi + các GET nhạy cảm. Truy vấn qua [`GET /api/v2/audit-log`](#get-apiv2audit-log).

### 15.3 Ownership (cô lập tenant)

| Resource | Scope theo `client_id`? |
|----------|--------------------------|
| Jobs (v2 list/retry), Webhooks, Alerts, Audit | ✅ Có |
| Branch READ / PATCH / regen-token / transfer | ❌ **KHÔNG** — xem [⚠️ Lưu ý bảo mật](#5-resource-branches-tram) |

### 15.4 Vòng đời job (state machine)

```
pending (API: 'queued')
   │  publish MQTT OK
   ▼
 sent ──── agent báo printed ──▶ printed   (clear cột error)
   │
   └─────── agent báo failed  ──▶ failed    (set error, mặc định 'unknown')
```

- **Retry / requeue:** tăng `retry_count`, clear `error`, set lại `sent`.
- **Cron requeue:** job `sent` bị "kẹt" (stale) được cron đẩy lại; `maxRetries` mặc định **5**.
