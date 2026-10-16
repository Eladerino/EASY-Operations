<?php
/**
 * Module: Certificate PDF gatekeeper and auto-trash.
 *
 * Originally EASY Core modules 7 and 9. Rewrite flushing and the private
 * folder setup run from easy-suite.php (activation and version change).
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module 7: Certificate PDF gatekeeper (v1.5.0)
 * --------------------------------------------------------------------------
 * Certificate PDFs are served through an authenticated gatekeeper instead
 * of direct uploads URLs. The web server serves /wp-content/uploads/*
 * directly, so no PHP — and no login check — ever ran for PDF links.
 *
 * - New cert PDFs are routed into uploads/easy-certs/ (see the upload_dir
 *   filter below; the EASY Operations app sends easy_cert_pdf=1 with the
 *   upload). Direct web access to easy-certs/ is denied at the server
 *   level (.htaccess written by easy_core_ensure_cert_pdf_dir()).
 * - Gatekeeper URL: /cert-pdf/<certificate-number>/ — login required;
 *   serves the file only to the cert owner (student_email match) or to
 *   users who can edit cert posts (instructors, office, admins), mirroring
 *   the Module 2b REST gate.
 * - One-time migration (status-page tool below) moves existing cert PDFs
 *   into easy-certs/, updates attachment metadata so cert posts keep
 *   pointing at their PDFs, and records old URL paths; old direct links
 *   redirect to the gatekeeper instead of 404ing.
 * ========================================================================== */


function easy_core_cert_pdf_register_rewrite() {
    add_rewrite_rule('^cert-pdf/([^/]+)/?$', 'index.php?easy_cert_pdf=$matches[1]', 'top');
}
add_action('init', 'easy_core_cert_pdf_register_rewrite');

add_filter('query_vars', function ($vars) {
    $vars[] = 'easy_cert_pdf';
    return $vars;
});

/* Create uploads/easy-certs/ with server-level deny rules. */
function easy_core_ensure_cert_pdf_dir() {
    $upload = wp_upload_dir();
    $dir = trailingslashit($upload['basedir']) . EASY_CERT_PDF_SUBDIR;
    wp_mkdir_p($dir);
    $ht = trailingslashit($dir) . '.htaccess';
    if (!file_exists($ht)) {
        file_put_contents($ht,
            "# EASY Core: block direct web access to certificate PDFs.\n" .
            "# Files here are served only through the /cert-pdf/ gatekeeper.\n" .
            "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n" .
            "<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n"
        );
    }
    $ix = trailingslashit($dir) . 'index.php';
    if (!file_exists($ix)) {
        file_put_contents($ix, "<?php\n// Silence is golden.\n");
    }
}

/* --- Frontend: route the ACF `certificate` file field through the gatekeeper.
 * Both certificate templates echo the_field('certificate') straight into the
 * download href. After migration those raw uploads URLs 403, so on the
 * frontend we swap the value for the /cert-pdf/<number>/ URL. Tightly scoped:
 * frontend only (admin keeps raw values), never cron (expiry emails attach the
 * file from disk), never REST (the app builds its own gatekeeper URLs), and
 * only for cert posts that actually have a certificate_number. */
add_filter('acf/format_value/name=certificate', function ($value, $post_id, $field) {
    if (is_admin() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return $value;
    }
    if (get_post_type($post_id) !== 'cert') {
        return $value;
    }
    $num = get_post_meta($post_id, 'certificate_number', true);
    if (!is_string($num) || trim($num) === '') {
        return $value;
    }
    $gk = home_url('/cert-pdf/' . rawurlencode(trim($num)) . '/');
    if (is_string($value) && $value !== '') {
        return $gk;
    }
    if (is_array($value)) {
        $value['url'] = $gk;
        return $value;
    }
    if (is_numeric($value)) {
        return $gk;
    }
    return $value;
}, 10, 3);

/* Repair cert attachments whose file went missing but whose basename already
 * lives in easy-certs/ (e.g. files moved by a batch that died before updating
 * attachment meta). Fixes _wp_attached_file, attachment metadata, and backfills
 * the old-URL manifest so legacy redirects keep working. Idempotent. */
