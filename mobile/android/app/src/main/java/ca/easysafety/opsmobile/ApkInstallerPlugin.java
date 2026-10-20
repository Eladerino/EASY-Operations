package ca.easysafety.opsmobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Minimal install hand-off for the self-update flow: takes the path of an
 * APK already downloaded into the app cache and opens the system installer
 * for it via the FileProvider declared in AndroidManifest.xml.
 *
 * Android always shows its own install confirmation; nothing here can (or
 * tries to) install silently. On Android 8+ the user must first allow
 * installs from this app; when that permission is missing this opens the
 * system settings page for it and rejects the call with NEEDS_PERMISSION
 * so the JS side can explain what happened.
 *
 * The path is checked before use: the file must exist and must live
 * inside the app cache directory, which is the only place the updater
 * downloads to. Any failure rejects with a plain message the JS side can
 * show, not a raw Java exception.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        try {
            String path = call.getString("path");
            if (path == null || path.isEmpty()) {
                call.reject("Missing APK path.");
                return;
            }
            File file = new File(path);
            if (!file.exists() || !file.isFile()) {
                call.reject("The downloaded update file was not found. Try the update check again.");
                return;
            }
            String cachePath = getContext().getCacheDir().getCanonicalPath();
            String filePath = file.getCanonicalPath();
            if (!filePath.equals(cachePath) && !filePath.startsWith(cachePath + File.separator)) {
                call.reject("The update file is not in the app cache, so it will not be installed.");
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                call.reject("NEEDS_PERMISSION");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer for the update. Download it from the GitHub release page instead.");
        }
    }
}
