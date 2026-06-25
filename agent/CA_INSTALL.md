# Hướng dẫn cài đặt Root CA Certificate trên Windows

Khi server dùng **Step-CA** (internal PKI) thay cho Let's Encrypt, máy tính
agent Windows cần được "tin tưởng" CA này — nếu không, mọi kết nối HTTPS
sẽ fail với lỗi `UNABLE_TO_VERIFY_LEAF_SIGNATURE` hoặc
`CERT_AUTHORITY_INVALID`.

## Khi nào cần làm

- Lần đầu tiên cài agent cho một chi nhánh mới.
- Mỗi khi root CA được rotate (thường rất hiếm, Step-CA root có thể valid
  nhiều năm — nhưng vẫn có thể xảy ra).

## Files cần từ HQ IT

| File | Mô tả |
|---|---|
| `root_ca.crt` | Certificate của Step-CA root (~2-5KB, định dạng PEM/X.509). |
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
   "Print System Internal CA" với dấu tick xanh.

### Phương pháp 2: certlm.msc (cho IT admin, nhiều máy)

1. Mở `certlm.msc` (Run as Administrator).
2. Navigate: **Certificates - Local Computer** → **Trusted Root
   Certification Authorities** → **Certificates**.
3. Right-click **Certificates** → **All Tasks** → **Import...**
4. Browse tới `root_ca.crt` → Next → Place in "Trusted Root
   Certification Authorities" → Finish.
5. Verify: tên "Print System Internal CA" xuất hiện trong list.

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
  Where-Object { $_.Subject -match "Print System" } |
  Select-Object Subject, NotAfter, Thumbprint
```

## Verify kết nối

Sau khi cài root CA, test từ PowerShell:

```powershell
# Test HTTPS API (should be 200 OK with no cert warning)
curl.exe --cacert C:\print-system\root_ca.crt `
  https://160.250.133.192:443/api/health

# Test MQTT TLS (should connect without UNABLE_TO_VERIFY_LEAF_SIGNATURE)
mosquitto_pub -h 160.250.133.192 -p 8883 `
  -t test/connectivity -m "ping" `
  --cafile C:\print-system\root_ca.crt `
  -u printservice -P '<mqtt_pass>'
```

Cả hai command phải chạy thành công, không có cảnh báo certificate.

## Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|---|---|---|
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Root CA chưa được cài, hoặc cài sai store. | Mở `certlm.msc` → Trusted Root → kiểm tra có "Print System Internal CA" không. |
| `CERT_AUTHORITY_INVALID` | CA cert hết hạn hoặc bị revoke. | Liên hệ HQ IT để lấy root CA mới. |
| `ERR_CERT_COMMON_NAME_INVALID` | Server cert không match hostname. | Kiểm tra server cert phải có SAN = `160.250.133.192`. Nếu agent dùng DNS khác, cần provision cert mới với SAN tương ứng. |
| Cài vào "Personal" thay vì "Trusted Root" | Nhầm store. | Remove cert khỏi Personal, cài lại vào Trusted Root. |

## Lưu ý bảo mật

- **Không commit** `root_ca.crt` vào git — file này nằm ngoài repo, distribute
  riêng qua kênh an toàn.
- Root CA chỉ cần cài trên **máy agent**, không cần trên server (server đã
  trust CA tự nhiên vì nó issue cert).
- Nếu máy agent bị compromise, **remove root CA** trên máy đó + rotate
  cert trên server (chạy `renew-step-certs.sh` với `--force`).
