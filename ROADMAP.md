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
- [x] HTTPS cho API (dual HTTP/HTTPS listener, cert nội bộ self-signed hoặc Step-CA) — xem `server/HANDOVER.md` §4.4.1, §10.4 (vẫn cần Let's Encrypt/domain thật khi có domain)
- [ ] Bulk tạo 25 branch mới (br_006..br_030) qua `POST /api/admin/agents`
- [ ] Monitoring: Prometheus + Grafana dashboard
- [ ] Alert: Telegram/PagerDuty khi service down
- [x] Rate limit per-client (chống HQ spam) — đã có `middleware/rate-limit-client.js`

## Q1 2027 (Jan-Mar) — UX & INTEGRATION
- [x] Web UI cho HQ (xem job history, retry manual, filter theo branch/status) — `web/` (Vite + React)
- [x] Webhook ERP (giảm polling, optional) — đã có, xem `docs/API.md`
- [x] Audit log chi tiết (ai in gì, lúc nào, IP, user-agent) — bảng `audit_log`, xem `docs/ARCHITECTURE.md` §Security
- [x] API versioning (`/api/v2/` prefix) — clients, printers filter, jobs bulk/retry
- [x] Bulk job API (gửi nhiều hợp đồng cùng lúc đến N chi nhánh) — `POST /api/v2/print-jobs/bulk`

## Backlog (chưa commit date)
- SNMP polling máy in mạng để đọc chính xác mức mực/giấy (thay best-effort WMI)
- Redis cache cho job metadata
- Multi-region VPS (failover)
- Mobile app cho chi nhánh (báo in xong, báo lỗi giấy)
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