(function (root) {
  'use strict';
  const MAX_RULES = 4500;
  function validDomain(d) { return typeof d === 'string' && d.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d); }
  function buildRules(policy) {
    const now = Date.now();
    const allow = [...new Set((policy.allowlist || []).filter(x => x && (!x.expiresAt || Date.parse(x.expiresAt) > now)).map(x => x.domain).filter(validDomain))];
    if (allow.length > 1000) throw new Error('The allowlist exceeds the browser rule-condition limit of 1,000 domains.');
    const manual = [...new Set((policy.blocklist || []).filter(validDomain))];
    const categories = policy.categories || {};
    const categoryDomains = [];
    const catalog = root.G53Categories || {};
    for (const [key, enabled] of Object.entries(categories)) if (enabled && catalog[key]) categoryDomains.push(...catalog[key].domains.filter(validDomain));
    const blocked = [...new Set([...manual, ...categoryDomains])].sort();
    if (blocked.length > MAX_RULES) throw new Error(`Policy exceeds the ${MAX_RULES} dynamic-rule safety limit.`);
    // Reserved stable range: 1000-5499. Do not share these IDs with other extensions/features.
    return blocked.map((domain, index) => ({
      id: 1000 + index,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/child/blocked.html' } },
      condition: { requestDomains: [domain], ...(allow.length ? { excludedRequestDomains: allow } : {}), resourceTypes: ['main_frame', 'sub_frame'] }
    }));
  }
  root.G53RulesCore = { buildRules };
})(globalThis);
