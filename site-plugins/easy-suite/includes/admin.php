<?php
/**
 * EASY Suite admin: one menu with the diagnostics overview (health checks,
 * module switches, PDF migration tool) and the settings page.
 *
 * Replaces the "EASY Core" status and settings pages. Option names are the
 * same ones EASY Core used, so saved settings carry over untouched.
 */

defined('ABSPATH') || exit;

add_action('admin_menu', function () {
    add_menu_page('EASY Suite', 'EASY Suite', 'manage_options', 'easy-suite', 'easy_suite_overview_page', 'dashicons-shield-alt', 58);
    add_submenu_page('easy-suite', 'EASY Suite overview', 'Overview', 'manage_options', 'easy-suite', 'easy_suite_overview_page');
    add_submenu_page('easy-suite', 'EASY Suite settings', 'Settings', 'manage_options', 'easy-suite-settings', 'easy_suite_settings_page');
});

/* Old EASY Core bookmarks land on the matching new page. */
add_action('admin_init', function () {
    $page = isset($_GET['page']) ? sanitize_key(wp_unslash($_GET['page'])) : '';
    $map = ['easy-core' => 'easy-suite', 'easy-core-settings' => 'easy-suite-settings'];
    if (isset($map[$page]) && current_user_can('manage_options')) {
        $args = array_map('sanitize_text_field', wp_unslash($_GET));
        $args['page'] = $map[$page];
        wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
        exit;
    }
});

/* --- Diagnostics ---------------------------------------------------------- */

/** Is a rewrite rule registered (saved rules or runtime extra rules)? */
function easy_suite_rewrite_rule_exists($regex) {
    global $wp_rewrite;
    if (!($wp_rewrite instanceof WP_Rewrite)) {
        return false;
    }
    $saved = (array) $wp_rewrite->wp_rewrite_rules();
    return isset($saved[$regex]) || isset($wp_rewrite->extra_rules_top[$regex]);
}

/** Format a cron hook's next run in St. John's time. */
function easy_suite_next_run($hook) {
    $ts = wp_next_scheduled($hook);
    if (!$ts) {
        return null;
    }
    $dt = (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('America/St_Johns'));
    return $dt->format('M j, g:i A') . ' (St. John\'s)';
}

/**
 * Health checks: [label, 'ok'|'warn'|'error'|'off', detail]. Each check
 * only reads; nothing on the overview writes unless a button is pressed.
 */
