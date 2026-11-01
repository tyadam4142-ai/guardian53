# Guardian 53 API reference

All endpoints are served by the Cloudflare Worker. Production clients must use HTTPS. JSON errors have the shape `{ "error": "..." }`.

## Public / child pairing

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health probe |
| POST | `/api/pair/redeem` | Redeem one-time code with child P-256 public key; returns pairing secret |
| GET | `/api/pair/status` | Poll using pairing secret; returns pending/denied/active/expired/revoked state and opaque keybox |
| POST | `/api/pair/complete` | Acknowledge keybox delivery and clear one-time pairing secret |

## Parent account

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Activate one license and create parent family account |
| POST | `/api/auth/login` | Sign in and create bearer session |
| POST | `/api/auth/logout` | Revoke current parent session |
| POST | `/api/pair/code` | Create a five-minute, one-use six-digit code |
| GET | `/api/pair/pending` | List pending and known devices |
| POST | `/api/pair/approve` | Approve a pending device and submit its opaque ECDH keybox + token hash (parent must compare the out-of-band key fingerprint) |
| POST | `/api/pair/deny` | Decline pairing |
| POST | `/api/devices/revoke` | Revoke an active child device |
| GET | `/api/policy` | Retrieve encrypted policy envelope |
| PUT | `/api/policy` | Store an encrypted policy envelope |
| GET | `/api/requests?status=pending` | List access requests |
| POST | `/api/requests/:id/decision` | Approve or deny an access request |
| GET | `/api/activity` | View security/approval audit metadata |

## Child device

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/policy` | Fetch latest encrypted family policy |
| POST | `/api/requests` | Submit a parent access request for one domain |

## Product-owner administration

These routes require `X-Admin-Key` matching the Cloudflare Worker secret `ADMIN_API_KEY`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/admin/licenses` | Create one or more license codes |
| GET | `/api/admin/licenses` | List license metadata (never displays code hashes) |
| PATCH | `/api/admin/licenses/:id` | Set license status to active, suspended, or revoked |

The license code is displayed only once at creation. Store and deliver it through a secure channel.
