# Print Agent (br_001)

Node.js agent cháº¡y trÃªn Windows, subscribe MQTT tá»« Print Service, in PDF qua SumatraPDF, callback status vá» server.

## Cáº¥u trÃºc thÆ° má»¥c

```
C:\print-system\
â”œâ”€â”€ agent.js              # Source code chÃ­nh
â”œâ”€â”€ package.json          # Node deps (axios, dotenv, mqtt)
â”œâ”€â”€ .env                  # Config runtime (token, paths) â€” KHÃ”NG commit
â”œâ”€â”€ ca.crt                # TLS cert tá»« Mosquitto broker
â”œâ”€â”€ node_modules/         # Deps (gitignore)
â”œâ”€â”€ tools/
â”‚   â””â”€â”€ SumatraPDF.exe    # SumatraPDF portable
â”œâ”€â”€ agents/agent-01/
â”‚   â””â”€â”€ tmp/              # PDF táº¡m khi in
â”œâ”€â”€ logs/                 # Log file theo ngÃ y + service stdout/stderr
â”‚   â””â”€â”€ 2026-06-22.log
â”œâ”€â”€ scripts/
â”‚   â”œâ”€â”€ fetch-cert.py     # Láº¥y ca.crt tá»« VPS (1 láº§n khi cÃ i)
â”‚   â”œâ”€â”€ query-vps-db.py   # Query DB jobs trÃªn VPS (debug)
â”‚   â”œâ”€â”€ install-service-elevated.ps1  # CÃ i NSSM service (UAC)
â”‚   â”œâ”€â”€ fix-service.ps1   # Fix AppDirectory
â”‚   â”œâ”€â”€ start-service.ps1 # Start service (UAC)
â”‚   â”œâ”€â”€ register-cleanup-task.ps1  # ÄÄƒng kÃ½ Task Scheduler (UAC)
â”‚   â””â”€â”€ cleanup-logs.ps1  # Cleanup log cÅ© + tmp leak
â”œâ”€â”€ check.ps1             # Health check nhanh (cháº¡y tay)
â””â”€â”€ README.md             # File nÃ y
```

## YÃªu cáº§u

- **Windows 10/11**
- **Node.js v18+** (Ä‘Ã£ test v24.14.0)
- **SumatraPDF** portable
- **NSSM 2.24+** (cho Windows Service)
- **Network:** má»Ÿ port 8883 (MQTTS) + 3000 (HTTPS API) tá»›i VPS `160.250.133.192`

## CÃ i Ä‘áº·t tá»« Ä‘áº§u

```powershell
# 1. Táº¡o thÆ° má»¥c
mkdir C:\print-system\tools
mkdir C:\print-system\agents\agent-01\tmp
mkdir C:\print-system\logs
mkdir C:\print-system\scripts

# 2. Táº£i SumatraPDF
Invoke-WebRequest -Uri "https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip" -OutFile "$env:TEMP\SumatraPDF.zip"
Expand-Archive "$env:TEMP\SumatraPDF.zip" -DestinationPath "C:\print-system\tools"
Move-Item "C:\print-system\tools\SumatraPDF-3.6.1-64.exe" "C:\print-system\tools\SumatraPDF.exe"

# 3. Láº¥y ca.crt tá»« VPS
python C:\print-system\scripts\fetch-cert.py

# 4. Táº¡o .env (xem file máº«u) vá»›i:
#    - BRANCH_ID, AGENT_TOKEN (láº¥y tá»« admin)
#    - MQTT_USER, MQTT_PASS
#    - PRINTER_NAME (tÃªn mÃ¡y in chÃ­nh xÃ¡c, má»Ÿ Printers xem)

# 5. CÃ i deps
cd C:\print-system
npm install

# 6. CÃ i NSSM
winget install NSSM.NSSM
# Hoáº·c táº£i thá»§ cÃ´ng vá» C:\Tools\nssm.exe

# 7. CÃ i Windows Service (cáº§n UAC)
powershell -File C:\print-system\scripts\install-service-elevated.ps1

# 8. ÄÄƒng kÃ½ Task Scheduler cleanup (cáº§n UAC)
powershell -File C:\print-system\scripts\register-cleanup-task.ps1
```

## Format in ra giáº¥y

Agent **luÃ´n Ã©p vá» A4 + fit-to-page** (qua SumatraPDF `-print-settings "1,a4,fit"`).

- **Khá»• giáº¥y**: A4 (máº·c Ä‘á»‹nh). CÃ³ thá»ƒ Ä‘á»•i: `a5`, `letter`, etc trong `.env`
- **Scaling**: `fit` (co/giÃ£n vá»«a khá»•). CÃ¡c giÃ¡ trá»‹ khÃ¡c: `shrink`, `noscale`
- **Orientation**: theo PDF gá»‘c (SumatraPDF khÃ´ng cÃ³ flag Ã©p portrait/landscape)

