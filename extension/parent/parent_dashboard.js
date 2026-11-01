'use strict';
const $ = id => document.getElementById(id);
let authMode = 'login';
let familyKey = null;
let familyKeyRaw = null;
let policy = { version: 1, categories: { adult: false, gambling: true, social: false, gaming: false, streaming: false, phishing: true }, blocklist: [], allowlist: [] };
let refreshTimer = null;

function showOnly(id) { ['auth-panel', 'unlock-panel', 'child-panel', 'dashboard'].forEach(x => $(x).hidden = x !== id); }
function setMessage(id, text, isError = false) { $(id).textContent = text; $(id).style.color = isError ? '#a33832' : '#365b79'; }
function sessionToken() { return currentSession?.token || ''; }
let currentSession = null;
async function api(path, options = {}) { return G53Api.request(path, { ...options, token: options.token || sessionToken() }); }
function randomToken() { return G53Crypto.b64(G53Crypto.randomBytes(32)); }

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => {
  authMode = tab.dataset.mode;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
  $('license-wrap').hidden = authMode !== 'register';
  $('password').autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
  $('auth-submit').textContent = authMode === 'register' ? 'Create family account' : 'Sign in';
});

document.querySelectorAll('.navbtn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.navbtn').forEach(x => x.classList.toggle('active', x === button));
  document.querySelectorAll('.tabpage').forEach(x => x.hidden = x.id !== `page-${button.dataset.tab}`);
}));

$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('auth-submit'); button.disabled = true;
  setMessage('auth-message', 'Contacting Guardian 53…');
  try {
    const body = { email: $('email').value.trim(), password: $('password').value };
    const result = await G53Api.request(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', token: '', body: authMode === 'register' ? { ...body, licenseCode: $('license').value.trim() } : body
    });
    currentSession = { token: result.token, email: body.email };
    await G53Secure.write('session', currentSession);
    const stored = await chrome.storage.local.get('g53_parent_vault');
    if (!stored.g53_parent_vault) {
      $('unlock-panel').dataset.create = 'yes';
      $('master-password').autocomplete = 'new-password';
      $('unlock-panel').querySelector('h2').textContent = 'Create your master password';
      $('unlock-panel').querySelector('button').textContent = 'Create encrypted family vault';
      $('unlock-panel').querySelector('p').textContent = 'Use a different password from your account password. It encrypts the family policy key locally and is never sent to the server.';
    }
    showOnly('unlock-panel');
    setMessage('unlock-message', 'Account authenticated. Unlock or create your local vault.');
  } catch (error) { setMessage('auth-message', error.message, true); }
  finally { button.disabled = false; }
});

$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('master-password').value;
  try {
    const stored = await chrome.storage.local.get('g53_parent_vault');
    if (!stored.g53_parent_vault) {
      const result = await G53Crypto.createParentVault(password);
      await chrome.storage.local.set({ g53_parent_vault: result.vault });
      familyKey = result.familyKey; familyKeyRaw = result.rawFamilyKey;
    } else { const unlocked = await G53Crypto.unlockParentVault(password, stored.g53_parent_vault); familyKey = unlocked.key; familyKeyRaw = unlocked.rawFamilyKey; }
    $('master-password').value = '';
    $('connection-status').textContent = 'Parent account connected'; $('connection-status').classList.add('good');
    showOnly('dashboard');
    await loadPolicy(); await refreshDevices(); await refreshRequests(); await refreshActivity(); renderCategories(); renderLists();
    await pollNotifications();
    clearInterval(refreshTimer); refreshTimer = setInterval(() => { refreshRequests().then(pollNotifications).catch(() => {}); refreshDevices().catch(() => {}); }, 15000);
  } catch (error) { setMessage('unlock-message', error.message, true); }
});

