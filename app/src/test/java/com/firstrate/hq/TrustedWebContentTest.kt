package com.firstrate.hq

import org.junit.Assert.*
import org.junit.Test

class TrustedWebContentTest {
    @Test fun allowsHqAndItsQueryNavigation() {
        assertTrue(TrustedWebContent.documentAllowed(TrustedWebContent.START_URL))
        assertTrue(TrustedWebContent.documentAllowed(TrustedWebContent.START_URL + "?screen=8a#home"))
        assertTrue(TrustedWebContent.documentAllowed(TrustedWebContent.ORIGIN + ":443/1st-Rate-Parts-App/index.html"))
    }
    @Test fun rejectsOtherRepositoriesAndPrefixLookalikes() {
        assertFalse(TrustedWebContent.documentAllowed(TrustedWebContent.ORIGIN + "/untrusted/"))
        assertFalse(TrustedWebContent.documentAllowed(TrustedWebContent.ORIGIN + "/1st-Rate-Parts-App-evil/"))
        assertFalse(TrustedWebContent.documentAllowed(TrustedWebContent.ORIGIN + "/"))
    }
    @Test fun rejectsHttpOtherHostsPortsAndUserInfo() {
        for (url in listOf("http://kenthegreat123.github.io/1st-Rate-Parts-App/",
            "https://kenthegreat123.github.io.evil.test/1st-Rate-Parts-App/",
            "https://kenthegreat123.github.io:444/1st-Rate-Parts-App/",
            "https://evil@kenthegreat123.github.io/1st-Rate-Parts-App/",
            "file:///1st-Rate-Parts-App/", "about:blank", "not a URL")) {
            assertFalse(url, TrustedWebContent.documentAllowed(url))
        }
    }
    @Test fun rejectsPlainAndEncodedTraversal() {
        for (path in listOf("../evil/", "%2e%2e/evil/", "part/../../evil/", "%5cevil/"))
            assertFalse(path, TrustedWebContent.documentAllowed(TrustedWebContent.START_URL + path))
    }
}
