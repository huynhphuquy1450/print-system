# HQ Print Admin

Admin panel nội bộ cho nhân viên HQ quản lý hệ thống in ấn.

## Cách chạy

```bash
npm install
npm run dev
```

Truy cập http://localhost:5173

```bash
npm run build
```

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `VITE_API_BASE_URL` | `http://localhost:3000` | URL gốc của backend API |

Tạo file `.env.local` từ `.env.example` và điều chỉnh nếu cần.

## Lưu ý

- GĐ1: backend cho phép CORS all origins — cần restrict lại khi lên production.
- Token được lưu trong `sessionStorage`, mất khi đóng tab.
