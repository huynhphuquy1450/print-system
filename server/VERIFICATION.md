# Print Service - Hướng dẫn Verify & Vận hành

> **Giai đoạn 1 (MVP) — Print Service + Mosquitto** trên VPS Ubuntu `<SERVER_IP>`.
> Mọi endpoint đã được test end-to-end từ VPS ngày 2026-06-21.

## 1. Tổng quan hệ thống

```
[HQ ERP/CMS] --HTTPS API--> [Print Service :3000]
                                  |
                                  +--MQTT publish--> [Mosquitto :8883 TLS]
                                                          |
                                                          v
                                                   [Agent Windows] --> Máy in
```

**Tech stack:**
- Node.js 24.15.0 + Express 4
- MQTT broker: Mosquitto 2.0.18 (TLS self-signed, port 8883)
- DB: SQLite (WAL mode) tại `<INSTALL_DIR>/data/jobs.db`
- Process: PM2 7.0.1
- Firewall: UFW (allow 22, 3000, 8883)

## 2. Cấu trúc thư mục

```
<INSTALL_DIR>/
├── src/                # Source code
├── scripts/            # gen-client, gen-agents, health-check
├── data/jobs.db        # SQLite DB
├── data/backups/       # Daily backups (giữ 30 ngày)
├── storage/            # PDF files (giữ 7 ngày)
├── logs/               # app logs + pm2 logs
├── certs/              # Self-signed cert (copy ở /etc/mosquitto/certs/)
├── .env                # Secrets (chmod 600, KHÔNG commit git)
├── ecosystem.config.js # PM2 config
└── VERIFICATION.md     # File này
```

## 3. Thông tin test (GĐ1)

> **Dùng để test từ máy local Windows của a. KHÔNG dùng cho production.**

| Mục | Giá trị |
|---|---|
| **Server URL** | `http://<SERVER_IP>:3000` (HTTP chưa bật TLS — GĐ1) |
| **MQTT broker** | `mqtts://<SERVER_IP>:8883` |
| **MQTT CA cert** | Copy từ VPS: `scp <user>@<SERVER_IP>:/etc/mosquitto/certs/server.crt C:\print-system\ca.crt` |
| **Client ID** | `<CLIENT_ID>` |
| **Client Secret** | `<CLIENT_SECRET>` |
| **br_001 agent_token** | `<AGENT_TOKEN>` |
| **br_002 agent_token** | (regen mới qua API, xem §8) |
| **br_003 agent_token** | (regen mới qua API, xem §8) |
| **MQTT user/pass** | `printservice / <MQTT_PASS>` |
| **br_001 MQTT pass** | `<BRANCH_MQTT_PASS_br_001>` |
| **br_002 MQTT pass** | `<BRANCH_MQTT_PASS_br_002>` |
| **br_003 MQTT pass** | `<BRANCH_MQTT_PASS_br_003>` |

## 4. Vận hành cơ bản

### 4.1. Check trạng thái
```bash
pm2 status                              # print-service online?
pm2 logs print-service --lines 50       # Xem log
curl -s http://localhost:3000/health    # Health check
```

### 4.2. Restart / Stop / Start
```bash
pm2 restart print-service
pm2 stop print-service
pm2 start print-service
pm2 logs print-service --raw            # Tail log realtime
```

### 4.3. PM2 auto-start khi reboot VPS
```bash
# Đã chạy khi deploy, kiểm tra:
pm2 startup     # In ra lệnh systemd cần chạy (vd: sudo env PATH=...)
pm2 save        # Lưu process list hiện tại
```

### 4.4. Mosquitto
```bash
sudo systemctl status mosquitto
sudo systemctl restart mosquitto
sudo tail -f /var/log/mosquitto/mosquitto.log
```

### 4.5. Firewall
```bash
sudo ufw status verbose                 # 22, 3000, 8883 allowed
sudo ufw allow 8883/tcp                 # Mở thêm nếu cần
```

## 5. Test API bằng curl (chạy trên VPS)

