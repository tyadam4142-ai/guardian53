'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/domain.js');
globalThis.G53Categories = {
  social: { label: 'Social', domains: ['social.example', 'video.example'] },
  gaming: { label: 'Gaming', domains: ['games.example'] }
};
require('../lib/rules-core.js');

test('normalizes URL input to a lowercase hostname', () => {
  assert.equal(G53Domain.normalizeDomain('HTTPS://Example.COM/path?q=1'), 'example.com');
});
test('rejects malformed and local domains', () => {
  for (const value of ['', 'localhost', 'http://localhost', 'not a domain', '192.168.1.2', 'a..b.com']) {
    assert.throws(() => G53Domain.normalizeDomain(value));
  }
});
test('generates only main-frame/sub-frame rules and applies whitelist exclusions', () => {
  const rules = G53RulesCore.buildRules({
    categories: { social: true, gaming: false },
    blocklist: ['manual.example'],
    allowlist: [{ domain: 'school.social.example', expiresAt: null }]
  });
  assert.equal(rules.length, 3);
  assert.ok(rules.every(rule => rule.action.redirect.extensionPath === '/child/blocked.html'));
  assert.ok(rules.every(rule => rule.condition.excludedRequestDomains.includes('school.social.example')));
  assert.ok(rules.every(rule => rule.condition.resourceTypes.includes('main_frame')));
});
test('expires temporary allowlist entries', () => {
  const rules = G53RulesCore.buildRules({
    categories: { social: true }, blocklist: [],
    allowlist: [{ domain: 'social.example', expiresAt: '2000-01-01T00:00:00.000Z' }]
  });
  assert.equal(rules.length, 2);
  assert.ok(rules.every(rule => !rule.condition.excludedRequestDomains));
});
test('rejects invalid domains in policy instead of generating unsafe rules', () => {
  const rules = G53RulesCore.buildRules({ categories: {}, blocklist: ['invalid_domain', 'example.com'], allowlist: [] });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.requestDomains, ['example.com']);
});
