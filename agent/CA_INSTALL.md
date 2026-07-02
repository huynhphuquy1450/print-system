# Hướng dẫn cài đặt Root CA Certificate trên Windows

Khi server dùng **cert nội bộ** (self-signed HOẶC Step-CA) thay cho Let's Encrypt,
máy agent Windows cần "tin tưởng" CA này — nếu không, kết nối TLS sẽ fail với
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` hoặc `CERT_AUTHORITY_INVALID`.

> **Deployment mặc định:** broker MQTT (8883) dùng cert **self-signed**
> `CN=<server_ip>`; `root_ca.crt` chính là cert đó (trên server:
> `cp /etc/mosquitto/certs/server.crt root_ca.crt`). Nếu API chạy HTTP:3000 (mặc định,
> `HTTPS_ENABLED=false`) thì agent KHÔNG cần CA cho API — chỉ cần cho MQTTS. CA chỉ bắt buộc
> cho HTTPS. Nếu deployment của bạn dùng **Step-CA** (PKI nội bộ, xem `server/scripts/setup-step-ca.sh`)
> thay vì self-signed, các bước cài root CA dưới đây vẫn giống hệt — chỉ khác nguồn gốc cert.
>
> **Lưu ý Node:** import vào Windows Trusted Root KHÔNG giúp agent (Node bỏ qua
> Windows cert store). Agent tin CA qua `MQTT_CA_FILE` (root_ca.crt) cho MQTT +
> axios httpsAgent; installer còn set `NODE_EXTRA_CA_CERTS`. Việc import Trusted
> Root bên dưới chỉ giúp browser/WinHTTP/`curl.exe`.

## Khi nào cần làm

- Lần đầu tiên cài agent cho một chi nhánh mới.
- Mỗi khi root CA được rotate (thường rất hiếm, Step-CA root có thể valid
  nhiều năm — nhưng vẫn có thể xảy ra).

## Files cần từ HQ IT

| File | Mô tả |
|---|---|
| `root_ca.crt` | Certificate CA nội bộ — self-signed (mặc định) hoặc Step-CA root tuỳ deployment (~2-5KB, định dạng PEM/X.509). |
| `CA password` (optional) | Nếu CA được re-issue, HQ sẽ thông báo. |

## Các bước cài (Windows 10/11)

### Phương pháp 1: GUI (khuyến nghị, dễ nhất)

1. Copy `root_ca.crt` vào máy agent (qua email mã hóa, USB, hoặc share
   nội bộ an toàn).
2. **Double-click** file `root_ca.crt`.
3. Hộp thoại "Certificate" mở ra → click **Install Certificate...**
4. Chọn **Local Machine** (cần admin) → Next.
5. Chọn **Place all certificates in the following store** → **Browse...**
6. Tick **Show physical stores** → mở **Trusted Root Certification
   Authorities** → chọn **Local Computer** → OK → Next.
7. **Finish**. Nếu có UAC prompt → Yes.
8. Verify: tab "Certification Path" phải hiện
   CN của server (self-signed: `CN=<server_ip>`, vd `<SERVER_IP>`) với dấu tick xanh.

### Phương pháp 2: certlm.msc (cho IT admin, nhiều máy)

1. Mở `certlm.msc` (Run as Administrator).
2. Navigate: **Certificates - Local Computer** → **Trusted Root
   Certification Authorities** → **Certificates**.
3. Right-click **Certificates** → **All Tasks** → **Import...**
4. Browse tới `root_ca.crt` → Next → Place in "Trusted Root
   Certification Authorities" → Finish.
5. Verify: cert `CN=<server_ip>` (vd `<SERVER_IP>`) xuất hiện trong list.

### Phương pháp 3: PowerShell (script, nhiều máy)

```powershell
# Run as Administrator
Import-Certificate `
  -FilePath "C:\path\to\root_ca.crt" `
  -CertStoreLocation Cert:\LocalMachine\Root
```

Verify:

```powershell
Get-ChildItem Cert:\LocalMachine\Root |
  Where-Object { $_.Subject -match "<SERVER_IP>" } |   # đổi theo CN cert của bạn
  Select-Object Subject, NotAfter, Thumbprint
```

## Verify kết nối

Sau khi cài root CA, test từ PowerShell. **Bắt buộc** (mọi deployment): MQTT TLS. **Tuỳ chọn**
(chỉ khi server bật `HTTPS_ENABLED=true`): HTTPS API — mặc định API chạy HTTP:3000, không cần CA.

```powershell
# Test MQTT TLS (should connect without UNABLE_TO_VERIFY_LEAF_SIGNATURE)
mosquitto_pub -h <SERVER_IP> -p 8883 `
  -t test/connectivity -m "ping" `
  --cafile C:\print-system\root_ca.crt `
  -u printservice -P '<mqtt_pass>'

# Chỉ chạy nếu API_URL dùng https:// (HTTPS_ENABLED=true trên server):
curl.exe --cacert C:\print-system\root_ca.crt `
  https://<SERVER_IP>:443/api/health
```

Command(s) phải chạy thành công, không có cảnh báo certificate.

## Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|---|---|---|
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Root CA chưa được cài, hoặc cài sai store. | Mở `certlm.msc` → Trusted Root → kiểm tra có cert `CN=<server_ip>` không. |
| `CERT_AUTHORITY_INVALID` | CA cert hết hạn hoặc bị revoke. | Liên hệ HQ IT để lấy root CA mới. |
| `ERR_CERT_COMMON_NAME_INVALID` | Server cert không match hostname. | Kiểm tra server cert phải có SAN = `<SERVER_IP>`. Nếu agent dùng DNS khác, cần provision cert mới với SAN tương ứng. |
| Cài vào "Personal" thay vì "Trusted Root" | Nhầm store. | Remove cert khỏi Personal, cài lại vào Trusted Root. |

## Lưu ý bảo mật

- **Không commit** `root_ca.crt` vào git — file này nằm ngoài repo, distribute
  riêng qua kênh an toàn.
- Root CA chỉ cần cài trên **máy agent**, không cần trên server (server đã
  trust CA tự nhiên vì nó issue cert).
- Nếu máy agent bị compromise, **remove root CA** trên máy đó + rotate cert trên server
  (self-signed: tạo lại cert Mosquitto rồi restart; Step-CA: chạy `renew-step-certs.sh` với `--force`).
