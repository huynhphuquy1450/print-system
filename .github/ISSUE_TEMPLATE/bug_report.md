---
name: Bug report
about: Báo cáo lỗi trong Print Service
title: '[BUG] '
labels: bug, needs-triage
assignees: ''
---

## Mô tả
Mô tả ngắn gọn về bug.

## Môi trường
- **Component**: [server / agent / mqtt / docs / CI]
- **Version**: (vd 1.0.0)
- **OS**: [Ubuntu 22.04 / Windows 11 / macOS 14]
- **Node.js version**: (vd 20.10.0)
- **MQTT broker**: [mosquitto 2.0.18 / other]

## Bước tái hiện
1. Bước 1
2. Bước 2
3. Bước 3
4. ...

## Expected behavior
Mô tả kỳ vọng đúng.

## Actual behavior
Mô tả thực tế sai.

## Log / Error message
```
Paste log/error tại đây
⚠️ MASK tất cả secret trước khi paste (client_secret, agent_token, JWT, MQTT_PASS)
```

## Severity
- [ ] **Blocker** — service down, không in được
- [ ] **Critical** — function chính bị hỏng
- [ ] **Major** — workaround được nhưng UX tệ
- [ ] **Minor** — edge case, ít gặp
- [ ] **Cosmetic** — typo, format

## Checklist
- [ ] Đã search issue hiện có (không trùng)
- [ ] Đã mask tất cả secret trong log paste
- [ ] Có thể tái hiện 100% (hoặc mô tả cách tái hiện)
- [ ] Reproduced trên `main` branch (hoặc note version cụ thể)