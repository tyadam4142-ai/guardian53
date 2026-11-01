// Public API endpoint for the production Guardian 53 Worker.
// This URL is not a secret. Never place ADMIN_API_KEY or PAIR_CODE_PEPPER here.
self.GUARDIAN_CONFIG = Object.freeze({
  API_BASE_URL: 'https://guardian53.dynamicrobotics53.com',
  POLICY_POLL_MINUTES: 1,
  EVENTS_POLL_MINUTES: 1,
  MAX_DYNAMIC_RULES: 4500
});