function easy_core_repair_stale_pdf_meta() {
    $upload = wp_upload_dir();
    $base = trailingslashit($upload['basedir']);
    $gated_dir = $base . EASY_CERT_PDF_SUBDIR;
    if (!is_dir($gated_dir)) {
        return 0;
    }
    $fixed = 0;
    $manifest = get_option(EASY_CERT_PDF_MANIFEST, []);
    if (!is_array($manifest)) {
        $manifest = [];
    }
    $certs = get_posts([
        'post_type'      => 'cert',
        'post_status'    => 'any',
        'posts_per_page' => -1,
        'fields'         => 'ids',
    ]);
    foreach ($certs as $pid) {
        $att_id = easy_core_cert_attachment_id($pid);
        if (!$att_id) {
            continue;
        }
        $path = get_attached_file($att_id);
        if ($path && is_file($path)) {
            continue;
        }
        if (!$path) {
            continue;
        }
        $gated = $gated_dir . '/' . basename($path);
        if (!is_file($gated)) {
            continue;
        }
        $rel = EASY_CERT_PDF_SUBDIR . '/' . basename($path);
        update_post_meta($att_id, '_wp_attached_file', $rel);
        $meta = wp_get_attachment_metadata($att_id);
        if (is_array($meta)) {
            $meta['file'] = $rel;
            wp_update_attachment_metadata($att_id, $meta);
        }
        $num = get_post_meta($pid, 'certificate_number', true);
        $old_rel = ltrim(substr($path, strlen($base)), '/');
        $manifest[] = [
            'att_id'       => $att_id,
            'cert_number'  => is_string($num) ? $num : '',
            'old_url'      => '',
            'old_url_path' => '/wp-content/uploads/' . $old_rel,
            'new_path'     => $rel,
        ];
        $fixed++;
    }
    if ($fixed > 0) {
        update_option(EASY_CERT_PDF_MANIFEST, $manifest, false);
    }
    return $fixed;
}

/* Self-heal safety net in the path resolver: if the attachment's recorded
 * file is gone but its basename exists in easy-certs/, repair and use it. */
/* --- Gatekeeper request handler ---------------------------------------- */

/* Application passwords are rejected on frontend requests by default
 * (WordPress only allows them for API requests). The EASY Operations app
 * authenticates with an app password via Basic auth, so the gatekeeper
 * endpoint must count as an API request or the app gets bounced to login. */
add_filter('application_password_is_api_request', function ($is_api) {
    // Match the gatekeeper path directly from the request URI — query vars
    // may not be parsed yet when this filter runs during authentication.
    // Only the path itself counts, anchored at the site root: a bare
    // substring match let any front-end URL carrying "/cert-pdf/" in its
    // query string accept app-password logins.
    if (!isset($_SERVER['REQUEST_URI'])) {
        return $is_api;
    }
    $path = (string) wp_parse_url(wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH);
    $base = rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
    if (preg_match('#^' . preg_quote($base, '#') . '/cert-pdf/[^/]+/?$#', $path)) {
        return true;
    }
    return $is_api;
});

add_action('template_redirect', function () {
    $cert_number = get_query_var('easy_cert_pdf');
    if ($cert_number === '' || $cert_number === null) {
        return;
    }
    $cert_number = sanitize_text_field(rawurldecode($cert_number));

    // Logged-out visitors go through the normal login flow, then back here.
    if (!is_user_logged_in()) {
        wp_redirect(wp_login_url(home_url('/cert-pdf/' . rawurlencode($cert_number) . '/')));
        exit;
    }

    $post_id = easy_core_find_cert_by_number($cert_number);
    if (!$post_id) {
        status_header(404);
        wp_die(esc_html__('Certificate not found.', 'easy-core'), 404);
    }

    $user = wp_get_current_user();
    $pto = get_post_type_object('cert');
    $can_edit = $pto && !empty($pto->cap->edit_posts) && current_user_can($pto->cap->edit_posts);
    $owner_email = strtolower(trim((string) get_post_meta($post_id, 'student_email', true)));
    $is_owner = $owner_email !== '' && $owner_email === strtolower(trim((string) $user->user_email));
    if (!$can_edit && !$is_owner) {
        status_header(403);
        wp_die(esc_html__('You are not authorized to view this certificate.', 'easy-core'), 403);
    }

    $path = easy_core_cert_pdf_path($post_id);
    if (!$path) {
        status_header(404);
        wp_die(esc_html__('Certificate file not found.', 'easy-core'), 404);
    }

    easy_core_stream_pdf($path, $cert_number . '.pdf');
});

