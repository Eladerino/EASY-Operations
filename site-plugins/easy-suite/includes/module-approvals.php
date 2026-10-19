<?php
/**
 * Module: App bridge — Ultimate Member approvals queue and expiring certificates.
 *
 * Originally EASY Core modules 1 and 8.
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module 1: EASY Approvals Bridge
 * --------------------------------------------------------------------------
 * Migrated from the "EASY Approvals Bridge" Code Snippet (v1.0.0).
 * Exposes Ultimate Member's pending-approval queue to the EASY Operations
 * desktop app. All endpoints require the promote_users capability.
 * ========================================================================== */

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/pending-users', [
        'methods'             => 'GET',
        'callback'            => 'easy_approvals_list_pending',
        'permission_callback' => 'easy_approvals_can_review',
    ]);
    register_rest_route('easy/v1', '/pending-users/(?P<id>\d+)/approve', [
        'methods'             => 'POST',
        'callback'            => 'easy_approvals_approve',
        'permission_callback' => 'easy_approvals_can_review',
        'args'                => [
            'id' => [
                'validate_callback' => function ($param) {
                    return (int) $param > 0;
                },
            ],
        ],
    ]);
    register_rest_route('easy/v1', '/pending-users/(?P<id>\d+)/reject', [
        'methods'             => 'POST',
        'callback'            => 'easy_approvals_reject',
        'permission_callback' => 'easy_approvals_can_review',
        'args'                => [
            'id' => [
                'validate_callback' => function ($param) {
                    return (int) $param > 0;
                },
            ],
        ],
    ]);
    register_rest_route('easy/v1', '/expiring-certs', [
        'methods'             => 'GET',
        'callback'            => 'easy_expiring_certs',
        'permission_callback' => 'easy_cert_rest_can_access',
        'args'                => [
            'days' => [
                'default'           => 90,
                'validate_callback' => function ($param) {
                    $d = (int) $param;
                    return $d >= 1 && $d <= 365;
                },
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);
});

/**
 * Only accounts that can manage users may see or touch the queue.
 * Instructors and other low-privilege accounts are rejected here.
 */
function easy_approvals_can_review() {
    return current_user_can('promote_users');
}


/**
 * Certificates expiring within the next N days (Module 8).
 * Queries expiry_date postmeta directly — no pagination guessing, no
 * dependence on ACF REST field exposure. Returns soonest-first.
 */
function easy_expiring_certs($request) {
    $days = $request->get_param('days');
    $days = $days ? min(max((int) $days, 1), 365) : 90;
    $today_ts = strtotime('today');
    $horizon_ts = strtotime('+' . $days . ' days', $today_ts);

    // Fetch all published certs that have an expiry_date; filter by actual
    // date in PHP so both Ymd and Y-m-d stored formats are handled.
    // Office accounts see every certificate; other cert editors only see
    // certificates they authored (the list carries student emails and
    // employer contacts).
    $query_args = [
        'post_type'      => 'cert',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'fields'         => 'ids',
        'no_found_rows'  => true,
        'meta_query'     => [
            [
                'key'     => 'expiry_date',
                'compare' => 'EXISTS',
            ],
        ],
    ];
    if (!easy_suite_is_office_user()) {
        $query_args['author'] = get_current_user_id();
    }
    $q = new WP_Query($query_args);

    $out = [];
    foreach ($q->posts as $pid) {
        $f = get_fields($pid) ?: [];
        $raw = isset($f['expiry_date']) ? trim((string) $f['expiry_date']) : '';
        if (!$raw) continue;
        // Normalize Ymd or Y-m-d to a timestamp.
        $ts = false;
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $raw, $m)) {
            $ts = strtotime("{$m[1]}-{$m[2]}-{$m[3]}");
        } elseif (preg_match('/^(\d{4})(\d{2})(\d{2})/', $raw, $m)) {
            $ts = strtotime("{$m[1]}-{$m[2]}-{$m[3]}");
        }
        if ($ts === false) continue;
        if ($ts < $today_ts || $ts > $horizon_ts) continue;
        $out[] = [
            'id'                => $pid,
            'title'             => get_the_title($pid),
            'student_name'      => isset($f['student_name']) ? $f['student_name'] : '',
            'student_email'     => isset($f['student_email']) ? $f['student_email'] : '',
            'course_category'   => isset($f['course_category']) ? $f['course_category'] : '',
            'course_title'      => isset($f['course_title']) ? $f['course_title'] : '',
            'completion_date'   => isset($f['completion_date']) ? $f['completion_date'] : '',
            'expiry_date'       => $raw,
            'instructor'        => isset($f['instructor']) ? $f['instructor'] : '',
            'instructor_email'  => isset($f['instructor_email']) ? $f['instructor_email'] : '',
            'company'           => isset($f['company']) ? $f['company'] : '',
            'company_contact'   => isset($f['company_contact']) ? $f['company_contact'] : '',
            'certificate_number'=> isset($f['certificate_number']) ? $f['certificate_number'] : '',
            '_ts'               => $ts,
        ];
    }
    // Soonest-first.
    usort($out, function ($a, $b) { return $a['_ts'] - $b['_ts']; });
    foreach ($out as &$row) { unset($row['_ts']); }
    return array_values($out);
}

