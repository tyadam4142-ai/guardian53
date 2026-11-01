'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const store = new Map();
globalThis.G53IDB = {
  async get(key) { return store.get(key); },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); }
};
globalThis.G53Secure = { async write(key, value) { store.set(`secure:${key}`, value); } };
require('../lib/crypto.js');

test('parent master password wraps and unlocks the family key', async () => {
  const created = await G53Crypto.createParentVault('Correct Horse Battery Staple 2026!');
  const unlocked = await G53Crypto.unlockParentVault('Correct Horse Battery Staple 2026!', created.vault);
  const payload = { blocklist: ['example.com'], categories: { social: true } };
  const envelope = await G53Crypto.encryptWithKey(created.familyKey, payload, 'guardian53-policy-v1');
  assert.deepEqual(await G53Crypto.decryptWithKey(unlocked.key, envelope), payload);
  await assert.rejects(() => G53Crypto.unlockParentVault('wrong password value', created.vault));
});

test('ECDH pairing envelope transfers family key and device token only to child private key', async () => {
  const parent = await G53Crypto.createParentVault('Another Strong Parent Password 2026!');
  const childPublicKey = await G53Crypto.createChildPairKey();
  const childFingerprint = await G53Crypto.fingerprint(childPublicKey);
  assert.match(childFingerprint, /^[0-9A-F]{12}$/);
  assert.equal(await G53Crypto.fingerprint(childPublicKey), childFingerprint);
  const envelope = await G53Crypto.makePairEnvelope(childPublicKey, parent.rawFamilyKey, 'child-device-token-test');
  const result = await G53Crypto.openPairEnvelope(envelope);
  assert.equal(result.deviceToken, 'child-device-token-test');
  assert.equal(store.get('secure:deviceToken'), 'child-device-token-test');
  const policy = { blocklist: ['school.example'], categories: { social: true } };
  const box = await G53Crypto.encryptWithKey(parent.familyKey, policy, 'guardian53-policy-v1');
  assert.deepEqual(await G53Crypto.decryptWithKey(await G53Crypto.getFamilyKey(), box), policy);
});
