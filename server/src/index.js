const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BODY = 1_000_000;

function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } }); }
function nowIso() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function un64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function randomBytes(size) { return crypto.getRandomValues(new Uint8Array(size)); }
function randomToken() { return b64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value)); }
async function hashPairCode(env, code, salt) {
  if (!env.PAIR_CODE_PEPPER) throw new HttpError(503, 'Pairing is not configured on this server.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.PAIR_CODE_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, encoder.encode(`${code}:${salt}`)));
}
async function passwordHash(password, saltB64) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: un64(saltB64), iterations: 310000, hash: 'SHA-256' }, material, 256);
  return b64(bits);
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
async function bodyJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw new Error('Request body is too large.');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error('Request body is too large.');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
}
function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  try {
    const o = new URL(origin);
    const u = new URL(request.url);
    if (o.origin === u.origin) return true;
    return Boolean(env.APP_ORIGIN && o.origin === env.APP_ORIGIN);
  } catch { return false; }
}
function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = origin.startsWith('chrome-extension://') || (() => {
    try {
      const requestOrigin = new URL(request.url).origin;
      const candidateOrigin = new URL(origin).origin;
      const appOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : '';
      return candidateOrigin === requestOrigin || candidateOrigin === appOrigin;
    } catch { return false; }
  })();
  return allowed ? { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS', 'access-control-allow-headers': 'Content-Type,Authorization,X-Admin-Key', 'access-control-max-age': '600' } : {};
}
async function rateLimit(env, key, limit, windowSeconds = 300) {
  // One atomic UPSERT avoids the read/modify/write race in concurrent Worker requests.
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(rate_key,window_start,hits) VALUES(?,?,1)
    ON CONFLICT(rate_key) DO UPDATE SET
      hits=CASE WHEN excluded.window_start-rate_limits.window_start>=? THEN 1 ELSE rate_limits.hits+1 END,
      window_start=CASE WHEN excluded.window_start-rate_limits.window_start>=? THEN excluded.window_start ELSE rate_limits.window_start END
    RETURNING hits`).bind(key, now, windowSeconds, windowSeconds).first();
  return Boolean(row && row.hits <= limit);
}
async function audit(env, familyId, actorType, actorId, eventType, metadata = {}) {
  await env.DB.prepare('INSERT INTO audit_log(id,family_id,actor_type,actor_id,event_type,created_at,metadata_json) VALUES(?,?,?,?,?,?,?)')
    .bind(id(), familyId || null, actorType, actorId || null, eventType, nowIso(), JSON.stringify(metadata).slice(0, 4000)).run();
}
function bearer(request) { const h = request.headers.get('authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; }
async function requireParent(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Sign in required.');
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT s.user_id,s.family_id,s.expires_at,u.email,f.status AS family_status,l.status AS license_status,l.expires_at AS license_expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN families f ON f.id=s.family_id LEFT JOIN licenses l ON l.activated_family_id=s.family_id WHERE s.token_hash=?`).bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= Date.now() || row.family_status !== 'active' || row.license_status !== 'active' || (row.license_expires_at && Date.parse(row.license_expires_at) <= Date.now())) throw new HttpError(401, 'Session expired or family account is unavailable.');
  return { userId: row.user_id, familyId: row.family_id, email: row.email, token };
}
async function requireDevice(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Paired device authentication required.');
  const row = await env.DB.prepare(`SELECT d.id,d.family_id,d.device_name,d.status,l.status AS license_status,l.expires_at AS license_expires_at
    FROM devices d JOIN licenses l ON l.activated_family_id=d.family_id WHERE d.token_hash=?`).bind(await sha256(token)).first();
  if (!row || row.status !== 'active' || row.license_status !== 'active' || (row.license_expires_at && Date.parse(row.license_expires_at) <= Date.now())) throw new HttpError(401, 'Device is not active. Ask the parent to review device access.');
  return { deviceId: row.id, familyId: row.family_id, deviceName: row.device_name };
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function validEmail(email) { return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validDomain(domain) { return typeof domain === 'string' && domain.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain); }
function decodeBase64(value) {
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return null; }
}
function safePublicKey(value) {
  const raw = decodeBase64(value);
  return Boolean(raw && raw.length === 65 && raw[0] === 4);
}
async function validP256PublicKey(value) {
  if (!safePublicKey(value)) return false;
  try { await crypto.subtle.importKey('raw', decodeBase64(value), { name: 'ECDH', namedCurve: 'P-256' }, false, []); return true; }
  catch { return false; }
}
function safeKeybox(box) {
  if (!box || box.v !== 1 || JSON.stringify(box).length >= 10000 || !safePublicKey(box.ephemeralPublicKey)) return false;
  const salt = decodeBase64(box.salt), iv = decodeBase64(box.iv), ciphertext = decodeBase64(box.ciphertext);
  return Boolean(salt?.length === 16 && iv?.length === 12 && ciphertext && ciphertext.length >= 32 && ciphertext.length <= 7500);
}
function safePolicyEnvelope(box) {
  if (!box || box.v !== 1 || box.alg !== 'A256GCM' || box.aad !== 'guardian53-policy-v1' || JSON.stringify(box).length > 900000) return false;
  const iv = decodeBase64(box.iv), ciphertext = decodeBase64(box.ct);
  return Boolean(iv?.length === 12 && ciphertext && ciphertext.length >= 16 && ciphertext.length <= 680000);
}
async function requireAdmin(request, env) {
  const candidate = request.headers.get('x-admin-key') || '';
  if (!env.ADMIN_API_KEY || !constantTimeEqual(candidate, env.ADMIN_API_KEY)) throw new HttpError(403, 'Product administrator access denied.');
}
const licenseAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeLicenseCode() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map(n => licenseAlphabet[n & 31]);
  return `G53-${chars.slice(0,4).join('')}-${chars.slice(4,8).join('')}-${chars.slice(8,12).join('')}`;
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  if (method === 'GET' && path === '/api/health') return json({ ok: true, service: 'guardian53-relay', time: nowIso() });

  if (method === 'POST' && path === '/api/auth/register') {
    if (!(await rateLimit(env, `register:${ip}`, 10, 3600))) throw new HttpError(429, 'Too many registration attempts.');
    const body = await bodyJson(request);
    if (!validEmail(body.email) || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128 || typeof body.licenseCode !== 'string') throw new HttpError(400, 'Enter a valid email, a 12-character password, and a license code.');
    const licenseHash = await sha256(body.licenseCode.trim().toUpperCase());
    const license = await env.DB.prepare('SELECT * FROM licenses WHERE code_hash=?').bind(licenseHash).first();
    if (!license || license.status !== 'available' || (license.expires_at && Date.parse(license.expires_at) <= Date.now())) throw new HttpError(403, 'License code is invalid, expired, or already used.');
    const familyId = id(), userId = id(), salt = b64(randomBytes(16));
    const hash = await passwordHash(body.password, salt);
    try {
      const batchResult = await env.DB.batch([
        env.DB.prepare('UPDATE licenses SET status=?,activated_family_id=? WHERE id=? AND status=? AND (expires_at IS NULL OR expires_at>?)').bind('active', familyId, license.id, 'available', nowIso()),
        env.DB.prepare(`INSERT INTO families(id,status,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM licenses WHERE id=? AND activated_family_id=? AND status=?)`).bind(familyId, 'active', nowIso(), license.id, familyId, 'active'),
        env.DB.prepare(`INSERT INTO users(id,family_id,email,password_salt,password_hash,created_at) SELECT ?,id,?,?,?,? FROM families WHERE id=?`).bind(userId, body.email.trim().toLowerCase(), salt, hash, nowIso(), familyId)
      ]);
      if (!batchResult[0].meta.changes || !batchResult[1].meta.changes || !batchResult[2].meta.changes) throw new HttpError(409, 'License was activated by another registration or is no longer available.');
    } catch (e) { if (e instanceof HttpError) throw e; if (String(e).includes('UNIQUE')) throw new HttpError(409, 'An account with this email already exists.'); throw e; }
    return createSession(env, userId, familyId, body.email.trim().toLowerCase());
  }

  if (method === 'POST' && path === '/api/auth/login') {
    if (!(await rateLimit(env, `login-ip:${ip}`, 40, 900))) throw new HttpError(429, 'Too many sign-in attempts from this network. Try again later.');
    const body = await bodyJson(request);
    const loginEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!validEmail(loginEmail) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) throw new HttpError(400, 'Enter a valid email and password.');
    if (!(await rateLimit(env, `login-email:${await sha256(loginEmail)}`, 12, 900))) throw new HttpError(429, 'Too many sign-in attempts for this account. Try again later.');
    const user = await env.DB.prepare('SELECT id,family_id,email,password_salt,password_hash FROM users WHERE email=? COLLATE NOCASE').bind(loginEmail).first();
    if (!user) throw new HttpError(401, 'Email or password is incorrect.');
    const attempt = await passwordHash(body.password, user.password_salt);
    if (!constantTimeEqual(attempt, user.password_hash)) throw new HttpError(401, 'Email or password is incorrect.');
    return createSession(env, user.id, user.family_id, user.email);
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const parentAuth = await requireParent(request, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(parentAuth.token)).run();
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/pair/redeem') {
    if (!(await rateLimit(env, `pair:${ip}`, 12, 300))) throw new HttpError(429, 'Too many pairing attempts.');
    const body = await bodyJson(request);
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code) || typeof body.publicKey !== 'string' || body.publicKey.length > 256 || !(await validP256PublicKey(body.publicKey)) || typeof body.deviceName !== 'string' || body.deviceName.length > 120) throw new HttpError(400, 'Invalid pairing details.');
    let codeRow = null;
    // Hash each candidate against active codes using a time-bounded query, avoiding storing the six digits.
    const candidates = await env.DB.prepare('SELECT id,family_id,salt,expires_at FROM pair_codes WHERE used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100').bind(nowIso()).all();
    for (const candidate of candidates.results || []) {
      if (constantTimeEqual(await hashPairCode(env, body.code, candidate.salt), candidate.code_hash)) { codeRow = candidate; break; }
    }
    if (!codeRow) throw new HttpError(404, 'Connection code is invalid or expired.');
    if (!(await rateLimit(env, `pair-family:${codeRow.family_id}`, 15, 300))) throw new HttpError(429, 'Too many pairing attempts for this family. Try again later.');
    const pairingSecret = randomToken();
    const deviceId = id();
    const name = body.deviceName.trim().slice(0, 80) || 'Child browser';
    const redeemedAt = nowIso();
    const redemptionTag = `${redeemedAt}#${id()}`;
    const redemption = await env.DB.batch([
      env.DB.prepare('UPDATE pair_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?').bind(redemptionTag, codeRow.id, redeemedAt),
      env.DB.prepare(`INSERT INTO devices(id,family_id,device_name,status,public_key,pairing_secret_hash,created_at,updated_at)
        SELECT ?,family_id,?,?,?, ?,?,? FROM pair_codes WHERE id=? AND used_at=?`)
        .bind(deviceId, name, 'pending', body.publicKey, await sha256(pairingSecret), redeemedAt, redeemedAt, codeRow.id, redemptionTag)
    ]);
    if (!redemption[0].meta.changes || !redemption[1].meta.changes) throw new HttpError(409, 'Connection code has already been used.');
    await audit(env, codeRow.family_id, 'child', deviceId, 'device_pair_requested', { deviceName: name });
    return json({ deviceId, pairingSecret, status: 'pending', expiresInSeconds: 300 }, 201);
  }

  if (method === 'GET' && path === '/api/pair/status') {
    const secret = bearer(request);
    if (!secret) throw new HttpError(401, 'Pairing session required.');
    const row = await env.DB.prepare(`SELECT d.id,d.status,d.keybox,d.updated_at,l.status AS license_status,l.expires_at AS license_expires_at
      FROM devices d JOIN licenses l ON l.activated_family_id=d.family_id WHERE d.pairing_secret_hash=?`).bind(await sha256(secret)).first();
    if (!row) throw new HttpError(404, 'Pairing session not found or expired.');
    if (row.license_status !== 'active' || (row.license_expires_at && Date.parse(row.license_expires_at) <= Date.now())) {
      await env.DB.prepare('UPDATE devices SET keybox=NULL,pairing_secret_hash=NULL,updated_at=? WHERE id=?').bind(nowIso(), row.id).run();
      return json({ deviceId: row.id, status: 'revoked', keybox: null });
    }
    if (row.status === 'pending') {
      const created = await env.DB.prepare('SELECT created_at FROM devices WHERE id=?').bind(row.id).first();
      if (created && Date.now() - Date.parse(created.created_at) > 5 * 60 * 1000) {
        await env.DB.prepare('UPDATE devices SET status=?,pairing_secret_hash=NULL,updated_at=? WHERE id=? AND status=?').bind('expired', nowIso(), row.id, 'pending').run();
        return json({ deviceId: row.id, status: 'expired', keybox: null });
      }
    }
    return json({ deviceId: row.id, status: row.status, keybox: row.status === 'active' && row.keybox ? JSON.parse(row.keybox) : null, updatedAt: row.updated_at });
  }
  if (method === 'POST' && path === '/api/pair/complete') {
    const secret = bearer(request);
    if (!secret) throw new HttpError(401, 'Pairing session required.');
    const result = await env.DB.prepare('UPDATE devices SET keybox=NULL,pairing_secret_hash=NULL,updated_at=? WHERE pairing_secret_hash=? AND status IN (?,?,?)').bind(nowIso(), await sha256(secret), 'active', 'denied', 'expired').run();
    if (!result.meta.changes) throw new HttpError(404, 'Active pairing result not found.');
    return json({ ok: true });
  }

  if (method.startsWith('POST') && path.startsWith('/api/admin/')) {
    if (!(await rateLimit(env, `admin-ip:${ip}`, 30, 300))) throw new HttpError(429, 'Too many administrator requests.');
    await requireAdmin(request, env);
    if (path === '/api/admin/licenses') {
      const body = await bodyJson(request);
      const count = body.count == null ? 1 : Number(body.count);
      const maxDevices = body.maxDevices == null ? 5 : Number(body.maxDevices);
      const expiresDays = body.expiresDays == null ? null : Number(body.expiresDays);
      if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100 || (expiresDays !== null && (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650))) throw new HttpError(400, 'Count, device limit, or expiry is outside the allowed range.');
      const issued = [];
      for (let i = 0; i < count; i++) {
        const code = makeLicenseCode(); const licenseId = id();
        await env.DB.prepare('INSERT INTO licenses(id,code_hash,label,status,max_devices,expires_at,created_at) VALUES(?,?,?,?,?,?,?)')
          .bind(licenseId, await sha256(code), String(body.label || '').slice(0,120), 'available', maxDevices, expiresDays ? new Date(Date.now() + expiresDays * 86400000).toISOString() : null, nowIso()).run();
        issued.push({ id: licenseId, code, status: 'available' });
      }
      return json({ licenses: issued }, 201);
    }
  }
  if (method === 'GET' && path === '/api/admin/licenses') {
    if (!(await rateLimit(env, `admin-ip:${ip}`, 30, 300))) throw new HttpError(429, 'Too many administrator requests.');
    await requireAdmin(request, env);
    const rows = await env.DB.prepare('SELECT id,label,status,max_devices,expires_at,activated_family_id,created_at FROM licenses ORDER BY created_at DESC LIMIT 250').all();
    return json({ licenses: rows.results || [] });
  }
  const adminLicenseMatch = path.match(/^\/api\/admin\/licenses\/([0-9a-f-]+)$/);
  if (method === 'PATCH' && adminLicenseMatch) {
    if (!(await rateLimit(env, `admin-ip:${ip}`, 30, 300))) throw new HttpError(429, 'Too many administrator requests.');
    await requireAdmin(request, env); const body = await bodyJson(request);
    if (!['suspended','revoked','active'].includes(body.status)) throw new HttpError(400, 'Unsupported license status.');
    await env.DB.prepare('UPDATE licenses SET status=? WHERE id=?').bind(body.status, adminLicenseMatch[1]).run();
    return json({ ok: true });
  }

  const parent = await requireParent(request, env).catch(async error => {
    // Device endpoints below use a separate token; keep authorization failure for unrelated routes.
    if ((path === '/api/policy' && method === 'GET') || (path === '/api/requests' && method === 'POST')) return null;
    return Promise.reject(error);
  });

  if (method === 'POST' && path === '/api/pair/code') {
    if (!(await rateLimit(env, `pair-code:${parent.userId}`, 10, 300))) throw new HttpError(429, 'Too many pairing codes generated. Try again later.');
    const license = await env.DB.prepare('SELECT max_devices FROM licenses WHERE activated_family_id=? AND status=? AND (expires_at IS NULL OR expires_at>?)').bind(parent.familyId, 'active', nowIso()).first();
    if (!license) throw new HttpError(403, 'The family license is not active.');
    const pendingCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const deviceCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM devices WHERE family_id=? AND (status=? OR (status=? AND created_at>?))').bind(parent.familyId, 'active', 'pending', pendingCutoff).first();
    if ((deviceCount?.count || 0) >= license.max_devices) throw new HttpError(403, `This license allows at most ${license.max_devices} child devices.`);
    const code = String(randomBytes(4).reduce((n, b) => ((n * 256) + b) >>> 0, 0) % 1_000_000).padStart(6, '0');
    const salt = b64(randomBytes(16));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO pair_codes(id,family_id,code_hash,salt,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(id(), parent.familyId, await hashPairCode(env, code, salt), salt, expiresAt, nowIso()).run();
    await audit(env, parent.familyId, 'parent', parent.userId, 'pair_code_created');
    return json({ code, expiresAt });
  }
  if (method === 'GET' && path === '/api/pair/pending') {
    const pendingCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE devices SET status=?,pairing_secret_hash=NULL,keybox=NULL,updated_at=? WHERE family_id=? AND status=? AND created_at<=?').bind('expired', nowIso(), parent.familyId, 'pending', pendingCutoff).run();
    const pending = await env.DB.prepare('SELECT id,device_name AS deviceName,public_key AS publicKey,created_at AS createdAt FROM devices WHERE family_id=? AND status=? AND created_at>? ORDER BY created_at DESC').bind(parent.familyId, 'pending', pendingCutoff).all();
    const devices = await env.DB.prepare('SELECT id,device_name AS deviceName,status,created_at AS createdAt,updated_at AS updatedAt FROM devices WHERE family_id=? AND status IN (?,?) ORDER BY created_at DESC').bind(parent.familyId, 'active', 'revoked').all();
    return json({ pending: pending.results || [], devices: devices.results || [] });
  }
  if (method === 'GET' && path === '/api/activity') {
    const rows = await env.DB.prepare('SELECT actor_type AS actorType,event_type AS eventType,created_at AS createdAt,metadata_json AS metadata FROM audit_log WHERE family_id=? ORDER BY created_at DESC LIMIT 40').bind(parent.familyId).all();
    return json({ activity: rows.results || [] });
  }
  if (method === 'POST' && path === '/api/pair/approve') {
    const body = await bodyJson(request);
    if (typeof body.deviceId !== 'string' || typeof body.deviceTokenHash !== 'string' || decodeBase64(body.deviceTokenHash)?.length !== 32 || !safeKeybox(body.keybox)) throw new HttpError(400, 'Invalid approval payload.');
    const device = await env.DB.prepare('SELECT id FROM devices WHERE id=? AND family_id=? AND status=?').bind(body.deviceId, parent.familyId, 'pending').first();
    if (!device) throw new HttpError(404, 'Pending device not found.');
    const approvalCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(`UPDATE devices SET status=?,token_hash=?,keybox=?,updated_at=?
      WHERE id=? AND family_id=? AND status=? AND created_at>?
      AND (SELECT COUNT(*) FROM devices WHERE family_id=? AND status=?) <
          (SELECT max_devices FROM licenses WHERE activated_family_id=? AND status=? AND (expires_at IS NULL OR expires_at>?))`)
      .bind('active', body.deviceTokenHash, JSON.stringify(body.keybox), nowIso(), body.deviceId, parent.familyId, 'pending', approvalCutoff, parent.familyId, 'active', parent.familyId, 'active', nowIso()).run();
    if (!result.meta.changes) throw new HttpError(409, 'Device limit reached or pending device expired. Refresh and review the device list.');
    await audit(env, parent.familyId, 'parent', parent.userId, 'device_pair_approved', { deviceId: body.deviceId });
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/api/pair/deny') {
    const body = await bodyJson(request);
    await env.DB.prepare('UPDATE devices SET status=?,updated_at=? WHERE id=? AND family_id=? AND status=?').bind('denied', nowIso(), body.deviceId, parent.familyId, 'pending').run();
    await audit(env, parent.familyId, 'parent', parent.userId, 'device_pair_denied', { deviceId: body.deviceId });
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/api/devices/revoke') {
    const body = await bodyJson(request);
    await env.DB.prepare('UPDATE devices SET status=?,token_hash=NULL,pairing_secret_hash=NULL,keybox=NULL,updated_at=? WHERE id=? AND family_id=? AND status=?').bind('revoked', nowIso(), body.deviceId, parent.familyId, 'active').run();
    await audit(env, parent.familyId, 'parent', parent.userId, 'device_revoked', { deviceId: body.deviceId });
    return json({ ok: true });
  }

  if (path === '/api/policy' && method === 'GET') {
    if (parent) {
      const row = await env.DB.prepare('SELECT policy_ciphertext,version,updated_at FROM policies WHERE family_id=?').bind(parent.familyId).first();
      return json({ policy: row ? JSON.parse(row.policy_ciphertext) : null, version: row?.version || 0, updatedAt: row?.updated_at || null });
    }
    const device = await requireDevice(request, env);
    const row = await env.DB.prepare('SELECT policy_ciphertext,version,updated_at FROM policies WHERE family_id=?').bind(device.familyId).first();
    return json({ policy: row ? JSON.parse(row.policy_ciphertext) : null, version: row?.version || 0, updatedAt: row?.updated_at || null });
  }
  if (path === '/api/policy' && method === 'PUT') {
    const body = await bodyJson(request);
    if (!safePolicyEnvelope(body.policy)) throw new HttpError(400, 'Encrypted policy envelope is invalid or too large.');
    await env.DB.prepare(`INSERT INTO policies(family_id,policy_ciphertext,version,updated_at) VALUES(?,?,1,?)
      ON CONFLICT(family_id) DO UPDATE SET policy_ciphertext=excluded.policy_ciphertext,version=policies.version+1,updated_at=excluded.updated_at`)
      .bind(parent.familyId, JSON.stringify(body.policy), nowIso()).run();
    await audit(env, parent.familyId, 'parent', parent.userId, 'policy_updated');
    return json({ ok: true });
  }

  if (path === '/api/requests' && method === 'POST') {
    const device = await requireDevice(request, env);
    const body = await bodyJson(request);
    const domain = typeof body.domain === 'string' ? body.domain.toLowerCase().trim().replace(/^https?:\/\//, '').split(/[/?#]/)[0] : '';
    if (!validDomain(domain)) throw new HttpError(400, 'Enter a valid website domain.');
    const open = await env.DB.prepare('SELECT COUNT(*) AS count FROM access_requests WHERE device_id=? AND status=?').bind(device.deviceId, 'pending').first();
    if ((open?.count || 0) >= 10) throw new HttpError(429, 'This device already has several pending requests.');
    const requestId = id();
    await env.DB.prepare('INSERT INTO access_requests(id,family_id,device_id,domain,status,created_at) VALUES(?,?,?,?,?,?)').bind(requestId, device.familyId, device.deviceId, domain, 'pending', nowIso()).run();
    await audit(env, device.familyId, 'child', device.deviceId, 'access_requested', { domain });
    return json({ id: requestId, status: 'pending' }, 201);
  }
  if (path === '/api/requests' && method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending','approved','denied','all'].includes(status)) throw new HttpError(400, 'Invalid request status.');
    const rows = await env.DB.prepare(`SELECT r.id,r.domain,r.status,r.created_at AS createdAt,d.device_name AS deviceName
      FROM access_requests r JOIN devices d ON d.id=r.device_id WHERE r.family_id=? ${status === 'all' ? '' : 'AND r.status=?'} ORDER BY r.created_at DESC LIMIT 100`)
      .bind(...(status === 'all' ? [parent.familyId] : [parent.familyId, status])).all();
    return json({ requests: rows.results || [] });
  }
  const decisionMatch = path.match(/^\/api\/requests\/([0-9a-f-]+)\/decision$/);
  if (method === 'POST' && decisionMatch) {
    const body = await bodyJson(request);
    if (!['approved','denied'].includes(body.decision)) throw new HttpError(400, 'Decision must be approved or denied.');
    const result = await env.DB.prepare('UPDATE access_requests SET status=?,decided_at=? WHERE id=? AND family_id=? AND status=?')
      .bind(body.decision, nowIso(), decisionMatch[1], parent.familyId, 'pending').run();
    if (!result.meta.changes) throw new HttpError(404, 'Pending request not found.');
    await audit(env, parent.familyId, 'parent', parent.userId, 'access_request_decided', { requestId: decisionMatch[1], decision: body.decision });
    return json({ ok: true });
  }

  throw new HttpError(404, 'API endpoint not found.');
}

async function createSession(env, userId, familyId, email) {
  const token = randomToken();
  const days = Math.max(1, Math.min(90, Number(env.SESSION_DAYS || 30)));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions(id,user_id,family_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)')
    .bind(id(), userId, familyId, await sha256(token), expiresAt, nowIso()).run();
  return json({ token, expiresAt, email, familyId });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (!originAllowed(request, env)) return json({ error: 'Origin not allowed.' }, 403);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Guardian 53 API is running.');
    try {
      const response = await routeApi(request, env);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('[Guardian53 API]', error);
      return json({ error: status === 500 ? 'Internal server error.' : error.message }, status, corsHeaders(request, env));
    }
  }
};
