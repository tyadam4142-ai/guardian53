# Cloudflare deployment

This project is preconfigured for the Cloudflare resources you just created:

- Worker: `guardian53-relay`
- D1 database: `guardian53-prod`
- D1 database ID: `db58625f-b049-472d-87d0-62bcbb533fda`
- Custom Domain: `guardian53.dynamicrobotics53.com`

## 1. Open the correct folder

In Terminal, change into the project's `server/` directory. If you extracted the configured ZIP into Downloads:

```bash
cd "$HOME/Downloads/guardian53/server"
```

If you extracted it somewhere else, use that folder's actual path. Wrangler must run from `server/` so it reads `wrangler.jsonc`; running it from `~` caused the earlier “Required Worker name missing” error.

Install dependencies and confirm Cloudflare authentication:

```bash
npm install
npx wrangler whoami
```

## 2. Apply the D1 schema

Your D1 database already exists. Do not create it again. Apply the migration:

```bash
npx wrangler d1 migrations apply guardian53-prod --remote
```

## 3. Deploy the Worker and custom domain

```bash
npx wrangler deploy
```

The `routes` entry in `wrangler.jsonc` configures `guardian53.dynamicrobotics53.com` as a Cloudflare Workers Custom Domain. Cloudflare creates the DNS record and certificate during deployment, provided `dynamicrobotics53.com` is an active zone in this same Cloudflare account and no conflicting CNAME already occupies that hostname. Do not change the apex/root or your marketing site's DNS records. If the subdomain already has a CNAME record, remove only that conflicting subdomain record before deploying.

## 4. Set product-owner secrets outside the repository

Do this after the first deployment, because `wrangler secret put` adds the secret to an existing Worker. The following macOS flow stores the secret values in a private directory outside the Git repository and uploads them to Cloudflare:

```bash
mkdir -p "$HOME/.guardian53-secrets"
chmod 700 "$HOME/.guardian53-secrets"
openssl rand -base64 48 > "$HOME/.guardian53-secrets/ADMIN_API_KEY"
openssl rand -base64 48 > "$HOME/.guardian53-secrets/PAIR_CODE_PEPPER"
chmod 600 "$HOME/.guardian53-secrets/"*

npx wrangler secret put ADMIN_API_KEY < "$HOME/.guardian53-secrets/ADMIN_API_KEY"
npx wrangler secret put PAIR_CODE_PEPPER < "$HOME/.guardian53-secrets/PAIR_CODE_PEPPER"
```

These are two different random secrets. Keep the files private and back them up securely. To paste the admin key into the product admin console later, run:

```bash
pbcopy < "$HOME/.guardian53-secrets/ADMIN_API_KEY"
```

Then paste it into the password field at `https://guardian53.dynamicrobotics53.com/`. Clear your clipboard afterward with `printf '' | pbcopy`.

Cloudflare injects the values into the Worker runtime as `env.ADMIN_API_KEY` and `env.PAIR_CODE_PEPPER`. The values do not go into `wrangler.jsonc`, source code, GitHub, screenshots, the extension manifest, or a customer ZIP. The random value previously printed in chat must not be reused; generate a fresh value as shown above.

## 5. Verify the deployment

```bash
curl https://guardian53.dynamicrobotics53.com/api/health
```

Expected response shape:

```json
{"ok":true,"service":"guardian53-relay","time":"..."}
```

Open `https://guardian53.dynamicrobotics53.com/` for the product-owner console. Paste the `ADMIN_API_KEY` from your private file when prompted. Use the console to issue a small number of test licenses first.

## 6. Build the customer extension ZIP

Return to the project root (one level above `server/`):

```bash
cd ..
GUARDIAN_API_ORIGIN=https://guardian53.dynamicrobotics53.com ./scripts/package-extension.sh
```

This creates `build/guardian53-extension.zip`. The script packages the extension with the correct API hostname and host permission. The source `extension/` directory is not modified.

## 7. Keep GitHub and Cloudflare secrets separate

- The Worker source, D1 migration, and public hostname belong in GitHub.
- `ADMIN_API_KEY` and `PAIR_CODE_PEPPER` belong only in Cloudflare Worker Secrets and your private local backup directory.
- Never commit `.dev.vars`, `.dev.vars.*`, real `.env` files, admin keys, customer license lists, D1 exports, or local database state.
- The repository's `.gitignore` already excludes local `.dev.vars` and `.env` files. The `.dev.vars.example` file contains placeholders only.
- Do not put the product-owner admin key in the extension. The extension authenticates using parent/device credentials, not the product-owner key.

## Operational checklist

- Verify the custom domain and TLS before producing a customer ZIP.
- Use separate staging and production D1 databases and secrets.
- Turn on Cloudflare observability and alerts for 4xx/5xx spikes.
- Set a D1 backup/export policy and test restore procedures.
- Define license issuance, refund, suspension, deletion, and support processes.
- Establish a privacy notice, data-retention schedule, parental-consent process, and incident response contact.