### 5.1. Health check
```bash
curl -s http://localhost:3000/health
# {"status":"ok","mqtt":"connected","db":"ok","uptime_seconds":N,"env":"production"}
```

### 5.2. Login → lấy JWT
```bash
CLIENT_ID="<CLIENT_ID>"
CLIENT_SECRET="<CLIENT_SECRET>"

JWT=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\"}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")
echo "JWT: $JWT"
```

### 5.3. Tạo print job
```bash
# Tạo file PDF test
cat > /tmp/test.pdf <<'EOF'
%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
trailer<</Size 4/Root 1 0 R>>
startxref
100
%%EOF
EOF

# Encode → base64
PDF_BASE64=$(base64 -w 0 /tmp/test.pdf)

# Gửi job
curl -s -X POST http://localhost:3000/api/print-jobs \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d "{\"branch_id\":\"br_001\",\"pdf_base64\":\"$PDF_BASE64\",\"metadata\":{\"contract\":\"HD-001\"}}"
# → {"job_id":"job_...","status":"queued"}
```

### 5.4. Xem job status
```bash
JOB_ID="job_xxx_yyyy"   # Lấy từ response trên
curl -s "http://localhost:3000/api/print-jobs/$JOB_ID" -H "Authorization: Bearer $JWT"
```

### 5.5. List branches
```bash
curl -s http://localhost:3000/api/branches -H "Authorization: Bearer $JWT"
```

### 5.6. List jobs (admin)
```bash
curl -s http://localhost:3000/api/print-jobs -H "Authorization: Bearer $JWT"   # KHÔNG có /:id
```

## 6. Test MQTT pub/sub

### 6.1. Từ VPS (local test)
```bash
# Subscribe br_001 (sẽ thấy job gửi tới br_001)
mosquitto_sub -h <SERVER_IP> -p 8883 \
  -u br_001 -P "<BRANCH_MQTT_PASS_br_001>" \
  --cafile /etc/mosquitto/certs/server.crt \
  -t "company/printer/br_001/#" -v

# Mở terminal khác, publish thử (giả lập server)
mosquitto_pub -h <SERVER_IP> -p 8883 \
  -u printservice -P "<MQTT_PASS>" \
  --cafile /etc/mosquitto/certs/server.crt \
  -t "company/printer/br_001/jobs" \
  -m '{"job_id":"test","pdf_base64":"..."}'
```

### 6.2. Từ máy Windows local của a
```cmd
:: 1. Copy CA cert từ VPS về
scp <user>@<SERVER_IP>:/etc/mosquitto/certs/server.crt C:\print-system\ca.crt

:: 2. Download mosquitto client Windows từ https://mosquitto.org/files/binary/win64/
::    Giải nén, thêm vào PATH

:: 3. Subscribe để xem job (giống agent sẽ làm)
mosquitto_sub -h <SERVER_IP> -p 8883 -u br_001 -P <BRANCH_MQTT_PASS_br_001> --cafile C:\print-system\ca.crt -t "company/printer/br_001/#" -v
```

## 7. Test agent callback (giả lập agent in xong)

```bash
AGENT_TOKEN="<AGENT_TOKEN>"

# Báo in thành công
curl -s -X POST "http://localhost:3000/api/print-jobs/$JOB_ID/status" \
  -H "X-Agent-Token: $AGENT_TOKEN" \
  -H "X-Branch-Id: br_001" \
  -H 'Content-Type: application/json' \
  -d '{"status":"printed"}'
# → {"ok":true}

# Báo in lỗi
curl -s -X POST "http://localhost:3000/api/print-jobs/$JOB_ID/status" \
  -H "X-Agent-Token: $AGENT_TOKEN" \
  -H "X-Branch-Id: br_001" \
  -H 'Content-Type: application/json' \
  -d '{"status":"failed","error":"printer offline"}'
```

## 8. Tạo thêm branch / rotate token

### 8.1. Tạo 1 branch
```bash
curl -s -X POST http://localhost:3000/api/branches \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Chi nhánh Hà Nội","location":"Hà Nội"}'
# → {"id":"br_xxx","name":"...","agent_token":"..."}  ← LƯU TOKEN!
```

