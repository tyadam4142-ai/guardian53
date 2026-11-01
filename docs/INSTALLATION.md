# Installation and packaging

## Parent desktop installation

1. Obtain a Guardian 53 license code from Dynamic Robotics.
2. Install Chrome or Edge on the parent desktop.
3. Unzip the release package to a stable folder (do not delete the folder after loading unpacked).
4. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
5. Enable Developer mode and select **Load unpacked**.
6. Select the extracted extension folder.
7. Open Guardian 53, create the parent account using the license code, and set a unique master password (at least 12 characters; not the account password).
8. Generate a connection code for the child device.

## Child desktop installation

1. Install the same signed-off release ZIP on the child browser using Load unpacked.
2. Open Guardian 53 and choose **Set up this browser as a child device**.
3. Enter the six-digit code shown on the parent.
4. The parent checks the pending device details, compares the 12-character fingerprint on both screens, and explicitly approves or declines it. Never approve a mismatch.
5. The child browser receives a one-time encrypted key envelope and the initial policy.
6. Verify a test blocked domain, a parent access request, a temporary exception, and revocation.

## Parent/child approvals

- The child blocked page displays a form to request one domain.
- The parent dashboard lists pending requests and can allow the requested domain for 30 minutes or deny it.
- An approval writes a temporary allowlist entry into the encrypted policy, then updates the request decision.
- The child polls for policy changes and updates dynamic DNR rules on its next successful sync.
- A lost network connection leaves the last applied rules in place. A revoked device cannot retrieve new policy.

## Extension ZIP creation

Linux/macOS:

```bash
GUARDIAN_API_ORIGIN=https://YOUR-ORIGIN ./scripts/package-extension.sh
```

Windows PowerShell:

```powershell
.\scripts\package-extension.ps1 -ApiOrigin 'https://YOUR-ORIGIN'
```

The ZIP contains the configured extension folder's contents at its root. Extract it before using Load unpacked. Chrome's Load unpacked picker must target the directory containing `manifest.json`, not the ZIP itself. Rebuild the ZIP whenever the Worker origin or approved release version changes; do not manually edit the customer's copy after packaging.

## Browser site-access permission

The extension requests the broad `<all_urls>` host permission because its Dynamic Declarative Net Request rules redirect arbitrary blocked top-level pages to the bundled neutral block page. Chrome requires host access for redirect rules; its own DNR reference shows this requirement for extension-resource redirects. The Worker API origin is also listed separately. Users must review and accept this permission during installation; if they decline it, broad website filtering cannot work as designed. This permission is used for URL filtering, not for reading page contents or injecting scripts.

## Managed deployments (optional)

For devices owned or administered by a school, organization, or parent, consult the browser vendor's official enterprise policy documentation. A managed installation policy must be configured by the authorized device/browser administrator and must be disclosed to the user. The exact force-install method varies by OS, browser channel, account type, and whether the extension is self-hosted or store-distributed. Do not assume it applies to consumer Android browsers.

Guardian 53's current extension is packaged for testing and private distribution; this project does not yet include a self-hosted CRX update server or a signed enterprise update manifest. A Load Unpacked install will not auto-update and is removable by a local user with control of the profile.
