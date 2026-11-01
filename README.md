# Guardian 53 — Dynamic Robotics

**Guardian 53** is a self-hosted Manifest V3 website-filtering and parent-approval starter product. The repository includes a Chromium extension, Cloudflare Workers API, D1 migration, standalone product-owner console, pairing flow, encrypted policy sync, approval requests, tests, and packaging scripts.

> **Release status: security-focused MVP / pre-production.** This is not a certified parental-control product and must pass the deployment checklist, real browser tests, privacy/legal review, and an independent security review before commercial sale. The included category lists are small starter examples, not comprehensive web classifications.

## What is implemented

- MV3 background service worker and dynamic `declarativeNetRequest` rules.
- Visible “Blocked by Admin” page and child-initiated parent access request.
- Parent account registration/login using license codes issued by the product-owner console.
- PBKDF2-SHA-256 password derivation (310,000 iterations), atomic non-exportable local key creation, and AES-256-GCM encrypted local session/device-token storage with record-bound AAD.
- Random 256-bit family key; parent master password wraps the key locally. Child devices receive it in an ECDH P-256 + HKDF + AES-GCM envelope only after parent approval.
- Policy is encrypted in the parent extension before being sent to the relay. D1 stores the ciphertext envelope, not readable categories or lists.
- Six-digit, five-minute, single-use pairing code, HMAC-SHA-256 with a server-only pepper, atomic rate limiting, parent approval, and an out-of-band public-key fingerprint comparison.
- Device registration, license device limits, device revocation, license suspension, request approval/denial, and audit metadata.
- Parent dashboard notifications while the dashboard is open; the MV3 background worker also polls pending requests on a one-minute alarm and uses the browser Notifications API.
- Standalone Cloudflare-hosted product admin console for license creation, suspension, and revocation.

## Important security and product limits

1. **No extension can make itself undeletable.** A user with control of their browser profile can remove an unpacked extension, clear its storage, or alter the browser. Guardian 53 does not hide itself, resist uninstall secretly, or disable developer tools.
2. **Managed installation is an administrator-owned option.** On compatible desktop Chrome/Edge deployments, an organization or device owner can use official browser enterprise policies (for example, force-install policies) and OS account controls. A Load Unpacked install is not tamper-proof. Android browser extension support differs by browser and version; do not claim equivalent enforcement without testing.
3. **Notifications are near-real-time polling, not standards-based Web Push.** The open parent dashboard polls every 15 seconds. The MV3 service worker uses an alarm with a one-minute period and local browser notifications while the browser can run extensions. It cannot guarantee delivery if the browser is fully closed, the OS suspends it, notifications are denied, or the device is offline. Add a separately configured Web Push provider/PWA for guaranteed remote push delivery.
4. **No remote activity surveillance.** The server stores parent-requested domains, device/policy metadata, and security events. It does not collect a complete browsing history. Do not add browsing-history collection without clear notice, consent, retention limits, and legal review.
5. **Parent master password is not recoverable by the server.** Losing it means losing access to the encrypted family key on that parent device. Make an offline recovery process before commercial release. Do not claim that the current MVP supports multi-parent or multi-parent-device key recovery.
6. **Local encryption is not a defense against a fully compromised endpoint.** A non-extractable CryptoKey and AES-GCM ciphertext protect stored data at rest from casual inspection, but code running with the extension's origin can use available keys. Browser-profile owners retain ultimate control.
7. **The admin API key is a high-value secret.** Keep it in Cloudflare Worker secrets, never commit it, never put it in the extension, and use a separate staging key/database.
8. The sample category domain arrays are deliberately sparse; `.invalid` entries are placeholders that never generate network rules. A production product needs reviewed, maintained classification feeds and false-positive handling.

## Repository map

```text
guardian53/
├── extension/
│   ├── manifest.json, background.js, config.js
│   ├── lib/                 # Web Crypto, encrypted local storage, API, DNR rule builder
│   ├── parent/              # Parent dashboard and styling
│   ├── child/               # Setup/pairing and neutral blocked page
│   ├── icons/               # Extension PNG icons
│   └── tests/               # Domain and policy-rule unit tests
├── server/
│   ├── src/index.js         # Cloudflare Worker REST API
│   ├── migrations/          # D1 schema
│   ├── wrangler.jsonc
│   └── package.json
├── public/                  # Standalone product-owner console served by Workers assets
├── docs/                    # Deployment/security/compatibility guidance
└── scripts/                 # Validation and extension packaging
```

## Quick build and test

Requirements: Node.js 20+, npm, Python 3, `zip`/`unzip` (macOS/Linux packaging and test tools), and a Cloudflare account with Workers and D1 access. Windows has a PowerShell packaging script.

```bash
cd server
npm install
cd ..
./scripts/check-project.sh
```

The automated checks do not require Cloudflare credentials. They cover domain normalization, DNR policy generation, parent-vault encryption, ECDH pairing envelopes, the D1 schema/critical SQL, JavaScript syntax, and extension packaging. They are not a substitute for a deployed Worker test, Chrome/Edge browser integration, or independent security review.

## Cloudflare deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/TESTING.md`](docs/TESTING.md), and [`docs/MANAGED_DEVICES.md`](docs/MANAGED_DEVICES.md). In brief:

1. Create a Cloudflare D1 database named `guardian53-prod`.
2. Put its database ID into `server/wrangler.jsonc`.
3. The Worker is preconfigured for `https://guardian53.dynamicrobotics53.com` and your D1 database ID.
4. Set `ADMIN_API_KEY` and `PAIR_CODE_PEPPER` using `wrangler secret put` from the `server/` directory; never commit secret values.
5. Apply the D1 migration and deploy the Worker.
6. Test `/api/health` and the admin console before issuing any license.
7. Package the extension with the final Worker origin so the manifest host permission and config are correct.

The Worker serves the static product admin console from `public/`, and API routes are routed through the Worker first. The marketing/download website can remain on GitHub Pages; the relay/admin app uses `guardian53.dynamicrobotics53.com`; keep your marketing/download website on its existing hostname.

## Extension installation

- Chrome desktop: unzip `build/guardian53-extension.zip`; open `chrome://extensions`; enable Developer mode; choose **Load unpacked** and select the extracted `extension` folder.
- Edge desktop: use `edge://extensions` and the same Load unpacked flow.
- Child setup: open the extension popup and select **Set up this browser as a child device**. Enter the six-digit code generated on the parent device. The child remains pending until the parent approves it.
- Parent setup: sign in/create account with a license code, create a distinct master password, generate a pair code, approve the pending child, and publish the policy.

For repeatable release packaging, see [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

## Browser permission disclosure

The extension declares `<all_urls>` because MV3 DNR redirect rules that send arbitrary blocked URLs to the extension's own block page require host access. The configured Cloudflare Worker origin is listed in addition. This is a broad browser permission and must be disclosed to users at installation; the extension does not inject scripts into pages or inspect page contents.


## Publish the source to GitHub

Publish the contents of this project directory. Keep `.gitignore`, `README.md`, `docs/`, `extension/`, `public/`, `scripts/`, and `server/` in the repository. The `.dev.vars.example` file contains placeholders only and is intentionally included as a safe template.

Do **not** publish real `.dev.vars` or `.env` files, `.wrangler/`, `node_modules/`, `build/`, local databases, private key files, customer license exports, or the private `~/.guardian53-secrets/` directory. Cloudflare Worker secrets are configured separately with Wrangler and are never committed to GitHub.
