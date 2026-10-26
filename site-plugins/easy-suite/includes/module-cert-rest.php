<?php
/**
 * Module: Certificate data & privacy.
 *
 * Originally EASY Core modules 2, 2b and 11, plus EASY Suite additions
 * (field allowlist, search/media/feed/oEmbed gates, replaced-PDF cleanup).
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module 2: ACF REST API Integration (cert endpoint)
 * --------------------------------------------------------------------------
 * Migrated from the "SCF/ACF REST API Integration" Code Snippet.
 * Exposes ACF fields on the `cert` REST endpoint. The EASY Operations
 * desktop app creates cert posts via POST /wp-json/wp/v2/cert with
 * acf[field_name] parameters; without this, WordPress ignores them and
 * certs are saved with empty fields.
 *
 * SECURITY (v1.4.1): the `cert` post type is public with show_in_rest, so
 * /wp-json/wp/v2/cert was anonymously readable — including student PII in
 * the ACF fields above. Every certificate page on the site is login-gated,
 * so anonymous REST access was never intended. See "Module 2b" below.
 * ========================================================================== */

/*
 * EASY Suite: writes go through an allowlist. The app already limits what it
 * sends, but that check lives in the client; the server now enforces the same
 * field list and validates the values, so a modified client can't write
 * arbitrary meta or plant markup in a course value.
 */
function easy_suite_cert_acf_allowed_keys() {
    return [
        'student_name', 'student_email', 'student_phone',
        'course_category', 'course_title', 'completion_date', 'expiry_date',
        'instructor', 'instructor_email', 'company', 'company_contact',
        'certificate_number', 'wpnl', 'certificate',
    ];
}

/**
 * Valid choices for a cert select field, merged across every field with that
 * name (course_title is seven fields, one per category). Empty array when ACF
 * or the field group isn't available — callers then skip choice validation.
 */
function easy_suite_cert_field_choices($name) {
    static $cache = [];
    if (isset($cache[$name])) {
        return $cache[$name];
    }
    $choices = [];
    if (function_exists('acf_get_field_groups') && function_exists('acf_get_fields')) {
        foreach (acf_get_field_groups(['post_type' => 'cert']) as $group) {
            foreach ((array) acf_get_fields($group) as $field) {
                if (($field['name'] ?? '') === $name && !empty($field['choices']) && is_array($field['choices'])) {
                    $choices += $field['choices'];
                }
            }
        }
    }
    return $cache[$name] = $choices;
}

/** Validate and normalize one incoming value; WP_Error when it's unacceptable. */
function easy_suite_cert_acf_clean_value($key, $value) {
    if (is_array($value) || is_object($value)) {
        return new WP_Error('easy_cert_bad_value', sprintf('Field %s must be a single value.', $key), ['status' => 400]);
    }
    $value = trim((string) $value);
    if ($value === '') {
        return '';
    }
    switch ($key) {
        case 'student_email':
        case 'instructor_email':
        case 'company_contact':
            $email = sanitize_email($value);
            if (!is_email($email)) {
                return new WP_Error('easy_cert_bad_email', sprintf('Field %s is not a valid email address.', $key), ['status' => 400]);
            }
            return $email;
        case 'course_category':
        case 'course_title':
            $choices = easy_suite_cert_field_choices($key);
            if ($choices && !array_key_exists($value, $choices)) {
                return new WP_Error('easy_cert_bad_choice', sprintf('"%s" is not a known %s.', $value, str_replace('_', ' ', $key)), ['status' => 400]);
            }
            return sanitize_text_field($value);
        case 'certificate':
            $att_id = absint($value);
            if (!$att_id || get_post_type($att_id) !== 'attachment' || get_post_mime_type($att_id) !== 'application/pdf') {
                return new WP_Error('easy_cert_bad_pdf', 'The certificate must be an uploaded PDF.', ['status' => 400]);
            }
            return $att_id;
        default:
            return sanitize_text_field($value);
    }
}

add_action('rest_api_init', function () {
    register_rest_field('cert', 'acf', [
        'get_callback' => function ($post) {
            return get_fields($post['id']);
        },
        'update_callback' => function ($value, $post) {
            if (!is_array($value)) {
                return false;
            }
            $allowed = easy_suite_cert_acf_allowed_keys();
            $clean = [];
            // Validate everything first so a bad value writes nothing.
            foreach ($value as $field_name => $field_value) {
                if (!in_array($field_name, $allowed, true)) {
                    continue; // Unknown keys are dropped, as the app does.
                }
                $v = easy_suite_cert_acf_clean_value($field_name, $field_value);
                if (is_wp_error($v)) {
                    return $v;
                }
                $clean[$field_name] = $v;
            }
            foreach ($clean as $field_name => $field_value) {
                update_field($field_name, $field_value, $post->ID);
            }
            return true;
        },
        'schema' => null,
    ]);
}, 20); // After ACF's own REST registration, so this definition wins.

