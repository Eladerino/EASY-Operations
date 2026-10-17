<?php
/**
 * wp-admin: EASY Suite → Online courses.
 *
 * Issue keys for phone and invoice sales, look up a key a customer reads
 * out, revoke, restore and resend keys, and see who is enrolled. Office
 * staff (the Course Builder reviewer rule) can use it, so the page is
 * registered with a capability worked out per user; the expiry settings
 * stay on EASY Suite → Settings with the other admin-only options.
 */

defined('ABSPATH') || exit;

add_action('admin_menu', function () {
    // Admins reach it like the rest of EASY Suite. Office staff without
    // manage_options get it too: WordPress then shows the EASY Suite menu
    // to them with this page as its only entry.
    $cap = current_user_can('manage_options') ? 'manage_options' : (easy_licenses_can_manage() ? 'read' : 'do_not_allow');
    add_submenu_page('easy-suite', 'Online courses', 'Online courses', $cap, 'easy-online-courses', 'easy_licenses_admin_page');
}, 20);

function easy_licenses_admin_url(array $args = []) {
    return add_query_arg(array_merge(['page' => 'easy-online-courses'], $args), admin_url('admin.php'));
}

/** One notice for the next page view, per user. */
function easy_licenses_admin_notice($type, $text, array $form = []) {
    set_transient('easy_licenses_notice_' . get_current_user_id(), ['type' => $type, 'text' => $text, 'form' => $form], 5 * MINUTE_IN_SECONDS);
}

function easy_licenses_admin_take_notice() {
    $key = 'easy_licenses_notice_' . get_current_user_id();
    $notice = get_transient($key);
    delete_transient($key);
    return is_array($notice) ? $notice : null;
}

function easy_licenses_admin_guard($nonce_action) {
    if (!easy_licenses_can_manage() || !check_admin_referer($nonce_action)) {
        wp_die(esc_html__('Not allowed.', 'easy-suite'), 403);
    }
}

/** Back to the page the form was on (only ever this admin page). */
function easy_licenses_admin_back(array $override = []) {
    $back = wp_get_referer();
    $args = [];
    if ($back) {
        parse_str((string) wp_parse_url($back, PHP_URL_QUERY), $args);
    }
    $keep = array_intersect_key($args, array_flip(['tab', 's', 'status', 'course', 'batch', 'paged']));
    wp_safe_redirect(easy_licenses_admin_url(array_merge($keep, $override)));
    exit;
}

/* ---------------- actions ---------------- */

add_action('admin_post_easy_licenses_issue', function () {
    easy_licenses_admin_guard('easy_licenses_issue');
    $form = [
        'course'           => sanitize_key(wp_unslash($_POST['course'] ?? '')),
        'quantity'         => (int) ($_POST['quantity'] ?? 1),
        'buyer_name'       => sanitize_text_field(wp_unslash($_POST['buyer_name'] ?? '')),
        'buyer_email'      => sanitize_text_field(wp_unslash($_POST['buyer_email'] ?? '')),
        'company'          => sanitize_text_field(wp_unslash($_POST['company'] ?? '')),
        'supervisor_email' => sanitize_text_field(wp_unslash($_POST['supervisor_email'] ?? '')),
        'note'             => sanitize_textarea_field(wp_unslash($_POST['note'] ?? '')),
        'send_email'       => !empty($_POST['send_email']),
    ];
    $rows = easy_licenses_issue($form + ['source' => 'office']);
    if (is_wp_error($rows)) {
        easy_licenses_admin_notice('error', $rows->get_error_message(), $form);
        easy_licenses_admin_back();
    }
    $count = count($rows);
    $text = sprintf('%d key%s issued for %s.', $count, $count === 1 ? '' : 's', easy_licenses_course_title($rows[0]->course));
    $type = 'success';
    if ($form['send_email']) {
        $sent = easy_licenses_email($rows);
        if (is_wp_error($sent)) {
            $type = 'warning';
            $text .= ' They were not emailed: ' . $sent->get_error_message();
        } else {
            $text .= ' Emailed to ' . $sent . '.';
        }
    }
    easy_licenses_admin_notice($type, $text);
    wp_safe_redirect(easy_licenses_admin_url(['batch' => $rows[0]->batch]));
    exit;
});

