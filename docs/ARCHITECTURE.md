# Print Service Architecture

## Tổng quan

```
┌──────────────┐    HTTPS REST      ┌──────────────────┐    MQTT TLS      ┌─────────────┐
│  HQ ERP/CRM  │ ──────────────────▶│  Print Service   │ ────────────────▶│ Print Agent │
│              │   POST /api/...    │     Server       │  company/printer/│  (Windows)  │
│              │   Bearer JWT       │  (Node.js +      │   {branch}/jobs │             │
│              │                    │   Express +      │                  │             │
│              │                    │   SQLite +       │                  │             │
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

## Database schema (SQLite)

```sql
clients(id PK, name, client_id_hash, client_secret_hash, created_at)
branches(id PK, name, location, mqtt_user, mqtt_pass_hash, agent_token_hash, status, last_seen_at, created_at)
printers(id PK, branch_id FK, name, is_default, created_at)
jobs(
  id PK, branch_id FK, client_id FK, printer_id FK?,
  pdf_path, status TEXT CHECK IN ('pending','sent','printed','failed'),
  metadata JSON, error TEXT, retry_count INT DEFAULT 0,
  created_at, sent_at, printed_at, failed_at
)
```

## 2 nguồn job cho Agent

| Nguồn | Khi nào | Payload |
|---|---|---|
| **MQTT real-time** | Agent đang chạy, subscribe nhận | `{job_id, pdf_base64, printer?, metadata, ...}` |
| **fetchPending API** | Sau (re)connect MQTT, agent gọi `GET /api/print-jobs?branch_id=X` → download từ `/api/print-jobs/:id/file` | metadata only, sau đó HTTP GET binary |

## File flow

### Job submit (HQ → server)

```
1. Client POST /api/print-jobs {branch_id, pdf_base64, metadata}
2. Server: validate JWT
3. Server: validate PDF magic bytes (%PDF-)
4. Server: write PDF to storage/{job_id}.pdf
5. Server: INSERT jobs (status='pending', pdf_path=...)
6. Server: publish MQTT company/printer/{branch_id}/jobs {job_id, pdf_base64, ...}
7a. Publish OK → UPDATE status='sent'
7b. Publish fail → log + (retry-stale cron sẽ republish sau 5p)
8. Response 201 {job_id, status:"queued"}
```

### Job print (Server → Agent → printer)

```
1. Agent nhận MQTT message
2. Validate magic bytes (defensive)
3. Decode base64 → write tmp file
4. spawn SumatraPDF -print-to "<printer>" -print-settings "1,a4,fit" tmp.pdf
5. SumatraPDF exit code 0 → in thành công
6. Agent POST /api/print-jobs/:id/status {status:"printed"}
7. Server UPDATE jobs SET status='printed', printed_at=NOW()
```

## Security

- **Client auth**: JWT HS256, secret 48-byte base64 random ở `.env` (`JWT_SECRET`)
- **Agent auth**: device token 64 hex, hash SHA-256 ở DB, constant-time compare
- **MQTT TLS**: self-signed cert, mỗi user 1 cặp, ACL per-branch
- **Login rate limit**: 5 attempts/phút (express-rate-limit)
- **Helmet**: HTTP headers secure
- **CORS**: cấu hình trong app.js

## Tham khảo

- API spec: [../shared/api-contract.md](../shared/api-contract.md)
- Server handover (production deployment): [../server/HANDOVER.md](../server/HANDOVER.md)