function easy_core_find_cert_by_number($cert_number) {
    if ($cert_number === '') {
        return 0;
    }
    $ids = get_posts([
        'post_type'      => 'cert',
        'post_status'    => 'any',
        'posts_per_page' => 1,
        'fields'         => 'ids',
        'meta_key'       => 'certificate_number',
        'meta_value'     => $cert_number,
    ]);
    return $ids ? (int) $ids[0] : 0;
}

/* Normalize the ACF `certificate` file field to an attachment ID. Shapes seen
 * in the wild: attachment ID, numeric string, ['id' => …] array, full URL. */
function easy_core_cert_attachment_id($post_id) {
    $ref = get_post_meta($post_id, 'certificate', true);
    if (is_numeric($ref) && (int) $ref > 0) {
        return (int) $ref;
    }
    if (is_array($ref) && !empty($ref['id']) && (int) $ref['id'] > 0) {
        return (int) $ref['id'];
    }
    if (is_string($ref) && trim($ref) !== '') {
        $t = trim($ref);
        if (ctype_digit($t)) {
            return (int) $t;
        }
        if (preg_match('#^https?://#i', $t)) {
            $id = attachment_url_to_postid($t);
            if ($id) {
                return (int) $id;
            }
        }
    }
    return 0;
}

/* Absolute path of the cert's PDF, or ''. Never derived from user input —
 * always resolved through the cert post → attachment chain. */
function easy_core_cert_pdf_path($post_id) {
    $att_id = easy_core_cert_attachment_id($post_id);
    if (!$att_id) {
        return '';
    }
    $path = get_attached_file($att_id);
    if ((!$path || !is_file($path)) && $path) {
        $upload = wp_upload_dir();
        $gated = trailingslashit($upload['basedir']) . EASY_CERT_PDF_SUBDIR . '/' . basename($path);
        if (is_file($gated)) {
            $rel = EASY_CERT_PDF_SUBDIR . '/' . basename($path);
            update_post_meta($att_id, '_wp_attached_file', $rel);
            $path = $gated;
        }
    }
    if (!$path || !is_file($path)) {
        return '';
    }
    if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'pdf') {
        return '';
    }
    $upload = wp_upload_dir();
    $basedir = realpath($upload['basedir']);
    $real = realpath($path);
    if (!$basedir || !$real || strpos($real, $basedir) !== 0) {
        return '';
    }
    return $real;
}

function easy_core_stream_pdf($path, $download_name) {
    if (ini_get('zlib.output_compression')) {
        ini_set('zlib.output_compression', 'Off');
    }
    nocache_headers();
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . addcslashes($download_name, '"\\') . '"');
    header('X-Content-Type-Options: nosniff');
    $fh = fopen($path, 'rb');
    if ($fh) {
        while (!feof($fh)) {
            echo fread($fh, 1048576);
            if (ob_get_level()) {
                ob_flush();
            }
            flush();
        }
        fclose($fh);
    }
    exit;
}

/* --- Upload routing: app-sent cert PDFs land in the private folder ------- */

add_filter('upload_dir', function ($dirs) {
    if (!empty($_POST[EASY_CERT_PDF_MARKER]) && isset($dirs['basedir'], $dirs['baseurl'])) {
        $dirs['subdir'] = '/' . EASY_CERT_PDF_SUBDIR;
        $dirs['path']   = trailingslashit($dirs['basedir']) . EASY_CERT_PDF_SUBDIR;
        $dirs['url']    = trailingslashit($dirs['baseurl']) . EASY_CERT_PDF_SUBDIR;
    }
    return $dirs;
});

/* --- Migration: move existing cert PDFs into easy-certs/ ----------------- */

/* Every cert post whose PDF currently lives outside the private folder. */
function easy_core_migratable_cert_pdfs() {
    $ids = get_posts([
        'post_type'      => 'cert',
        'post_status'    => 'any',
        'posts_per_page' => -1,
        'fields'         => 'ids',
    ]);
    $out = [];
    foreach ($ids as $pid) {
        $att_id = easy_core_cert_attachment_id($pid);
        if (!$att_id) {
            continue;
        }
        $path = get_attached_file($att_id);
        if (!$path || !is_file($path)) {
            continue;
        }
        if (stripos($path, '/' . EASY_CERT_PDF_SUBDIR . '/') !== false) {
            continue;
        }
        if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'pdf') {
            continue;
        }
        $out[] = [
            'post_id'     => (int) $pid,
            'att_id'      => $att_id,
            'path'        => $path,
            'cert_number' => (string) get_post_meta($pid, 'certificate_number', true),
        ];
    }
    return $out;
}

