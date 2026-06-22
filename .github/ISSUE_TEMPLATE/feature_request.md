---
name: Feature request
about: Đề xuất tính năng mới
title: '[FEAT] '
labels: enhancement, needs-triage
assignees: ''
---

## Vấn đề cần giải quyết
Mô tả use case thực tế. Feature này giải quyết vấn đề gì? Ai sẽ dùng?

## Giải pháp đề xuất
Mô tả ngắn gọn giải pháp bạn hình dung.

## Giải pháp thay thế
Đã xem xét giải pháp nào khác chưa? Tại sao chọn giải pháp này?

## API/UI mockup (optional)
```typescript
// Nếu là API change
POST /api/v2/jobs/bulk
{
  "branch_ids": ["br_001", "br_002"],
  "pdf_base64": "..."
}
```

## Impact
- **Ai sẽ dùng**: [HQ / chi nhánh / cả hai]
- **Tần suất**: [mỗi ngày / mỗi tuần / hiếm]
- **Số lượng user bị ảnh hưởng**: [1-5 / 5-30 / 30+]

## Effort estimate (best guess)
- [ ] **S** — 1-2 ngày
- [ ] **M** — 1 tuần
- [ ] **L** — 2-4 tuần
- [ ] **XL** — > 1 tháng

## Có thể tự implement không?
- [ ] Có — sẽ mở PR
- [ ] Có — cần hỗ trợ design
- [ ] Không — cần maintainer

## Reference
- Link issue liên quan (nếu có)
- Link tài liệu / RFC / blog post liên quan