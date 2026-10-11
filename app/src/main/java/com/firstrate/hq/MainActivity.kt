package com.firstrate.hq

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.*
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.*

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var bridgeAvailable = false
    private lateinit var bridge: HQJavascriptBridge
    private var busy = false
    private var overlayPending = false
    private var launchAfterOverlay = false
    private var notificationPending = false
    private var cameraRequest: PermissionRequest? = null
    private var explanation: AlertDialog? = null
    private val prefs by lazy { getSharedPreferences("hq", MODE_PRIVATE) }

    private val overlaySettings = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        overlayPending = false
        val launch = launchAfterOverlay
        launchAfterOverlay = false
        if (launch) notificationsThenLaunch() else busy = false
    }
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationPending = false
        launchInstalledHcp()
    }
    private val camera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraRequest?.let { request ->
            if (granted && trusted(request.origin) && trustedDocument(Uri.parse(web.url ?: "")))
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
        }
        cameraRequest = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overlayPending = savedInstanceState?.getBoolean("overlayPending") ?: false
        launchAfterOverlay = savedInstanceState?.getBoolean("launchAfterOverlay") ?: false
        notificationPending = savedInstanceState?.getBoolean("notificationPending") ?: false
        busy = overlayPending || notificationPending
        web = WebView(this)
        setContentView(web)
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.isForMainFrame && !trustedDocument(request.url)) return blockedResponse()
                return null // Preserve HTTPS and the live site's normal service-worker network/cache flow.
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame && trustedDocument(request.url)) return false
                if (request.isForMainFrame && request.url.scheme in setOf("https", "http")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    catch (_: Exception) { message("No browser is available for this link.") }
                }
                return true
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                cameraRequest?.deny(); cameraRequest = null
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!bridgeAvailable) message("Update Android System WebView to enable HQ native integration.")
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) { handler.cancel() }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = null
            })
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean =
                bridge.handlePermissionQuery(view, url, message, defaultValue, result)
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!trusted(request.origin) || !trustedDocument(Uri.parse(web.url ?: "")) ||
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) { request.deny(); return@runOnUiThread }
                    cameraRequest?.deny()
                    cameraRequest = null
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        cameraRequest = request
                        camera.launch(Manifest.permission.CAMERA)
                    }
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (cameraRequest === request) cameraRequest = null
            }
        }
        bridge = HQJavascriptBridge(this)
        bridgeAvailable = bridge.install(web)
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null ||
            !trustedDocument(Uri.parse(web.url ?: ""))) web.loadUrl(START_URL)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
    }

    override fun onStart() {
        super.onStart()
        (application as HqApplication).setHqVisible(true)
        if (!overlayPending && !notificationPending && explanation == null) busy = false
    }
    override fun onStop() {
        (application as HqApplication).setHqVisible(false)
        super.onStop()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        outState.putBoolean("overlayPending", overlayPending)
        outState.putBoolean("launchAfterOverlay", launchAfterOverlay)
        outState.putBoolean("notificationPending", notificationPending)
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        explanation?.setOnDismissListener(null); explanation?.dismiss()
        cameraRequest?.deny(); cameraRequest = null
        web.stopLoading(); web.removeAllViews(); web.destroy()
        super.onDestroy()
    }

    fun overlayAllowed() = Settings.canDrawOverlays(this)
    fun stopBubble() {
        (application as HqApplication).cancelLaunch()
        // stopService does not create an idle service solely to stop it.
        stopService(Intent(this, BubbleService::class.java))
    }
    fun openHcp() {
        if (busy || !(application as HqApplication).hqVisible) return
        busy = true
        if (hcpIntent() == null) { openStore(); busy = false; return }
        if (!overlayAllowed() && !prefs.getBoolean("overlayExplained", false)) requestOverlay(true)
        else notificationsThenLaunch()
    }
    fun requestOverlay(forLaunch: Boolean) {
        if (overlayPending || explanation != null || isFinishing) return
        if (overlayAllowed()) { if (forLaunch) notificationsThenLaunch(); return }
        busy = true
        var selected = false
        explanation = AlertDialog.Builder(this)
            .setTitle("Floating HQ button")
            .setMessage("1st Rate HQ can show a small floating button while you use Housecall Pro. Tapping it returns you directly to HQ. Android requires permission to display this button over other apps.")
            .setPositiveButton("Allow floating HQ button") { _, _ ->
                selected = true
                prefs.edit().putBoolean("overlayExplained", true).apply()
                overlayPending = true; launchAfterOverlay = forLaunch
                try { overlaySettings.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
                catch (_: Exception) {
                    overlayPending = false; launchAfterOverlay = false
                    message("Overlay settings are unavailable. You can still use Housecall Pro.")
                    if (forLaunch) notificationsThenLaunch() else busy = false
                }
            }
            .setNegativeButton("Not now") { _, _ ->
                selected = true
                prefs.edit().putBoolean("overlayExplained", true).apply()
                if (forLaunch) notificationsThenLaunch() else busy = false
            }.create().also { dialog ->
                dialog.setOnDismissListener {
                    explanation = null
                    if (!selected) {
                        prefs.edit().putBoolean("overlayExplained", true).apply()
                        if (forLaunch) notificationsThenLaunch() else busy = false
                    }
                }
                dialog.show()
            }
    }
    private fun notificationsThenLaunch() {
        if (overlayAllowed() && Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !prefs.getBoolean("notificationAsked", false)) {
            prefs.edit().putBoolean("notificationAsked", true).apply()
            notificationPending = true
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else launchInstalledHcp()
    }
    private fun hcpIntent(): Intent? = try { packageManager.getLaunchIntentForPackage(HCP_PACKAGE) } catch (_: Exception) { null }
    private fun launchInstalledHcp() {
        val intent = hcpIntent()
        if (intent == null) { openStore(); busy = false; return }
        if (overlayAllowed()) {
            val token = (application as HqApplication).armLaunch()
            try { ContextCompat.startForegroundService(this, Intent(this, BubbleService::class.java)
                .setAction(BubbleService.ACTION_SHOW).putExtra(BubbleService.EXTRA_LAUNCH_TOKEN, token)) }
            catch (_: Exception) {
                (application as HqApplication).cancelLaunch()
                message("Floating button unavailable; opening Housecall Pro.")
            }
        }
        try { startActivity(intent) }
        catch (_: Exception) { stopBubble(); openStore(); busy = false }
    }
    private fun openStore() {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$HCP_PACKAGE"))); return }
        catch (_: Exception) { }
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$HCP_PACKAGE"))) }
        catch (_: Exception) { message("Housecall Pro is unavailable. Install it from Google Play when a browser or store is available.") }
    }
    private fun message(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
    companion object {
        const val ORIGIN = TrustedWebContent.ORIGIN
        const val START_URL = TrustedWebContent.START_URL
        const val HCP_PACKAGE = "housecall.pros"
        fun trusted(uri: Uri) = TrustedWebContent.originAllowed(uri.toString())
        fun trustedDocument(uri: Uri) = TrustedWebContent.documentAllowed(uri.toString())
        fun returnIntent(context: android.content.Context) = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        private fun blockedResponse() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), "Untrusted navigation blocked".byteInputStream())
    }
}
