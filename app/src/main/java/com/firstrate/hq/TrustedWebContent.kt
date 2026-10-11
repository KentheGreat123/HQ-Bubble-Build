package com.firstrate.hq

import java.net.URI

/** GitHub Pages shares an origin between repositories; documents must also stay in HQ's path. */
object TrustedWebContent {
    const val ORIGIN = "https://kenthegreat123.github.io"
    const val ROOT_PATH = "/1st-Rate-Parts-App/"
    const val START_URL = "$ORIGIN$ROOT_PATH"
    fun originAllowed(url: String): Boolean = try {
        val uri = URI(url)
        uri.scheme == "https" && uri.host == "kenthegreat123.github.io" &&
            uri.rawUserInfo == null && (uri.port == -1 || uri.port == 443)
    } catch (_: Exception) { false }
    fun documentAllowed(url: String): Boolean = try {
        val uri = URI(url)
        originAllowed(url) && uri.path.startsWith(ROOT_PATH) &&
            uri.path.split('/').none { it == "." || it == ".." || it.contains('\\') }
    } catch (_: Exception) { false }
}