function easy_suite_health_rows() {
    $rows = [];
    $on = easy_suite_module_states();
    $routes = function_exists('rest_get_server') ? array_keys(rest_get_server()->get_routes()) : [];

    // Dependencies first: most modules are inert without them.
    $deps = [
        'Advanced Custom Fields' => function_exists('get_field'),
        'Custom post type "cert"' => post_type_exists('cert'),
        'Ultimate Member' => defined('UM_VERSION'),
        'WooCommerce' => defined('WC_VERSION'),
        'The Events Calendar' => class_exists('Tribe__Events__Main'),
    ];
    foreach ($deps as $name => $ok) {
        $rows[] = ['Dependency: ' . $name, $ok ? 'ok' : 'error', $ok ? 'Active.' : 'Not active. Features that rely on it will not work.'];
    }

    // Certificate data & privacy.
    $cert_ok = in_array('/wp/v2/cert', $routes, true);
    $missing = [];
    if (function_exists('acf_get_field_groups')) {
        $names = [];
        foreach (acf_get_field_groups(['post_type' => 'cert']) as $g) {
            foreach ((array) acf_get_fields($g) as $f) {
                $names[] = $f['name'];
            }
        }
        $missing = array_diff(easy_suite_cert_acf_allowed_keys(), $names);
    }
    $rows[] = [
        'Certificate data & privacy',
        $cert_ok && !$missing ? 'ok' : 'warn',
        !$cert_ok
            ? 'The /wp/v2/cert endpoint was not found. Check the cert post type has "Show in REST API" on.'
            : ($missing
                ? 'These app fields have no ACF field on certificates, so the app cannot save them: ' . implode(', ', $missing) . '.'
                : 'App fields are allowlisted and validated; certificate titles are hidden from public REST, search, media, feeds and embeds.'),
    ];

    // PDF gatekeeper.
    $upload = wp_upload_dir();
    $dir = trailingslashit($upload['basedir']) . EASY_CERT_PDF_SUBDIR;
    $rule = easy_suite_rewrite_rule_exists('^cert-pdf/([^/]+)/?$');
    $deny = file_exists($dir . '/.htaccess');
    $rows[] = [
        'Certificate PDF gatekeeper',
        $rule && $deny ? 'ok' : 'warn',
        $rule && $deny
            ? '/cert-pdf/<number>/ is registered and uploads/easy-certs/ blocks direct downloads.'
            : 'Not fully armed: download link rule ' . ($rule ? 'OK' : 'missing') . ', folder block ' . ($deny ? 'OK' : 'missing')
                . '. Re-saving Settings → Permalinks restores the rule.',
    ];
    if (function_exists('easy_core_migratable_cert_pdfs')) {
        $left = count(easy_core_migratable_cert_pdfs());
        $rows[] = [
            'Certificate PDFs at public addresses',
            $left ? 'warn' : 'ok',
            $left ? $left . ' certificate PDF(s) are still in public uploads. Use the migration tool below.' : 'All certificate PDFs are in the private folder.',
        ];
    }

    // App bridge.
    if ($on['approvals']) {
        $ok = in_array('/easy/v1/pending-users', $routes, true) && in_array('/easy/v1/expiring-certs', $routes, true);
        $rows[] = ['App bridge', $ok ? 'ok' : 'error', $ok ? 'Approval queue and expiring-certificate routes are serving.' : 'Routes are missing; the app\'s Accounts and expiring lists will fail.'];
    } else {
        $rows[] = ['App bridge', 'off', 'Switched off. The app\'s Accounts approval queue and expiring list will not load.'];
    }

    // Notifications.
    if ($on['notifications'] && class_exists('Easy_Safety_Cert_Notifications', false)) {
        $daily = easy_suite_next_run('easy_safety_daily_expiry_check');
        $digest = easy_suite_next_run('easy_safety_employer_digest');
        $suppressed = Easy_Safety_Cert_Notifications::notifications_suppressed();
        $rows[] = [
            'Certificate emails',
            $suppressed ? 'warn' : ($daily && $digest ? 'ok' : 'warn'),
            ($suppressed ? 'Sending is SUPPRESSED (import mode); no emails go out. ' : '')
                . 'Next expiry check: ' . ($daily ?: 'not scheduled') . '. Next employer digest: ' . ($digest ?: 'not scheduled') . '.'
                . (defined('DISABLE_WP_CRON') && DISABLE_WP_CRON ? ' WordPress cron is driven by the server.' : ''),
        ];
    } else {
        $rows[] = ['Certificate emails', 'off', 'Switched off. Students and employers get no certificate emails.'];
    }

    // Calendar feed.
    if ($on['calendar']) {
        $ok = easy_suite_rewrite_rule_exists('^instructor-calendar/([^/]+)\.ics/?$');
        $rows[] = ['Instructor calendar feed', $ok ? 'ok' : 'warn', $ok ? 'Feeds are served at /instructor-calendar/<name>.ics.' : 'Feed address rule missing. Re-save Settings → Permalinks.'];
    } else {
        $rows[] = ['Instructor calendar feed', 'off', 'Switched off. Instructor calendar subscriptions stop updating.'];
    }

    // Shop.
    if ($on['shop'] && defined('EASY_INSTRUCTOR_CAT_SLUG')) {
        $term = get_term_by('slug', EASY_INSTRUCTOR_CAT_SLUG, 'product_cat');
        $rows[] = [
            'Instructor-only products',
            $term ? 'ok' : 'warn',
            $term ? sprintf('Category "%s" holds %d product(s), visible only to instructors, shop managers and admins.', $term->name, (int) $term->count)
                  : 'Category "instructor-materials" not found. Create it under Products → Categories for the gate to apply.',
        ];
    }

    // SEO.
    if ($on['seo']) {
        $paths = easy_core_get_noindex_paths();
        $found = 0;
        foreach ($paths as $p) {
            $found += get_page_by_path(trim($p, '/')) instanceof WP_Post ? 1 : 0;
        }
        $rows[] = ['SEO noindex', $found === count($paths) ? 'ok' : 'warn', sprintf('%d of %d listed page(s) exist and are kept out of search.', $found, count($paths))];
    }

    // Leftovers that would duplicate EASY Suite.
    $legacy = array_merge(easy_suite_legacy_plugins(), array_values(easy_suite_active_legacy_snippets()));
    $rows[] = [
        'Old copies switched off',
        $legacy ? 'warn' : 'ok',
        $legacy ? 'Still on: ' . implode('; ', $legacy) . '. Use the switch-over button at the top of the page.' : 'No old plugins or snippets duplicate EASY Suite.',
    ];

    return $rows;
}

