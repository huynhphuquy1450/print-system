# Print Service & Agent

Hệ thống in PDF hợp đồng từ xa cho công ty có HQ + nhiều chi nhánh.

## Kiến trúc

```
[HQ ERP/CRM] --HTTPS API--> [Print Service Server] --MQTT TLS--> [Print Agent] --SumatraPDF--> [Máy in]
```

## Cấu trúc repo

- `server/` — Node.js Print Service backend (Express + SQLite + MQTT)
- `agent/` — Node.js Print Agent chạy trên Windows (MQTT subscriber + SumatraPDF)
- `shared/api-contract.md` — API spec (server ↔ agent ↔ client)
- `docs/ARCHITECTURE.md` — Kiến trúc tổng thể

## Quick start

### Server (Ubuntu/Linux)
```bash
cd server
npm install --omit=dev
cp .env.example .env  # rồi điền secret
node src/index.js
```

### Agent (Windows)
```powershell
cd agent
# Cài SumatraPDF vào C:\print-system\tools\SumatraPDF.exe (xem tools/README.md)
npm install --omit=dev
# Điền .env với AGENT_TOKEN, MQTT_USER, MQTT_PASS
.\install-service.ps1
```

## Tài liệu

- [Server handover](server/HANDOVER.md) — Triển khai server production
- [API contract](shared/api-contract.md) — REST + MQTT spec
- [Architecture](docs/ARCHITECTURE.md) — Sơ đồ tổng thể
- [Agent docs](agent/docs/README.md) — Vận hành agent

## Chi phí

~$100/năm (VPS $5-10/tháng + domain). Tiết kiệm ~80% so với dịch vụ in đám mây.

## License

MIT — xem [LICENSE](LICENSE).
