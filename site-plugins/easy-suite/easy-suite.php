<?php
/**
 * Plugin Name:       EASY Suite
 * Description:       All EASY Safety Training site integrations in one plugin. Replaces EASY Core, EASY Certificate Notifications, EASY Instructor Calendar Feed, and the EASY snippets.
 * Version:           2.2.28
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            Brandon Glynn
 * Author URI:        https://github.com/Eladerino
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 */

defined('ABSPATH') || exit;

define('EASY_SUITE_VERSION', '2.2.28');
define('EASY_SUITE_FILE', __FILE__);
define('EASY_SUITE_DIR', plugin_dir_path(__FILE__));

/* ==========================================================================
 * Legacy hand-over
 * --------------------------------------------------------------------------
 * EASY Suite carries the same functions as the plugins it replaces, so it
 * must never run alongside them. The old plugins sort before "easy-suite"
 * alphabetically and therefore load first; if any of them is active, EASY
 * Suite loads nothing but its hand-over notice (with a one-click switch).
 * ========================================================================== */

/** Legacy plugin files EASY Suite replaces, keyed by plugin basename pattern. */
function easy_suite_legacy_plugins() {
    $out = [];
    if (!function_exists('get_option')) {
        return $out;
    }
    foreach ((array) get_option('active_plugins', []) as $basename) {
        $dir = strtolower(dirname((string) $basename));
        if (strpos($dir, 'easy-core') === 0
            || strpos($dir, 'easy-cert-notifications') === 0
            || $dir === 'easy-instructor-calendar'
            || $dir === 'easy-approvals-bridge') {
            $out[] = $basename;
        }
    }
    return $out;
}

/** True when any replaced plugin's code is already loaded this request. */
function easy_suite_legacy_loaded() {
    return defined('EASY_CORE_VERSION')
        || defined('EASY_ICS_VERSION')
        || class_exists('Easy_Safety_Cert_Notifications', false)
        || function_exists('easy_approvals_can_review');
}

require_once EASY_SUITE_DIR . 'includes/modules.php';
require_once EASY_SUITE_DIR . 'includes/handover.php';

// Decided once, before any module loads: the modules define some of the
// same functions the legacy check looks for.
define('EASY_SUITE_PAUSED', easy_suite_legacy_loaded());

if (EASY_SUITE_PAUSED) {
    // Only the hand-over UI runs until the old plugins are switched off.
    return;
}

require_once EASY_SUITE_DIR . 'includes/helpers.php';
foreach (easy_suite_enabled_modules() as $module) {
    require_once EASY_SUITE_DIR . 'includes/module-' . $module . '.php';
}
require_once EASY_SUITE_DIR . 'includes/admin.php';

/* Activation: rewrite rules for the PDF gatekeeper and the ICS feed, the
 * private PDF folder, and the notification schedules. Every step is
 * idempotent, so re-activating is always safe. */
register_activation_hook(__FILE__, function () {
    if (function_exists('easy_core_cert_pdf_register_rewrite')) {
        easy_core_cert_pdf_register_rewrite();
        easy_core_ensure_cert_pdf_dir();
    }
    if (function_exists('easy_ics_add_rewrite_rule')) {
        easy_ics_add_rewrite_rule();
    }
    if (class_exists('Easy_Safety_Cert_Notifications', false)) {
        Easy_Safety_Cert_Notifications::activate();
    }
    flush_rewrite_rules();
    update_option('easy_suite_version', EASY_SUITE_VERSION);
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('easy_safety_daily_expiry_check');
    wp_clear_scheduled_hook('easy_safety_employer_digest');
    wp_clear_scheduled_hook('easy_licenses_daily');
    flush_rewrite_rules();
});

/* Version change (covers replace-with-upload updates, where the activation
 * hook does not run): re-register rewrites, re-arm the private folder, and
 * repair any half-migrated PDF metadata. */
add_action('admin_init', function () {
    if (get_option('easy_suite_version') === EASY_SUITE_VERSION) {
        return;
    }
    if (function_exists('easy_core_cert_pdf_register_rewrite')) {
        easy_core_cert_pdf_register_rewrite();
        easy_core_ensure_cert_pdf_dir();
        easy_core_repair_stale_pdf_meta();
    }
    if (function_exists('easy_ics_add_rewrite_rule')) {
        easy_ics_add_rewrite_rule();
    }
    flush_rewrite_rules();
    update_option('easy_suite_version', EASY_SUITE_VERSION);
});