/* ==========================================================================
 * Module 2b: Cert REST endpoint requires authentication AND cert privileges
 * --------------------------------------------------------------------------
 * v1.4.1: anonymous requests to /wp-json/wp/v2/cert* were rejected with 401
 * (the post type is public with show_in_rest, so the feed — including
 * student PII in ACF fields — was anonymously readable).
 * v1.4.2: authenticated users WITHOUT certificate privileges (e.g. students)
 * could still enumerate every record via the API. Now only users who can
 * edit cert posts (instructors, office staff, admins — the accounts the
 * EASY Operations desktop app authenticates with) may use the endpoint;
 * everyone else gets 403. The student-facing certificate pages use PHP
 * templates, not REST, so nothing student-facing breaks.
 * ========================================================================== */

add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    $route = $request->get_route();
    if (strpos($route, '/wp/v2/cert') !== 0) {
        return $result;
    }
    // CORS preflight (OPTIONS) requests never carry credentials, and their
    // responses contain only CORS headers, no data. Let them through so
    // browser based clients (the EASY Manager app WebView) can complete the
    // preflight; the checks below still guard every real request method.
    if ($request->get_method() === 'OPTIONS') {
        return $result;
    }
    if (!is_user_logged_in()) {
        return new WP_Error(
            'easy_cert_rest_forbidden',
            'Authentication is required to access certificate records.',
            ['status' => 401]
        );
    }
    $pto = get_post_type_object('cert');
    $cap = ($pto && !empty($pto->cap->edit_posts)) ? $pto->cap->edit_posts : 'edit_posts';
    if (!current_user_can($cap)) {
        return new WP_Error(
            'easy_cert_rest_forbidden',
            'You do not have permission to access certificate records.',
            ['status' => 403]
        );
    }
    return $result;
}, 10, 3);

/* ==========================================================================
 * Module 2c: Core user directory requires a signed-in account
 * --------------------------------------------------------------------------
 * /wp/v2/users (the list) and /wp/v2/users/<id> hand any anonymous visitor
 * the site's accounts: names and login slugs for the staff accounts. Nothing
 * public reads them: front-end pages render server-side, Ultimate Member
 * runs on its own routes, and the desktop app and EASY Manager only ever
 * call /wp/v2/users/me with the signed-in user's own credentials. Anonymous
 * requests therefore get 401. Any signed-in account keeps access, and
 * /users/me is never matched here (the route check below only matches the
 * list route and numeric single-user routes), so app sign-in checks and
 * student accounts are unaffected.
 * ========================================================================== */

add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    $route = $request->get_route();
    $is_user_directory = ($route === '/wp/v2/users')
        || preg_match('#^/wp/v2/users/\d+$#', $route);
    if (!$is_user_directory) {
        return $result;
    }
    // CORS preflight (OPTIONS) requests never carry credentials, and their
    // responses contain only CORS headers, no data. Let them through so
    // browser based clients (the EASY Manager app WebView) can complete the
    // preflight; the check below still guards every real request method.
    if ($request->get_method() === 'OPTIONS') {
        return $result;
    }
    if (!is_user_logged_in()) {
        return new WP_Error(
            'easy_user_directory_forbidden',
            'Authentication is required to access user records.',
            ['status' => 401]
        );
    }
    return $result;
}, 10, 3);

/* ==========================================================================
 * Module 11: Server-side instructor identity enforcement
 * --------------------------------------------------------------------------
 * The EASY Operations desktop app stamps the signed-in instructor's identity
 * onto every certificate it posts — but that stamping happens client-side. A
 * modified client could attribute a certificate to a different instructor.
 * This module enforces the same rule on the server: after a cert post is
 * created or updated over REST, accounts WITHOUT cert publish rights get
 * their instructor/instructor_email ACF fields overwritten with their own
 * WordPress profile data. Accounts that can publish certs (office, admins —
 * the proxy posters) may attribute certificates to any instructor, which is
 * how posting on behalf of others keeps working. wp-admin is untouched: this
 * only fires for REST requests.
 * ========================================================================== */

