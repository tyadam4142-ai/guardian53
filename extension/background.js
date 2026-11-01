'use strict';
importScripts(
  'config.js',
  'lib/idb.js',
  'lib/secure-storage.js',
  'lib/domain.js',
  'lib/categories.js',
  'lib/crypto.js',
  'lib/api.js',
  'lib/rules-core.js'
);

const RULE_MIN = 1000;
const RULE_MAX = 5499;
const POLICY_KEY = 'g53_policy_envelope';

async function getDeviceToken() {
  try { return await G53Secure.read('deviceToken'); } catch { return null; }
}
async function getParentSession() {
  try { return await G53Secure.read('session'); } catch { return null; }
}
async function notify(title, message, id) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create(id || `g53-${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1
  });
}
async function applyPolicy(policy) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) throw new Error('This browser does not support the required declarativeNetRequest API.');
  const rules = G53RulesCore.buildRules(policy);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter(r => r.id >= RULE_MIN && r.id <= RULE_MAX).map(r => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  await chrome.storage.local.set({ [POLICY_KEY]: policy.envelope || null, g53_last_policy_sync: Date.now() });
  return rules.length;
}
async function pullPolicy() {
  const deviceToken = await getDeviceToken();
  if (!deviceToken) return;
  const response = await G53Api.request('/api/policy', { token: deviceToken });
  if (!response.policy) return;
  const key = await G53Crypto.getFamilyKey();
  const policy = await G53Crypto.decryptWithKey(key, response.policy);
  await applyPolicy({ ...policy, envelope: response.policy });
}
async function pollParentRequests() {
  const session = await getParentSession();
  if (!session?.token) return;
  const data = await G53Api.request('/api/requests?status=pending', { token: session.token });
  for (const request of (data.requests || [])) {
    const seenKey = `g53_seen_request_${request.id}`;
    const seen = await chrome.storage.local.get(seenKey);
    if (!seen[seenKey]) {
      await notify('Guardian 53: approval requested', `${request.domain} is waiting for your decision.`, `g53-request-${request.id}`);
      await chrome.storage.local.set({ [seenKey]: true });
    }
  }
}
async function syncChild() {
  try { await pullPolicy(); return { ok: true }; }
  catch (error) { console.warn('[Guardian 53] Policy sync:', error.message); return { ok: false, error: error.message }; }
}
async function runAlarms() {
  await syncChild();
  try { await pollParentRequests(); } catch (error) { console.warn('[Guardian 53] Event sync:', error.message); }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('g53-sync', { periodInMinutes: Math.max(1, G53_CONFIG.POLICY_POLL_MINUTES || 1) });
  await chrome.storage.local.set({ g53_installed_version: chrome.runtime.getManifest().version });
  if (!chrome.declarativeNetRequest) {
    await chrome.storage.local.set({ g53_unsupported_browser: true });
  }
});
chrome.runtime.onStartup?.addListener(runAlarms);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'g53-sync') runAlarms(); });
chrome.notifications.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'G53_REQUEST_ACCESS') {
    (async () => {
      const token = await getDeviceToken();
      if (!token) throw new Error('This device is not paired with a parent yet.');
      const domain = G53Domain.normalizeDomain(message.domain);
      const result = await G53Api.request('/api/requests', { method: 'POST', token, body: { domain } });
      return result;
    })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'G53_STATUS') {
    Promise.all([getDeviceToken(), getParentSession(), chrome.storage.local.get(['g53_last_policy_sync', 'g53_unsupported_browser'])])
      .then(([deviceToken, session, local]) => sendResponse({ paired: Boolean(deviceToken), parentSignedIn: Boolean(session?.token), lastPolicySync: local.g53_last_policy_sync || null, unsupported: Boolean(local.g53_unsupported_browser) }));
    return true;
  }
  if (message?.type === 'G53_FORCE_SYNC') {
    syncChild().then(result => sendResponse(result));
    return true;
  }
  return false;
});

// Alarm creation is repeated at startup because browser vendors may clear alarms after upgrades.
chrome.runtime.onStartup?.addListener(() => chrome.alarms.create('g53-sync', { periodInMinutes: 1 }));