function easy_approvals_pending_users() {
    return get_users([
        'meta_key'   => 'account_status',
        'meta_value' => 'awaiting_admin_review',
        'number'     => 100,
        'orderby'    => 'user_registered',
        'order'      => 'ASC',
    ]);
}

/**
 * Minimal fields only: id, display name, email, signup date.
 */
function easy_approvals_list_pending() {
    $out = [];
    foreach (easy_approvals_pending_users() as $u) {
        $out[] = [
            'id'         => $u->ID,
            'name'       => $u->display_name,
            'email'      => $u->user_email,
            'registered' => $u->user_registered,
        ];
    }
    return $out;
}

/**
 * Shared guard for approve/reject: target must exist, must currently be
 * awaiting review, and must not be an administrator.
 */
function easy_approvals_target_or_error($id) {
    $id   = (int) $id;
    $user = get_userdata($id);
    if (!$user) {
        return new WP_Error('easy_no_user', 'User not found.', ['status' => 404]);
    }
    if (get_user_meta($id, 'account_status', true) !== 'awaiting_admin_review') {
        return new WP_Error('easy_bad_status', 'That account is not awaiting review.', ['status' => 409]);
    }
    if (user_can($id, 'manage_options')) {
        return new WP_Error('easy_no_admin', 'Administrator accounts cannot be changed here.', ['status' => 403]);
    }
    return $user;
}

function easy_approvals_clear_um_cache($id) {
    delete_option('um_cache_userdata_' . (int) $id);
}

/**
 * Apply an approve/reject decision and VERIFY it landed. UM's own
 * routine runs first so its emails/hooks fire, but UM can bail
 * internally without reporting failure, so the account_status meta is
 * re-read afterwards; if UM did not change it, write it directly and
 * verify again. Only a verified change counts as success.
 */
function easy_approvals_apply_decision($id, $um_method, $expected_status) {
    if (function_exists('um_fetch_user')) {
        um_fetch_user($id);
        $um_user = UM()->user();
        if (is_object($um_user) && method_exists($um_user, $um_method)) {
            $um_user->{$um_method}();
        }
    }
    if (get_user_meta($id, 'account_status', true) !== $expected_status) {
        update_user_meta($id, 'account_status', $expected_status);
    }
    easy_approvals_clear_um_cache($id);
    if (get_user_meta($id, 'account_status', true) !== $expected_status) {
        return new WP_Error(
            'easy_decision_not_saved',
            'That decision could not be saved. The account is still waiting for review; please try again.',
            ['status' => 500]
        );
    }
    return true;
}

function easy_approvals_approve($request) {
    $user = easy_approvals_target_or_error($request['id']);
    if (is_wp_error($user)) {
        return $user;
    }
    $id = $user->ID;

    $result = easy_approvals_apply_decision($id, 'approve', 'approved');
    if (is_wp_error($result)) {
        return $result;
    }
    return ['ok' => true, 'id' => $id, 'status' => 'approved'];
}

function easy_approvals_reject($request) {
    $user = easy_approvals_target_or_error($request['id']);
    if (is_wp_error($user)) {
        return $user;
    }
    $id = $user->ID;

    $result = easy_approvals_apply_decision($id, 'reject', 'rejected');
    if (is_wp_error($result)) {
        return $result;
    }
    return ['ok' => true, 'id' => $id, 'status' => 'rejected'];
}