add_action('admin_post_easy_licenses_key', function () {
    $id = (int) ($_POST['id'] ?? 0);
    easy_licenses_admin_guard('easy_licenses_key_' . $id);
    $do = sanitize_key(wp_unslash($_POST['do'] ?? ''));
    $row = easy_licenses_get($id);
    $label = $row ? easy_key_format($row->code) : 'The key';
    if ($do === 'revoke') {
        $result = easy_licenses_revoke($id, wp_unslash($_POST['note'] ?? ''));
        if (is_wp_error($result)) {
            easy_licenses_admin_notice('error', $result->get_error_message());
        } else {
            easy_licenses_admin_notice('success', $label . ' is revoked.'
                . ($result['suspended'] ? ' The learner\'s course is suspended until the key is restored.' : '')
                . ($result['kept'] ? ' The learner had already finished the course, so it and their certificate stay available.' : ''));
        }
    } elseif ($do === 'restore') {
        $result = easy_licenses_restore($id);
        easy_licenses_admin_notice(is_wp_error($result) ? 'error' : 'success', is_wp_error($result) ? $result->get_error_message() : $label . ' is restored.');
    } elseif ($do === 'resend' && $row) {
        $sent = easy_licenses_email([$row], sanitize_text_field(wp_unslash($_POST['email'] ?? '')));
        easy_licenses_admin_notice(is_wp_error($sent) ? 'error' : 'success', is_wp_error($sent) ? $sent->get_error_message() : $label . ' was emailed to ' . $sent . '.');
    }
    easy_licenses_admin_back();
});

add_action('admin_post_easy_licenses_batch_email', function () {
    $batch = sanitize_key(wp_unslash($_POST['batch'] ?? ''));
    easy_licenses_admin_guard('easy_licenses_batch_' . $batch);
    $rows = preg_match('/^[a-f0-9]{16}$/', $batch) ? easy_licenses_batch_rows($batch) : [];
    $sent = $rows ? easy_licenses_email($rows, sanitize_text_field(wp_unslash($_POST['email'] ?? ''))) : new WP_Error('none', 'No keys were found for that batch.');
    easy_licenses_admin_notice(is_wp_error($sent) ? 'error' : 'success', is_wp_error($sent) ? $sent->get_error_message() : 'The keys were emailed to ' . $sent . '.');
    easy_licenses_admin_back(['batch' => $batch]);
});

add_action('admin_post_easy_licenses_extend', function () {
    $id = (int) ($_POST['id'] ?? 0);
    easy_licenses_admin_guard('easy_licenses_extend_' . $id);
    $row = easy_enrollment_extend($id, (int) ($_POST['days'] ?? 0));
    easy_licenses_admin_notice(
        is_wp_error($row) ? 'error' : 'success',
        is_wp_error($row) ? $row->get_error_message() : 'Access now runs until ' . easy_licenses_date($row->access_until, true) . '.'
    );
    easy_licenses_admin_back(['tab' => 'learners']);
});

/* ---------------- page ---------------- */

function easy_licenses_admin_key_status($row) {
    $status = easy_licenses_key_status($row);
    switch ($status) {
        case 'issued':
            return ['Unused', '#2271b1'];
        case 'redeemed':
            return ['Used ' . easy_licenses_date($row->redeemed_at), '#008a20'];
        case 'revoked':
            return ['Revoked ' . easy_licenses_date($row->revoked_at), '#d63638'];
        default:
            return ['Expired ' . easy_licenses_date($row->expires_at), '#646970'];
    }
}

function easy_licenses_admin_enrollment_status($row) {
    $status = easy_enrollment_status($row);
    $labels = [
        'active'           => ['In progress', '#2271b1'],
        'theory_complete'  => ['Theory complete', '#2271b1'],
        'practical_booked' => ['Practical booked', '#2271b1'],
        'completed'        => ['Completed ' . easy_licenses_date($row->completed_at), '#008a20'],
        'expired'          => ['Access ended', '#646970'],
        'suspended'        => ['Suspended (key revoked)', '#d63638'],
    ];
    return $labels[$status] ?? [$status, '#646970'];
}