function easy_suite_overview_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }
    $registry = easy_suite_module_registry();
    $states = easy_suite_module_states();

    echo '<div class="wrap"><h1>EASY Suite <span style="font-weight:normal;color:#646970;">v' . esc_html(EASY_SUITE_VERSION) . '</span></h1>';
    if (!empty($_GET['easy_switched'])) {
        echo '<div class="notice notice-success is-dismissible"><p>The old plugins and snippets are switched off. EASY Suite is now running everything.</p></div>';
    }
    if (!empty($_GET['easy_modules_saved'])) {
        echo '<div class="notice notice-success is-dismissible"><p>Module switches saved.</p></div>';
    }

    // Health.
    echo '<h2>Health</h2><table class="widefat striped" style="max-width:1100px;"><thead><tr><th style="width:26%;">Check</th><th style="width:10%;">Status</th><th>Detail</th></tr></thead><tbody>';
    $badges = ['ok' => ['OK', '#008a20'], 'warn' => ['Attention', '#b65e02'], 'error' => ['Problem', '#d63638'], 'off' => ['Off', '#646970']];
    foreach (easy_suite_health_rows() as [$label, $state, $detail]) {
        [$text, $color] = $badges[$state];
        echo '<tr><td><strong>' . esc_html($label) . '</strong></td><td style="color:' . esc_attr($color) . ';font-weight:600;">'
            . esc_html($text) . '</td><td>' . esc_html($detail) . '</td></tr>';
    }
    echo '</tbody></table>';
    echo '<p><a href="' . esc_url(admin_url('tools.php?page=easy-cert-check')) . '">Certificate expiry check (dry run)</a> &middot; '
        . '<a href="' . esc_url(admin_url('tools.php?page=easy-employer-digest')) . '">Employer digest preview</a> &middot; '
        . '<a href="' . esc_url(admin_url('admin.php?page=easy-suite-settings')) . '">Settings</a></p>';

    // Module switches.
    echo '<h2 style="margin-top:28px;">Modules</h2>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    echo '<input type="hidden" name="action" value="easy_suite_save_modules">';
    wp_nonce_field('easy_suite_save_modules');
    echo '<table class="widefat striped" style="max-width:1100px;"><tbody>';
    foreach ($registry as $key => $m) {
        $locked = !empty($m['locked']);
        $note = '';
        if (easy_suite_snippet_still_active($key)) {
            $note = ' <em>(the old Code Snippet is still on and runs instead until switched off)</em>';
        }
        echo '<tr><td style="width:34px;"><input type="checkbox" id="easy-mod-' . esc_attr($key) . '" name="modules[' . esc_attr($key) . ']" value="1"'
            . checked($states[$key], true, false) . disabled($locked, true, false) . '></td>'
            . '<td><label for="easy-mod-' . esc_attr($key) . '"><strong>' . esc_html($m['label']) . '</strong>'
            . ($locked ? ' <span style="color:#646970;">(always on)</span>' : '') . '</label><br>'
            . '<span class="description">' . esc_html($m['description']) . '</span>' . wp_kses($note, ['em' => []]) . '</td></tr>';
    }
    echo '</tbody></table>';
    submit_button('Save module switches');
    echo '</form>';

    // PDF migration tool (from EASY Core, unchanged behaviour).
    if (function_exists('easy_core_migratable_cert_pdfs')) {
        $mig = count(easy_core_migratable_cert_pdfs());
        $manifest = get_option(EASY_CERT_PDF_MANIFEST, []);
        $manifest_count = is_array($manifest) ? count($manifest) : 0;
        echo '<h2 style="margin-top:28px;">Certificate PDF migration</h2><div style="max-width:900px;">';
        $err = get_option('easy_core_last_migration_error');
        if ($err) {
            echo '<div class="notice notice-error inline"><p><strong>Last migration error:</strong><br><code>' . esc_html($err) . '</code></p></div>';
        }
        $mig_state = isset($_GET['easy_mig']) ? sanitize_key(wp_unslash($_GET['easy_mig'])) : '';
        if ($mig_state === 'done' || $mig_state === 'reversed') {
            echo '<div class="notice ' . ($mig_state === 'done' ? 'notice-success' : 'notice-warning') . ' inline"><p>'
                . ($mig_state === 'done' ? 'Migrated ' : 'Moved back ') . (int) ($_GET['easy_migrated'] ?? 0) . ' PDF(s). '
                . (int) ($_GET['easy_remaining'] ?? 0) . ' remaining.</p></div>';
        }
        echo '<p>Moves certificate PDFs from public uploads into the private <code>easy-certs/</code> folder, served only through '
            . '<code>/cert-pdf/</code>. Old direct links redirect there. Runs 500 at a time; press again until nothing remains.</p>';
        echo '<p><strong>' . (int) $mig . '</strong> PDF(s) still public. <strong>' . (int) $manifest_count . '</strong> moved file(s) on record.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;margin-right:12px;">';
        echo '<input type="hidden" name="action" value="easy_core_migrate_pdfs">';
        wp_nonce_field('easy_core_migrate_pdfs');
        submit_button($mig ? 'Migrate next batch' : 'Nothing to migrate', 'primary', 'submit', false, $mig ? [] : ['disabled' => 'disabled']);
        echo '</form>';
        if ($manifest_count) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;" '
                . 'onsubmit="return confirm(\'Move migrated PDFs back to their original public locations? Only use this to roll back.\');">';
            echo '<input type="hidden" name="action" value="easy_core_reverse_pdfs">';
            wp_nonce_field('easy_core_reverse_pdfs');
            submit_button('Move migrated PDFs back', 'secondary', 'submit', false);
            echo '</form>';
        }
        echo '</div>';
    }
    echo '</div>';
}