function easy_core_enforce_cert_identity($post, $request, $creating) {
    if (!($post instanceof WP_Post) || $post->post_type !== 'cert') {
        return;
    }
    $pto = get_post_type_object('cert');
    $publish_cap = ($pto && !empty($pto->cap->publish_posts)) ? $pto->cap->publish_posts : 'publish_posts';
    if (current_user_can($publish_cap) || easy_suite_is_proxy_poster()) {
        return; // Office/admins and listed proxy posters may post for any instructor.
    }
    $user = wp_get_current_user();
    if (!$user || !$user->ID) {
        return;
    }
    if (function_exists('update_field')) {
        update_field('instructor', $user->display_name, $post->ID);
        update_field('instructor_email', $user->user_email, $post->ID);
    } else {
        update_post_meta($post->ID, 'instructor', $user->display_name);
        update_post_meta($post->ID, 'instructor_email', $user->user_email);
    }
}
add_action('rest_after_insert_cert', 'easy_core_enforce_cert_identity', 10, 3);

/* ==========================================================================
 * EASY Suite: close the remaining logged-out paths to certificate titles
 * --------------------------------------------------------------------------
 * Cert titles read "date - course - student name". The REST gate above only
 * covers /wp/v2/cert, but the post type is public (students need their
 * single pages, staff use the /cert/ archive), so titles also surfaced via
 * the REST search endpoint, the media library endpoint (cert PDFs are
 * attachments of public posts), the cert RSS feed, oEmbed, attachment pages,
 * and front-end search. Each path below is closed for anyone who can't edit
 * certificates; staff keep full access.
 * ========================================================================== */

/** Is this attachment a certificate PDF in the private folder? */
function easy_suite_is_cert_pdf($att_id) {
    $att_id = (int) $att_id;
    if (!$att_id || get_post_type($att_id) !== 'attachment') {
        return false;
    }
    $file = (string) get_post_meta($att_id, '_wp_attached_file', true);
    return strpos($file, EASY_CERT_PDF_SUBDIR . '/') === 0;
}

/* REST search (/wp/v2/search): drop certs from the searchable post types. */
add_filter('rest_post_search_query', function ($query_args) {
    if (easy_cert_rest_can_access()) {
        return $query_args;
    }
    $types = (array) ($query_args['post_type'] ?? []);
    $types = array_values(array_diff($types, ['cert']));
    $query_args['post_type'] = $types ? $types : ['__easy_none__'];
    return $query_args;
});

/* REST media list (/wp/v2/media): hide files stored in easy-certs/. */
add_filter('rest_attachment_query', function ($args) {
    if (easy_cert_rest_can_access()) {
        return $args;
    }
    $meta_query = isset($args['meta_query']) && is_array($args['meta_query']) ? $args['meta_query'] : [];
    $meta_query[] = [
        'key'     => '_wp_attached_file',
        'value'   => EASY_CERT_PDF_SUBDIR . '/',
        'compare' => 'NOT LIKE',
    ];
    $args['meta_query'] = $meta_query;
    return $args;
});

/* REST single media item (/wp/v2/media/<id>): 404 for cert PDFs. */
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    if (!preg_match('#^/wp/v2/media/(\d+)#', $request->get_route(), $m)) {
        return $result;
    }
    if (easy_suite_is_cert_pdf((int) $m[1]) && !easy_cert_rest_can_access()) {
        return new WP_Error('rest_post_invalid_id', 'Invalid post ID.', ['status' => 404]);
    }
    return $result;
}, 10, 3);

/* Front end: cert feed, embeds and cert-PDF attachment pages 404 for non-staff. */
add_action('template_redirect', function () {
    if (easy_cert_rest_can_access()) {
        return;
    }
    $blocked = (is_feed() && is_post_type_archive('cert'))
        || (is_embed() && is_singular('cert'))
        || (is_attachment() && easy_suite_is_cert_pdf(get_queried_object_id()));
    if (!$blocked) {
        return;
    }
    global $wp_query;
    $wp_query->set_404();
    status_header(404);
    nocache_headers();
    include get_query_template('404');
    exit;
}, 1);

/* oEmbed discovery for a cert URL returns nothing for non-staff. */
add_filter('oembed_request_post_id', function ($post_id) {
    if ($post_id && get_post_type($post_id) === 'cert' && !easy_cert_rest_can_access()) {
        return 0;
    }
    return $post_id;
});

/* Front-end search: certs never appear for non-staff (CPT UI's "exclude from
 * search" covers this too; this keeps it true if that setting is reset). */
