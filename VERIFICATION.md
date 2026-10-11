# Three-pass verification

**Historical version 0.1.0 development-shell review.** The current live-site integration, exact HQNative contract, current reviews and execution evidence supersede this document and are recorded in [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md).

## Pass 1 — requirements mapped to implementation

“Implemented” below is a source review, not a claim of physical-device acceptance. Kotlin locations are under `app/src/main/java/com/firstrate/hq/` unless stated otherwise.

| Requirement | Implemented? | File/location | Notes |
|---|---|---|---|
| Inspect and preserve existing repository | Yes | original `Android_HQ_Bubble_developer_spec.md` | Only original spec existed; preserved unchanged |
| Complete Kotlin/AndroidX/Gradle project; wrapper, resources, ignore | Yes | root Gradle files, `app/`, `gradle/`, `.gitignore` | No production UI invented |
| App name and com.firstrate.hq | Yes | manifest, strings, app Gradle | min SDK 26 |
| Newest available stable SDK | Yes | app Gradle | SDK Manager listed stable 37.2; compile 37.2, target major 37 |
| Native WebView/local web files replaceable | Yes | MainActivity; `assets/www/index.html`; README | HTTPS AndroidX asset loader; production files absent |
| Development heading, four actual bridge buttons, logs | Yes | `assets/www/index.html` | Also persistence/state and camera tests |
| JavaScript, DOM storage, caching | Yes | MainActivity settings | Default WebView caching, DOM storage; never clear storage |
| Preserve existing HQ state on HCP return | Yes | MainActivity manifest/lifecycle | singleTask; no loadUrl on return; orientation kept in same activity |
| Process recreation recovery | Partial platform limit | MainActivity save/restore; README | History/localStorage restored; arbitrary live JS heap cannot survive process death |
| HQ.openHcp | Yes | HQJavascriptBridge, MainActivity | Promise acknowledges dispatch |
| HQ.bubble.stop/isAllowed/requestPermission | Yes | HQJavascriptBridge, MainActivity | Real permission snapshot; sign-out stop is idempotent |
| Nested API wrapper and web fallback contract | Yes | HQJavascriptBridge; README; test page | hq-ready initialization event |
| Trusted bridge only; block privileged remote/frame access | Yes | HQJavascriptBridge, MainActivity | Exact origin and main-frame checks, no legacy JavascriptInterface |
| Installed HCP launch and modern visibility | Yes | MainActivity; manifest queries | getLaunchIntentForPackage housecall.pros |
| Missing HCP market then HTTPS fallback | Yes | MainActivity.openStore | Handles missing both handlers with message |
| HQ explanation before overlay Settings | Yes | MainActivity.requestOverlay | Exact purpose and requested choices |
| Package overlay Settings, real re-check on return | Yes | MainActivity | Settings.canDrawOverlays at launch; no assumption based on resultCode |
| Denial never prevents HCP; no retries/nagging | Yes | MainActivity | Decline remembered; explicit permission action remains available |
| Foreground service explicit SHOW/HIDE/STOP | Yes | BubbleService; HqApplication | stopService used for web stop to avoid starting a service solely to stop |
| specialUse type/permissions/purpose on modern Android | Yes | manifest; BubbleService | API 34 conditional startForeground type |
| Channel, ongoing text, direct existing-activity return | Yes | BubbleNotifications | Immutable direct Activity PendingIntent |
| Notification Close stops all resources | Yes | BubbleNotifications, BubbleService | STOP action removes foreground notification/windows |
| POST_NOTIFICATIONS handled on API 33+ | Yes | MainActivity, manifest | Asked once at bubble launch; denial does not block launch |
| 56dp circular icon/elevation/0.85 idle/1 touched | Yes | BubbleController; drawable resources | Temporary monogram explicitly labeled |
| Default right edge; center 30% above safe bottom | Yes | BubbleGeometry.defaultPosition | Unit-tested; all dp converted using display density |
| System/nav/gesture/cutout bounds | Yes; device check pending | BubbleController | Current metrics plus transparent untouchable inset probe; probe removed with bubble |
| Persist dock side/normalized Y; clamp invalid coordinates | Yes | BubbleGeometry, BubbleController preferences | Nonfinite Y fallback; unit-tested across changed displays |
| Quick tap reuses HQ and hides bubble | Yes | BubbleController, BubbleService, MainActivity | Return flags + singleTask; notification fallback |
| 300ms hold and Android touch slop | Yes | BubbleController.touch | Movement above slop before hold cancels gesture |
| Smooth following, safe bounds, nearest-edge snap | Yes | BubbleController; BubbleGeometry | Final coordinates persisted |
| Handle UP/CANCEL, prevent false taps after drag | Yes | BubbleController.touch | Cancel docks safely, removes target; no close/tap |
| 64dp close target bottom centered, 48dp safe gap | Yes | BubbleController.showTarget | Separate untouchable service overlay |
| 60dp activation radius and one entry haptic | Yes | BubbleController, closeHit | VibratorManager API 31+, VibrationEffect API 26+ |
| Release active target cleans overlays/service/notification | Yes | BubbleController, BubbleService | Guarded idempotent cleanup |
| Hide whenever HQ visible; show only explicit HCP action | Yes | HqApplication; MainActivity onStart/onStop; BubbleService | Visibility arm cancelled on return; service retained hidden |
| Eight-hour monotonic cap; no automatic restart | Yes, sleep timing limit | SessionClock; BubbleService; README | elapsedRealtime/boot count; watchdog and elapsed alarm; OS may defer physical sleep cleanup |
| Sign-out hook | Yes | HQ.bubble.stop | Production frontend must invoke it |
| Camera only after trusted-origin and Android permission | Yes | MainActivity WebChromeClient | Only VIDEO_CAPTURE; cancels stale navigation requests |
| Denied/revoked permission, repeated calls/activity/service, invalid positions | Yes; runtime pending | MainActivity; BubbleService; BubbleController | No privileged external components; failures isolated from HCP launch |
| View add/update/remove exceptions and cleanup | Yes | BubbleController, BubbleService | Removes bubble, target and probe, including partial add failures |
| Config changes/lifecycle cleanup | Yes | manifest; MainActivity; BubbleService | No intentional WebView reload on ordinary return/config changes |
| Reasonable separation of responsibilities | Yes | seven Kotlin source files | Activity, bridge, application lifecycle, service, controller, notification, geometry |
| Temporary adaptive/vector icon replacement instructions | Yes | resources; README | Production logo absent |
| README requirements/setup/build/web/bridge/package/permissions/version/tests/icon/limits | Yes | README | Includes explicit prohibition on HCP UI reading/control |
| No scraping/accessibility/touch simulation/root/iOS/broad permissions | Yes | manifest and source review | Server HCP API integration remains outside shell |
| Manual manifest review | Yes | manifest | INTERNET, CAMERA, SYSTEM_ALERT_WINDOW, FGS, SPECIAL_USE, POST_NOTIFICATIONS, VIBRATE; optional camera; queries; exports; service type/property |
| Actual build, fix and rebuild | Result recorded below | Gradle build | APK path recorded below when successful |
| Meaningful unit tests | Yes | BubbleGeometryTest | Seven tests, multiple geometry/expiry assertions |
| Exact manual acceptance steps and version matrix | Yes | ACCEPTANCE_TESTS.md | All 14 requested tests plus camera/security |
| Debug-shortened expiry | Yes | app Gradle; ACCEPTANCE_TESTS test 13 | -PhqDebugTimeoutMs; release always eight hours |
| Three separate review passes and final build/tests | This document | below | Physical-device execution remains pending |

