(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITERATIONS = 310000;
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const un64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
  async function sha256Bytes(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', value)); }
  async function derivePasswordKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptWithKey(key, value, additionalData = 'guardian53-v1') {
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(additionalData), tagLength: 128 }, key, enc.encode(JSON.stringify(value)));
    return { v: 1, alg: 'A256GCM', iv: b64(iv), ct: b64(ciphertext), aad: additionalData };
  }
  async function decryptWithKey(key, box) {
    if (!box || box.v !== 1 || box.alg !== 'A256GCM' || !box.iv || !box.ct) throw new Error('Encrypted data format is invalid.');
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(box.iv), additionalData: enc.encode(box.aad || 'guardian53-v1'), tagLength: 128 }, key, un64(box.ct));
    return JSON.parse(dec.decode(clear));
  }
  async function createParentVault(password) {
    if (typeof password !== 'string' || password.length < 12) throw new Error('Use a master password of at least 12 characters.');
    const salt = randomBytes(16);
    const wrappingKey = await derivePasswordKey(password, salt);
    const rawFamilyKey = randomBytes(32);
    const familyKey = await crypto.subtle.importKey('raw', rawFamilyKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const wrappedKey = await encryptWithKey(wrappingKey, { familyKey: b64(rawFamilyKey) }, 'guardian53-family-key-v1');
    return { vault: { v: 1, salt: b64(salt), wrappedKey, iterations: ITERATIONS }, familyKey, rawFamilyKey };
  }
  async function unlockParentVault(password, vault) {
    if (!vault || vault.v !== 1) throw new Error('No parent vault is configured on this device.');
    const wrappingKey = await derivePasswordKey(password, un64(vault.salt));
    try {
      const decoded = await decryptWithKey(wrappingKey, vault.wrappedKey);
      const key = await crypto.subtle.importKey('raw', un64(decoded.familyKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { key, rawFamilyKey: un64(decoded.familyKey) };
    } catch { throw new Error('Incorrect master password or damaged vault.'); }
  }
  async function getFamilyKey() {
    const key = await G53IDB.get('familyKey');
    if (!key) throw new Error('Family key is locked or this device has not been paired.');
    return key;
  }
  async function fingerprint(publicKeyB64) {
    const digest = await sha256Bytes(un64(publicKeyB64));
    return Array.from(digest.slice(0, 6), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  async function makePairEnvelope(childPublicKeyB64, rawFamilyKey, deviceToken) {
    const childPub = await crypto.subtle.importKey('raw', un64(childPublicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: childPub }, ephemeral.privateKey, 256);
    const salt = randomBytes(16);
    const hkdfMaterial = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const wrapKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('guardian53-pair-wrap-v1') }, hkdfMaterial,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const rawFamily = rawFamilyKey instanceof Uint8Array ? rawFamilyKey : new Uint8Array(rawFamilyKey);
    const payload = { familyKey: b64(rawFamily), deviceToken };
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('guardian53-pair-box-v1') }, wrapKey, enc.encode(JSON.stringify(payload)));
    const publicKey = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
    return { v: 1, ephemeralPublicKey: b64(publicKey), salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
  }
  async function createChildPairKey() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    await G53IDB.put('pairPrivateKey', pair.privateKey);
    return b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  async function openPairEnvelope(box) {
    const privateKey = await G53IDB.get('pairPrivateKey');
    if (!privateKey) throw new Error('Pairing session expired. Start pairing again.');
    const ephemeralPub = await crypto.subtle.importKey('raw', un64(box.ephemeralPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephemeralPub }, privateKey, 256);
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const wrapKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: un64(box.salt), info: enc.encode('guardian53-pair-wrap-v1') }, material,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(box.iv), additionalData: enc.encode('guardian53-pair-box-v1') }, wrapKey, un64(box.ciphertext));
    const result = JSON.parse(dec.decode(clear));
    const familyKey = await crypto.subtle.importKey('raw', un64(result.familyKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    await G53IDB.put('familyKey', familyKey);
    await G53Secure.write('deviceToken', result.deviceToken);
    await G53IDB.delete('pairPrivateKey');
    return result;
  }
  root.G53Crypto = {
    b64, un64, randomBytes, sha256: async value => b64(await sha256Bytes(typeof value === 'string' ? enc.encode(value) : value)),
    createParentVault, unlockParentVault, getFamilyKey, encryptWithKey, decryptWithKey,
    makePairEnvelope, createChildPairKey, openPairEnvelope, fingerprint
  };
})(globalThis);
