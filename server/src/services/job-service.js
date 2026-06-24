'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');
const mqttClient = require('../mqtt-client');
const { validatePdf } = require('./pdf-validator');
const { HttpError } = require('../errors');

/**
 * Tạo job mới: validate, lưu PDF, insert DB, publish MQTT
 * @param {object} params
 * @param {string} params.branchId
 * @param {string|null} params.printer
 * @param {Buffer} params.pdfBuffer - Raw PDF bytes (from multer memoryStorage)
 * @param {object} params.metadata
 * @param {string} params.clientId - ID của client tạo job (từ JWT)
 */
async function createJob({ branchId, printer, pdfBuffer, metadata, clientId }) {
 // Validate input
 if (!branchId) throw new HttpError(400, 'branch_id is required');
 if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
 throw new HttpError(400, 'pdf file is required');
 }

 // Check branch exists
 const branch = await stmts.getBranchById.get(branchId);
 if (!branch) throw new HttpError(404, `Branch '${branchId}' not found`);

 // Validate PDF magic bytes
 const err = validatePdf(pdfBuffer);
 if (err) throw new HttpError(400, err);

 // Generate job ID
 const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

 // Save PDF to storage
 const storageDir = path.resolve(__dirname, '..', '..', config.storage.path);
 fs.mkdirSync(storageDir, { recursive: true });
 const filePath = path.join(storageDir, `${jobId}.pdf`);
 fs.writeFileSync(filePath, pdfBuffer);

 // Insert DB (status=pending)
 const metadataJson = JSON.stringify(metadata || {});
 await stmts.insertJob.run({
 id: jobId,
 branch_id: branchId,
 printer: printer || null,
 file_path: filePath,
 metadata: metadataJson,
 client_id: clientId || null,
 created_at: Date.now(),
 });

 // Publish MQTT — chỉ metadata, agent sẽ tự GET /:id/file
 try {
 await mqttClient.publishJob(branchId, {
 job_id: jobId,
 version: 2, // protocol v2: agent always fetches PDF via HTTP
 printer: printer || null,
 metadata: metadata || {},
 created_at: Date.now(),
 });
 await stmts.markJobSent.run({ sent_at: Date.now(), id: jobId });
 } catch (e) {
 logger.error('Failed to publish job to MQTT', { job_id: jobId, err: e.message });
 // Vẫn trả 201 - job sẽ được retry bởi cron
 }

 return { job_id: jobId, status: 'queued' };
}

async function getJob(jobId) {
 const job = await stmts.getJobById.get(jobId);
 if (!job) throw new HttpError(404, 'Job not found');
 // Parse metadata JSON nếu có
 if (job.metadata) {
 try { job.metadata = JSON.parse(job.metadata); } catch (e) {}
 }
 return job;
}

async function listPendingForBranch(branchId) {
 const jobs = await stmts.listPendingJobsByBranch.all(branchId);
 return jobs.map((j) => {
 if (j.metadata) {
 try { j.metadata = JSON.parse(j.metadata); } catch (e) {}
 }
 return j;
 });
}

async function listAllJobs() {
 const jobs = await stmts.listJobs.all();
 return jobs.map((j) => {
 if (j.metadata) {
 try { j.metadata = JSON.parse(j.metadata); } catch (e) {}
 }
 return j;
 });
}

/**
 * Agent callback: báo printed/failed
 * Validate: branch_id trong job phải khớp với agent's branch (chống replay)
 */
async function updateJobStatus(jobId, branchId, status, errorMessage) {
 if (status !== 'printed' && status !== 'failed') {
 throw new HttpError(400, "status must be 'printed' or 'failed'");
 }
 const job = await stmts.getJobById.get(jobId);
 if (!job) throw new HttpError(404, 'Job not found');
 if (job.branch_id !== branchId) {
 throw new HttpError(403, 'Branch mismatch');
 }
 if (status === 'printed') {
 await stmts.markJobPrinted.run({ printed_at: Date.now(), id: jobId });
 } else {
 await stmts.markJobFailed.run({
 failed_at: Date.now(),
 error: errorMessage || 'unknown',
 id: jobId,
 });
 }
 // Update branch last_seen
 await stmts.updateBranchStatus.run({
 status: 'online',
 last_seen_at: Date.now(),
 id: branchId,
 });
 return { ok: true };
}

/**
 * Agent download PDF file cho job
 * Validate:
 * - job tồn tại
 * - branch_id khớp (chống agent br_001 download job br_002)
 * - status phải là 'pending' hoặc 'sent' (file đã bị cleanup nếu printed/failed)
 * - file_path vẫn còn trên disk
 * Returns: { absolutePath, fileSize }
 * Throws HttpError nếu lỗi
 */
async function getJobFileForAgent(jobId, branchId) {
 const job = await stmts.getJobById.get(jobId);
 if (!job) throw new HttpError(404, 'Job not found');
 if (job.branch_id !== branchId) {
 throw new HttpError(403, 'Branch mismatch');
 }
 if (job.status !== 'pending' && job.status !== 'sent') {
 throw new HttpError(410, `Job status is '${job.status}', file no longer available (only pending/sent jobs can be downloaded)`);
 }
 if (!job.file_path || !fs.existsSync(job.file_path)) {
 throw new HttpError(404, `PDF file missing for job ${jobId}`);
 }
 const stat = fs.statSync(job.file_path);
 return { absolutePath: job.file_path, fileSize: stat.size };
}

module.exports = {
 HttpError, // re-exported for tests + legacy callers (canonical source: src/errors.js)
 createJob,
 getJob,
 listPendingForBranch,
 listAllJobs,
 updateJobStatus,
 getJobFileForAgent,
};