## Mô tả
Mô tả ngắn gọn thay đổi. Link issue nếu có: `Fixes #123`

## Loại thay đổi
- [ ] Bug fix (non-breaking change sửa lỗi)
- [ ] New feature (non-breaking change thêm tính năng)
- [ ] Breaking change (fix/feature gây ảnh hưởng API hiện tại)
- [ ] Documentation update
- [ ] Refactor / chore (không đổi behavior)

## Component bị ảnh hưởng
- [ ] `server/` (API + worker)
- [ ] `agent/` (Windows client)
- [ ] `shared/` (API contract)
- [ ] `docs/`
- [ ] `.github/` (CI/CD, templates)
- [ ] Root (`README.md`, `LICENSE`, etc.)

## Checklist
- [ ] Code đã test local (nếu là code change)
- [ ] Đã chạy `npm test` (nếu có test framework)
- [ ] Đã chạy `npm run lint` (nếu có eslint)
- [ ] Tài liệu đã update (nếu thay đổi API/UI)
- [ ] `CHANGELOG` updated (nếu có)
- [ ] **KHÔNG có secret mới trong diff** (verify `git diff` không có `*.key`, `*.pem`, password, token)
- [ ] KHÔNG commit `.env` / `*.key` / `*.pem` / `certs/`
- [ ] Commit message theo [Conventional Commits](https://www.conventionalcommits.org/)

## Test plan
Mô tả cách bạn test:

- **Test gì**:
- **Test như thế nào**:
- **Pass/Fail**:

## Screenshots (nếu có UI change)
[Attach images]

## Migration (nếu breaking change)
- **API cũ**: `POST /api/print-jobs` với body cũ
- **API mới**: `POST /api/v2/print-jobs` với body mới
- **Migration plan**: cả 2 endpoint cùng tồn tại 6 tháng, log warning khi dùng API cũ

## Deployment notes
- [ ] Cần chạy migration script
- [ ] Cần restart service
- [ ] Cần update `.env.example` (KHÔNG commit `.env`)
- [ ] Cần rotate secret
- [ ] Cần update agent ở các chi nhánh