A chọn **Option 1** — tôi đã thêm endpoint `GET /api/print-jobs/:id/file` trên server rồi, không cần SFTP.

**Spec endpoint (đã apply + test pass trên server):**

- **Auth:** Headers `X-Agent-Token` + `X-Branch-Id` (giống các endpoint agent khác)
- **Response 200:** `Content-Type: application/pdf`, body là binary PDF
- **Response 410 Gone:** job đã `printed`/`failed` (file đã bị cleanup xóa — không in lại được)
- **Response 404:** job không tồn tại hoặc file path trên disk không còn
- **Response 401:** token sai / branch_id không tồn tại
- **Response 403:** branch_id khớp token nhưng job thuộc branch khác (chống replay)

**A cần update code agent:**

Trong `processJob`, khi job đến từ `fetchPending` (không có `pdf_base64`), gọi API download:

```js
async function downloadJobFile(jobId) {
  const tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
  const r = await axios.get(`${API_URL}/api/print-jobs/${jobId}/file`, {
    headers: {
      'X-Agent-Token': AGENT_TOKEN,
      'X-Branch-Id': BRANCH_ID,
    },
    responseType: 'arraybuffer',
    timeout: 30000,
    validateStatus: () => true, // mình check tay
  });

  if (r.status === 200) {
    fs.writeFileSync(tmpPath, Buffer.from(r.data));
    return tmpPath;
  }
  if (r.status === 410) return null;   // job đã in rồi → skip
  if (r.status === 404) return null;   // file bị cleanup xóa → skip
  throw new Error(`Download HTTP ${r.status}: ${JSON.stringify(r.data)}`);
}
```

**Flow mới trong `processJob`:**

```js
async function processJob(job) {
  const jobId = job.job_id || job.id;
  let tmpPath;

  if (job.pdf_base64) {
    // Job từ MQTT real-time — có sẵn base64
    const buf = Buffer.from(job.pdf_base64, 'base64');
    if (buf.subarray(0, 5).toString() !== '%PDF-') {
      return reportStatus(jobId, 'failed', 'Invalid PDF magic');
    }
    tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
    fs.writeFileSync(tmpPath, buf);
  } else {
    // Job từ fetchPending (sau reconnect) — phải download
    tmpPath = await downloadJobFile(jobId);
    if (!tmpPath) return; // 410/404 → skip im lặng
  }

  try {
    await printPdf(tmpPath, job.printer);
    await reportStatus(jobId, 'printed');
  } catch (e) {
    await reportStatus(jobId, 'failed', e.message);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (e) {}
  }
}
```

**KHÔNG dùng `file_path` từ list response** — đó là path trên VPS (vd `<INSTALL_DIR>/storage/...`), agent Windows không truy cập được. LUÔN download qua API.

Server đã test 8/8 case pass (download OK, 410 cho job printed, 401 cho token sai, 404 cho job not found, v.v.). A cứ code theo hướng dẫn, chạy thử báo lại kết quả.
