# Install/update the integrated HQ application

The user reports the previous APK now installs successfully. There is no longer an unresolved installation failure to diagnose from an error message. This build updates the **same** Android package (`com.firstrate.hq`), with version code 2 / version name 0.2.0. It loads the live HQ UI and runs the return bubble inside that app.

Install `app/build/outputs/apk/debug/app-debug.apk` over the earlier debug build using the normal Android installer, or:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Do not uninstall an existing HQ app or clear its data merely to try an update; that removes its WebView storage/preferences. Android WebView storage is independent of browser/PWA storage, so browser sign-in is not automatically shared with this APK.

## Diagnosing an actual install error

| Installer/ADB result | Interpretation | Check / remedy |
|---|---|---|
| INSTALL_FAILED_UPDATE_INCOMPATIBLE | Same package, different signing certificate | Compare `apksigner verify --print-certs` for both APKs; keep the existing signing key. A production-signed HQ cannot be updated by this debug certificate |
| INSTALL_FAILED_VERSION_DOWNGRADE | Installed version code is higher | Inspect `adb shell dumpsys package com.firstrate.hq`; build a higher version with the same key |
| INSTALL_FAILED_OLDER_SDK | Device below Android 8/API 26 | Check device API; minSdk is 26, not targetSdk 37 |
| INSTALL_FAILED_NO_MATCHING_ABIS | APK native libraries incompatible | This APK has no bundled app native libraries/ABI filter; inspect any different APK supplied to installer |
| Invalid/corrupt APK or signature error | Partial download, modified archive or wrong file | Recopy the complete `.apk`; run `apksigner verify --verbose` |
| INSTALL_FAILED_INSUFFICIENT_STORAGE | Device space issue | Free device space and retry without deleting HQ data |
| Blocked installation from this source | Android user/device policy | Use the device's approved installation process; no automated bypass |

Target API is a behavior level, not the minimum Android version. This universal debug APK supports API 26+ and contains one launcher Activity, no separate bubble launcher/package. Android may still apply OEM/enterprise installer policies.

The rebuilt APK's certificate is compared against the prior workspace APK in INTEGRATION_VERIFICATION.md. Matching the workspace artifact does not establish that a separately installed production APK uses that certificate. Installation of the **new** APK has not been tested on a connected device.
