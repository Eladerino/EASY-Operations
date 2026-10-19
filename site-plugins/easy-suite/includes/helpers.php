<?php
/**
 * Shared helpers used by several modules and the admin pages.
 */

defined('ABSPATH') || exit;

/* Certificate PDF storage (see module-cert-pdf.php). */
define('EASY_CERT_PDF_SUBDIR', 'easy-certs');
define('EASY_CERT_PDF_MARKER', 'easy_cert_pdf');
define('EASY_CERT_PDF_MANIFEST', 'easy_core_pdf_manifest');

/**
 * Permission check for certificate data endpoints (Module 2b policy).
 * Only users who can edit cert posts (instructors, office staff, admins —
 * the accounts the EASY Operations app authenticates with) may access.
 */
function easy_cert_rest_can_access() {
    if (!is_user_logged_in()) {
        return false;
    }
    $pto = get_post_type_object('cert');
    $cap = ($pto && !empty($pto->cap->edit_posts)) ? $pto->cap->edit_posts : 'edit_posts';
    return current_user_can($cap);
}

/**
 * Office-level accounts, for reads that hand out full student PII
 * (class rosters, the expiring-certificates list): site admins, plus
 * the proxy posters (office staff who act on behalf of instructors,
 * listed under EASY Suite → Settings). Instructors are not office-level:
 * their own calendar feed shows roster names only.
 */
function easy_suite_is_office_user($user = null) {
    $user = $user ?: wp_get_current_user();
    if (!$user || !$user->ID) {
        return false;
    }
    if (user_can($user, 'manage_options')) {
        return true;
    }
    return function_exists('easy_suite_is_proxy_poster') && easy_suite_is_proxy_poster($user);
}

/* --- Settings getters (EASY Suite → Settings), each with its historical default --- */

function easy_core_get_notification_thresholds() {
    $raw = get_option('easy_notification_thresholds', '');
    if (is_string($raw) && trim($raw) !== '') {
        $parts = array_map('intval', explode(',', $raw));
        $parts = array_values(array_filter($parts, function ($n) { return $n > 0 && $n <= 365; }));
        if (count($parts) >= 1) {
            rsort($parts); // largest first, e.g. 30 before 7
            return array_slice($parts, 0, 2);
        }
    }
    return [30, 7]; // historical default
}

function easy_core_get_notification_time() {
    $raw = get_option('easy_notification_time', '');
    if (is_string($raw) && preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', trim($raw), $m)) {
        return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
    }
    return '09:00'; // default: 9 AM site time
}

function easy_core_get_noindex_paths() {
    $raw = get_option('easy_noindex_paths', '');
    if (is_string($raw) && trim($raw) !== '') {
        $lines = preg_split('/[\r\n]+/', $raw);
        $paths = [];
        foreach ($lines as $line) {
            $line = trim(trim($line), '/');
            if ($line !== '') {
                $paths[] = $line;
            }
        }
        if (!empty($paths)) {
            return $paths;
        }
    }
    return EASY_NOINDEX_PATHS; // historical default
}

/**
 * Page paths (no leading/trailing slash) that must never be indexed.
 * Children of EASY_NOINDEX_PATH_PREFIXES are covered too, so future
 * portal sub-pages are private by default.
 */

define('EASY_NOINDEX_PATHS', [
    'list-a-product',   // private: Dad's product-listing page (unlisted, gated)
    'cart',
    'checkout',
    'my-account',
    'password-reset',
    'account',
    'logout',
    'members',
    'register',
    'login',
    'user',
    'tickets-order',
    'tickets-checkout',
    'instructor-login',
    'instructor-portal',
    'view-certificates',
]);

define('EASY_NOINDEX_PATH_PREFIXES', [
    'instructor-portal', // any current or future page under the portal
]);