add_action('pre_get_posts', function ($q) {
    if (is_admin() || !$q->is_main_query() || !$q->is_search() || easy_cert_rest_can_access()) {
        return;
    }
    $types = $q->get('post_type');
    if (empty($types) || $types === 'any') {
        $types = get_post_types(['exclude_from_search' => false]);
    }
    $q->set('post_type', array_values(array_diff((array) $types, ['cert'])));
});

/* Core sitemaps (Yoast normally replaces them): never list certs. */
add_filter('wp_sitemaps_post_types', function ($types) {
    unset($types['cert']);
    return $types;
});

/* ==========================================================================
 * EASY Suite: certificate PDF cleanup that works for instructors
 * --------------------------------------------------------------------------
 * The app deletes a PDF when a post fails after upload, or when a draft is
 * re-saved with a new PDF. Instructors have no delete_posts capability, so
 * those deletes were silently refused and the PDFs piled up. Two fixes:
 *
 * 1. Instructors may delete their OWN certificate PDFs that no certificate
 *    points to (exactly the orphan case), and nothing else.
 * 2. When a cert's `certificate` field changes, the server deletes the PDF it
 *    replaced, provided no other certificate still uses it.
 * ========================================================================== */

/** Does any cert (other than $exclude_post) point at this attachment? */
function easy_suite_cert_pdf_in_use($att_id, $exclude_post = 0) {
    global $wpdb;
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery
    $ids = $wpdb->get_col($wpdb->prepare(
        "SELECT pm.post_id FROM {$wpdb->postmeta} pm
         JOIN {$wpdb->posts} p ON p.ID = pm.post_id AND p.post_type = 'cert'
         WHERE pm.meta_key = 'certificate' AND pm.meta_value = %s",
        (string) (int) $att_id
    ));
    $ids = array_map('intval', (array) $ids);
    return (bool) array_diff($ids, [(int) $exclude_post]);
}

add_filter('map_meta_cap', function ($caps, $cap, $user_id, $args) {
    if ($cap !== 'delete_post' || empty($args[0])) {
        return $caps;
    }
    $att_id = (int) $args[0];
    if (!easy_suite_is_cert_pdf($att_id)) {
        return $caps;
    }
    $att = get_post($att_id);
    if ($att && (int) $att->post_author === (int) $user_id && !easy_suite_cert_pdf_in_use($att_id)) {
        return ['upload_files'];
    }
    return $caps;
}, 10, 4);

/* Remember the old value just before a cert's `certificate` meta changes... */
add_filter('update_post_metadata', function ($check, $object_id, $meta_key) {
    if ($meta_key === 'certificate' && get_post_type($object_id) === 'cert') {
        $GLOBALS['easy_suite_prev_cert_pdf'][(int) $object_id] = (int) get_post_meta($object_id, 'certificate', true);
    }
    return $check;
}, 10, 3);

/* ...and delete the replaced PDF once the new value is saved. */
add_action('updated_post_meta', function ($meta_id, $object_id, $meta_key, $meta_value) {
    if ($meta_key !== 'certificate') {
        return;
    }
    $old = $GLOBALS['easy_suite_prev_cert_pdf'][(int) $object_id] ?? 0;
    unset($GLOBALS['easy_suite_prev_cert_pdf'][(int) $object_id]);
    $new = is_numeric($meta_value) ? (int) $meta_value : 0;
    if (!$old || $old === $new || !easy_suite_is_cert_pdf($old)) {
        return;
    }
    if (easy_suite_cert_pdf_in_use($old, (int) $object_id)) {
        return;
    }
    wp_delete_attachment($old, true);
}, 10, 4);

/* ==========================================================================
 * EASY Suite: unique certificate numbers, checked against every certificate
 * --------------------------------------------------------------------------
 * The app used to check a new number against the newest 100 published
 * certificates only, so it could not see older certificates or anyone
 * else's drafts in the review queue. Now the app asks the site for the next
 * free number (all statuses except trash), and the site refuses a save that
 * would duplicate an existing number, as a backstop for two instructors
 * posting the same course and date at the same moment.
 * ========================================================================== */

/** Is $number used by a certificate other than $exclude_id? */
function easy_suite_cert_number_taken($number, $exclude_id = 0) {
    global $wpdb;
    $number = trim((string) $number);
    if ($number === '') {
        return false;
    }
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery
    $id = $wpdb->get_var($wpdb->prepare(
        "SELECT p.ID FROM {$wpdb->posts} p
         JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID AND pm.meta_key = 'certificate_number'
         WHERE p.post_type = 'cert' AND p.post_status NOT IN ('trash', 'auto-draft')
           AND pm.meta_value = %s AND p.ID <> %d
         LIMIT 1",
        $number,
        (int) $exclude_id
    ));
    return (bool) $id;
}

