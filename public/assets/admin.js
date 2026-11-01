'use strict';
const $ = id => document.getElementById(id);
let adminKey = sessionStorage.getItem('g53_admin_key') || '';
async function api(path, options = {}) {
  const response = await fetch(path, { method: options.method || 'GET', headers: { 'content-type': 'application/json', 'x-admin-key': adminKey }, body: options.body ? JSON.stringify(options.body) : undefined, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function message(id, text, bad = false) { $(id).textContent = text; $(id).style.color = bad ? '#a23832' : '#41617f'; }
function showConsole(yes) { $('login').hidden = yes; $('console').hidden = !yes; }
$('connect').addEventListener('click', async () => {
  adminKey = $('admin-key').value.trim();
  try { await refresh(); sessionStorage.setItem('g53_admin_key', adminKey); showConsole(true); message('login-message', 'Authenticated.'); }
  catch (error) { adminKey = ''; message('login-message', error.message, true); }
});
async function refresh() {
  const data = await api('/api/admin/licenses');
  const rows = $('license-rows'); rows.replaceChildren();
  const counts = { available: 0, active: 0, disabled: 0 };
  (data.licenses || []).forEach(license => {
    if (license.status === 'available') counts.available++;
    else if (license.status === 'active') counts.active++;
    else counts.disabled++;
    const tr = document.createElement('tr');
    const values = [license.label || '—', license.status, license.max_devices, license.expires_at ? new Date(license.expires_at).toLocaleDateString() : 'No expiry', license.activated_family_id ? license.activated_family_id.slice(0, 8) + '…' : '—'];
    for (let i = 0; i < values.length; i++) {
      const td = document.createElement('td');
      if (i === 1) { const span = document.createElement('span'); span.className = `status ${license.status}`; span.textContent = license.status; td.append(span); }
      else td.textContent = String(values[i]);
      tr.append(td);
    }
    const action = document.createElement('td');
    if (license.status !== 'revoked') {
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = license.status === 'suspended' ? 'Reactivate' : 'Suspend';
      button.addEventListener('click', async () => { await api(`/api/admin/licenses/${license.id}`, { method: 'PATCH', body: { status: license.status === 'suspended' ? 'active' : 'suspended' } }); await refresh(); }); action.append(button);
    }
    tr.append(action); rows.append(tr);
  });
  $('available-count').textContent = counts.available; $('active-count').textContent = counts.active; $('disabled-count').textContent = counts.disabled;
}
$('issue').addEventListener('click', async () => {
  try {
    const body = { count: Number($('count').value), maxDevices: Number($('max-devices').value), label: $('label').value.trim() };
    if ($('expiry').value) body.expiresDays = Number($('expiry').value);
    const result = await api('/api/admin/licenses', { method: 'POST', body });
    const codeList = result.licenses.map(x => x.code);
    $('issued').hidden = false; $('issued').replaceChildren();
    const pre = document.createElement('pre'); pre.textContent = codeList.join('\n');
    const copy = document.createElement('button'); copy.textContent = 'Copy codes'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(codeList.join('\n')); copy.textContent = 'Copied'; });
    $('issued').append(pre, copy); message('issue-message', 'Codes generated. Copy and deliver them securely; they cannot be displayed again.'); await refresh();
  } catch (error) { message('issue-message', error.message, true); }
});
$('refresh').addEventListener('click', () => refresh().catch(error => alert(error.message)));
$('disconnect').addEventListener('click', () => { adminKey = ''; sessionStorage.removeItem('g53_admin_key'); $('admin-key').value = ''; showConsole(false); });
if (adminKey) { $('admin-key').value = adminKey; refresh().then(() => showConsole(true)).catch(() => { adminKey = ''; sessionStorage.removeItem('g53_admin_key'); }); }
