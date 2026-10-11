package com.firstrate.hq

import android.app.*
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

object BubbleNotifications {
    const val ID = 101
    private const val CHANNEL = "hq_return_bubble"
    fun create(context: Context): Notification {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "HQ return button", NotificationManager.IMPORTANCE_LOW))
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val back = PendingIntent.getActivity(context, 1, MainActivity.returnIntent(context), flags)
        val stop = PendingIntent.getService(context, 2,
            Intent(context, BubbleService::class.java).setAction(BubbleService.ACTION_STOP), flags)
        return NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("1st Rate HQ")
            .setContentText("1st Rate HQ is running · tap to return").setContentIntent(back)
            .setOngoing(true).setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(R.drawable.ic_notification, "Close bubble", stop).build()
    }
}
