# Print Service Architecture

## Tổng quan

```
┌──────────────┐    HTTPS REST      ┌──────────────────┐    MQTT TLS      ┌─────────────┐
│  HQ ERP/CRM  │ ──────────────────▶│  Print Service   │ ────────────────▶│ Print Agent │
│              │   POST /api/...    │     Server       │  company/printer/│  (Windows)  │
│              │   Bearer JWT       │  (Node.js +      │   {branch}/jobs │             │
│              │                    │   Express +      │                  │             │
│              │                    │   PostgreSQL +   │                  │             │
│              │                    │   MQTT client)   │                  │             │
└──────────────┘                    └──────────────────┘                  └──────┬──────┘
                                                                                │
                                                                                ▼
                                                                         ┌─────────────┐
                                                                         │ SumatraPDF  │
                                                                         │     +       │
                                                                         │ Máy in thật │
                                                                         └─────────────┘
```

## Database schema (PostgreSQL)

> Engine là PostgreSQL (driver `pg`). Timestamp lưu BIGINT (ms epoch). DDL nguồn: `server/src/db.js` (`SCHEMA_SQL`).

```sql
clients(id PK, name UNIQUE, secret_hash, is_active, created_at)
branches(id PK, name, location, agent_token_hash UNIQUE, status, last_seen_at, created_at,
         client_id FK→clients)
printers(id PK, branch_id FK, name, is_default, status, last_seen_at, created_at)
jobs(
  id PK, branch_id FK, printer, file_path,
  status ('pending'|'sent'|'printed'|'failed'),
  metadata JSON(text), error, retry_count INT DEFAULT 0,
  created_at, sent_at, printed_at, failed_at, client_id FK→clients
)
cleanup_audit(id PK, job_id, file_path, branch_id, reason, deleted_at, size_bytes)  -- vết xóa PDF khi cleanup
```

> Đăng ký chi nhánh tự phục vụ: `branches.client_id` + endpoint `POST /api/setup/register-branch`.
> Không dùng migration tool — schema khởi tạo idempotent qua `CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS`.

## 2 nguồn job cho Agent

| Nguồn | Khi nào | Payload |
|---|---|---|
| **MQTT real-time** | Agent đang chạy, subscribe nhận | metadata-only `{job_id, version:2, printer?, metadata, created_at}` → agent tải PDF qua HTTP `/api/print-jobs/:id/file` |
| **fetchPending API** | Sau (re)connect MQTT, agent gọi `GET /api/print-jobs?branch_id=X` → download từ `/api/print-jobs/:id/file` | metadata only, sau đó HTTP GET binary |

> Ngoại lệ: retry cron (`retry-stale`) republish có thể gửi kèm `pdf_base64` để in lại job đã miss.

## File flow

### Job submit (HQ → server)

```
1. Client POST /api/print-jobs (multipart: pdf file + branch_id + metadata{user_id,...})
2. Server: validate JWT + metadata.user_id bắt buộc
3. Server: validate PDF magic bytes (%PDF-)
4. Server: write PDF to storage/{job_id}.pdf
5. Server: INSERT jobs (status='pending', file_path=..., client_id)
6. Server: publish MQTT company/printer/{branch_id}/jobs {job_id, version:2, metadata, ...} (metadata-only)
7a. Publish OK → UPDATE status='sent'
7b. Publish fail → log + (retry-stale cron sẽ republish sau 5p)
8. Response 201 {job_id, status:"queued"}
```

### Job print (Server → Agent → printer)

```
1. Agent nhận MQTT message (metadata-only) → GET /api/print-jobs/:id/file tải PDF
2. Validate magic bytes (defensive)
3. Write PDF → tmp file
4. spawn SumatraPDF -print-to "<printer>" -print-settings "1,a4,fit" tmp.pdf
5. SumatraPDF exit code 0 → in thành công
6. Agent POST /api/print-jobs/:id/status {status:"printed"}
7. Server UPDATE jobs SET status='printed', printed_at=NOW()
```

## Security

- **Client auth**: JWT HS256, secret 48-byte base64 random ở `.env` (`JWT_SECRET`)
- **Agent auth**: device token 64 hex, hash SHA-256 ở DB, constant-time compare
- **MQTT TLS**: Step-CA internal PKI (cert auto-renew), mỗi user 1 cặp, ACL per-branch
- **Rate limit (per-client)**: 30 job/phút/client (`CLIENT_WRITE_RATE_PER_MIN`)
- **Audit**: `POST /api/print-jobs` bắt buộc `metadata.user_id`; cleanup PDF ghi `cleanup_audit`. Bảng
  `audit_log` ghi mọi thao tác ghi + GET nhạy cảm (who/IP/user-agent/status), tự purge sau `AUDIT_RETENTION_DAYS` (mặc định 90)
- **Login rate limit**: 5 attempts/phút (express-rate-limit)
- **Helmet**: HTTP headers secure
- **CORS**: cấu hình trong app.js

## Tham khảo

- API spec: [../shared/api-contract.md](../shared/api-contract.md)
- Server handover (production deployment): [../server/HANDOVER.md](../server/HANDOVER.md)