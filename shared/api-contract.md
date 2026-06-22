# API Contract

## Authentication

### Client (HQ ERP/CRM)
- `POST /api/auth/login` — body `{client_id, client_secret}` → `{token: JWT}`
- Tất cả endpoints khác yêu cầu header `Authorization: Bearer <token>`
- JWT TTL: 24h

### Agent
- Bearer token (`AGENT_TOKEN`), hash SHA-256 lưu DB, constant-time compare

## Endpoints (Client)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/print-jobs` | Submit job. Body: `{branch_id, pdf_base64, metadata, printer_id?}` |
| GET  | `/api/print-jobs/:id` | Xem trạng thái job |
| GET  | `/api/print-jobs?branch_id=X&status=Y` | List jobs (cho HQ dashboard) |

## Endpoints (Agent)

| Method | Path | Mô tả |
|---|---|---|
| GET  | `/api/print-jobs/:id/file` | Download PDF binary (auth: AGENT_TOKEN) |
| POST | `/api/print-jobs/:id/status` | Body: `{status: "printed"\|"failed", error?}` |

## MQTT (Server → Agent)

- Topic: `company/printer/{branch_id}/jobs`
- QoS: 1
- Payload: `{job_id, pdf_base64, printer?, metadata}` (base64, không phải file)

## Status flow

```
pending → sent (MQTT publish OK)
sent → printed (agent callback)
sent → failed (agent callback hoặc retry-stale cron)
```

## Rate limit
- Login: 5 attempts/phút/IP
- Submit job: 60/phút/client
