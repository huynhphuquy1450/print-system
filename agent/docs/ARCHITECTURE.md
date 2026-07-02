# Architecture

> Tài liệu kiến trúc sẽ được bổ sung sau. Hiện tại xem:
> - `README.md` (tổng quan)
> - Source code `agent.js` (có comment giải thích flow)
> - Server spec tại `server/CLIENT_GUIDE.md` trong repo

## Tổng quan 1 phút

```
[HQ/Client]
   │ POST /api/print-jobs (HTTPS, JWT Bearer)
   ▼
[Print Service :3000]  ─── save PDF ─── validate magic bytes ─── insert jobs DB
   │
   │ publish MQTTS QoS 1
   ▼
[Mosquitto :8883]  ─── ACL: br_001 chỉ subscribe br_001/#
   │
   ▼
[Print Agent (this repo)]  ─── decode base64 ─── SumatraPDF ─── printer
   │
   │ POST /api/print-jobs/{id}/status (X-Agent-Token)
   ▼
[Print Service]  ─── update DB ─── done
```

## 2 nguồn job

| Nguồn | Khi nào | Payload |
|---|---|---|
| **MQTT real-time** | Agent đang chạy, nhận qua subscribe | `{job_id, pdf_base64, printer?, metadata, ...}` |
| **fetchPending** | Sau khi (re)connect MQTT | API `GET /api/print-jobs` → download từ `/api/print-jobs/:id/file` |

## File flow trong agent

```
processJob(job)
├─ if (job.pdf_base64) {
│    // Source: MQTT
│    buf = Buffer.from(base64)
│    validate magic bytes
│    write to tmp file
│  } else {
│    // Source: fetchPending
│    GET /api/print-jobs/:id/file
│    save binary to tmp file
│  }
├─ spawn SumatraPDF with -print-to + -print-settings "1,a4,fit"
├─ POST /api/print-jobs/:id/status (printed | failed)
└─ unlink tmp file
```

Xem chi tiết trong `agent.js`.