/** Small POST button for a row action. */
function easy_licenses_admin_button($action, $nonce, array $fields, $label, $confirm = '', $class = 'button button-small') {
    $html = '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;margin:0 4px 4px 0;"'
        . ($confirm !== '' ? ' onsubmit="return confirm(' . esc_attr(wp_json_encode($confirm)) . ');"' : '') . '>'
        . '<input type="hidden" name="action" value="' . esc_attr($action) . '">'
        . wp_nonce_field($nonce, '_wpnonce', true, false);
    foreach ($fields as $name => $value) {
        $html .= '<input type="hidden" name="' . esc_attr($name) . '" value="' . esc_attr($value) . '">';
    }
    return $html . '<button type="submit" class="' . esc_attr($class) . '">' . esc_html($label) . '</button></form>';
}

function easy_licenses_admin_person_cell($user_id) {
    $person = easy_licenses_person($user_id);
    if (!$person) {
        return $user_id ? '<em>Deleted account</em>' : '';
    }
    $name = esc_html($person['name']);
    if (current_user_can('edit_user', $person['id'])) {
        $name = '<a href="' . esc_url(get_edit_user_link($person['id'])) . '">' . $name . '</a>';
    }
    return $name . '<br><a href="mailto:' . esc_attr($person['email']) . '">' . esc_html($person['email']) . '</a>';
}

function easy_licenses_admin_pagination($result) {
    if ($result['pages'] < 2) {
        return '';
    }
    $links = paginate_links([
        'base'      => add_query_arg('paged', '%#%'),
        'format'    => '',
        'current'   => $result['page'],
        'total'     => $result['pages'],
        'prev_text' => '‹',
        'next_text' => '›',
    ]);
    return '<div class="tablenav"><div class="tablenav-pages"><span class="displaying-num">' . (int) $result['total'] . ' items</span> ' . $links . '</div></div>';
}

function easy_licenses_admin_page() {
    if (!easy_licenses_can_manage()) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }
    $tab = (isset($_GET['tab']) && $_GET['tab'] === 'learners') ? 'learners' : 'keys';
    $notice = easy_licenses_admin_take_notice();

    echo '<div class="wrap"><h1>Online courses</h1>';
    easy_suite_admin_tabs('easy-online-courses');
    if ($notice) {
        $class = ['success' => 'notice-success', 'warning' => 'notice-warning', 'error' => 'notice-error'][$notice['type']] ?? 'notice-info';
        echo '<div class="notice ' . esc_attr($class) . ' is-dismissible"><p>' . esc_html($notice['text']) . '</p></div>';
    }
    if (!easy_licenses_ready()) {
        $why = get_transient('easy_licenses_db_failed');
        echo '<div class="notice notice-error"><p>The key tables are not set up yet' . ($why ? ': ' . esc_html($why) : '') . '. Reload this page to try again.</p></div></div>';
        return;
    }
    echo '<nav class="nav-tab-wrapper" style="margin-bottom:16px;">'
        . '<a class="nav-tab' . ($tab === 'keys' ? ' nav-tab-active' : '') . '" href="' . esc_url(easy_licenses_admin_url()) . '">Keys</a>'
        . '<a class="nav-tab' . ($tab === 'learners' ? ' nav-tab-active' : '') . '" href="' . esc_url(easy_licenses_admin_url(['tab' => 'learners'])) . '">Learners</a>'
        . '</nav>';

    if ($tab === 'learners') {
        easy_licenses_admin_learners_tab();
    } else {
        easy_licenses_admin_keys_tab($notice['form'] ?? []);
    }
    echo '</div>';
}

