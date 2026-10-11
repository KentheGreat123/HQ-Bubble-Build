package com.firstrate.hq

import kotlin.math.hypot

enum class DockSide { LEFT, RIGHT }
data class Position(val x: Float, val y: Float)
data class SafeBounds(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    fun clamp(p: Position, size: Float) = Position(
        p.x.coerceIn(left, maxOf(left, right - size)),
        p.y.coerceIn(top, maxOf(top, bottom - size)))
    fun nearestSide(p: Position, size: Float) =
        if (p.x + size / 2 < (left + right) / 2) DockSide.LEFT else DockSide.RIGHT
    fun normalizedY(y: Float, size: Float): Float {
        val range = bottom - top - size
        return if (range <= 0 || !y.isFinite()) 0.7f else ((y - top) / range).coerceIn(0f, 1f)
    }
    fun restore(side: DockSide, normalized: Float, size: Float): Position {
        val fraction = if (normalized.isFinite()) normalized.coerceIn(0f, 1f) else 0.7f
        return clamp(Position(if (side == DockSide.LEFT) left else right - size,
            top + maxOf(0f, bottom - top - size) * fraction), size)
    }
    fun defaultPosition(size: Float) = clamp(Position(right - size,
        bottom - (bottom - top) * 0.3f - size / 2), size)
}
fun closeHit(bubbleCenter: Position, targetCenter: Position, radius: Float) =
    hypot(bubbleCenter.x - targetCenter.x, bubbleCenter.y - targetCenter.y) <= radius

object SessionClock {
    const val MAX_MS = 8 * 60 * 60 * 1000L
    fun remaining(start: Long, now: Long, timeout: Long): Long =
        if (start < 0 || now < start) 0 else (timeout.coerceIn(1, MAX_MS) - (now - start)).coerceAtLeast(0)
}
