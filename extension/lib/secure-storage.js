(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const un64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  async function localKey() {
    let key = await G53IDB.get('localStorageKey');
    if (!key) {
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      key = await G53IDB.addIfAbsent('localStorageKey', candidate);
    }
    return key;
  }
  async function write(name, value) {
    const key = await localKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = `guardian53-local:${name}:v1`;
    const clear = enc.encode(JSON.stringify(value));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, clear);
    await chrome.storage.local.set({ [`g53_${name}_box`]: { v: 1, iv: b64(iv), ct: b64(ct), aad } });
  }
  async function read(name) {
    const stored = await chrome.storage.local.get(`g53_${name}_box`);
    const box = stored[`g53_${name}_box`];
    if (!box) return null;
    const expectedAad = `guardian53-local:${name}:v1`;
    if (!box || box.v !== 1 || box.aad !== expectedAad || typeof box.iv !== 'string' || typeof box.ct !== 'string') {
      throw new Error('Encrypted local record is invalid or belongs to a different storage slot.');
    }
    const key = await localKey();
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(box.iv), additionalData: enc.encode(expectedAad) }, key, un64(box.ct));
    return JSON.parse(dec.decode(clear));
  }
  async function remove(name) { await chrome.storage.local.remove(`g53_${name}_box`); }
  root.G53Secure = { write, read, remove };
})(globalThis);