Config trong `.env`:
```
PRINT_SETTINGS=1,a4,fit
```

- PDF A4 portrait â†’ in A4 portrait (khá»›p, khÃ´ng scale)
- PDF A4 landscape â†’ in A4 landscape (xoay ngang)
- PDF Letter â†’ scale xuá»‘ng vá»«a A4
- Muá»‘n Ã©p portrait tuyá»‡t Ä‘á»‘i? Pháº£i xoay PDF trÆ°á»›c khi gá»­i (HQ phÃ­a client xá»­ lÃ½)

## Váº­n hÃ nh

### Kiá»ƒm tra tráº¡ng thÃ¡i

```powershell
# Health check tá»•ng
powershell -File C:\print-system\check.ps1

# Service status
Get-Service PrintAgent-br001

# Log real-time
Get-Content "C:\print-system\logs\$(Get-Date -Format 'yyyy-MM-dd').log" -Wait
```

### Start / Stop / Restart

```powershell
# Qua NSSM
C:\Tools\nssm.exe start PrintAgent-br001
C:\Tools\nssm.exe stop PrintAgent-br001
C:\Tools\nssm.exe restart PrintAgent-br001

# Qua PowerShell
Start-Service PrintAgent-br001
Stop-Service PrintAgent-br001
Restart-Service PrintAgent-br001
```

### Gá»­i job test

```powershell
$login = Invoke-RestMethod -Method POST -Uri "http://160.250.133.192:3000/api/auth/login" -ContentType "application/json" -Body '{"client_id":"<client_id_from_secret_manager>","client_secret":"<client_secret_from_secret_manager>"}'
$JWT = $login.token

# Tá»« PDF báº¥t ká»³
$pdf = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes("C:\path\to\file.pdf"))
$body = @{ branch_id = "br_001"; pdf_base64 = $pdf; metadata = @{ test = "manual" } } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "http://160.250.133.192:3000/api/print-jobs" -Headers @{Authorization = "Bearer $JWT"} -ContentType "application/json" -Body $body
```

## Common errors & fix

| Váº¥n Ä‘á» | NguyÃªn nhÃ¢n | Fix |
|---|---|---|
| `Missing env: BRANCH_ID` | `.env` sai path hoáº·c format | `cat .env` kiá»ƒm tra, khÃ´ng cÃ³ space quanh `=` |
| `unable to verify the first certificate` | `ca.crt` sai hoáº·c khÃ´ng Ä‘á»c Ä‘Æ°á»£c | `python scripts/fetch-cert.py` Ä‘á»ƒ láº¥y láº¡i |
| `Not authorized` (MQTT) | `MQTT_USER` / `MQTT_PASS` sai | Check vá»›i admin |
| `SumatraPDF exit 1` (khÃ´ng in Ä‘Æ°á»£c) | (1) `PRINTER_NAME` sai tÃªn; (2) thiáº¿u `-print-to` | Äáº·t `PRINTER_NAME=Brother HL-L2360D series (Copy 1)` (tÃªn chÃ­nh xÃ¡c) |
| `HTTP 401` khi callback | Token sai (Ä‘Ã£ regen trÃªn server?) | YÃªu cáº§u admin regen token + update `.env` |
| Service crash liÃªn tá»¥c | `AppDirectory` sai (process cháº¡y á»Ÿ `C:\Program Files\nodejs` khÃ´ng tÃ¬m tháº¥y `.env`) | `nssm set PrintAgent-br001 AppDirectory "C:\print-system"` rá»“i restart |
| Job stuck á»Ÿ 'sent' | Agent khÃ´ng cháº¡y hoáº·c callback fail | `check.ps1` xem service; xem log cÃ³ error khÃ´ng |

## Báº£o máº­t

- File `.env` chá»©a token, **KHÃ”NG commit git**, **KHÃ”NG share**
- File `ca.crt` khÃ´ng nháº¡y cáº£m (public cert) nhÆ°ng cÅ©ng khÃ´ng cáº§n share
- Token nÃªn Ä‘Æ°á»£c regen Ä‘á»‹nh ká»³ (qua API `/api/branches/:id/regen-token`)
- Náº¿u lá»™ token: SSH vÃ o VPS regen token má»›i, update `.env`, restart service

## LiÃªn há»‡

Admin: Huynh Phu Quy  
Server: VPS 160.250.133.192, `/opt/print-service/`  
Spec Ä‘áº§y Ä‘á»§: `docs/CLIENT_GUIDE.md`

