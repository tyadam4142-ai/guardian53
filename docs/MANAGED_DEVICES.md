# Managed-device deployment

Guardian 53's current distributable uses **Load Unpacked** for private testing. This mode does not prevent a user with control of the browser profile from disabling or removing the extension.

For a genuinely managed deployment, the parent, school, or organization must own/administer the device or browser profile and use the browser vendor's documented enterprise management mechanism. Apply management transparently and obtain the required consent/authority.

The current source does not yet contain a signed CRX build, hosted extension update manifest, or an enterprise policy installer. A production-managed release needs these components:

1. A stable extension ID and signed package build process with the signing key held offline.
2. An HTTPS update manifest and versioned CRX distribution endpoint.
3. A documented Chrome/Edge `ExtensionSettings` policy for authorized devices.
4. An administrator-controlled configuration profile and recovery/uninstall procedure.
5. A separate validation matrix for mobile browser vendors; desktop enterprise policy cannot be assumed to work on Kiwi or Orion.

Do not use stealth installation, persistence tricks, hidden processes, or unauthorized controls. If a device is not owned or administered by the parent/organization, use the normal visible installation and parent approval flow.