async function loadPolicy() {
  const result = await api('/api/policy');
  if (result.policy) policy = await G53Crypto.decryptWithKey(familyKey, result.policy);
  renderCategories(); renderLists();
  $('protection-state').textContent = result.policy ? 'Encrypted policy loaded from the family relay.' : 'No policy published yet. Save the initial policy to activate filtering.';
}
async function savePolicy() {
  // Validate browser rule and whitelist limits before publishing an encrypted policy.
  G53RulesCore.buildRules(policy);
  policy.version = 1; policy.updatedAt = new Date().toISOString();
  const envelope = await G53Crypto.encryptWithKey(familyKey, policy, 'guardian53-policy-v1');
  await api('/api/policy', { method: 'PUT', body: { policy: envelope } });
  await chrome.storage.local.set({ g53_parent_policy_version: policy.updatedAt });
  setMessage('policy-message', 'Encrypted policy saved. Child devices will sync on their next check-in.');
}
function renderCategories() {
  const host = $('categories'); host.replaceChildren();
  Object.entries(G53Categories).forEach(([key, value]) => {
    const label = document.createElement('label'); label.className = 'checkrow';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(policy.categories?.[key]);
    input.addEventListener('change', () => { policy.categories[key] = input.checked; });
    const text = document.createElement('span'); text.textContent = value.label;
    label.append(input, text); host.append(label);
  });
}
function listRow(container, value, kind, expiresAt) {
  const li = document.createElement('li');
  const detail = document.createElement('span'); detail.textContent = `${value}${expiresAt ? ` · expires ${new Date(expiresAt).toLocaleString()}` : ''}`;
  const button = document.createElement('button'); button.className = 'remove'; button.textContent = 'Remove';
  button.addEventListener('click', () => {
    if (kind === 'block') policy.blocklist = policy.blocklist.filter(x => x !== value);
    else policy.allowlist = policy.allowlist.filter(x => x.domain !== value);
    renderLists();
  });
  li.append(detail, button); container.append(li);
}
function renderLists() {
  $('block-list').replaceChildren(); $('allow-list').replaceChildren();
  (policy.blocklist || []).forEach(value => listRow($('block-list'), value, 'block'));
  (policy.allowlist || []).forEach(item => listRow($('allow-list'), item.domain, 'allow', item.expiresAt));
  if (!$('block-list').children.length) $('block-list').textContent = 'No manually blocked sites.';
  if (!$('allow-list').children.length) $('allow-list').textContent = 'No allowed sites.';
}
$('block-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const domain = G53Domain.normalizeDomain($('block-domain').value); policy.blocklist = [...new Set([...(policy.blocklist || []), domain])]; $('block-domain').value = ''; renderLists(); }
  catch (error) { setMessage('policy-message', error.message, true); }
});
$('allow-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const domain = G53Domain.normalizeDomain($('allow-domain').value); policy.allowlist = [...(policy.allowlist || []).filter(x => x.domain !== domain), { domain, expiresAt: null }]; $('allow-domain').value = ''; renderLists(); }
  catch (error) { setMessage('policy-message', error.message, true); }
});
$('save-policy').addEventListener('click', async () => { try { await savePolicy(); } catch (error) { setMessage('policy-message', error.message, true); } });

