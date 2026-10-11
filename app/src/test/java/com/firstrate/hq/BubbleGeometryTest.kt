package com.firstrate.hq

import org.junit.Assert.*
import org.junit.Test

class BubbleGeometryTest {
    private val bounds = SafeBounds(10f, 30f, 410f, 830f)
    @Test fun nearestEdgeUsesBubbleCenter() {
        assertEquals(DockSide.LEFT, bounds.nearestSide(Position(150f, 100f), 56f))
        assertEquals(DockSide.RIGHT, bounds.nearestSide(Position(182f, 100f), 56f))
    }
    @Test fun clampHonorsInsetsAndEntireBubble() {
        assertEquals(Position(10f, 774f), bounds.clamp(Position(-900f, 9000f), 56f))
        assertEquals(Position(354f, 30f), bounds.clamp(Position(999f, -9f), 56f))
    }
    @Test fun normalizedPositionSurvivesDisplayChange() {
        val fraction = bounds.normalizedY(402f, 56f)
        assertEquals(0.5f, fraction, 0.001f)
        assertEquals(Position(544f, 422f), SafeBounds(0f, 50f, 600f, 850f).restore(DockSide.RIGHT, fraction, 56f))
    }
    @Test fun invalidSavedCoordinatesAreClamped() {
        assertEquals(Position(10f, 774f), bounds.restore(DockSide.LEFT, 100f, 56f))
        assertEquals(0.7f, bounds.normalizedY(Float.NaN, 56f), 0f)
        assertTrue(bounds.restore(DockSide.RIGHT, Float.NaN, 56f).y.isFinite())
        assertEquals(Position(0f, 0f), SafeBounds(0f, 0f, 20f, 20f).restore(DockSide.RIGHT, 1f, 56f))
    }
    @Test fun defaultCenterIsThirtyPercentAboveBottom() {
        assertEquals(590f, bounds.defaultPosition(56f).y + 28f, 0.001f)
    }
    @Test fun closeRegionUsesEuclideanDistanceAndInclusiveBoundary() {
        assertTrue(closeHit(Position(36f, 48f), Position(0f, 0f), 60f))
        assertFalse(closeHit(Position(40f, 50f), Position(0f, 0f), 60f))
        assertTrue(closeHit(Position(1f, 1f), Position(1f, 1f), 0f))
    }
    @Test fun timeoutUsesElapsedTimeAndNeverExtendsEightHours() {
        assertEquals(100L, SessionClock.remaining(200, 300, 200))
        assertEquals(0L, SessionClock.remaining(200, 400, 200))
        assertEquals(0L, SessionClock.remaining(200, 100, 200))
        assertEquals(0L, SessionClock.remaining(-1, 100, 200))
        assertEquals(SessionClock.MAX_MS, SessionClock.remaining(100, 100, Long.MAX_VALUE))
    }
}
