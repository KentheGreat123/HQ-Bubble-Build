package com.firstrate.hq

import android.app.Application

class HqApplication : Application() {
    private var generation = 0L
    private var armed = false
    var hqVisible = false
        private set
    fun armLaunch(): Long { armed = true; return ++generation }
    fun cancelLaunch() { armed = false; generation++ }
    fun isCurrentLaunch(token: Long) = armed && token == generation
    fun setHqVisible(visible: Boolean) {
        hqVisible = visible
        if (visible) { cancelLaunch(); BubbleService.current?.hide() }
        else BubbleService.current?.onHqHidden()
    }
}