$('create-code').addEventListener('click', async () => {
  try { const result = await api('/api/pair/code', { method: 'POST', body: {} }); $('pair-code').hidden = false; $('pair-code').textContent = result.code; setMessage('pair-message', `Expires ${new Date(result.expiresAt).toLocaleTimeString()}. One device can redeem this code.`); }
  catch (error) { setMessage('pair-message', error.message, true); }
});
async function refreshDevices() {
  const data = await api('/api/pair/pending');
  const pending = $('pending-devices'); pending.replaceChildren();
  const paired = $('paired-devices'); paired.replaceChildren();
  for (const device of (data.pending || [])) {
    const card = document.createElement('div'); card.className = 'device-card';
    const details = document.createElement('div');
    const title = document.createElement('span'); title.textContent = `${device.deviceName} · waiting for approval`;
    const fingerprint = document.createElement('small'); fingerprint.className = 'muted';
    fingerprint.textContent = `Compare with the child screen: ${await G53Crypto.fingerprint(device.publicKey)}`;
    details.append(title, document.createElement('br'), fingerprint);
    const actions = document.createElement('div'); actions.className = 'action-row';
    const approve = document.createElement('button'); approve.textContent = 'Approve';
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        const deviceToken = randomToken();
        const keybox = await G53Crypto.makePairEnvelope(device.publicKey, familyKeyRaw, deviceToken);
        await api('/api/pair/approve', { method: 'POST', body: { deviceId: device.id, deviceTokenHash: await G53Crypto.sha256(deviceToken), keybox } });
        await refreshDevices();
      } catch (error) { approve.disabled = false; alert(error.message); }
    });
    const deny = document.createElement('button'); deny.className = 'secondary'; deny.textContent = 'Decline';
    deny.addEventListener('click', async () => { await api('/api/pair/deny', { method: 'POST', body: { deviceId: device.id } }); await refreshDevices(); });
    actions.append(approve, deny); card.append(details, actions); pending.append(card);
  }
  (data.devices || []).forEach(device => {
    const card = document.createElement('div'); card.className = 'device-card';
    const title = document.createElement('span'); title.textContent = `${device.deviceName} · ${device.status}`;
    const revoke = document.createElement('button'); revoke.className = 'danger'; revoke.textContent = 'Revoke';
    revoke.addEventListener('click', async () => { if (confirm('Revoke this device? It will stop receiving policy updates.')) { await api('/api/devices/revoke', { method: 'POST', body: { deviceId: device.id } }); await refreshDevices(); } });
    card.append(title, revoke); paired.append(card);
  });
  if (!pending.children.length) pending.textContent = 'No pending devices.';
  if (!paired.children.length) paired.textContent = 'No paired devices.';
  $('device-count').textContent = String((data.devices || []).filter(x => x.status === 'active').length);
}
async function refreshActivity() {
  const data = await api('/api/activity'); const list = $('activity-list'); list.replaceChildren();
  (data.activity || []).forEach(item => { const row = document.createElement('div'); row.className = 'device-card'; const label = document.createElement('span'); label.textContent = item.eventType.replaceAll('_', ' '); const when = document.createElement('time'); when.textContent = new Date(item.createdAt).toLocaleString(); row.append(label, when); list.append(row); });
  if (!list.children.length) list.textContent = 'No recorded activity yet.';
}
async function refreshRequests() {
  const data = await api('/api/requests?status=pending');
  const list = $('approval-list'); list.replaceChildren();
  $('request-count').textContent = String((data.requests || []).length);
  (data.requests || []).forEach(request => {
    const card = document.createElement('div'); card.className = 'request-card';
    const detail = document.createElement('span'); detail.textContent = `${request.domain} · ${request.deviceName || 'Child device'} · ${new Date(request.createdAt).toLocaleString()}`;
    const actions = document.createElement('div'); actions.className = 'action-row';
    const approve = document.createElement('button'); approve.textContent = 'Allow 30 min';
    approve.addEventListener('click', () => decideRequest(request, 'approved'));
    const deny = document.createElement('button'); deny.className = 'secondary'; deny.textContent = 'Deny';
    deny.addEventListener('click', () => decideRequest(request, 'denied'));
    actions.append(approve, deny); card.append(detail, actions); list.append(card);
  });
  if (!list.children.length) list.textContent = 'No pending requests.';
}
async function decideRequest(request, decision) {
  try {
    if (decision === 'approved') {
      policy.allowlist = [...(policy.allowlist || []).filter(x => x.domain !== request.domain), { domain: request.domain, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() }];
      await savePolicy();
    }
    await api(`/api/requests/${encodeURIComponent(request.id)}/decision`, { method: 'POST', body: { decision } });
    await refreshRequests();
  } catch (error) { alert(error.message); }
}
let lastNotified = new Set();
async function pollNotifications() {
  const data = await api('/api/requests?status=pending');
  for (const request of (data.requests || [])) {
    if (!lastNotified.has(request.id) && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Guardian 53: approval requested', { body: `${request.domain} needs your review.` });
    }
    lastNotified.add(request.id);
  }
}
$('enable-notifications').addEventListener('click', async () => {
  if (!('Notification' in window)) { setMessage('notification-message', 'This browser does not support page notifications.', true); return; }
  try {
    const permission = await Notification.requestPermission();
    setMessage('notification-message', permission === 'granted' ? 'Desktop notifications enabled.' : 'Notifications were not enabled. Check browser site settings.', permission !== 'granted');
  } catch { setMessage('notification-message', 'Could not request notification permission.', true); }
});
$('back-to-login').addEventListener('click', async () => {
  await G53Secure.remove('session');
  currentSession = null; familyKey = null; familyKeyRaw = null;
  $('master-password').value = '';
  showOnly('auth-panel');
});
$('child-request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('child-request-form').querySelector('button'); button.disabled = true;
  try {
    const token = await G53Secure.read('deviceToken');
    if (!token) throw new Error('This browser is not paired. Ask the parent to pair it again.');
    const domain = G53Domain.normalizeDomain($('child-request-domain').value);
    await G53Api.request('/api/requests', { method: 'POST', token, body: { domain } });
    $('child-request-domain').value = '';
    setMessage('child-message', 'Request sent. Your parent or guardian will review it.');
  } catch (error) { setMessage('child-message', error.message, true); }
  finally { button.disabled = false; }
});
$('refresh-child').addEventListener('click', async () => {
  const button = $('refresh-child'); button.disabled = true;
  try {
    const result = await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'G53_FORCE_SYNC' }, response => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(response || { ok: false, error: 'No response from service worker.' });
    }));
    const local = await chrome.storage.local.get(['g53_last_policy_sync', 'g53_unsupported_browser']);
    if (result.ok && !local.g53_unsupported_browser) {
      $('child-status').textContent = local.g53_last_policy_sync ? `Protection policy refreshed · ${new Date(local.g53_last_policy_sync).toLocaleString()}` : 'No policy has been published by the parent yet.';
      setMessage('child-message', 'Protection sync checked.');
    } else {
      $('child-status').textContent = 'Protection could not be confirmed on this browser.';
      setMessage('child-message', result.error || 'This browser may not support the required filtering API.', true);
    }
  } catch (error) { setMessage('child-message', error.message, true); }
  finally { button.disabled = false; }
});
$('sign-out').addEventListener('click', async () => {
  clearInterval(refreshTimer); try { if (currentSession?.token) await api('/api/auth/logout', { method: 'POST', body: {} }); } catch {} await G53Secure.remove('session'); currentSession = null; familyKey = null; familyKeyRaw = null; showOnly('auth-panel');
  $('connection-status').textContent = 'Signed out'; $('connection-status').classList.remove('good');
});