/* Move up to $batch PDFs; record old URL path → cert number for the old-link
 * redirect and for rollback. Cert posts keep pointing at their PDFs via the
 * updated attachment metadata. */
function easy_core_migrate_cert_pdfs($batch = 100) {
    easy_core_ensure_cert_pdf_dir();
    $upload = wp_upload_dir();
    $target = trailingslashit($upload['basedir']) . EASY_CERT_PDF_SUBDIR;
    $manifest = get_option(EASY_CERT_PDF_MANIFEST, []);
    if (!is_array($manifest)) {
        $manifest = [];
    }
    $cands = easy_core_migratable_cert_pdfs();
    $moved = 0;
    foreach (array_slice($cands, 0, $batch) as $c) {
        $old_url = wp_get_attachment_url($c['att_id']); // capture BEFORE the move
        $dest = trailingslashit($target) . wp_unique_filename($target, basename($c['path']));
        if (!@rename($c['path'], $dest)) {
            continue;
        }
        $rel = EASY_CERT_PDF_SUBDIR . '/' . basename($dest);
        // Direct meta write: equivalent to wp_update_attached_file() here since
        // $rel is already a relative uploads path, and avoids loading
        // wp-admin/includes/media.php (unavailable on admin-post.php).
        update_post_meta($c['att_id'], '_wp_attached_file', $rel);
        $meta = wp_get_attachment_metadata($c['att_id']);
        if (is_array($meta)) {
            $meta['file'] = $rel;
            wp_update_attachment_metadata($c['att_id'], $meta);
        }
        $manifest[] = [
            'att_id'       => $c['att_id'],
            'old_url_path' => $old_url ? (string) wp_parse_url($old_url, PHP_URL_PATH) : '',
            'cert_number'  => $c['cert_number'],
        ];
        $moved++;
    }
    update_option(EASY_CERT_PDF_MANIFEST, array_values($manifest), false);
    return ['moved' => $moved, 'remaining' => max(0, count($cands) - $moved)];
}

/* Rollback helper: move migrated PDFs back to their original locations. */
function easy_core_reverse_cert_pdf_migration($batch = 100) {
    $manifest = get_option(EASY_CERT_PDF_MANIFEST, []);
    if (!is_array($manifest)) {
        $manifest = [];
    }
    $upload = wp_upload_dir();
    $base_path = (string) wp_parse_url($upload['baseurl'], PHP_URL_PATH);
    $moved = 0;
    $kept = [];
    foreach ($manifest as $entry) {
        $done = false;
        if ($moved < $batch && is_array($entry) && !empty($entry['att_id']) && !empty($entry['old_url_path'])) {
            $att_id = (int) $entry['att_id'];
            $cur = get_attached_file($att_id);
            $rel_old = ltrim(substr($entry['old_url_path'], strlen($base_path)), '/');
            if ($rel_old) {
                $dest = trailingslashit($upload['basedir']) . $rel_old;
                wp_mkdir_p(dirname($dest));
                if ($cur && is_file($cur) && @rename($cur, $dest)) {
                    update_post_meta($att_id, '_wp_attached_file', $rel_old);
                    $meta = wp_get_attachment_metadata($att_id);
                    if (is_array($meta)) {
                        $meta['file'] = $rel_old;
                        wp_update_attachment_metadata($att_id, $meta);
                    }
                    $moved++;
                    $done = true;
                }
            }
        }
        if (!$done) {
            $kept[] = $entry;
        }
    }
    update_option(EASY_CERT_PDF_MANIFEST, array_values($kept), false);
    return ['moved' => $moved, 'remaining' => count($kept)];
}

