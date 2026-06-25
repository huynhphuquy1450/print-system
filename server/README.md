# Print Service Server

Node.js Express server nhận job in PDF từ HQ, publish qua MQTT tới agent ở chi nhánh.

## Tech stack
- Node.js 18+
- Express 4
- PostgreSQL (driver `pg`); test dùng `pg-mem` (in-process, không cần DB thật)
- mqtt.js
- JWT auth (client HQ) + agent token (chi nhánh)
- PM2 (process manager)

## Yêu cầu môi trường
- **Node.js 18+** (CI chạy Node 18; code tương thích 18+).
- **PostgreSQL** cho production/dev thật (đặt `DATABASE_URL`). Khi chỉ chạy test thì **không cần** DB — `jest.setup.js`
  tiêm sẵn env giả và các integration test dùng `pg-mem`.
- **Mosquitto (MQTT broker)** cho dev thật. Khi chạy test, MQTT được mock nên không cần broker.

## Cài đặt
```bash
cd server
npm ci                 # cài đủ dependencies (gồm devDeps cho test/lint)
cp .env.example .env    # điền DATABASE_URL, JWT_SECRET, AGENT_TOKEN_SECRET, MQTT_PASS, ...
```

Xem `.env.example` để biết toàn bộ biến môi trường (đối chiếu `src/config.js`). Các biến **bắt buộc** (không có default):
`MQTT_URL`, `MQTT_USER`, `MQTT_PASS`, `JWT_SECRET`, `AGENT_TOKEN_SECRET`. `DATABASE_URL` bắt buộc khi khởi động server thật.

## Lệnh thường dùng
```bash
npm run dev      # nodemon — chạy server local (cần .env + PostgreSQL + MQTT)
npm start        # node src/index.js (production)
npm test         # jest — toàn bộ unit + integration test (không cần DB/MQTT thật)
npm run lint     # eslint
npm run format   # prettier --write

# Production process manager
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

> Onboarding nhanh: `npm ci && npm test` phải xanh ngay sau khi clone, **không cần** cài PostgreSQL hay MQTT.

## Endpoints (tóm tắt)
- `GET /health` — health check (status, mqtt, db, uptime)
- `POST /api/auth/login` — client login → JWT; `GET /api/auth/me`
- `POST /api/print-jobs` — submit job (**multipart/form-data**: field file `pdf` + `branch_id` + `metadata` JSON
  bắt buộc có `user_id`)
- `GET /api/print-jobs/:id` — xem trạng thái job (client)
- `GET /api/print-jobs?branch_id=X` — list pending jobs (agent token)
- `GET /api/print-jobs/:id/file` — agent download PDF binary
- `POST /api/print-jobs/:id/status` — agent callback (`printed`/`failed`)
- `POST /api/branches` · `POST /api/branches/:id/regen-token` — quản lý branch
- `POST /api/admin/agents` — bulk tạo branch; `POST /api/setup/register-branch` — self-service đăng ký chi nhánh

Xem chi tiết: [../shared/api-contract.md](../shared/api-contract.md) và [HANDOVER.md](HANDOVER.md).
