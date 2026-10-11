package com.firstrate.hq

import android.webkit.WebView
import android.webkit.JsPromptResult
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.UUID

/** Public HQNative facade; transport checks origin, main frame, repository path and token. */
class HQJavascriptBridge(private val activity: MainActivity) {
    private val token = UUID.randomUUID().toString()
    private var installed = false
    fun install(view: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false
        WebViewCompat.addWebMessageListener(view, TRANSPORT, setOf(TrustedWebContent.ORIGIN)) {
                _, message, origin, mainFrame, _ ->
            if (!mainFrame || !TrustedWebContent.originAllowed(origin.toString()) ||
                !TrustedWebContent.documentAllowed(view.url ?: "")) return@addWebMessageListener
            try {
                val input = JSONObject(message.data ?: "")
                if (input.optString("token") != token) return@addWebMessageListener
                when (input.getString("method")) {
                    "openHcp" -> activity.openHcp()
                    "stopBubble" -> activity.stopBubble()
                    "requestBubblePermission" -> activity.requestOverlay(false)
                }
            } catch (_: Exception) { /* malformed input cannot invoke native operations */ }
        }
        val script = activity.assets.open("native/hq-native.js").bufferedReader().use { it.readText() }
            .replace("__HQ_TOKEN__", token)
        WebViewCompat.addDocumentStartJavaScript(view, script, setOf(TrustedWebContent.ORIGIN))
        installed = true
        return true
    }

    /** Read-only authenticated synchronous query. No privileged action uses this dialog channel. */
    fun handlePermissionQuery(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
        if (message != PERMISSION_QUERY) return false
        if (installed && defaultValue == token && TrustedWebContent.documentAllowed(url) &&
            TrustedWebContent.documentAllowed(view.url ?: "")) result.confirm(activity.overlayAllowed().toString())
        else result.cancel()
        return true
    }

    companion object {
        const val TRANSPORT = "__HqNativeTransport"
        const val PERMISSION_QUERY = "hq-native:overlay-permission"
    }
}
