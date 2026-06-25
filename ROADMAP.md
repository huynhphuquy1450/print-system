# Roadmap

> Last updated: 2026-06-25. Cập nhật mỗi quý hoặc khi có thay đổi lớn.

Dự án Print System đang ở giai đoạn 1.5 (Team handoff). Hướng phát triển 12 tháng tới:

## Q3 2026 (Jul-Sep) — STABILITY ✅ HOÀN THÀNH SỚM
- [x] Setup test framework (jest) — 14 test files, 107 tests pass
- [x] ESLint + Prettier — chuẩn hóa style
- [x] Bật GitHub Actions thật (lint + test trên mỗi PR)
- [x] Fix 8 known issues trong `server/HANDOVER.md` §10.1 (tất cả đã fix, xem §10.1)
- [ ] Onboard 2 dev đầu tiên
- [ ] Viết unit test cho `server/src/services/`, target 60% coverage

## Q4 2026 (Oct-Dec) — SCALE TO 30 BRANCHES
- [ ] Mua domain (vd `print.example.com`, ~$10/năm)
- [ ] nginx reverse proxy + Let's Encrypt (certbot)
- [ ] Bỏ self-signed cert cho API
- [ ] Bulk tạo 25 branch mới (br_006..br_030) qua `POST /api/admin/agents`
- [ ] Monitoring: Prometheus + Grafana dashboard
- [ ] Alert: Telegram/PagerDuty khi service down
- [x] Rate limit per-client (chống HQ spam) — đã có `middleware/rate-limit-client.js`

## Q1 2027 (Jan-Mar) — UX & INTEGRATION
- [ ] Web UI cho HQ (xem job history, retry manual, filter theo branch/status)
- [ ] Webhook ERP (giảm polling, optional)
- [ ] Audit log chi tiết (ai in gì, lúc nào, IP, user-agent)
- [ ] API versioning (`/api/v2/` prefix)
- [ ] Bulk job API (gửi 100 hợp đồng cùng lúc đến N chi nhánh)

## Backlog (chưa commit date)
- PostgreSQL thay SQLite (khi > 100 jobs/phút)
- Redis cache cho job metadata
- Multi-region VPS (failover)
- Mobile app cho chi nhánh (báo in xong, báo lỗi giấy)
- Printer status feedback (hết giấy, kẹt giấy, offline)
- Auto-discovery printer qua Bonjour/mDNS
- i18n (Tiếng Việt / English UI)
- Docker image + docker-compose

## Contributing vào roadmap
Mở GitHub issue với label `roadmap-proposal`. Maintainer sẽ review mỗi tháng và update roadmap nếu được duyệt.

## Out of scope (hiện tại)
- Cloud-managed offering (SaaS do bên thứ 3 host)
- Cross-region active-active (multi-VPS cùng lúc)
- AI/ML-based print queue optimization
- In ấn từ mobile app native (chỉ làm web responsive)

## Xem thêm
- `server/HANDOVER.md` — tài liệu kỹ thuật chi tiết
- `shared/api-contract.md` — API reference
- `docs/ARCHITECTURE.md` — kiến trúc hệ thống