function easy_licenses_admin_keys_tab(array $form) {
    $courses = easy_licenses_courses();
    $approved = array_filter($courses, function ($c) { return $c['version'] > 0; });
    $can_email = easy_licenses_redeem_url() !== '';
    $batch = isset($_GET['batch']) ? sanitize_key(wp_unslash($_GET['batch'])) : '';
    $batch = preg_match('/^[a-f0-9]{16}$/', $batch) ? $batch : '';

    // Keys just issued (or a batch picked from the list): ready to read out or paste.
    if ($batch !== '') {
        $rows = easy_licenses_batch_rows($batch);
        if ($rows) {
            $first = $rows[0];
            $course_title = easy_licenses_course_title($first->course);
            // Only keys someone can still use go in the copy box; the rest are counted below it.
            $unused = [];
            $other = ['redeemed' => 0, 'revoked' => 0, 'expired' => 0];
            foreach ($rows as $r) {
                $state = easy_licenses_key_status($r);
                if ($state === 'issued') {
                    $unused[] = $r;
                } elseif (isset($other[$state])) {
                    $other[$state]++;
                }
            }
            $total = count($rows);
            $left_out = [];
            foreach (['redeemed' => 'used', 'revoked' => 'revoked', 'expired' => 'expired'] as $state => $word) {
                if ($other[$state]) {
                    $left_out[] = $other[$state] . ' ' . $word;
                }
            }
            echo '<div class="card" style="max-width:820px;padding:12px 20px 16px;">';
            $heading = count($unused) === $total
                ? ($total === 1 ? 'Key' : $total . ' keys') . ' for ' . $course_title
                : count($unused) . ' unused key' . (count($unused) === 1 ? '' : 's') . ' of ' . $total . ' for ' . $course_title;
            echo '<h2 style="margin-top:6px;">' . esc_html($heading) . '</h2>';
            echo '<p>Issued ' . esc_html(easy_licenses_date($first->issued_at, true)) . ' for ' . esc_html(trim($first->buyer_name . ' <' . $first->buyer_email . '>'))
                . ($first->company !== '' ? ', ' . esc_html($first->company) : '') . '. Unused keys expire ' . esc_html(easy_licenses_date($first->expires_at, true)) . '.</p>';
            if ($unused) {
                $lines = implode("\n", array_map(function ($r) { return easy_key_format($r->code); }, $unused));
                echo '<textarea readonly rows="' . (int) min(10, count($unused)) . '" class="large-text code" style="font-size:15px;letter-spacing:1px;" onclick="this.select();">' . esc_textarea($lines) . '</textarea>';
                echo '<p class="description">Click to select, then copy into an invoice or read out over the phone.'
                    . ($left_out ? ' Not shown above: ' . esc_html(implode(', ', $left_out)) . '.' : '') . '</p>';
            } else {
                echo '<p><strong>None of these keys are still unused</strong>' . ($left_out ? ' (' . esc_html(implode(', ', $left_out)) . ')' : '') . '.</p>';
            }
            if ($can_email && ($unused || $other['redeemed'])) {
                echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin:8px 0;">'
                    . '<input type="hidden" name="action" value="easy_licenses_batch_email"><input type="hidden" name="batch" value="' . esc_attr($batch) . '">'
                    . wp_nonce_field('easy_licenses_batch_' . $batch, '_wpnonce', true, false)
                    . '<label for="easy-batch-email">Email these keys to</label> '
                    . '<input type="email" id="easy-batch-email" name="email" value="' . esc_attr($first->buyer_email) . '" class="regular-text" required> '
                    . '<button type="submit" class="button">Send</button>'
                    . '<p class="description">Used keys are marked as used in the email. Revoked and expired keys are left out.</p></form>';
            }
            echo '<a href="' . esc_url(easy_licenses_admin_url()) . '">Back to all keys</a></div>';
        }
    }

    // Issue form.
    echo '<h2>Issue keys</h2>';
    if (!$courses) {
        echo '<p>No courses are on the site yet. Courses come from the EASY Operations app\'s Course Builder.</p>';
    } elseif (!$approved) {
        echo '<p>No course is approved yet. Keys can only be issued for a course with an approved version in the app\'s Course Builder.</p>';
    }
    if ($approved) {
        $v = function ($key, $default = '') use ($form) { return $form[$key] ?? $default; };
        // A second click while the first is still sending would issue a second batch.
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="max-width:820px;" onsubmit="if(this.dataset.sent&&Date.now()-this.dataset.sent<15000){return false;}this.dataset.sent=Date.now();">';
        echo '<input type="hidden" name="action" value="easy_licenses_issue">';
        wp_nonce_field('easy_licenses_issue');
        echo '<table class="form-table"><tbody>';
        echo '<tr><th scope="row"><label for="easy-key-course">Course</label></th><td><select id="easy-key-course" name="course" required>';
        foreach ($courses as $cid => $c) {
            echo '<option value="' . esc_attr($cid) . '"' . selected($v('course'), $cid, false) . disabled($c['version'] < 1, true, false) . '>'
                . esc_html($c['title'] . ($c['version'] < 1 ? ' (not approved yet)' : ' (version ' . $c['version'] . ')')) . '</option>';
        }
        echo '</select></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-qty">How many</label></th><td><input type="number" id="easy-key-qty" name="quantity" min="1" max="' . (int) EASY_LICENSES_MAX_ISSUE . '" value="' . esc_attr((int) $v('quantity', 1)) . '" class="small-text" required>'
            . '<p class="description">One key per learner.</p></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-name">Buyer name</label></th><td><input type="text" id="easy-key-name" name="buyer_name" value="' . esc_attr($v('buyer_name')) . '" class="regular-text"></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-email">Buyer email</label></th><td><input type="email" id="easy-key-email" name="buyer_email" value="' . esc_attr($v('buyer_email')) . '" class="regular-text" required></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-company">Company</label></th><td><input type="text" id="easy-key-company" name="company" value="' . esc_attr($v('company')) . '" class="regular-text">'
            . '<p class="description">For employer purchases. Goes on the certificates.</p></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-super">Supervisor email</label></th><td><input type="email" id="easy-key-super" name="supervisor_email" value="' . esc_attr($v('supervisor_email')) . '" class="regular-text">'
            . '<p class="description">Gets the certificates through the employer digest.</p></td></tr>';
        echo '<tr><th scope="row"><label for="easy-key-note">Office note</label></th><td><textarea id="easy-key-note" name="note" rows="2" class="large-text">' . esc_textarea($v('note')) . '</textarea>'
            . '<p class="description">Only the office sees this, for example an invoice number.</p></td></tr>';
        echo '<tr><th scope="row">Email</th><td><label><input type="checkbox" name="send_email" value="1"' . checked($can_email && !empty($form['send_email']), true, false) . disabled(!$can_email, true, false) . '> Email the keys to the buyer</label>'
            . ($can_email ? '' : '<p class="description">Available once the My Courses page exists, because the email links to it. Until then, copy the keys from the box that appears after issuing.</p>')
            . '</td></tr>';
        echo '</tbody></table>';
        submit_button('Issue keys');
        echo '</form>';
    }

    // Key list.
    $search = isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '';
    $status = isset($_GET['status']) ? sanitize_key(wp_unslash($_GET['status'])) : '';
    $course = isset($_GET['course']) ? sanitize_key(wp_unslash($_GET['course'])) : '';
    $result = easy_licenses_query([
        'search' => $search,
        'status' => $status,
        'course' => $course,
        'batch'  => $batch,
        'page'   => isset($_GET['paged']) ? (int) $_GET['paged'] : 1,
    ]);

    echo '<h2 style="margin-top:28px;">Keys</h2>';
    echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '" style="margin-bottom:10px;">';
    echo '<input type="hidden" name="page" value="easy-online-courses">';
    echo '<input type="search" name="s" value="' . esc_attr($search) . '" placeholder="Key, email, name, company, invoice or order #" style="width:340px;"> ';
    echo '<select name="status"><option value="">Any status</option>';
    foreach (['issued' => 'Unused', 'redeemed' => 'Used', 'revoked' => 'Revoked', 'expired' => 'Expired'] as $value => $text) {
        echo '<option value="' . esc_attr($value) . '"' . selected($status, $value, false) . '>' . esc_html($text) . '</option>';
    }
    echo '</select> <select name="course"><option value="">Any course</option>';
    foreach ($courses as $cid => $c) {
        echo '<option value="' . esc_attr($cid) . '"' . selected($course, $cid, false) . '>' . esc_html($c['title']) . '</option>';
    }
    echo '</select> <button type="submit" class="button">Search</button>';
    if ($search !== '' || $status !== '' || $course !== '' || $batch !== '') {
        echo ' <a href="' . esc_url(easy_licenses_admin_url()) . '">Clear</a>';
    }
    echo '</form>';

    if (!$result['rows']) {
        echo '<p>' . ($search !== '' || $status !== '' || $course !== '' || $batch !== '' ? 'No keys match.' : 'No keys have been issued yet.') . '</p>';
        return;
    }
    echo '<table class="widefat striped"><thead><tr><th>Key</th><th>Course</th><th>Status</th><th>Buyer</th><th>Used by</th><th>Issued</th><th>Expires</th><th></th></tr></thead><tbody>';
    foreach ($result['rows'] as $row) {
        [$text, $color] = easy_licenses_admin_key_status($row);
        $state = easy_licenses_key_status($row);
        $buyer = esc_html($row->buyer_name !== '' ? $row->buyer_name : $row->buyer_email);
        if ($row->buyer_name !== '') {
            $buyer .= '<br><a href="mailto:' . esc_attr($row->buyer_email) . '">' . esc_html($row->buyer_email) . '</a>';
        }
        if ($row->company !== '') {
            $buyer .= '<br>' . esc_html($row->company);
        }
        if ($row->order_id) {
            $buyer .= '<br>Order #' . (int) $row->order_id;
        }
        if ($batch === '') {
            $buyer .= '<br><a href="' . esc_url(easy_licenses_admin_url(['batch' => $row->batch])) . '">Keys issued with this one</a>';
        }
        $actions = '';
        if ($state === 'issued' || $state === 'redeemed') {
            $confirm = $state === 'redeemed'
                ? 'Revoke this key? The learner who used it loses access to the course until the key is restored. If they already finished it, their course and certificate stay available.'
                : 'Revoke this key? Nobody will be able to use it.';
            $actions .= easy_licenses_admin_button('easy_licenses_key', 'easy_licenses_key_' . $row->id, ['id' => $row->id, 'do' => 'revoke'], 'Revoke', $confirm);
            if (easy_licenses_redeem_url() !== '') {
                $actions .= easy_licenses_admin_button('easy_licenses_key', 'easy_licenses_key_' . $row->id, ['id' => $row->id, 'do' => 'resend'], 'Email again');
            }
        } elseif ($state === 'revoked') {
            $actions .= easy_licenses_admin_button('easy_licenses_key', 'easy_licenses_key_' . $row->id, ['id' => $row->id, 'do' => 'restore'], 'Restore');
        }
        echo '<tr>'
            . '<td><code style="font-size:13px;white-space:nowrap;">' . esc_html(easy_key_format($row->code)) . '</code>'
            . ($row->note ? '<br><span class="description">' . nl2br(esc_html($row->note)) . '</span>' : '') . '</td>'
            . '<td>' . esc_html(easy_licenses_course_title($row->course)) . '</td>'
            . '<td style="color:' . esc_attr($color) . ';font-weight:600;white-space:nowrap;">' . esc_html($text) . '</td>'
            . '<td>' . $buyer . '</td>'
            . '<td>' . easy_licenses_admin_person_cell($row->redeemed_by) . '</td>'
            . '<td style="white-space:nowrap;">' . esc_html(easy_licenses_date($row->issued_at, true)) . '</td>'
            . '<td style="white-space:nowrap;">' . esc_html($state === 'issued' ? easy_licenses_date($row->expires_at, true) : '') . '</td>'
            . '<td>' . $actions . '</td>'
            . '</tr>';
    }
    echo '</tbody></table>';
    echo easy_licenses_admin_pagination($result);
}

