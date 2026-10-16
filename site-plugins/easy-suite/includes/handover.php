<?php
/**
 * Hand-over from the legacy plugins and Code Snippets.
 *
 * Loaded on every request (even while EASY Suite is paused) so the admin
 * always sees what still needs switching off, with a one-click switch.
 */

defined('ABSPATH') || exit;

/**
 * Snippet titles (as saved in Code Snippets) that EASY Suite now carries,
 * mapped to the module that replaces each one.
 */
function easy_suite_legacy_snippet_map() {
    return [
        'EASY: No upcoming sessions fallback (course pages)' => 'course-fallback',
        'EASY: Register page - quiet login link'             => 'um-forms',
        'EASY: Login page - quiet register link'             => 'um-forms',
        'Certificates page login redirect'                   => 'cert-page-redirect',
        'EASY: Branded email wrapper'                        => 'email-wrapper',
        'UM: Allow HTML in checkbox labels'                  => 'um-checkbox-html',
        // Migrated into EASY Core long ago; listed so stragglers are caught.
        'EASY Approvals Bridge'                              => 'approvals',
        'SCF/ACF REST API Integration'                       => 'cert-rest',
    ];
}

/**
 * Active legacy snippets: [id => name]. One query per request, and an
 * empty result when Code Snippets isn't installed.
 */
function easy_suite_active_legacy_snippets() {
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    global $wpdb;
    if (!isset($wpdb)) {
        return $cache;
    }
    $table = $wpdb->prefix . 'snippets';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) !== $table) {
        return $cache;
    }
    $names = array_keys(easy_suite_legacy_snippet_map());
    $placeholders = implode(',', array_fill(0, count($names), '%s'));
    // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name from $wpdb->prefix.
    $rows = $wpdb->get_results($wpdb->prepare("SELECT id, name FROM {$table} WHERE active = 1 AND name IN ($placeholders)", $names));
    foreach ((array) $rows as $r) {
        $cache[(int) $r->id] = (string) $r->name;
    }
    return $cache;
}

/** True when the legacy snippet for $module is still running. */
function easy_suite_snippet_still_active($module) {
    $map = easy_suite_legacy_snippet_map();
    foreach (easy_suite_active_legacy_snippets() as $name) {
        if (isset($map[$name]) && $map[$name] === $module) {
            return true;
        }
    }
    return false;
}

/** Turn off one Code Snippets snippet, preferring the plugin's own API. */
function easy_suite_deactivate_snippet($id) {
    $id = (int) $id;
    if (function_exists('Code_Snippets\\deactivate_snippet')) {
        \Code_Snippets\deactivate_snippet($id);
        return;
    }
    global $wpdb;
    $wpdb->update($wpdb->prefix . 'snippets', ['active' => 0], ['id' => $id], ['%d'], ['%d']);
    if (function_exists('wp_cache_flush_group')) {
        wp_cache_flush_group('code_snippets');
    } else {
        wp_cache_flush();
    }
}

/* --- Admin notice ------------------------------------------------------- */

add_action('admin_notices', function () {
    if (!current_user_can('activate_plugins')) {
        return;
    }
    $legacy_plugins  = easy_suite_legacy_plugins();
    $legacy_snippets = easy_suite_active_legacy_snippets();
    if (!$legacy_plugins && !$legacy_snippets) {
        return;
    }
    $paused = defined('EASY_SUITE_PAUSED') && EASY_SUITE_PAUSED;
    echo '<div class="notice ' . ($paused ? 'notice-warning' : 'notice-info') . '"><p><strong>EASY Suite</strong> ';
    if ($paused) {
        echo 'is installed but <strong>paused</strong>: the plugins it replaces are still active, and running both would clash.';
    } else {
        echo 'is running. These old copies of its features are still switched on and now duplicate it:';
    }
    echo '</p><ul style="list-style:disc;margin-left:20px;">';
    foreach ($legacy_plugins as $basename) {
        echo '<li>Plugin: <code>' . esc_html($basename) . '</code></li>';
    }
    foreach ($legacy_snippets as $name) {
        echo '<li>Code Snippet: ' . esc_html($name) . '</li>';
    }
    echo '</ul><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin:0 0 10px;">';
    echo '<input type="hidden" name="action" value="easy_suite_switch_over">';
    wp_nonce_field('easy_suite_switch_over');
    submit_button('Switch these off and use EASY Suite', 'primary', 'submit', false);
    echo ' <span class="description">Deactivates only the items listed. Settings, sent-email records, and certificate PDFs carry over unchanged.</span>';
    echo '</form></div>';
});

add_action('admin_post_easy_suite_switch_over', function () {
    if (!current_user_can('activate_plugins') || !check_admin_referer('easy_suite_switch_over')) {
        wp_die(esc_html__('Not allowed.', 'easy-suite'), 403);
    }
    $plugins = easy_suite_legacy_plugins();
    if ($plugins) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        // Runs each plugin's deactivation hook (the old notifications plugin
        // clears its cron events; EASY Suite re-schedules them on next load).
        deactivate_plugins($plugins);
    }
    foreach (array_keys(easy_suite_active_legacy_snippets()) as $id) {
        easy_suite_deactivate_snippet($id);
    }
    // Rewrites are re-registered by EASY Suite's version check on the next
    // admin load; clearing the stored version forces that.
    delete_option('easy_suite_version');
    wp_safe_redirect(admin_url('admin.php?page=easy-suite&easy_switched=1'));
    exit;
});
