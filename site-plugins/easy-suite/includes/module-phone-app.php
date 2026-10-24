<?php
/**
 * Module: EASY Manager web version.
 *
 * The Publish Suite workflow copies the phone app (mobile/www) into this
 * plugin's app/ folder, where the web server hands it out as plain files.
 * This module only gives it a short address: /easy-app/ redirects there.
 * The app signs in through WordPress's own Authorize Application page and
 * talks to the REST API like the Android app, so nothing else is needed.
 */

defined('ABSPATH') || exit;

/** Full URL of the web version, or '' when this copy of the plugin has none. */
function easy_suite_phone_app_url() {
    if (!file_exists(EASY_SUITE_DIR . 'app/index.html')) {
        return '';
    }
    return plugins_url('app/index.html', EASY_SUITE_FILE);
}

add_action('init', function () {
    $path = (string) wp_parse_url(isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '', PHP_URL_PATH);
    $home = (string) wp_parse_url(home_url('/'), PHP_URL_PATH);
    if (untrailingslashit($path) !== untrailingslashit($home) . '/easy-app') {
        return;
    }
    $url = easy_suite_phone_app_url();
    if ($url === '') {
        return; // Normal 404 until a published zip carries the app.
    }
    nocache_headers();
    wp_safe_redirect($url, 302);
    exit;
});
