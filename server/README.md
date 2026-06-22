# Print Service Server

Node.js Express server nhận job in PDF từ HQ, publish qua MQTT tới agent ở chi nhánh.

## Tech stack
- Node.js 18+
- Express 4
- better-sqlite3
- mqtt.js
- JWT auth
- PM2 (process manager)

## Cài đặt
```bash
npm install --production
cp .env.example .env  # điền JWT_SECRET, AGENT_TOKEN_SECRET, MQTT_PASS, ...
```

## Chạy
```bash
# Dev
node src/index.js

# Production
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Endpoints
- `GET /health` — health check
- `POST /api/auth/login` — client JWT
- `POST /api/print-jobs` — submit job
- `GET /api/print-jobs/:id/file` — agent download PDF
- `POST /api/print-jobs/:id/status` — agent callback
- `POST /api/branches` / `POST /api/branches/:id/regen-token` — quản lý branch

Xem chi tiết: [../shared/api-contract.md](../shared/api-contract.md) và [HANDOVER.md](HANDOVER.md).
