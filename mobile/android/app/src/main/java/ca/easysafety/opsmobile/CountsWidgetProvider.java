package ca.easysafety.opsmobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

// Home-screen widget: the waiting counts the app last saw.
//
// Data path: the JS app writes one small JSON snapshot through
// Capacitor Preferences after successful Approvals/Alerts loads.
// @capacitor/preferences on Android stores values as plain strings in
// the SharedPreferences file named by its default group,
// "CapacitorStorage" (see PreferencesConfiguration in the plugin), and
// the app's store layer prefixes its keys with "easy_mgr_", so the
// snapshot lives under the key below. Nothing here talks to the
// network; the widget only ever shows what the app last loaded, with
// an "As of" time so a stale count never pretends to be live.
public class CountsWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String COUNTS_KEY = "easy_mgr_widget_counts";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, buildViews(context));
        }
    }

    private RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_counts);

        int certs = -1;
        int classes = -1;
        int accounts = -1;
        int queue = -1;
        int expiring = -1;
        String atIso = null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            String raw = prefs.getString(COUNTS_KEY, null);
            if (raw != null) {
                JSONObject json = new JSONObject(raw);
                certs = json.optInt("certDrafts", -1);
                classes = json.optInt("classDrafts", -1);
                accounts = json.optInt("accountSignups", -1);
                queue = json.optInt("queueOpen", -1);
                expiring = json.optInt("expiring30", -1);
                atIso = json.optString("at", null);
            }
        } catch (Exception ignored) {
            // A missing or unreadable snapshot falls through to the
            // "open the app" text below.
        }

        if (atIso == null) {
            views.setTextViewText(R.id.widget_counts, "Open EASY Manager to load the latest counts.");
            views.setTextViewText(R.id.widget_asof, "");
        } else {
            StringBuilder sb = new StringBuilder();
            appendCount(sb, "Certificate drafts", certs);
            appendCount(sb, "Class drafts", classes);
            appendCount(sb, "Account signups", accounts);
            appendCount(sb, "Queue questions", queue);
            appendCount(sb, "Expiring in 30 days", expiring);
            views.setTextViewText(R.id.widget_counts, sb.toString());
            String when = formatAsOf(atIso);
            views.setTextViewText(R.id.widget_asof, when == null ? "" : "As of " + when);
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        return views;
    }

    private void appendCount(StringBuilder sb, String label, int value) {
        if (value < 0) {
            return;
        }
        if (sb.length() > 0) {
            sb.append("\n");
        }
        sb.append(label).append(": ").append(value);
    }

    // The app stores an ISO 8601 UTC stamp (Date.toISOString()).
    private String formatAsOf(String iso) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date when = in.parse(iso);
            if (when == null) {
                return null;
            }
            return new SimpleDateFormat("h:mm a", Locale.getDefault()).format(when);
        } catch (Exception e) {
            return null;
        }
    }
}