## Pass 2 — Android platform correctness

Reviewed API 26 conditional APIs, package visibility on API 30+, runtime camera/notification permissions, API 34 specialUse declaration/property/type, foreground-only service initiation, visible-overlay activity return, direct notification Activity PendingIntent, system/gesture/cutout insets, and trusted-origin main-frame bridge. Fixed the full-screen inset probe to use **WindowManager alpha zero**, ensuring Android 12+ touch-through protection does not block HCP; a view-level alpha alone was insufficient. The untouchable close target has window alpha 0.7. The service arms during HQ visibility and reveals only from the actual onStop transition. AndroidX message transport avoids legacy bridge exposure to arbitrary iframes. In-memory document preservation covers normal HCP switches and declared configuration changes; OS process death cannot preserve a JavaScript heap. User-requested camera resources never include microphone access. Android versions/OEM behavior still require the device matrix.

## Pass 3 — failure modes

Reviewed overlay/notification/camera denial, overlay revocation, missing launch/store/browser handlers, Settings cancellation, repeated opens, duplicate service actions, rapid foreground transitions, view add/update/removal failures, saved Y corruption, orientation/display change, multiple notifications taps, cancelled drag, process death and timeout. Added a generation token to invalidate queued SHOW commands after HQ returns or sign-out stops the service; otherwise a late command could rearm a hidden overlay. Each stop removes every WindowManager view and cancels handlers/alarm. No sticky restart or boot receiver exists. Busy launch/permission guards coalesce repeated calls. Revocation watchdog stops an active/hidden service. Window operations fail closed. Expiration is measured monotonically and cannot be extended by a re-show; reboot invalidates prior elapsed timestamps.

## Execution evidence

Final command: `gradlew.bat assembleDebug testDebugUnitTest lintDebug --console=plain`, after all source review corrections.

- **Build PASS:** `BUILD SUCCESSFUL in 30s`; 51 actionable tasks, 27 executed and 24 up-to-date. Compiled with installed stable platform 37.2, AGP 9.4.1, Gradle 9.6.0, JDK 17 and Build Tools 36.0.0.
- **Unit tests PASS:** 7 executed, 0 skipped, 0 failures, 0 errors. XML: `app/build/test-results/testDebugUnitTest/TEST-com.firstrate.hq.BubbleGeometryTest.xml`. HTML: `app/build/reports/tests/testDebugUnitTest/index.html`.
- **Lint PASS:** 0 errors, 23 warnings. Warnings concern optional KTX syntax, pinned dependency/version update suggestions, intentional JavaScript enabling, physical LEFT coordinate gravity, resource qualifier/style and accessibility detector limitations. No lint baseline or global suppression was used. Report: `app/build/reports/lint-results-debug.html`.
- **APK signature PASS:** `apksigner verify --verbose` verified the v2 signature. `aapt dump badging` confirmed `com.firstrate.hq`, label `1st Rate HQ`, minSdk 26, targetSdk 37.
- **APK:** `C:\Users\kenne\HQ-Bubble-Build\app\build\outputs\apk\debug\app-debug.apk`.
- **Manifest review PASS:** permissions, optional camera/autofocus, HCP query, exported launcher, nonexported specialUse service/subtype, singleTask activity, and backup exclusions inspected manually and through the packaged APK metadata.
- **Device acceptance PENDING:** `adb devices` returned an empty device list. No Android runtime/device behavior is claimed as tested.

The initial attempt failed at debug signing with `AccessDeniedException: C:\Users\kenne\.android\debug.keystore.lock`. The build was rerun with approved sandbox escalation and workspace Android build state. The first lint run then found a Windows drive-letter escape in `local.properties`; that was corrected. Final build/test/lint succeeded. Build logs remain in ignored `.tooling/build-first.log`, `.tooling/build-review.log`, `.tooling/build-final.log`.
