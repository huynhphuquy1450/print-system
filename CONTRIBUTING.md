# Contributing to Print System

Cảm ơn bạn đã quan tâm đóng góp! 🎉

Project này là open-source (MIT license), dùng để in PDF hợp đồng từ xa cho doanh nghiệp có HQ + nhiều chi nhánh.

## Quick start

1. Fork repo trên GitHub
2. Clone: `git clone https://github.com/<your-username>/print-system.git`
3. Tạo branch: `git checkout -b feat/ten-tinh-nang`
4. Setup server local (xem `server/README.md`)
5. Code, test, commit
6. Push + mở Pull Request

## Coding style

- Node.js >= 18 (hiện test với 24, code compatible 18+)
- Indent: 2 spaces, no tabs
- Quotes: single quotes preferred
- Semicolons: required
- Naming: camelCase cho biến/hàm, PascalCase cho class, UPPER_SNAKE cho const
- Comment ngắn gọn, tiếng Việt hoặc Anh đều OK
- File < 400 dòng (chia nhỏ nếu dài hơn)

## Commit convention

Dùng [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — tính năng mới
- `fix: ...` — sửa bug
- `docs: ...` — chỉ tài liệu
- `chore: ...` — refactor, deps, không đổi behavior
- `test: ...` — thêm/sửa test
- `security: ...` — fix security
- `perf: ...` — performance

Scope (optional): `feat(server): ...`, `fix(agent): ...`

Ví dụ: `feat(server): add per-client rate limit`

## Pull Request process

1. Đảm bảo `npm test` pass (jest — chạy `cd server && npm test`)
2. Đảm bảo `npm run lint` pass (eslint)
3. Mô tả thay đổi trong PR description (dùng PR template)
4. Reference issue nếu có: `Fixes #123`
5. Đợi review từ maintainer
6. Squash merge sau khi approve

## Coding rules

- **KHÔNG** commit secret (`.env`, password, token, key)
- **KHÔNG** log PII ra console
- Mỗi PR nên < 400 dòng thay đổi (nếu nhiều hơn, chia nhỏ thành nhiều PR)
- Backward compatible API (trừ khi bump major version + có migration)
- Migration script cho schema change (khi có)
- KHÔNG modify file trong `certs/`, `data/`, `storage/`, `logs/` (đã gitignore)
- Tất cả file mới phải được `git add` explicit (KHÔNG dùng `git add .` mà không review)

## Local dev setup

```bash
# Server
cd server
cp .env.example .env
# Fill JWT_SECRET, AGENT_TOKEN_SECRET, MQTT_PASS (random 48-byte base64)
npm install
npm run dev   # nodemon

# Agent
cd agent
cp .env.example .env
# Fill BRANCH_ID, AGENT_TOKEN, MQTT_PASS, API_URL, SUMATRA_PATH
npm install
npm start
```

Xem `server/README.md` và `agent/README.md` để biết chi tiết.

## Testing

Server dùng **jest** (+ `supertest` cho HTTP, `pg-mem` cho integration test với PostgreSQL in-process).
Không cần DB hay MQTT thật để chạy test — `server/jest.setup.js` tiêm env giả.

```bash
cd server && npm test              # toàn bộ test
cd server && npx jest --coverage   # kèm báo cáo coverage (CI enforce threshold)
```

Thêm test khi đóng góp:
- Đặt test cạnh code: `src/<area>/__tests__/<name>.test.js`.
- Unit test: hoist `jest.mock('../../db')` trước `require`. Integration test DB: dùng `pg-mem`
  (xem `src/db/__tests__/db.pg.test.js`). Integration HTTP: dùng `supertest` (xem `src/api/__tests__/jobs.test.js`).
- **Mỗi service mới trong `src/services/` phải kèm test** — coverage được enforce trên thư mục này, thiếu test sẽ làm CI đỏ.

## Report security issue

**KHÔNG** mở public issue cho security bug.

Dùng GitHub Security Advisories của repo này (private vulnerability reporting): tab **Security** →
**Advisories** → **Report a vulnerability**.

## License

Bằng cách contribute, bạn đồng ý license contribution dưới MIT (xem `LICENSE`).