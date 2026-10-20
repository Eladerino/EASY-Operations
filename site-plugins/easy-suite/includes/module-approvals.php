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
    register_rest_route('easy/v1', '/cert-search', [
        'methods'             => 'GET',
        'callback'            => 'easy_cert_search',
        'permission_callback' => 'easy_cert_rest_can_access',
        'args'                => [
            'q' => [
                'required'          => true,
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ],
    ]);
    register_rest_route('easy/v1', '/cert-pdf/(?P<number>[^/]+)', [
        'methods'             => 'GET',
        'callback'            => 'easy_cert_pdf',
        'permission_callback' => 'easy_cert_rest_can_access',
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

/**
 * Certificate search for the EASY Manager phone app (read only).
 * Matches the query two ways and merges the results, newest first:
 *   - WordPress post search over certificate titles, which are shaped
 *     "YYYY-MM-DD - Course - Student Name", so a student name matches.
 *   - A LIKE query over the certificate_number meta, which post
 *     search cannot reach.
 * Scoping mirrors easy_expiring_certs: office accounts search every
 * certificate; other cert editors only search their own, because the
 * rows carry student details. Capped at 25 rows, like a search box
 * should be.
 */
function easy_cert_search($request) {
    $q = trim((string) $request->get_param('q'));
    if (strlen($q) < 2) {
        return new WP_Error(
            'easy_cert_search_short',
            'Type at least 2 characters to search.',
            ['status' => 400]
        );
    }
    $base_args = [
        'post_type'     => 'cert',
        'post_status'   => ['publish', 'draft', 'pending', 'private'],
        'posts_per_page' => 25,
        'fields'        => 'ids',
        'no_found_rows' => true,
        'orderby'       => 'date',
        'order'         => 'DESC',
    ];
    if (!easy_suite_is_office_user()) {
        $base_args['author'] = get_current_user_id();
    }
    $by_text = new WP_Query(array_merge($base_args, ['s' => $q]));
    $by_number = new WP_Query(array_merge($base_args, [
        'meta_query' => [
            [
                'key'     => 'certificate_number',
                'value'   => $q,
                'compare' => 'LIKE',
            ],
        ],
    ]));
    $ids = [];
    foreach (array_merge($by_text->posts, $by_number->posts) as $pid) {
        $pid = (int) $pid;
        if ($pid > 0 && !in_array($pid, $ids, true)) {
            $ids[] = $pid;
        }
    }
    $ids = array_slice($ids, 0, 25);
    $out = [];
    foreach ($ids as $pid) {
        $f = get_fields($pid) ?: [];
        $course = isset($f['course_title']) && $f['course_title'] !== ''
            ? $f['course_title']
            : (isset($f['course_category']) ? $f['course_category'] : '');
        $out[] = [
            'id'                 => $pid,
            'title'              => get_the_title($pid),
            'status'             => get_post_status($pid),
            'student'            => isset($f['student_name']) ? $f['student_name'] : '',
            'course'             => $course,
            'certificate_number' => isset($f['certificate_number']) ? $f['certificate_number'] : '',
            'completion_date'    => isset($f['completion_date']) ? $f['completion_date'] : '',
            'expiry_date'        => isset($f['expiry_date']) ? $f['expiry_date'] : '',
        ];
    }
    return $out;
}

/**
 * Send one certificate's stored PDF to the phone app (read only).
 * The REST counterpart of the /cert-pdf/ gatekeeper in
 * module-cert-pdf.php: same resolver (easy_core_find_cert_by_number),
 * same file chain (easy_core_cert_pdf_path, which never builds a
 * path from request input). Unlike the gatekeeper it does not stream
 * the file out of the REST request; it returns the PDF as base64
 * inside the normal JSON response, so serve-time CORS and error
 * handling apply exactly as they do for every other route. The
 * certificate number is only a lookup key here.
 *
 * Access mirrors the gatekeeper plus the scoping the other cert
 * routes use: office accounts reach every certificate, other cert
 * editors reach certificates they authored, and the certificate's
 * owner reaches their own by student_email match. Anyone else who
 * passed the route permission (cert editors generally) is refused
 * for certificates outside that scope.
 */
function easy_cert_pdf($request) {
    $number = sanitize_text_field(rawurldecode((string) $request['number']));
    if ($number === '') {
        return new WP_Error(
            'easy_cert_not_found',
            'Certificate not found.',
            ['status' => 404]
        );
    }
    $post_id = easy_core_find_cert_by_number($number);
    if (!$post_id) {
        return new WP_Error(
            'easy_cert_not_found',
            'Certificate not found.',
            ['status' => 404]
        );
    }
    $user = wp_get_current_user();
    $is_author = (int) get_post_field('post_author', $post_id) === (int) $user->ID;
    $owner_email = strtolower(trim((string) get_post_meta($post_id, 'student_email', true)));
    $is_owner = $owner_email !== ''
        && $owner_email === strtolower(trim((string) $user->user_email));
    if (!easy_suite_is_office_user($user) && !$is_author && !$is_owner) {
        return new WP_Error(
            'easy_cert_forbidden',
            'You are not authorized to view this certificate.',
            ['status' => 403]
        );
    }
    $path = easy_core_cert_pdf_path($post_id);
    if (!$path) {
        return new WP_Error(
            'easy_cert_no_pdf',
            'No PDF is on file for this certificate yet.',
            ['status' => 404]
        );
    }
    $contents = file_get_contents($path);
    if ($contents === false) {
        return new WP_Error(
            'easy_cert_pdf_unreadable',
            'The PDF for this certificate could not be read.',
            ['status' => 500]
        );
    }
    return rest_ensure_response([
        'number'     => $number,
        'filename'   => $number . '.pdf',
        'pdf_base64' => base64_encode($contents),
    ]);
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