### 8.2. Bulk tạo N branches
```bash
# Tạo 30 branches br_001..br_030
curl -s -X POST http://localhost:3000/api/admin/agents \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"count":30,"prefix":"br_","name_template":"Chi nhánh {n}"}'
```

### 8.3. Rotate agent token (mất token cũ)
```bash
curl -s -X POST http://localhost:3000/api/branches/br_001/regen-token \
  -H "Authorization: Bearer $JWT"
# → {"id":"br_001","agent_token":"NEW_TOKEN"}  ← Update vào agent .env ngay
```

## 9. Backup / Restore DB

```bash
# Backups tự động mỗi ngày 2h sáng (cron backup-db)
# File ở: <INSTALL_DIR>/data/backups/jobs-YYYY-MM-DD.db
ls -la <INSTALL_DIR>/data/backups/

# Restore từ backup
pm2 stop print-service
cp <INSTALL_DIR>/data/backups/jobs-2026-06-21.db <INSTALL_DIR>/data/jobs.db
pm2 start print-service
```

## 10. Cron jobs (chạy tự động trong service)

| Job | Lịch | File | Mục đích |
|---|---|---|---|
| `retry-stale` | Mỗi 5 phút | `src/jobs/retry-stale.js` | Republish job `sent` quá 5p (max 5 retry) |
| `cleanup-files` | 3h sáng mỗi ngày | `src/jobs/cleanup-files.js` | Xóa PDF + jobs rows > 7 ngày |
| `backup-db` | 2h sáng mỗi ngày | `src/jobs/backup-db.js` | Copy `jobs.db` → `backups/jobs-YYYY-MM-DD.db` (giữ 30 ngày) |

## 11. Khi nào scale lên Giai đoạn 2 (mua domain)

Checklist trước khi scale:
- [ ] In thật ra giấy OK từ máy local
- [ ] 3 agents chạy song song, đúng branch nhận job
- [ ] Reconnect khi mất mạng OK
- [ ] Retry cron republish OK
- [ ] Backup tự động tạo file OK
- [ ] Code ổn định, không bug trong 1 tuần test

Khi sẵn sàng → mua domain (~$10/năm tại Namecheap/Google), setup Let's Encrypt, đổi URL từ IP sang domain. Hướng dẫn chi tiết ở plan gốc §1.8.

## 12. Common issues

| Lỗi | Nguyên nhân | Fix |
|---|---|---|
| `Error: Connection refused` (agent) | MQTT broker chưa chạy hoặc firewall chặn | `sudo systemctl status mosquitto` + `sudo ufw status` |
| `Protocol error` (mosquitto_pub) | Cert không có SAN trùng hostname | Connect bằng IP, hoặc regen cert có SAN `localhost`/`127.0.0.1` |
| `Invalid agent token` | Token bị regen mà agent chưa update | Regen token rồi copy vào `agent/.env` |
| `EADDRINUSE :::3000` | Process cũ còn giữ port | `fuser -k 3000/tcp` rồi restart |
| DB locked | 2 process mở DB cùng lúc (không nên) | Chỉ 1 instance print-service, SQLite hỗ trợ concurrent read OK |

## 13. Tham chiếu nhanh

**File config quan trọng (VPS):**
- `/etc/mosquitto/conf.d/print-service.conf` — MQTT broker
- `/etc/mosquitto/acl` — ACL per-branch
- `/etc/mosquitto/passwd` — MQTT users (hash)
- `<INSTALL_DIR>/.env` — App secrets (chmod 600)
- `<INSTALL_DIR>/ecosystem.config.js` — PM2
- `/etc/mosquitto/certs/server.crt` + `server.key` — Self-signed TLS

**Scripts:**
- `node scripts/gen-client.js <name>` — Tạo client mới
- `node scripts/gen-agents.js <count> [prefix]` — Tạo N branch
- `node scripts/health-check.js` — Test health từ CLI
