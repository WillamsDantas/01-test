package com.auxano.quita;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Alertas de vencimento.
 * A interface (JS) calcula a agenda de avisos e entrega aqui como JSON:
 * [{"when": epochMillis, "title": "...", "text": "..."}]
 * Este receiver guarda a agenda, agenda o próximo alarme e mostra as notificações.
 */
public class AlertReceiver extends BroadcastReceiver {

    static final String ACTION_ALARM = "com.auxano.quita.ALERT";
    static final String PREFS = "quita_alerts";
    static final String CHANNEL = "vencimentos";
    private static final long STALE_MS = 12L * 60 * 60 * 1000; // não mostra aviso com mais de 12h de atraso

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_ALARM.equals(action)) {
            fireDue(ctx);
        }
        scheduleNext(ctx);
    }

    static void saveSchedule(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("schedule", json).apply();
        scheduleNext(ctx);
    }

    private static JSONArray load(Context ctx) {
        try {
            String s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("schedule", "[]");
            return new JSONArray(s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void fireDue(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long last = sp.getLong("lastFired", 0);
        long now = System.currentTimeMillis();
        JSONArray arr = load(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            long when = o.optLong("when", 0);
            if (when > last && when <= now + 60000 && now - when < STALE_MS) {
                notify(ctx, (int) (when / 60000 % 100000), o.optString("title"), o.optString("text"));
            }
        }
        sp.edit().putLong("lastFired", now + 60000).apply();
    }

    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, AlertReceiver.class);
        i.setAction(ACTION_ALARM);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1001, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        long last = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("lastFired", 0);
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        JSONArray arr = load(ctx);
        for (int k = 0; k < arr.length(); k++) {
            JSONObject o = arr.optJSONObject(k);
            if (o == null) continue;
            long when = o.optLong("when", 0);
            if (when > now && when > last && when < next) next = when;
        }
        if (next == Long.MAX_VALUE) return;
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Vencimentos", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Avisos de parcelas e despesas perto do vencimento");
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void notify(Context ctx, int id, String title, String text) {
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, CHANNEL)
                : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_notif)
                .setColor(0xFF0F5C4D)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            nm.notify(id, b.build());
        } catch (SecurityException ignored) { }
    }
}
