(function (root) {
  'use strict';
  const RESERVED = new Set(['localhost', 'local', 'example', 'invalid', 'test']);
  function normalizeDomain(input) {
    if (typeof input !== 'string') throw new Error('Enter a domain name.');
    let value = input.trim().toLowerCase();
    if (!value || value.length > 253) throw new Error('Domain is empty or too long.');
    if (value.includes('://')) {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error('Enter a valid website URL.'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS websites can be managed.');
      value = parsed.hostname.toLowerCase();
    } else {
      value = value.split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '');
    }
    value = value.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
    if (!value || value.length > 253 || value.includes('..')) throw new Error('Invalid domain name.');
    if (value === 'localhost' || value.endsWith('.localhost') || RESERVED.has(value)) throw new Error('Local/test domains cannot be added.');
    const labels = value.split('.');
    if (labels.length < 2 || labels.some(label => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
      throw new Error('Enter a valid public domain, such as example.com.');
    }
    if (/^\d+(\.\d+){3}$/.test(value)) throw new Error('IP addresses are not accepted; enter a domain name.');
    return value;
  }
  root.G53Domain = { normalizeDomain };
})(globalThis);