function easy_licenses_admin_learners_tab() {
    $courses = easy_licenses_courses();
    $search = isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '';
    $status = isset($_GET['status']) ? sanitize_key(wp_unslash($_GET['status'])) : '';
    $course = isset($_GET['course']) ? sanitize_key(wp_unslash($_GET['course'])) : '';
    $result = easy_enrollments_query([
        'search' => $search,
        'status' => $status,
        'course' => $course,
        'page'   => isset($_GET['paged']) ? (int) $_GET['paged'] : 1,
    ]);

    $days = easy_licenses_access_days();
    echo '<p>' . esc_html($days ? 'Learners have ' . $days . ' days from the day they use a key.' : 'Course access has no time limit after a key is used.')
        . (current_user_can('manage_options') ? ' <a href="' . esc_url(admin_url('admin.php?page=easy-suite-settings#easy-online-courses')) . '">Change this in Settings</a>.' : '') . '</p>';

    echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '" style="margin-bottom:10px;">';
    echo '<input type="hidden" name="page" value="easy-online-courses"><input type="hidden" name="tab" value="learners">';
    echo '<input type="search" name="s" value="' . esc_attr($search) . '" placeholder="Name or email" style="width:260px;"> ';
    echo '<select name="status"><option value="">Any status</option>';
    foreach (['active' => 'In progress', 'completed' => 'Completed', 'expired' => 'Access ended', 'suspended' => 'Suspended'] as $value => $text) {
        echo '<option value="' . esc_attr($value) . '"' . selected($status, $value, false) . '>' . esc_html($text) . '</option>';
    }
    echo '</select> <select name="course"><option value="">Any course</option>';
    foreach ($courses as $cid => $c) {
        echo '<option value="' . esc_attr($cid) . '"' . selected($course, $cid, false) . '>' . esc_html($c['title']) . '</option>';
    }
    echo '</select> <button type="submit" class="button">Search</button></form>';

    if (!$result['rows']) {
        echo '<p>' . ($search !== '' || $status !== '' || $course !== '' ? 'No learners match.' : 'Nobody has used a key yet.') . '</p>';
        return;
    }
    echo '<table class="widefat striped"><thead><tr><th>Learner</th><th>Course</th><th>Status</th><th>Progress</th><th>Started</th><th>Access until</th><th>Key</th><th></th></tr></thead><tbody>';
    foreach ($result['rows'] as $row) {
        [$text, $color] = easy_licenses_admin_enrollment_status($row);
        $state = easy_enrollment_status($row);
        $key = $row->license_id ? easy_licenses_get($row->license_id) : null;
        $actions = '';
        if (($state === 'active' && $row->access_until) || $state === 'expired') {
            $actions = '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="white-space:nowrap;">'
                . '<input type="hidden" name="action" value="easy_licenses_extend"><input type="hidden" name="id" value="' . (int) $row->id . '">'
                . wp_nonce_field('easy_licenses_extend_' . $row->id, '_wpnonce', true, false)
                . '<input type="number" name="days" value="30" min="1" max="365" class="small-text" aria-label="Days"> days '
                . '<button type="submit" class="button button-small">Extend</button></form>';
        }
        echo '<tr>'
            . '<td>' . easy_licenses_admin_person_cell($row->user_id)
            . ($row->cert_name !== '' ? '<br><span class="description">On the certificate: ' . esc_html($row->cert_name) . '</span>' : '') . '</td>'
            . '<td>' . esc_html(easy_licenses_course_title($row->course)) . ' <span class="description">v' . (int) $row->course_version . '</span></td>'
            . '<td style="color:' . esc_attr($color) . ';font-weight:600;">' . esc_html($text) . '</td>'
            . '<td>' . (int) $row->progress . '%</td>'
            . '<td style="white-space:nowrap;">' . esc_html(easy_licenses_date($row->started_at, true)) . '</td>'
            . '<td style="white-space:nowrap;">' . esc_html($row->access_until ? easy_licenses_date($row->access_until, true) : 'No limit') . '</td>'
            . '<td>' . ($key ? '<a href="' . esc_url(easy_licenses_admin_url(['s' => easy_key_format($key->code)])) . '"><code>' . esc_html(easy_key_format($key->code)) . '</code></a>' : '') . '</td>'
            . '<td>' . $actions . '</td>'
            . '</tr>';
    }
    echo '</tbody></table>';
    echo easy_licenses_admin_pagination($result);
}