add_action('admin_post_easy_suite_save_modules', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('easy_suite_save_modules')) {
        wp_die(esc_html__('Not allowed.', 'easy-suite'), 403);
    }
    $posted = isset($_POST['modules']) && is_array($_POST['modules']) ? $_POST['modules'] : [];
    $before = easy_suite_module_states();
    $save = [];
    foreach (easy_suite_module_registry() as $key => $m) {
        $save[$key] = !empty($m['locked']) || !empty($posted[$key]);
    }
    update_option('easy_suite_modules', $save, true);

    // Switching emails off stops their schedules; switching on re-arms them
    // on the next load. Any change re-registers rewrites (calendar feed).
    if ($before['notifications'] && !$save['notifications']) {
        wp_clear_scheduled_hook('easy_safety_daily_expiry_check');
        wp_clear_scheduled_hook('easy_safety_employer_digest');
    }
    if ($before !== $save) {
        delete_option('easy_suite_version');
    }
    wp_safe_redirect(admin_url('admin.php?page=easy-suite&easy_modules_saved=1'));
    exit;
});

/* --- Settings --------------------------------------------------------------- */

function easy_suite_settings_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }

    if (isset($_POST['easy_suite_settings_nonce'])
        && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['easy_suite_settings_nonce'])), 'easy_suite_save_settings')) {

        $t1 = isset($_POST['easy_notif_t1']) ? max(1, min(365, (int) $_POST['easy_notif_t1'])) : 30;
        $t2 = isset($_POST['easy_notif_t2']) ? max(1, min(365, (int) $_POST['easy_notif_t2'])) : 7;
        update_option('easy_notification_thresholds', max($t1, $t2) . ',' . min($t1, $t2), false);

        $nt = isset($_POST['easy_notif_time']) ? trim(sanitize_text_field(wp_unslash($_POST['easy_notif_time']))) : '';
        if (preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $nt)) {
            update_option('easy_notification_time', $nt, false);
        }

        $clean = [];
        foreach (preg_split('/[\r\n]+/', (string) wp_unslash($_POST['easy_noindex_paths'] ?? '')) as $line) {
            $line = trim(trim($line), '/');
            if ($line !== '' && preg_match('#^[a-z0-9/_-]+$#i', $line)) {
                $clean[] = $line;
            }
        }
        update_option('easy_noindex_paths', implode("\n", $clean), false);

        $users = [];
        foreach (preg_split('/[\s,]+/', (string) wp_unslash($_POST['easy_product_users'] ?? '')) as $u) {
            $u = sanitize_user($u, true);
            if ($u !== '') {
                $users[] = $u;
            }
        }
        update_option('easy_product_form_allowed_users', implode("\n", array_unique($users)), false);

        $proxies = [];
        foreach (preg_split('/[\s,]+/', (string) wp_unslash($_POST['easy_proxy_posters'] ?? '')) as $u) {
            $u = sanitize_user($u, true);
            if ($u !== '') {
                $proxies[] = $u;
            }
        }
        update_option('easy_proxy_posters', implode("\n", array_unique($proxies)), false);

        echo '<div class="notice notice-success is-dismissible"><p><strong>Settings saved.</strong></p></div>';
    }

    $thresholds = easy_core_get_notification_thresholds();
    $t1 = $thresholds[0];
    $t2 = $thresholds[1] ?? 7;
    $product_users = function_exists('easy_suite_product_form_users')
        ? easy_suite_product_form_users()
        : array_filter(preg_split('/[\s,]+/', (string) get_option('easy_product_form_allowed_users', '')));

    echo '<div class="wrap" style="max-width:820px;"><h1>EASY Suite settings</h1>';
    echo '<form method="post" action="">';
    wp_nonce_field('easy_suite_save_settings', 'easy_suite_settings_nonce');

    echo '<h2>Certificate expiry reminders</h2><table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="easy_notif_t1">First reminder (days before expiry)</label></th>'
        . '<td><input type="number" id="easy_notif_t1" name="easy_notif_t1" value="' . esc_attr($t1) . '" min="1" max="365" class="small-text"></td></tr>';
    echo '<tr><th scope="row"><label for="easy_notif_t2">Second reminder (days before expiry)</label></th>'
        . '<td><input type="number" id="easy_notif_t2" name="easy_notif_t2" value="' . esc_attr($t2) . '" min="1" max="365" class="small-text"></td></tr>';
    echo '<tr><th scope="row"><label for="easy_notif_time">Daily send time</label></th>'
        . '<td><input type="time" id="easy_notif_time" name="easy_notif_time" value="' . esc_attr(easy_core_get_notification_time()) . '">'
        . '<p class="description">St. John\'s time. The expiry check runs once a day at this time.</p></td></tr>';
    echo '</tbody></table>';

    echo '<h2>Search engines</h2><table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="easy_noindex_paths">Pages kept out of search</label></th>'
        . '<td><textarea id="easy_noindex_paths" name="easy_noindex_paths" rows="10" class="large-text code">'
        . esc_textarea(implode("\n", easy_core_get_noindex_paths())) . '</textarea>'
        . '<p class="description">One page slug per line. Everything under <code>instructor-portal/</code> is always excluded.</p></td></tr>';
    echo '</tbody></table>';

    echo '<h2>EASY Operations app</h2><table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="easy_proxy_posters">Can post certificates for other instructors</label></th>'
        . '<td><textarea id="easy_proxy_posters" name="easy_proxy_posters" rows="4" class="regular-text code">'
        . esc_textarea(implode("\n", function_exists('easy_suite_proxy_posters') ? easy_suite_proxy_posters() : [])) . '</textarea>'
        . '<p class="description">WordPress usernames, one per line. Everyone else posts under their own name. Admins and anyone who can publish certificates can always post for others.</p></td></tr>';
    echo '</tbody></table>';

    echo '<h2>Shop</h2><table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="easy_product_users">Who can use "List a Product"</label></th>'
        . '<td><textarea id="easy_product_users" name="easy_product_users" rows="4" class="regular-text code">'
        . esc_textarea(implode("\n", $product_users)) . '</textarea>'
        . '<p class="description">WordPress usernames, one per line. Everyone else gets a "not found" page.</p></td></tr>';
    echo '</tbody></table>';

    submit_button('Save settings');
    echo '</form></div>';
}
