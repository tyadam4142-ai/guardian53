# Browser compatibility plan

| Browser | Expected position | Release gate |
|---|---|---|
| Chrome desktop | Primary target: MV3, service worker, DNR, alarms, notifications | Test current stable on Windows and macOS |
| Microsoft Edge desktop | Chromium MV3 target | Test current stable and Edge enterprise policy separately |
| Kiwi Browser Android | Third-party Chromium extension support varies by Kiwi build | Install, pair, DNR redirect, alarms and notifications must be tested on actual phone/build |
| Orion mobile | WebExtensions compatibility varies by platform/version and supported APIs | Treat as experimental until DNR, background execution and storage tests pass |
| Chrome Android | Standard Chrome Android does not provide the desktop extension installation flow | Do not claim support |

The extension checks for `declarativeNetRequest` at runtime. A browser missing that API cannot provide the intended filtering and should show an unsupported status rather than claiming protection is active. Mobile background suspension, battery optimization, notifications, and browser-specific API gaps can delay sync and approval notifications.

Maintain a compatibility matrix per browser version. Do not sell a platform as supported based only on the ability to install the extension.
