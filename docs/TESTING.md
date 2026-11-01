# Test plan and release gates

## Automated checks

Run from the repository root:

```bash
./scripts/check-project.sh
```

Current automated coverage:

- Domain parsing, URL normalization, malformed/local/IP rejection.
- DNR rule generation, allowlist precedence, temporary exception expiry, and invalid policy filtering.
- Parent master-password vault encryption/decryption and wrong-password rejection.
- P-256 ECDH + HKDF + AES-GCM pairing-envelope round trip and family-policy decryption.
- JavaScript syntax across the Worker, extension, and admin console; Manifest JSON parsing.
- SQLite/D1-schema smoke checks for license activation, account creation, pair redemption, device approval limits, access requests, policy upsert, rate-limit UPSERT, and revocation credential cleanup.
- Configured extension packaging smoke test (manifest host permission and API origin are rewritten in a staging copy, not the source folder).

The SQLite smoke check uses Python's standard `sqlite3` module. It verifies SQL compatibility and statement shape locally but does not emulate D1 concurrency, Worker runtime behavior, or Cloudflare account configuration.

## Manual integration test sequence

Use a separate staging Worker and D1 database. Do not use real child browsing accounts for first tests.

1. **Health and admin:** Deploy Worker; verify `/api/health`; open `/`; authenticate with the Worker admin key; create one test license; verify the raw license code appears once and the inventory only shows metadata.
2. **Registration:** Load the unpacked extension in a clean desktop Chromium profile; create a family account using the test license; create a distinct master password; sign out and sign back in; unlock the local vault.
3. **Pairing:** Generate a code; load the same staging build in a second clean profile; open child setup; redeem the code; confirm the parent sees a pending device; approve; confirm child says connected; try reusing the code and verify it fails.
4. **Policy encryption:** Add one test domain to the manual blocklist; enable a starter category; save; inspect D1 and confirm `policies.policy_ciphertext` is only an AES-GCM envelope (no plain domain list); inspect `chrome.storage.local` and confirm the policy is a ciphertext envelope.
5. **Filtering:** Navigate to the test domain on the child profile; verify DNR redirects to `child/blocked.html`; inspect `chrome.declarativeNetRequest.getDynamicRules()` in the extension service worker console to confirm rule application.
6. **Approval:** Submit a request from the blocked page; verify a parent dashboard item and browser notification; approve for 30 minutes; wait for child sync; verify the requested domain is accessible; verify the allowlist expiry is removed after expiry and subsequent sync.
7. **Denial:** Submit another request; deny it; verify the child remains blocked and the request status changes.
8. **Revocation:** Revoke the child device; verify `/api/policy` returns 401 for its token and no future policy is received.
9. **License lifecycle:** Suspend the license in the product admin console; verify parent and child API calls stop; reactivate it and verify access returns.
10. **Offline behavior:** Disconnect the child from the network after a valid policy is applied; verify previously applied DNR rules remain. Reconnect and verify sync resumes.
11. **Unsupported browser:** Test a browser without DNR support; verify it does not claim the filtering protection is active.
12. **Tamper expectations:** Remove the extension in the test profile and document that the product cannot prevent removal in a self-managed profile. For a managed desktop test, separately validate the organization's official enterprise policy and removal process.

## Mobile release gates

Repeat pairing, policy sync, redirect, notifications, background suspension, offline behavior, battery saver behavior, and revocation tests on each exact supported browser build/device OS. A passing desktop test does not establish mobile compatibility.

## Do not ship until

- Staging and production secrets/databases are separated.
- Cloudflare D1 backups and restore are tested.
- A parent account recovery process is documented and safely implemented.
- The adult/gambling/phishing feeds are real, licensed, current, reviewed, and tested (or their toggles remain clearly marked as unavailable).
- Web Push is added if the product specification requires alerts when the parent's browser is closed.
- Privacy notice, parental-consent flow, retention/deletion workflow, support and incident response are ready.
- Independent security review has passed.
