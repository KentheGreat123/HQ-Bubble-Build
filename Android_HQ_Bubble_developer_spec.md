# 1st Rate HQ — Android App + Floating HQ Bubble

## 1. Project Goal

Build a native Android application that hosts the existing 1st Rate HQ web application and provides a floating HQ bubble over Housecall Pro when a technician opens HCP from within HQ.

The floating bubble allows technicians to return directly to HQ without losing their current screen or application state.

## 2. Android Application

- Application name: **1st Rate HQ**
- Package ID: `com.firstrate.hq`
- Minimum Android SDK: 26
- Target: Current supported Android SDK
- Native implementation: Kotlin WebView shell or Capacitor
- Preserve WebView localStorage and session state.
- Support camera permissions for barcode scanning.
- Support notification permissions on Android 13 and newer.

If the production HQ web files are missing, create a development test page. Do not invent or replace the production HQ interface.

## 3. Housecall Pro Integration

Housecall Pro Android package: `housecall.pros`

Expose a JavaScript-to-native bridge:

- `HQ.openHcp()`
- `HQ.bubble.stop()`
- `HQ.bubble.isAllowed()`
- `HQ.bubble.requestPermission()`

When `HQ.openHcp()` is called:

1. Check whether Housecall Pro is installed.
2. If installed, launch the application.
3. If not installed, open its Google Play Store listing.
4. Start the floating HQ bubble when overlay permission is granted.
5. If permission is denied, still open HCP without crashing.

The web version must continue using its existing fallback behavior when `window.HQ` is unavailable.

## 4. Overlay Permission

Request `SYSTEM_ALERT_WINDOW` permission.

Before displaying Android's overlay permission settings, explain why HQ needs this permission.

Use `Settings.canDrawOverlays()` to verify permission.

Do not repeatedly prompt the user after denial during the same launch.

## 5. Floating Bubble Service

Implement a foreground service that manages the bubble through Android `WindowManager`.

Use `TYPE_APPLICATION_OVERLAY`.

Use an appropriate foreground service type and current Android permissions.

Display an ongoing notification:

**1st Rate HQ is running · tap to return**

Include a **Close bubble** notification action.

## 6. Bubble Appearance

- 56dp circular HQ icon
- Light shadow
- 85% opacity when idle
- 100% opacity when touched
- Initially docked to the right edge
- Approximately 30% above the usable screen bottom
- Must respect system navigation and display insets

## 7. Bubble Interactions

**Tap:** Return to the existing HQ screen without reloading the WebView, and hide the bubble.

**Hold and drag:** After approximately 300 milliseconds, allow dragging. The bubble follows the finger and snaps to the nearest left or right screen edge when released.

Save its docked side and vertical position.

**Drag to close:** During dragging, show a 64dp circular close target centered near the bottom, approximately 48dp above the navigation safe area.

When the bubble enters approximately 60dp of the close target, provide a short vibration.

Releasing over the close target must stop the bubble service and remove the notification.

## 8. Visibility and Lifecycle

Hide the bubble automatically whenever HQ returns to the foreground.

Only show it again when the user explicitly opens HCP from HQ.

Stop the bubble when:

- The notification's Close bubble action is selected.
- The bubble is dragged onto the close target.
- `HQ.bubble.stop()` is called, including during sign-out.
- An eight-hour bubble session expires.

Prevent duplicate activities, leaked overlay windows, and unnecessary WebView reloads.

## 9. Security

Only expose privileged JavaScript bridge functions to trusted HQ web content.

Do not allow arbitrary external webpages to access native functionality.

Do not scrape, read, or control the Housecall Pro application's internal UI.

Housecall Pro job and customer data must come through authorized server-side API integrations.

## 10. Acceptance Tests

1. Fresh installation provides an HQ explanation before requesting overlay permission.
2. Opening Housecall Pro from HQ displays the bubble within approximately one second when permissions permit.
3. Tapping the bubble returns to the existing HQ screen without resetting it.
4. Holding and dragging moves the bubble and remembers its position.
5. Dragging onto the close target removes the bubble and notification.
6. Denying overlay permission does not prevent HCP from opening.
7. Missing HCP redirects to its Play Store listing.
8. Returning to HQ hides the bubble.
9. Opening HCP again reactivates the bubble.
10. Notification controls correctly return to HQ or stop the service.
11. Calling `HQ.bubble.stop()` removes all bubble resources.
12. The service stops after eight hours.
13. Repeated calls do not create duplicate overlay windows.
14. Camera and notification permissions are handled safely.

## 11. Required Deliverables

- Complete Android project source
- AndroidManifest.xml
- Kotlin activity and services
- JavaScript/native bridge
- Development test web page when production assets are unavailable
- Gradle build configuration and wrapper
- README with setup instructions
- Acceptance test document
- Unit tests for appropriate bubble calculations
- Debug APK when the Android build environment permits

## 12. Verification

Codex must conduct three independent reviews:

1. **Requirements review:** Verify every specification requirement against actual implementation.
2. **Android compatibility review:** Check Android API permissions, services, activity state, overlays, and WebView security.
3. **Failure-mode review:** Test denied permissions, repeated calls, missing HCP, overlay removal, and lifecycle failures.

Run the build and available tests. Do not claim a successful build unless it actually succeeds.

If the repository is empty, initialize the entire project rather than stopping.

Do not declare completion until implementation, verification, documentation, and all available tests have been addressed.