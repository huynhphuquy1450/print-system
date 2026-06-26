# Tools

Thư mục này chứa các tool binary cần thiết cho Print Agent.

## SumatraPDF (REQUIRED)

Agent dùng SumatraPDF để in PDF silent. Tải bản **portable** (không cần cài):

- **Link chính thức:** https://www.sumatrapdfreader.org/download-free-pdf-viewer
- **Bản portable 64-bit:** https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip

### Cài đặt (Windows)

```powershell
# Tai ve thu muc hien tai
Invoke-WebRequest -Uri "https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip" -OutFile "$env:TEMP\SumatraPDF.zip"

# Giai nen vao C:\print-system\tools\
Expand-Archive "$env:TEMP\SumatraPDF.zip" -DestinationPath "C:\print-system\tools" -Force

# Doi ten thanh SumatraPDF.exe (de khop voi SUMATRA_PATH trong .env)
Move-Item "C:\print-system\tools\SumatraPDF-3.6.1-64.exe" "C:\print-system\tools\SumatraPDF.exe" -Force
```

### Verify

```powershell
& "C:\print-system\tools\SumatraPDF.exe" -version
# Phai in ra version string, khong loi
```

### Vì sao SumatraPDF?

- **Portable** — không cần cài đặt, copy file là chạy
- **Silent print** — hỗ trợ `-print-to "printer_name" -silent -exit-when-done`
- **Fast** — load PDF nhanh, in ngay
- **Lightweight** — file EXE ~20MB
- **Cross-version Windows** — chạy được từ Win 7 trở lên

## Không commit vào Git

File `SumatraPDF.exe` (và các DLL đi kèm) **KHÔNG** commit vào repo vì:
- File binary lớn (>20MB)
- Có thể cần cập nhật version độc lập với code
- Đã được `.gitignore` loại trừ

Mỗi máy agent tự tải về khi cài đặt (xem `../install.ps1`).