add_action('admin_post_easy_core_migrate_pdfs', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('easy_core_migrate_pdfs')) {
        wp_die(esc_html__('Not allowed.', 'easy-core'), 403);
    }
    delete_option('easy_core_last_migration_error');
    register_shutdown_function(function () {
        $err = error_get_last();
        if ($err && in_array((int) $err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
            update_option('easy_core_last_migration_error',
                $err['message'] . ' — ' . (isset($err['file']) ? $err['file'] : '') . ':' . (isset($err['line']) ? $err['line'] : ''), false);
        }
    });
    $res = easy_core_migrate_cert_pdfs(500);
    wp_redirect(add_query_arg([
        'page'           => 'easy-suite',
        'easy_mig'       => 'done',
        'easy_migrated'  => $res['moved'],
        'easy_remaining' => $res['remaining'],
    ], admin_url('admin.php')));
    exit;
});

add_action('admin_post_easy_core_reverse_pdfs', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('easy_core_reverse_pdfs')) {
        wp_die(esc_html__('Not allowed.', 'easy-core'), 403);
    }
    $res = easy_core_reverse_cert_pdf_migration(500);
    wp_redirect(add_query_arg([
        'page'           => 'easy-suite',
        'easy_mig'       => 'reversed',
        'easy_migrated'  => $res['moved'],
        'easy_remaining' => $res['remaining'],
    ], admin_url('admin.php')));
    exit;
});

/* Old direct PDF links (pre-migration) redirect to the gatekeeper so they
 * keep working for authorized users instead of 404ing. */
add_action('template_redirect', function () {
    if (!is_404()) {
        return;
    }
    global $wp;
    $req = isset($wp->request) ? '/' . ltrim($wp->request, '/') : '';
    if (stripos($req, '/wp-content/uploads/') !== 0) {
        return;
    }
    if (strtolower(substr($req, -4)) !== '.pdf') {
        return;
    }
    $req = '/' . ltrim(urldecode(ltrim($req, '/')), '/');
    $manifest = get_option(EASY_CERT_PDF_MANIFEST, []);
    if (is_array($manifest)) {
        foreach ($manifest as $entry) {
            if (is_array($entry) && !empty($entry['old_url_path']) && !empty($entry['cert_number'])
                && $entry['old_url_path'] === $req) {
                wp_redirect(home_url('/cert-pdf/' . rawurlencode($entry['cert_number']) . '/'), 302);
                exit;
            }
        }
    }
}, 5);

/* -------------------------------------------------------------------------
 * Module 9: Auto-trash linked certificate PDFs
 *
 * A cert post's PDF is a WordPress attachment linked via the 'certificate'
 * post meta (see easy_core_cert_attachment_id()). WordPress does not remove
 * the attachment when the cert post is trashed/deleted, so orphaned PDFs
 * accumulate in easy-certs/.
 *
 * Lifecycle handled here:
 *  - wp_trash_post on a cert  → trash its PDF attachment too (reversible).
 *  - untrash_post on a cert   → restore its PDF attachment too.
 *  - before_delete_post       → permanently delete the PDF attachment + file.
 *
 * Guards: only acts on the 'cert' post type, only on real attachments, and
 * never loops (attachment trash/delete fires the same hooks but the post-type
 * check returns early for non-cert posts).
 * ------------------------------------------------------------------------- */
function easy_core_pdf_autotrash_trash($post_id) {
    if (get_post_type($post_id) !== 'cert') {
        return;
    }
    $att_id = easy_core_cert_attachment_id($post_id);
    if (!$att_id || get_post_type($att_id) !== 'attachment') {
        return;
    }
    if (get_post_status($att_id) !== 'trash') {
        wp_trash_post($att_id);
    }
}

function easy_core_pdf_autotrash_untrash($post_id) {
    if (get_post_type($post_id) !== 'cert') {
        return;
    }
    $att_id = easy_core_cert_attachment_id($post_id);
    if (!$att_id || get_post_type($att_id) !== 'attachment') {
        return;
    }
    if (get_post_status($att_id) === 'trash') {
        wp_untrash_post($att_id);
    }
}

function easy_core_pdf_autotrash_delete($post_id) {
    if (get_post_type($post_id) !== 'cert') {
        return;
    }
    $att_id = easy_core_cert_attachment_id($post_id);
    if (!$att_id || get_post_type($att_id) !== 'attachment') {
        return;
    }
    // true = force delete, bypass trash; removes the file from easy-certs/.
    wp_delete_attachment($att_id, true);
}

add_action('wp_trash_post', 'easy_core_pdf_autotrash_trash');
add_action('untrash_post', 'easy_core_pdf_autotrash_untrash');
add_action('before_delete_post', 'easy_core_pdf_autotrash_delete');

