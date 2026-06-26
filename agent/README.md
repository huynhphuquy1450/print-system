# Print Agent

Node.js agent chạy trên Windows. Subscribe MQTT từ Print Service, nhận job in PDF, in qua SumatraPDF, callback status về server.

## Tính năng

- Subscribe MQTT QoS 1 với TLS + ACL (mỗi agent cho 1 branch riêng)
- Nhận job qua 2 nguồn: MQTT real-time + fetchPending (sau reconnect)
- Validate PDF magic bytes
- In silent qua SumatraPDF
- Force A4 + fit-to-page (`-print-settings "1,a4,fit"`)
- Callback status (printed/failed) với retry 3 lần
- Tự reconnect MQTT khi mất mạng (5s)
- Tự cleanup tmp file cũ (>1 giờ) khi start
- Log theo ngày

## Cài đặt

### Cài nhanh — installer trọn gói 1 phát (khuyến nghị)

Cần 2 file từ HQ IT (distribute riêng, KHÔNG có trong repo):

- `install.json` — HQ tạo bằng `OUTPUT_FILE=install.json node server/scripts/gen-client.js "<Tên client>"`.
  File này chứa `client_id` + `client_secret` + khối `agent_env` (MQTT/API/đường dẫn) để agent ghi
  thẳng vào `.env`, máy chi nhánh **không phải điền tay**.
- `root_ca.crt` — Step-CA root (xem `CA_INSTALL.md`).

```powershell
# Copy cả thư mục agent + install.json + root_ca.crt sang máy chi nhánh, rồi:
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json
# Script tự: nâng quyền UAC, kiểm tra Node, tải SumatraPDF + NSSM, cài root CA,
# npm install, hỏi "Tên chi nhánh / Địa điểm", cài + chạy Windows service, smoke test.
```

### Cài thủ công

Xem chi tiết trong `docs/README.md`.

## Cấu trúc

```
print-agent/
├── agent.js                 # Main code
├── package.json             # Node deps
├── .env.example             # Template env
├── .gitignore
├── check.ps1                # Health check
├── install-service.ps1      # Cai NSSM service (UAC)
├── restart-service.ps1      # Restart service (UAC)
├── start-service.ps1        # Start service (UAC)
├── stop-service.ps1         # Stop service (UAC)
├── fix-service.ps1          # Fix AppDirectory
├── cleanup-logs.ps1         # Cleanup log cu
├── tools/
│   ├── README.md            # Huong dan cai SumatraPDF
│   └── SumatraPDF.exe       # (tai thu cong, khong commit)
├── docs/
│   ├── README.md            # Huong dan day du
│   └── ARCHITECTURE.md      # Kien truc
├── install.ps1              # Installer tron goi 1 phat (UAC)
└── root_ca.crt              # (distribute rieng tu HQ IT, khong commit)
```

## Yêu cầu

- Windows 10/11
- Node.js v18+
- SumatraPDF portable (xem `tools/README.md`)
- Network tới Print Service: port 3000 (HTTP) + 8883 (MQTTS)

## Vận hành

```powershell
# Health check
powershell -ExecutionPolicy Bypass -File .\check.ps1

# Service status
Get-Service PrintAgent-br001

# Log real-time
Get-Content logs\$(Get-Date -Format 'yyyy-MM-dd').log -Wait
```

## Cấu hình

Copy `.env.example` → `.env` và điền giá trị thật từ secret manager:

```bash
BRANCH_ID=br_001
AGENT_TOKEN=<paste_from_secret_manager>
MQTT_URL=mqtts://<server_host>:8883
MQTT_USER=<mqtt_user>
MQTT_PASS=<mqtt_pass>
MQTT_CA_FILE=C:\print-system\root_ca.crt
API_URL=http://<server_host>:3000
SUMATRA_PATH=C:\print-system\tools\SumatraPDF.exe
TMP_DIR=C:\print-system\agents\agent-01\tmp
PRINT_SETTINGS=1,a4,fit
```

## License

Internal use only.
