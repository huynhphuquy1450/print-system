# API Contract

> Nguồn chuẩn chi tiết: [`server/HANDOVER.md`](../server/HANDOVER.md) §4. File này là bản tóm tắt.

## Versioning

- Endpoint hiện tại phục vụ qua `/api/v1/*` **và** alias `/api/*` (back-compat client cũ).
- Feature mới (job history/filter/retry, webhooks ERP, bulk job) đặt dưới `/api/v2/*`.
- Chính sách deprecation alias `/api/*` (không version): giữ tới hết 2027, sau đó client phải gọi prefix có version.

## Authentication

### Client (HQ ERP/CRM)
- `POST /api/auth/login` — body `{client_id, client_secret}` → `{token: JWT}`
- Mọi endpoint client khác cần header `Authorization: Bearer <token>`
- JWT TTL: mặc định **7 ngày** (`JWT_EXPIRES_IN`)

### Agent (chi nhánh)
- Header `X-Agent-Token: <token>` + `X-Branch-Id: <branch_id>` (KHÔNG dùng `Authorization: Bearer`)
- Token hash SHA-256 lưu DB, constant-time compare

## Endpoints (Client)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/print-jobs` | Submit job. **`multipart/form-data`**: file field `pdf` (≤50MB, magic `%PDF-`) + `branch_id` + `printer?` + `metadata` (JSON string, **bắt buộc** chứa `user_id` không rỗng). Thiếu `user_id` → 400. |
| GET  | `/api/print-jobs/:id` | Xem trạng thái 1 job |

> List/filter job cho HQ dashboard (`?branch_id=&status=&from=&to=` + pagination) + retry thủ công: **roadmap Q1 2027** (`/api/v2`), chưa có ở v1.

## Endpoints (Agent)

| Method | Path | Mô tả |
|---|---|---|
| GET  | `/api/print-jobs?branch_id=X` | List job `pending`/`sent` của branch (khi (re)connect) |
| GET  | `/api/print-jobs/:id/file` | Download PDF binary |
| POST | `/api/print-jobs/:id/status` | Body: `{status: "printed"\|"failed", error?}` |

## MQTT (Server → Agent)

- Topic: `company/printer/{branch_id}/jobs`
- QoS: 1
- Payload v2 (**metadata-only**, KHÔNG nhúng PDF): `{job_id, version: 2, printer?, metadata, created_at}`.
  Agent nhận message rồi tải PDF qua `GET /api/print-jobs/:id/file`.
- Retry cron (`retry-stale`) có thể gửi kèm `pdf_base64` để in lại job đã miss.

## Status flow

```
pending → sent (MQTT publish OK)
sent → printed (agent callback)
sent → failed (agent callback hoặc retry-stale cron khi quá số lần retry)
```

## Rate limit
- Login: 5/phút/IP
- Submit job (per-client write): **30/phút/client** (`CLIENT_WRITE_RATE_PER_MIN`)
- Self-service register branch: 5/giờ/IP
