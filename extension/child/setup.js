'use strict';
const codeInput = document.getElementById('code');
const button = document.getElementById('pair');
const message = document.getElementById('message');
let pairingComplete = false;
button.addEventListener('click', async () => {
  pairingComplete = false;
  button.disabled = true; message.textContent = 'Starting secure pairing…';
  try {
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code.');
    const publicKey = await G53Crypto.createChildPairKey();
    document.getElementById('fingerprint-value').textContent = await G53Crypto.fingerprint(publicKey);
    document.getElementById('fingerprint').hidden = false;
    const result = await G53Api.request('/api/pair/redeem', { method: 'POST', body: { code, publicKey, deviceName: `${navigator.platform || 'Child'} browser` }, token: '' });
    await G53Secure.write('pairingSecret', result.pairingSecret);
    message.textContent = 'Waiting for parent approval…';
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const state = await G53Api.request('/api/pair/status', { token: result.pairingSecret });
      if (state.status === 'expired') { await G53Api.request('/api/pair/complete', { method: 'POST', token: result.pairingSecret, body: {} }).catch(() => {}); throw new Error('Pairing request expired. Ask the parent to generate a new code.'); }
      if (state.status === 'denied') { await G53Api.request('/api/pair/complete', { method: 'POST', token: result.pairingSecret, body: {} }).catch(() => {}); throw new Error('The parent declined this pairing request.'); }
      if (state.status === 'revoked') throw new Error('The family license or pairing access is inactive. Ask the parent to review it.');
      if (state.status === 'active' && state.keybox) {
        await G53Crypto.openPairEnvelope(state.keybox);
        // The keybox is already authenticated and stored locally. Server-side
        // cleanup is best-effort so a transient network failure cannot erase a
        // successful pairing or leave the user stuck in the pairing screen.
        await G53Api.request('/api/pair/complete', { method: 'POST', token: result.pairingSecret, body: {} }).catch(() => {});
        await G53Secure.remove('pairingSecret');
        pairingComplete = true;
        message.textContent = 'Connected. Guardian 53 protection is ready.';
        button.textContent = 'Connected';
        return;
      }
    }
    throw new Error('Pairing timed out. Ask the parent to generate a new code.');
  } catch (error) {
    message.textContent = error.message;
    await G53Secure.remove('pairingSecret').catch(() => {});
    await G53IDB.delete('pairPrivateKey').catch(() => {});
  } finally { button.disabled = pairingComplete; }
});
