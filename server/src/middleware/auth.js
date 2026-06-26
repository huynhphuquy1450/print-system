'use strict';

const { stmts } = require('../db');
const { verifyClientJwt } = require('../services/auth-service');
const { verifyAgentToken } = require('../services/token-service');
const alertService = require('../services/alert-service');

/**
 * Verify client JWT
 * Header: Authorization: Bearer <jwt>
 */
function verifyClient(req, res, next) {
 const auth = req.headers.authorization || '';
 const m = auth.match(/^Bearer\s+(.+)$/i);
 if (!m) {
 return res.status(401).json({ error: 'Missing Authorization header' });
 }
 const decoded = verifyClientJwt(m[1]);
 if (!decoded) {
 return res.status(401).json({ error: 'Invalid or expired token' });
 }
 req.client = { id: decoded.sub, name: decoded.name };
 next();
}

/**
 * Verify agent token (device credential)
 * Headers:
 * X-Agent-Token: <plaintext token>
 * X-Branch-Id: <branch id>
 */
function verifyAgent(req, res, next) {
 (async () => {
 try {
 const token = req.headers['x-agent-token'];
 const branchId = req.headers['x-branch-id'];
 if (!token) {
 return res.status(401).json({ error: 'Missing X-Agent-Token' });
 }
 if (!branchId) {
 return res.status(401).json({ error: 'Missing X-Branch-Id' });
 }
 // Tìm branch theo id, check token hash
 const branch = await stmts.getBranchById.get(branchId);
 if (!branch) {
 return res.status(401).json({ error: 'Invalid branch' });
 }
 const ok = verifyAgentToken(token, branch.agent_token_hash);
 if (!ok) {
 return res.status(401).json({ error: 'Invalid agent token' });
 }
 // Phát hiện recovery: branch vừa được xác nhận online sau khi đã offline
 const wasRecovered = branch.status === 'offline' && branch.last_seen_at != null;
 req.agent = { branchId, branchName: branch.name, clientId: branch.client_id };
 // Update last_seen (best-effort; failure shouldn't block the request)
 stmts.updateBranchStatus.run({
 status: 'online',
 last_seen_at: Date.now(),
 id: branchId,
 }).catch(() => { /* ignore */ });
 if (wasRecovered) {
 // Branch vừa lên lại sau offline → bắn alert recovery, fire-and-forget
 alertService.emit({ clientId: branch.client_id, branchId, alertType: 'branch.online', status: 'online' }).catch(() => {});
 }
 next();
 } catch (e) {
 next(e);
 }
 })();
}

module.exports = { verifyClient, verifyAgent };