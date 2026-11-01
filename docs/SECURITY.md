# Security design and remaining work

## Data flows

- Parent account password is sent only over HTTPS to the Worker and checked using PBKDF2-SHA-256 (310,000 iterations, random per-account salt). The server stores the derived verifier, not the password.
- Server session tokens are random opaque bearer tokens. Only SHA-256 token hashes are stored in D1. The parent extension stores its token in a locally encrypted AES-256-GCM envelope in `chrome.storage.local`; the non-extractable local wrapping key is kept in IndexedDB.
- A separate parent master password derives an AES-256-GCM wrapping key (PBKDF2-SHA-256, random salt) for a random 256-bit family key. The wrapped key is stored locally. The raw family key is only held in the parent UI memory after unlock.
- A child creates a P-256 ECDH key pair. The parent creates an ephemeral P-256 ECDH key pair, derives a shared secret, then uses HKDF-SHA-256 to derive an AES-256-GCM wrapping key. The encrypted pairing envelope contains the family key and child device token. The server stores only the opaque envelope; it never receives either plaintext value.
- Policy content is serialized and encrypted using AES-256-GCM with a fresh random 96-bit nonce for every update. D1 stores the serialized ciphertext envelope. The server can still see request domain names, account metadata, device metadata, timestamps, and other API routing metadata.
- The server stores a salted HMAC of pairing codes using the separate `PAIR_CODE_PEPPER` Worker secret, one-time status, expiration, pairing secrets as SHA-256 hashes, and child device token hashes.

## Security properties and caveats

- AES-GCM authentication tags detect modification of encrypted policy/envelopes.
- Pairing approval binds the family key and device credential to the child public key.
- Pair codes expire after five minutes and are consumed in the same D1 batch as device creation; atomic rate limits apply by client IP and the matched family. Parent sign-in and product-admin routes are also throttled.
- D1 policies are end-to-end encrypted from the extension clients in the normal flow. Do not add server-side plaintext policy diagnostics.
- AES local storage encryption is not equivalent to OS hardware-backed key storage. An attacker controlling the browser profile or running code in the extension origin may use keys available to that origin.
- Parent session storage encryption does not stop an authorized local extension context from using the session while the browser profile is unlocked.
- No local encryption can prevent uninstall, extension disablement, profile deletion, OS reinstall, alternate browsers, VPN/proxy use outside enforced controls, or network-level workarounds.

## Required pre-production work

- Independent threat model and code audit; review pairing, session lifecycle, rate-limit concurrency, account recovery, and admin key handling.
- Add email verification and a secure password recovery workflow.
- Add multi-parent/device key recovery with explicit recovery-key enrollment; do not silently upload the raw family key.
- Add standards-based Web Push (VAPID) if notifications must be delivered while the parent browser is closed.
- Add robust license billing/renewal, refund and transfer semantics, support tooling, and admin MFA/IP allowlisting.
- Add category data licensing, safe update distribution, false-positive appeals, and malware/phishing feed provenance.
- Add policy schema versioning/migration, signed update metadata, backup and disaster recovery tests.
- Add browser integration tests for Chromium stable and Edge stable; verify each mobile browser version separately.
- Add accessibility, localization, privacy retention and deletion controls; consider child-safety and data-protection legal review in each launch country.

## Security reporting

Before commercial release, publish a security contact and vulnerability disclosure policy. Do not ask customers to send passwords, family keys, or full browsing logs to support.


## Pairing confirmation and local key handling

- Pairing uses a six-digit code with a five-minute lifetime, single redemption, an HMAC-SHA-256 pepper held as a Cloudflare secret, per-IP and per-family throttling, and explicit parent approval.
- Before approval, both screens display a 12-hex-character short authentication string derived from the child's P-256 public key. The parent must compare it with the value shown on the child screen out-of-band; do not approve a mismatch.
- The child P-256 private key and imported AES family key are non-exportable CryptoKey objects stored in extension-origin IndexedDB. Parent session/device bearer tokens are encrypted with AES-256-GCM before being written to `chrome.storage.local`; the local wrapping CryptoKey is non-exportable and held in IndexedDB.
- The AES local-storage AAD is bound to the logical record name to prevent swapping one encrypted record into another record slot.
- These browser storage controls reduce casual extraction and accidental disclosure. They do not defend against a fully compromised browser profile, malicious extension code, browser debugging, or an administrator with access to the profile.
