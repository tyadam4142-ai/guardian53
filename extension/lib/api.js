(function (root) {
  'use strict';
  const base = (self.GUARDIAN_CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
  async function request(path, options = {}) {
    if (!base || base.includes('example.com')) throw new Error('Configure the Guardian 53 API URL in extension/config.js first.');
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const token = typeof options.token === 'string' ? options.token : '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${base}${path}`, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Server returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  root.G53Api = { request, base };
})(globalThis);