/**
 * Bump the trailing two-digit instance until the number is free, the same
 * rule as the app's shared.nextFreeCertificateNumber(). Returns a WP_Error
 * when all 99 instances are taken.
 */
function easy_suite_next_free_cert_number($candidate, $exclude_id = 0) {
    $candidate = trim((string) $candidate);
    if (!preg_match('/^(.*?)(\d{2})$/', $candidate, $m)) {
        return $candidate;
    }
    $prefix = $m[1];
    $n = (int) $m[2];
    $number = $candidate;
    while (easy_suite_cert_number_taken($number, $exclude_id)) {
        $n++;
        if ($n > 99) {
            return new WP_Error('easy_cert_number_exhausted', 'All 99 certificate numbers for this course and date are taken.', ['status' => 409]);
        }
        $number = $prefix . str_pad((string) $n, 2, '0', STR_PAD_LEFT);
    }
    return $number;
}

/* Backstop: refuse a create/update that would duplicate a number. Runs
 * before the post is written, so a refused create leaves nothing behind. */
add_filter('rest_pre_insert_cert', function ($prepared, $request) {
    $acf = $request->get_param('acf');
    if (!is_array($acf) || !isset($acf['certificate_number']) || is_array($acf['certificate_number'])) {
        return $prepared;
    }
    $number = trim((string) $acf['certificate_number']);
    if ($number !== '' && easy_suite_cert_number_taken($number, (int) $request->get_param('id'))) {
        return new WP_Error(
            'easy_cert_number_taken',
            sprintf('Certificate number %s is already used by another certificate. Submit again to get the next free number.', $number),
            ['status' => 409]
        );
    }
    return $prepared;
}, 10, 2);

/* ==========================================================================
 * EASY Suite: proxy posters
 * --------------------------------------------------------------------------
 * WordPress usernames allowed to post certificates on behalf of other
 * instructors without publish rights (e.g. office staff). Set under
 * EASY Suite → Settings (option easy_proxy_posters); the app reads it from
 * /easy/v1/app-config instead of a list hardcoded in each install.
 * ========================================================================== */

function easy_suite_proxy_posters() {
    $raw = get_option('easy_proxy_posters', false);
    if ($raw === false) {
        return []; // Never configured: nobody is a proxy poster until Settings is saved.
    }
    return array_values(array_filter(array_map('strtolower', array_map('trim', preg_split('/[\s,]+/', (string) $raw)))));
}

function easy_suite_is_proxy_poster($user = null) {
    $user = $user ?: wp_get_current_user();
    return $user && $user->ID && in_array(strtolower($user->user_login), easy_suite_proxy_posters(), true);
}

add_action('rest_api_init', function () {
    // Next free certificate number for a candidate (all statuses).
    register_rest_route('easy/v1', '/cert-number', [
        'methods'             => 'GET',
        'callback'            => function (WP_REST_Request $request) {
            $next = easy_suite_next_free_cert_number($request->get_param('candidate'), (int) $request->get_param('exclude'));
            return is_wp_error($next) ? $next : ['number' => $next];
        },
        'permission_callback' => 'easy_cert_rest_can_access',
        'args'                => [
            'candidate' => ['required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
            'exclude'   => ['type' => 'integer', 'default' => 0],
        ],
    ]);
    // Per-user app settings that live on the site rather than in each install.
    register_rest_route('easy/v1', '/app-config', [
        'methods'             => 'GET',
        'callback'            => function () {
            return [
                'proxyPoster' => easy_suite_is_proxy_poster(),
                'version'     => EASY_SUITE_VERSION,
            ];
        },
        'permission_callback' => 'is_user_logged_in',
    ]);
    // The authenticated user's own identity, read server-side. Core's
    // /wp/v2/users/me can come back with the email field stripped by
    // security/privacy plugins filtering the core user response, which
    // left the desktop app unable to pull the signed-in user's email
    // even though it is stored on the account. This reads user_email
    // directly instead. It takes no user parameter and only ever returns
    // the caller's own record.
    register_rest_route('easy/v1', '/me', [
        'methods'             => 'GET',
        'callback'            => function () {
            $user = wp_get_current_user();
            return [
                'id'           => (int) $user->ID,
                'username'     => $user->user_login,
                'name'         => $user->display_name,
                'email'        => $user->user_email,
                'capabilities' => (object) $user->allcaps,
            ];
        },
        'permission_callback' => 'is_user_logged_in',
    ]);
});
