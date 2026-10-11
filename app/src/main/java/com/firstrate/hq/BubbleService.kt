package com.firstrate.hq

import android.app.AlarmManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.*
import android.provider.Settings
import android.util.Log

class BubbleService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var controller: BubbleController? = null
    private var requested = false
    private var started = false
    private var stopped = false
    private var sessionStart = 0L
    private val timeout get() = BuildConfig.BUBBLE_TIMEOUT_MS.coerceIn(1, SessionClock.MAX_MS)
    private val alarm by lazy { getSystemService(AlarmManager::class.java) }
    private val expiry = AlarmManager.OnAlarmListener { stopSession() }
    private val watchdog = object : Runnable {
        override fun run() {
            if (stopped) return
            if (remaining() == 0L || !Settings.canDrawOverlays(this@BubbleService)) stopSession()
            else handler.postDelayed(this, minOf(1000L, remaining()))
        }
    }
    override fun onCreate() { super.onCreate(); current = this }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW -> {
                // Discard a queued SHOW if HQ returned or sign-out stopped it before delivery.
                if (!(application as HqApplication).isCurrentLaunch(intent.getLongExtra(EXTRA_LAUNCH_TOKEN, -1))) {
                    if (!started) stopSession()
                    return START_NOT_STICKY
                }
                if (stopped || !Settings.canDrawOverlays(this)) { stopSession(); return START_NOT_STICKY }
                if (!started) {
                    try {
                        val notification = BubbleNotifications.create(this)
                        if (Build.VERSION.SDK_INT >= 34) startForeground(BubbleNotifications.ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                        else startForeground(BubbleNotifications.ID, notification)
                        started = true
                        val prefs = getSharedPreferences("bubbleSession", MODE_PRIVATE)
                        val now = SystemClock.elapsedRealtime()
                        val boot = Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, -1)
                        val saved = prefs.getLong("start", -1)
                        sessionStart = if (boot >= 0 && prefs.getInt("boot", -2) == boot && SessionClock.remaining(saved, now, timeout) > 0) saved else now
                        prefs.edit().putLong("start", sessionStart).putInt("boot", boot).apply()
                        alarm.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, sessionStart + timeout, "HQ expiry", expiry, handler)
                        handler.post(watchdog)
                        controller = BubbleController(this, { returnToHq() }, { stopSession() })
                    } catch (failure: Exception) {
                        Log.w("HQBubble", "Bubble could not start", failure)
                        stopSession(); return START_NOT_STICKY
                    }
                }
                if (remaining() == 0L) stopSession()
                else {
                    requested = true
                    if (!(application as HqApplication).hqVisible) showRequested()
                }
            }
            ACTION_HIDE -> hide()
            ACTION_STOP -> stopSession()
            else -> stopSession()
        }
        return START_NOT_STICKY
    }
    private fun remaining() = SessionClock.remaining(sessionStart, SystemClock.elapsedRealtime(), timeout)
    fun onHqHidden() { if (requested) showRequested() }
    private fun showRequested() {
        if (stopped || remaining() == 0L || !Settings.canDrawOverlays(this)) { stopSession(); return }
        try { controller?.show() }
        catch (failure: Exception) { Log.w("HQBubble", "Overlay unavailable", failure); stopSession() }
    }
    fun hide() {
        requested = false
        controller?.hide()
    }
    private fun returnToHq() {
        if (remaining() == 0L) { stopSession(); return }
        try { startActivity(MainActivity.returnIntent(this)); hide() }
        catch (failure: Exception) { Log.w("HQBubble", "Use notification to return to HQ", failure) }
    }
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (requested && !(application as HqApplication).hqVisible) {
            controller?.hide(); showRequested()
        }
    }
    private fun stopSession() {
        if (stopped) return
        stopped = true; requested = false
        cleanup()
        stopSelf()
    }
    private fun cleanup() {
        handler.removeCallbacksAndMessages(null)
        try { alarm.cancel(expiry) } catch (_: Exception) { }
        try { controller?.hide() } finally {
            controller = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            getSharedPreferences("bubbleSession", MODE_PRIVATE).edit().clear().apply()
        }
    }
    override fun onDestroy() {
        stopped = true
        cleanup()
        if (current === this) current = null
        super.onDestroy()
    }
    companion object {
        const val ACTION_SHOW = "com.firstrate.hq.bubble.SHOW"
        const val ACTION_HIDE = "com.firstrate.hq.bubble.HIDE"
        const val ACTION_STOP = "com.firstrate.hq.bubble.STOP"
        const val EXTRA_LAUNCH_TOKEN = "launchToken"
        var current: BubbleService? = null
            private set
    }
}
