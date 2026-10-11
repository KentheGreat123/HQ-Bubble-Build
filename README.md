# 1st Rate HQ Android

One Kotlin/AndroidX Android application (`com.firstrate.hq`, Android 8/API 26+) hosts the existing live [1st Rate HQ interface](https://kenthegreat123.github.io/1st-Rate-Parts-App/) and includes the Housecall Pro return bubble in the same APK. There is no separate bubble app or screen to open. The original developer spec and old test page are preserved; the test page is no longer the startup UI. The HQ monogram remains temporary artwork.

## Build and Android Studio

Use JDK 17, Android Studio supporting AGP 9.4.1, and Android SDK Platform 37.2 with Build Tools 36.0.0. Gradle 9.6.0 is pinned by the wrapper; AGP supplies built-in Kotlin support. Open this repository as an Android Studio project, set its Gradle JDK to 17, and install the SDK through SDK Manager. Set `sdk.dir=C\:/path/to/Android/Sdk` in ignored `local.properties`, or set `ANDROID_HOME`.

```powershell
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
node --test tests/bridge-contract.test.cjs
```

On macOS/Linux: `chmod +x gradlew` if the checkout lacks the executable bit, then `./gradlew assembleDebug testDebugUnitTest lintDebug`. APK: `app/build/outputs/apk/debug/app-debug.apk`. Use Run in Android Studio or `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

The app compiles against installed stable API 37.2 and targets major API 37. To change SDK later, update the `compileSdk` release/minor settings and `targetSdk` in `app/build.gradle.kts`, with a compatible stable AGP/Gradle toolchain. Never select a preview SDK blindly. The workspace-local `.tooling` folder, when present, is an ignored build setup convenience, not part of the shipped app.

For the tools installed in this workspace, run these first in PowerShell:

```powershell
$env:JAVA_HOME = (Resolve-Path '.tooling/jdk/jdk-17.0.20.1+1').Path
$env:GRADLE_USER_HOME = "$pwd/.tooling/gradle-home"
$env:ANDROID_USER_HOME = "$pwd/.tooling/android-home"
```

## Live HQ interface and exact bridge API

The WebView starts at `https://kenthegreat123.github.io/1st-Rate-Parts-App/`. Website updates arrive through its normal HTTPS/service-worker behavior, without rebuilding the native APK. No production web repository is copied, edited or deleted. Native code does not force a page reload when returning from HCP. The website itself may reload when its service worker updates.

Android injects the public adapter at **document start**, before web initialization. The exact API is:

| Method | Return | Behavior |
|---|---|---|
| `HQNative.openHcp()` | `undefined` (void) | Launch installed HCP or store fallback; arm bubble if allowed |
| `HQNative.stopBubble()` | `undefined` (void) | Stop bubble/service, including sign-out |
| `HQNative.isBubbleAllowed()` | synchronous `boolean` | Actual Settings.canDrawOverlays state, queried per call |
| `HQNative.requestBubblePermission()` | `undefined` (void) | HQ explanation followed by package overlay Settings |

The current deployed page calls `window.HQ` directly, so the native adapter also supplies this compatible API. An existing website-owned HQ object is preserved. No Promise migration is required.

```javascript
if (window.HQ) {
  window.HQ.openHcp();
} else {
  // Preserve the production application's existing browser/web launch behavior.
}
const allowed = window.HQ ? HQ.bubble.isAllowed() : false;
HQ.bubble.requestPermission(); // explanation then Android Settings
HQ.bubble.stop();              // call during sign-out
```

An origin-restricted AndroidX WebMessageListener verifies main frame, exact HTTPS origin, HQ repository path and random adapter token for privileged actions. The public HQNative adapter is installed only in the top HQ document; third-party frames have none. A token-authenticated, URL-checked **read-only** native prompt handler returns the required synchronous permission boolean without displaying a dialog. It cannot perform launch/stop/permission actions. No `addJavascriptInterface` or broad origin wildcard is used. Providers lacking WEB_MESSAGE_LISTENER or DOCUMENT_START_SCRIPT retain the website fallback and an update hint.

GitHub Pages repositories share an origin, so navigation and native calls are restricted to `/1st-Rate-Parts-App/`; other HTTP(S) document links open externally. Production scripts on the HQ origin are trusted code. WebView DOM storage/cookies/cache are never cleared on activity transitions, but WebView storage is separate from Chrome and the previous local test-page origin. Normal HCP returns reuse the existing singleTask activity and live document. Declared configuration changes preserve the same WebView. OS process death cannot retain an arbitrary JavaScript heap; production state must be persisted by the frontend.

The site's relative service-worker registration is preserved. Its source contains shell caching and an offline fallback, but **offline support has not been verified in Android**. Authentication/PIN behavior, actual WebView localStorage, scanner camera and site navigation need the device checklist. Menu sign-out already calls HQ.bubble.stop; the alternate PIN-page sign-out in the inspected live source does not. See [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md) for evidence and this frontend limitation.

## Permissions, service and Android versions

The app does not request overlay permission on fresh launch. The first installed-HCP action explains the bubble with **Allow floating HQ button** / **Not now**. Denial is remembered to avoid nagging; the explicit Request Overlay Permission action always permits trying again. Returning from Settings checks the actual permission before continuing. HCP still opens on denial, revocation, notification denial, or service failure. Missing HCP opens its market listing, then the HTTPS listing if no market handler exists.

The user-initiated service starts while HQ is visible. SHOW arms visibility; the Activity's actual `onStop` reveals it, avoiding a launch delay. Returning to HQ sends HIDE semantics, cancelling that arm and removing every overlay while retaining the active service/notification. Another explicit HCP action is required to show again. STOP/notification close/drag close/sign-out/expiry remove all windows and foreground state. Repeated SHOW does not extend the session. The service is START_NOT_STICKY and never automatically resurrects a bubble after process death.

API 26 uses TYPE_APPLICATION_OVERLAY and a notification channel. API 30+ metrics and an untouchable transparent overlay inset probe on all versions keep the bubble/close target in safe display bounds. API 33+ asks for POST_NOTIFICATIONS only before the first permitted bubble launch; denial does not prevent a foreground service (Android may show it only in Task Manager). API 34+ declares specialUse, its permission and purpose property, and passes the explicit type to startForeground. No background service launch is used. Bubble taps rely on the visible SYSTEM_ALERT_WINDOW exception for activity launches; the direct notification Activity PendingIntent offers another return route. API 31+ uses VibratorManager; older supported versions use Vibrator with VibrationEffect.

Camera getUserMedia grants **only video capture**, only to the exact trusted origin, and only after Android CAMERA permission. Audio/other resources are not granted. Camera hardware is optional. No microphone, accessibility, broad storage, exact-alarm or boot permissions are requested.

Session expiration uses elapsedRealtime (including sleep), persisted with Android boot count, capped at eight hours. A main-thread watchdog checks expiry/revocation once a second while awake; an elapsed-time alarm also schedules cleanup. Android can defer inexact alarms while asleep, so physical cleanup at the precise eight-hour instant during device sleep is not guaranteed. The watchdog stops an overdue session on waking; OEM background/service restrictions also require device validation.

## Icons and validation

Replace temporary `app/src/main/res/drawable/ic_hq.xml` with approved production artwork and update the adaptive launcher at `res/mipmap-anydpi-v26/ic_launcher.xml` as needed. The bubble uses `ic_hq`; its container stays 56dp. `ic_notification.xml` must remain an Android monochrome notification icon. Use Android Studio Image Asset tooling to generate production resources.

Unit tests cover geometry, normalized persistence, close-distance boundaries, elapsed-time expiry, URL trust and the exact JavaScript contract. See [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) for device steps and [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md) for three separate reviews and results. [INSTALLATION.md](INSTALLATION.md) explains package/signing compatibility. Release signing and physical-device validation remain outstanding.

Android does not permit reading or controlling HCP's internal UI through this overlay implementation. No scraping, AccessibilityService, simulated touches, root, or iOS overlay is implemented. Job/customer/part data belongs in authorized server-side Housecall Pro API integration.

Platform references: [special-use foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use), [notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission), [origin-restricted native bridges](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge).