(async function init() {
  if (!chrome?.storage?.local) { setMessage('auth-message', 'Open this page inside the Guardian 53 extension.', true); return; }
  try {
    const childToken = await G53Secure.read('deviceToken');
    if (childToken) {
      showOnly('child-panel');
      const local = await chrome.storage.local.get(['g53_last_policy_sync', 'g53_unsupported_browser']);
      $('child-status').textContent = local.g53_unsupported_browser
        ? 'This browser does not support the required filtering API.'
        : local.g53_last_policy_sync ? `Last policy sync · ${new Date(local.g53_last_policy_sync).toLocaleString()}` : 'Paired. Waiting for the parent to publish the first policy.';
      try {
        await G53Api.request('/api/policy', { token: childToken });
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          $('child-status').textContent = 'This device is no longer authorized, or the family license is inactive.';
          $('child-repair').hidden = false;
        } else {
          setMessage('child-message', 'The relay is unreachable. Existing locally applied rules remain in the browser.', true);
        }
      }
      return;
    }
    currentSession = await G53Secure.read('session');
    if (currentSession?.token) {
      showOnly('unlock-panel');
      const vault = await chrome.storage.local.get('g53_parent_vault');
      if (!vault.g53_parent_vault) {
        $('unlock-panel').dataset.create = 'yes'; $('unlock-panel').querySelector('h2').textContent = 'Create your master password';
        $('unlock-panel').querySelector('button').textContent = 'Create encrypted family vault';
      }
    } else showOnly('auth-panel');
  } catch { showOnly('auth-panel'); }
})();
