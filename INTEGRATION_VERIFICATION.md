# HQ live-site integration — version 0.2.0

Authority: revised developer specification, Section 4a, supplied as `Android HQ Bubble - developer spec (1).md`, together with the user's explicit request for one integrated application. The user subsequently confirmed the earlier APK was installed; a separate bubble application is not wanted. No application was uninstalled or web repository changed.

## Review 1 — product and JavaScript contract

- One application module, one launcher, one APK, package `com.firstrate.hq`; existing bubble, notifications, preferences and service preserved. Version code increased to 2 for an update.
- `MainActivity.START_URL` now loads `https://kenthegreat123.github.io/1st-Rate-Parts-App/` with the existing Kotlin WebView architecture. The former development assets are retained but no longer the startup interface.
- Public `window.HQNative` has exactly `openHcp()`, `stopBubble()`, `isBubbleAllowed()`, `requestBubblePermission()`. Action methods return JavaScript `undefined` (void) and enqueue native operations. `isBubbleAllowed()` returns an actual synchronous boolean from `Settings.canDrawOverlays`, not a Promise, string, or cached approximation.
- Public `HQ.openHcp()` / `HQ.bubble.stop()` / `HQ.bubble.isAllowed()` / `HQ.bubble.requestPermission()` are also installed for the currently deployed site's calls. Existing site-owned HQ objects are preserved.
- Document-start injection precedes website initialization. The public adapter survives the live site's DOM replacement because the window is retained. No page-finished reinjection or return-time reload is used.
- Existing explicit HCP launch controls the overlay. Returning to HQ hides it; opening HCP from HQ again re-shows it. This does not add app surveillance or attempt to detect arbitrary HCP launches from Recents.

## Review 2 — origin, frames and Android platform

- Uses AndroidX origin-restricted WebMessageListener instead of `addJavascriptInterface`. Privileged action messages must come from the main frame, exact HTTPS GitHub Pages host/default port, the HQ repository document path, and the adapter's random token. Other GitHub Pages repositories on the same host are excluded by path validation.
- Document-start adapter checks top-frame identity and HQ path before exposing HQNative/HQ. Third-party frames have no public adapter. A raw transport may be injected by AndroidX into same-origin frames, but native validation rejects their messages. Same-origin script execution has the browser's usual shared trust boundary; do not publish untrusted code in HQ's repository.
- A separate authenticated **read-only** `onJsPrompt` query implements the required synchronous boolean. It validates the caller document URL, current HQ URL and random token. It cannot launch apps, stop service or request permissions; those operations exclusively use the frame-checked message listener. Its prompt is handled natively without showing a dialog. Unexpected tokens/origins receive a cancelled result.
- Top-level navigation stays within `/1st-Rate-Parts-App/`. Other HTTP(S) links open externally; file/content/mixed-content navigation is blocked. Untrusted main-frame requests receive 403, including restored history outside the permitted path. SSL errors are cancelled. No broad host wildcard, arbitrary intent URI launch or blanket WebView permission grant exists.
- Camera grants only VIDEO_CAPTURE following runtime CAMERA permission, for the exact HQ origin with a currently trusted HQ document. Cancelled navigation requests are denied. Notification/overlay/foreground-service behavior is retained, including API 33 notification handling and API 34 specialUse declarations.
- Service and return-task configuration remain intact. The WebView is not reloaded when HCP returns. DOM storage and default WebView cookies/cache persist; Android WebView storage is separate from Chrome/browser storage.
- Live HTTPS/service-worker requests are passed through to the normal WebView network/cache implementation; local asset-loader interception was removed from the startup path. There is no service-worker/cache clearing, forced offline mode or custom offline claim.

## Review 3 — failures and existing live app

- Coalesced repeated HCP/permission requests, no Settings retry loop, denied overlays still open HCP, foreground-start failures isolated, and existing launch-generation protection retained.
- Providers missing either WEB_MESSAGE_LISTENER or DOCUMENT_START_SCRIPT get no native facade, an update hint, and the site's existing browser fallback. There is no insecure legacy fallback.
- URL unit tests include HTTPS/host/port/userinfo, repository prefix confusion, query/hash navigation and encoded traversal. Bridge contract tests exercise the actual injected JS, synchronous permission state changes, void returns, exact method names, adapter preservation, and rejection in foreign frames/origins/paths.
- Native full camera flow, live storage persistence, actual offline recovery and gestures require Android runtime validation. No available browser surface was exposed by the computer-use tool (browser inventory empty; Edge and in-app browser unavailable). Consequently no interactive live-site login or offline success is claimed.

## Live website inspection

Read-only downloads of the live index, service worker and web manifest were inspected. The encoded page template and bundled JS resources were decoded locally for review; no files were sent to or changed in the HQ web repository.

| Area | Evidence inspected | Result / remaining validation |
|---|---|---|
| HCP | Current page's `openHcp()` calls `window.HQ.openHcp` before browser fallback | Compatible with injected HQ adapter; physical native launch pending |
| HQNative detection | Current downloaded index/template contain no HQNative reference | Android supplies both exact HQNative and HQ adapter; handles current and revised web contracts |
| Authentication | PIN selection/keypad flow, local `fr-pins-v1` persistence | Source review only; no assertion of secure server authentication or successful live login |
| Menu sign-out | `menuSignOut` calls `HQ.bubble.stop()` then resets identity | Native stop preserved |
| Alternate sign-out | PIN page `pSignOut` only resets its local step | Current website does not invoke stop on this path; requires a frontend correction if it is used while a bubble session remains active |
| localStorage | PIN/preferences/catalog state writes in deployed source; domStorageEnabled remains true | Logic/source verification; Android persistence acceptance pending |
| Service worker | Relative `sw.js` registration; shell cache; network-first pages, cached fallback, background resource refresh | Registration/cache behavior left intact; **offline support not verified** |
| Reloads | Website may reload on subsequent service-worker controllerchange | Native code never forces a reload on HCP return; a site update can intentionally reload itself |
| Camera | getUserMedia video/environment, BarcodeDetector if available | Native camera flow supported; actual camera/barcode detection depends on device/WebView and remains pending |
| Navigation | URL screen parameter/history navigation; decoded main template has no iframe elements | HQ repository URLs retained; outside links external; runtime navigation pending |

The alternate PIN-page sign-out is a deployed website limitation, not corrected by guessing DOM selectors or rewriting production scripts. The web repository was explicitly outside edit scope. Its production fix is to invoke `window.HQ?.bubble?.stop?.()` before clearing the sign-in step.

## Build, tests and APK

Final execution results and signing/package verification are recorded below after the review build. Device installation has not been tested by the agent; prior installation success was reported by the user.
