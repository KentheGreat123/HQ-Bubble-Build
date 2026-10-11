package com.firstrate.hq

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.view.*
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.hypot
import kotlin.math.roundToInt

/** Owns every WindowManager view; all methods run on the main thread. */
class BubbleController(private val context: Context, private val onTap: () -> Unit, private val onClose: () -> Unit) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val prefs = context.getSharedPreferences("bubblePosition", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private val size = dp(56)
    private val targetSize = dp(64)
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var bubble: ImageView? = null
    private var target: TextView? = null
    private var probe: View? = null
    private var bounds = SafeBounds(0f, 0f, size.toFloat(), size.toFloat())
    private var pos = Position(0f, 0f)
    private var targetCenter = Position(0f, 0f)
    private var dragging = false
    private var moved = false
    private var active = false
    private var finger = Position(0f, 0f)
    private var initial = Position(0f, 0f)
    private var down = Position(0f, 0f)
    private var bubbleParams = params(size, size)
    private val hold = Runnable {
        if (!moved && bubble != null) {
            dragging = true
            try { showTarget() } catch (_: Exception) { onClose() }
        }
    }
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).roundToInt()
    private fun params(width: Int, height: Int, untouchable: Boolean = false) = WindowManager.LayoutParams(
        width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            (if (untouchable) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0), PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        if (Build.VERSION.SDK_INT >= 30) { setFitInsetsTypes(0); layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
    }
    private fun prepare(view: View) {
        @Suppress("DEPRECATION")
        view.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }
    private fun circle(color: Int) = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }

    fun show() {
        if (bubble != null) return
        refreshBounds()
        pos = restore()
        bubbleParams = params(size, size).apply { x = pos.x.roundToInt(); y = pos.y.roundToInt() }
        val icon = object : ImageView(context) {
            override fun onTouchEvent(event: MotionEvent) = touch(event)
            override fun performClick(): Boolean {
                super.performClick()
                onTap()
                return true
            }
        }.apply {
            setImageResource(R.drawable.ic_hq)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = circle(Color.WHITE)
            elevation = dp(4).toFloat(); alpha = 0.85f
            contentDescription = "Return to 1st Rate HQ. Hold to move."
            prepare(this)
            isClickable = true
        }
        bubble = icon
        try {
            wm.addView(icon, bubbleParams)
            // Transparent, untouchable full-screen probe supplies actual overlay-window insets on API 26+.
            val safeProbe = View(context).apply { alpha = 0f; prepare(this) }
            probe = safeProbe
            ViewCompat.setOnApplyWindowInsetsListener(safeProbe) { _, insets ->
                updateBounds(safeProbe, insets); insets
            }
            safeProbe.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                ViewCompat.getRootWindowInsets(safeProbe)?.let { updateBounds(safeProbe, it) }
            }
            // Window alpha (not merely View alpha) must be zero so Android 12+ permits
            // touches through this full-screen non-touchable window to Housecall Pro.
            wm.addView(safeProbe, params(-1, -1, true).apply { alpha = 0f })
            ViewCompat.requestApplyInsets(safeProbe)
        } catch (failure: Exception) { hide(); throw failure }
    }
    private fun refreshBounds() {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = wm.currentWindowMetrics
            val i = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val gestures = metrics.windowInsets.getInsets(WindowInsets.Type.mandatorySystemGestures())
            bounds = SafeBounds(maxOf(i.left, gestures.left).toFloat(), i.top.toFloat(),
                (metrics.bounds.width() - maxOf(i.right, gestures.right)).toFloat(),
                (metrics.bounds.height() - maxOf(i.bottom, gestures.bottom)).toFloat())
        } else {
            val p = Point()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getSize(p)
            bounds = SafeBounds(0f, 0f, p.x.toFloat(), p.y.toFloat())
        }
    }
    private fun updateBounds(view: View, insets: WindowInsetsCompat) {
        if (view.width <= 0 || view.height <= 0) return
        val bars = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val gestures = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures())
        val location = IntArray(2); view.getLocationOnScreen(location)
        bounds = SafeBounds((location[0] + maxOf(bars.left, gestures.left)).toFloat(),
            (location[1] + bars.top).toFloat(), (location[0] + view.width - maxOf(bars.right, gestures.right)).toFloat(),
            (location[1] + view.height - maxOf(bars.bottom, gestures.bottom)).toFloat())
        pos = if (dragging) bounds.clamp(pos, size.toFloat()) else restore()
        safelyUpdate()
        if (dragging) { removeTarget(); try { showTarget() } catch (_: Exception) { onClose() } }
    }
    private fun restore(): Position {
        if (!prefs.contains("y")) return bounds.defaultPosition(size.toFloat())
        val side = if (prefs.getString("side", "RIGHT") == "LEFT") DockSide.LEFT else DockSide.RIGHT
        return bounds.restore(side, prefs.getFloat("y", 0.7f), size.toFloat())
    }
    private fun dock() {
        val side = bounds.nearestSide(pos, size.toFloat())
        val y = bounds.normalizedY(pos.y, size.toFloat())
        pos = bounds.restore(side, y, size.toFloat())
        prefs.edit().putString("side", side.name).putFloat("y", y).apply()
        safelyUpdate()
    }
    private fun safelyUpdate() {
        bubble?.let {
            bubbleParams.x = pos.x.roundToInt(); bubbleParams.y = pos.y.roundToInt()
            try { wm.updateViewLayout(it, bubbleParams) } catch (_: Exception) { onClose() }
        }
    }
    private fun touch(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                bubble?.alpha = 1f
                dragging = false; moved = false; active = false
                down = Position(event.rawX, event.rawY); finger = down; initial = pos
                handler.postDelayed(hold, 300)
            }
            MotionEvent.ACTION_MOVE -> {
                finger = Position(event.rawX, event.rawY)
                if (!dragging && hypot(finger.x - down.x, finger.y - down.y) > slop) {
                    moved = true; handler.removeCallbacks(hold)
                }
                if (dragging) {
                    pos = bounds.clamp(Position(initial.x + finger.x - down.x, initial.y + finger.y - down.y), size.toFloat())
                    safelyUpdate()
                    val hit = closeHit(Position(pos.x + size / 2f, pos.y + size / 2f), targetCenter, dp(60).toFloat())
                    if (hit && !active) vibrate()
                    active = hit
                    target?.background = circle(if (hit) Color.rgb(200, 45, 55) else Color.rgb(50, 58, 68))
                    target?.scaleX = if (hit) 1.12f else 1f; target?.scaleY = if (hit) 1.12f else 1f
                }
            }
            MotionEvent.ACTION_UP -> {
                handler.removeCallbacks(hold)
                if (dragging && active) { onClose(); return true }
                if (dragging) dock()
                else if (!moved && event.eventTime - event.downTime < 300) bubble?.performClick()
                finishGesture()
            }
            MotionEvent.ACTION_CANCEL -> {
                handler.removeCallbacks(hold)
                if (dragging) dock()
                finishGesture()
            }
        }
        return true
    }
    private fun finishGesture() { dragging = false; active = false; removeTarget(); bubble?.alpha = 0.85f }
    private fun showTarget() {
        if (target != null) return
        val p = bounds.clamp(Position((bounds.left + bounds.right - targetSize) / 2,
            bounds.bottom - dp(48) - targetSize), targetSize.toFloat())
        targetCenter = Position(p.x + targetSize / 2f, p.y + targetSize / 2f)
        val view = TextView(context).apply {
            text = "×"; textSize = 38f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
            background = circle(Color.rgb(50, 58, 68)); contentDescription = "Close HQ bubble"; prepare(this)
        }
        target = view
        wm.addView(view, params(targetSize, targetSize, true).apply {
            x = p.x.roundToInt(); y = p.y.roundToInt(); alpha = 0.7f
        })
    }
    private fun vibrate() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java).defaultVibrator
                else context.getSystemService(Vibrator::class.java)
            if (vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) { }
    }
    private fun remove(view: View?) {
        if (view == null) return
        try { wm.removeViewImmediate(view) } catch (_: Exception) { /* revoked permission or already detached */ }
    }
    private fun removeTarget() { val old = target; target = null; remove(old) }
    fun hide() {
        handler.removeCallbacksAndMessages(null)
        dragging = false; active = false
        removeTarget()
        val oldBubble = bubble; bubble = null
        val oldProbe = probe; probe = null
        try { remove(oldBubble) } finally { remove(oldProbe) }
    }
}
