<?php
/**
 * Module: Class check-in (per-class QR code).
 *
 * One QR code per class, not one code forever (the lesson from Eastern
 * Safety's single permanent registration form). The Suite mints a secret
 * token for a class event; the QR points at /check-in/<token>. Students
 * scan it, find their booking, confirm the name that will go on their
 * certificate, add an emergency contact, sign the waiver on their phone,
 * and land on the class's existing roster as checked in.
 *
 * Privacy rules baked in (proposal section 4.9):
 *  - The token is stored HASHED (sha256). The plaintext exists only in
 *    the printed/shared link and, briefly, in a per-user transient right
 *    after it is created so the office can download or print the QR.
 *  - The check-in page is a standalone lightweight template (no theme,
 *    no trackers), sent with noindex headers, and the URL is never
 *    linked from any public page. Rewrite endpoints never appear in
 *    WordPress or Yoast sitemaps, so there is nothing to exclude.
 *  - Lookup by email or phone only ever reveals the matched student's
 *    own roster entry, never a list of other students.
 *  - Signature images live in a private uploads subfolder with
 *    server-level deny rules (the cert-PDF pattern) and are served
 *    only through a staff-gated route.
 *  - ID and date-of-birth fields do not exist in the flow unless the
 *    class has them explicitly switched on (default off).
 *
 * The public page stays inactive for a class until a waiver text has
 * been saved under EASY Suite -> Class check-in (and the class has the
 * waiver step switched on): nothing ships with placeholder legal text.
 */

defined('ABSPATH') || exit;

define('EASY_CHECKIN_META', '_easy_checkin');
define('EASY_CHECKIN_SIG_SUBDIR', 'easy-signatures');
define('EASY_CHECKIN_OFFICE_PHONE', '(709) 221-7233');
define('EASY_CHECKIN_CODE_ALPHABET', 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'); // no 0/O/1/I/L

/* ==========================================================================
 * The per-event check-in record (_easy_checkin)
 * ========================================================================== */

/** Normalized check-in record for an event, defaults filled in. */
function easy_checkin_record($event_id) {
    $event_id = (int) $event_id;
    $raw = $event_id > 0 ? get_post_meta($event_id, EASY_CHECKIN_META, true) : '';
    $rec = is_array($raw) ? $raw : array();
    $toggles = isset($rec['toggles']) && is_array($rec['toggles']) ? $rec['toggles'] : array();
    return array(
        'token_hash' => isset($rec['token_hash']) && is_string($rec['token_hash']) ? $rec['token_hash'] : '',
        'short_code' => isset($rec['short_code']) && is_string($rec['short_code']) ? strtoupper($rec['short_code']) : '',
        'status'     => isset($rec['status']) && in_array($rec['status'], array('open', 'closed'), true) ? $rec['status'] : 'none',
        'created_at' => isset($rec['created_at']) ? (int) $rec['created_at'] : 0,
        'created_by' => isset($rec['created_by']) ? (int) $rec['created_by'] : 0,
        'expires'    => isset($rec['expires']) ? (int) $rec['expires'] : 0,
        'waiver_type' => isset($rec['waiver_type']) && $rec['waiver_type'] === 'practical' ? 'practical' : 'classroom',
        'toggles'    => array(
            // Emergency contact is required for in-person classes
            // (Phase 0 decision), so it starts on.
            'emergency' => !isset($toggles['emergency']) || !empty($toggles['emergency']),
            'waiver'    => !isset($toggles['waiver']) || !empty($toggles['waiver']),
            'recert'    => !empty($toggles['recert']),
            // ID/DOB starts off and stays off unless a class needs it
            // (Phase 0 decision; collecting less is the point).
            'id_dob'    => !empty($toggles['id_dob']),
        ),
    );
}

function easy_checkin_save_record($event_id, $rec) {
    update_post_meta((int) $event_id, EASY_CHECKIN_META, $rec);
}

/** Check-in is usable right now: link created, open, and not expired. */
function easy_checkin_is_open($rec) {
    return $rec['status'] === 'open' && $rec['expires'] > time() && $rec['token_hash'] !== '';
}

/* ==========================================================================
 * Waiver texts (Suite settings, versioned)
 *
 * Two texts, classroom and practical, each with a version label. The
 * version label plus a sha256 of the exact text are recorded with every
 * signature, so a signed waiver always proves which words were agreed
 * to. Editing a text later never changes what earlier students signed.
 * ========================================================================== */

function easy_checkin_waiver($type) {
    $type = $type === 'practical' ? 'practical' : 'classroom';
    $text = get_option('easy_checkin_waiver_' . $type, '');
    $version = get_option('easy_checkin_waiver_' . $type . '_version', '');
    return array(
        'text'    => is_string($text) ? $text : '',
        'version' => is_string($version) ? $version : '',
    );
}

function easy_checkin_waiver_ready($type) {
    $w = easy_checkin_waiver($type);
    return trim($w['text']) !== '';
}

/* ==========================================================================
 * Tokens
 * ========================================================================== */

function easy_checkin_token_url($token) {
    return home_url('/check-in/' . $token . '/');
}

function easy_checkin_code_url($code) {
    return home_url('/c/' . $code . '/');
}

/** 6-character human code, checked unique across classes. */
function easy_checkin_mint_code() {
    $alphabet = EASY_CHECKIN_CODE_ALPHABET;
    $max = strlen($alphabet) - 1;
    for ($attempt = 0; $attempt < 20; $attempt++) {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }
        if (!easy_checkin_find_event_by_code($code)) {
            return $code;
        }
    }
    return $code; // vanishingly unlikely collision; lookup takes the first match
}

/**
 * Expiry for a fresh link: class end + 24 hours, so a multi-day class
 * keeps working each morning. When the end is unknown, start + 24h.
 */
function easy_checkin_default_expiry($event_id) {
    $start = 0;
    $end = 0;
    if (function_exists('easy_ics_event_times')) {
        $times = easy_ics_event_times($event_id);
        if ($times) {
            list($start, $end) = $times;
        }
    }
    if (!$end) {
        $end_local = get_post_meta($event_id, '_EventEndDate', true);
        $start_local = get_post_meta($event_id, '_EventStartDate', true);
        $end = is_string($end_local) && $end_local !== '' ? (int) strtotime($end_local) : 0;
        $start = is_string($start_local) && $start_local !== '' ? (int) strtotime($start_local) : 0;
    }
    $base = $end > 0 ? $end : ($start > 0 ? $start : time());
    return $base + DAY_IN_SECONDS;
}

/** Events that have a check-in record at all (candidate set for lookups).
 * Deliberately NOT a WP_Query: The Events Calendar rewrites event queries
 * on the front end (date and status conditions), which silently dropped
 * classes whose start time had passed — a live class mid-session stopped
 * matching its own check-in link (found in the Oct 26 dummy-class test).
 * Only events carrying a record can match, so read postmeta directly. */
function easy_checkin_candidate_events() {
    global $wpdb;
    if (!isset($wpdb) || !is_object($wpdb)) {
        return array();
    }
    $ids = $wpdb->get_col($wpdb->prepare(
        "SELECT DISTINCT pm.post_id FROM {$wpdb->postmeta} pm"
        . " INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id"
        . " WHERE pm.meta_key = %s AND p.post_type = 'tribe_events' AND p.post_status = 'publish'"
        . " ORDER BY pm.post_id DESC LIMIT 500",
        EASY_CHECKIN_META
    ));
    return array_map('intval', is_array($ids) ? $ids : array());
}

/** Find the event a plaintext token belongs to (timing-safe compare). */
function easy_checkin_find_event_by_token($token) {
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        return 0;
    }
    $hash = hash('sha256', $token);
    foreach (easy_checkin_candidate_events() as $id) {
        $rec = easy_checkin_record($id);
        if ($rec['token_hash'] !== '' && hash_equals($rec['token_hash'], $hash)) {
            return (int) $id;
        }
    }
    return 0;
}

/** Find the event a human short code belongs to (timing-safe compare). */
function easy_checkin_find_event_by_code($code) {
    if (!is_string($code)) {
        return 0;
    }
    $code = strtoupper(trim($code));
    if (!preg_match('/^[A-Z2-9]{6}$/', $code)) {
        return 0;
    }
    foreach (easy_checkin_candidate_events() as $id) {
        $rec = easy_checkin_record($id);
        if ($rec['short_code'] !== '' && hash_equals($rec['short_code'], $code)) {
            return (int) $id;
        }
    }
    return 0;
}

function easy_checkin_log($event_id, $action, $detail = array()) {
    if (!function_exists('easy_activity_insert')) {
        return;
    }
    $detail = array_merge(array('surface' => 'checkin'), $detail);
    easy_activity_insert('checkin', (int) $event_id, (string) get_the_title($event_id), $action, (int) get_current_user_id(), $detail);
}

/**
 * Create (or regenerate) the check-in link for an event. Returns the
 * plaintext token on success, '' on failure. Only the hash is stored;
 * the caller hands the plaintext to a one-time display transient.
 * Regenerating replaces the hash and the code, so the old link and the
 * old code both stop working immediately.
 */
function easy_checkin_mint($event_id, $regenerate) {
    $event_id = (int) $event_id;
    if (get_post_type($event_id) !== 'tribe_events') {
        return '';
    }
    $token = bin2hex(random_bytes(32));
    $rec = easy_checkin_record($event_id);
    $rec['token_hash'] = hash('sha256', $token);
    $rec['short_code'] = easy_checkin_mint_code();
    $rec['status'] = 'open';
    $rec['created_at'] = time();
    $rec['created_by'] = (int) get_current_user_id();
    $rec['expires'] = easy_checkin_default_expiry($event_id);
    easy_checkin_save_record($event_id, $rec);
    easy_checkin_log($event_id, $regenerate ? 'link_regenerated' : 'link_created', array(
        'expires' => $rec['expires'],
    ));
    return $token;
}

function easy_checkin_close($event_id) {
    $rec = easy_checkin_record($event_id);
    $rec['status'] = 'closed';
    easy_checkin_save_record($event_id, $rec);
    easy_checkin_log($event_id, 'closed');
}

/* ==========================================================================
 * Signature storage (private folder, the cert-PDF pattern)
 * ========================================================================== */

function easy_checkin_sig_dir() {
    $upload = wp_upload_dir();
    return trailingslashit($upload['basedir']) . EASY_CHECKIN_SIG_SUBDIR;
}

/* Create uploads/easy-signatures/ with server-level deny rules. */
function easy_checkin_ensure_sig_dir() {
    $dir = easy_checkin_sig_dir();
    wp_mkdir_p($dir);
    $ht = trailingslashit($dir) . '.htaccess';
    if (!file_exists($ht)) {
        file_put_contents($ht,
            "# EASY Suite: block direct web access to waiver signatures.\n" .
            "# Files here are served only through the staff-only signature route.\n" .
            "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n" .
            "<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n"
        );
    }
    $ix = trailingslashit($dir) . 'index.php';
    if (!file_exists($ix)) {
        file_put_contents($ix, "<?php\n// Silence is golden.\n");
    }
}

/**
 * Store one signature PNG from a canvas data URL. Returns the stored
 * file name (the private reference kept on the roster record), or ''.
 * The file name is derived from the event + roster record, so a student
 * resubmitting overwrites their own earlier signature instead of
 * leaving duplicates behind.
 */
function easy_checkin_save_signature($event_id, $record_id, $data_url) {
    if (!is_string($data_url) || strpos($data_url, 'data:image/png;base64,') !== 0) {
        return '';
    }
    $bin = base64_decode(substr($data_url, strlen('data:image/png;base64,')), true);
    if ($bin === false || strlen($bin) < 100 || strlen($bin) > 262144) {
        return '';
    }
    if (substr($bin, 0, 8) !== "\x89PNG\r\n\x1a\n") {
        return ''; // not actually a PNG, whatever the data URL claimed
    }
    easy_checkin_ensure_sig_dir();
    $name = 'sig-' . (int) $event_id . '-' . substr(hash('sha256', $record_id . '|' . wp_salt()), 0, 12) . '.png';
    if (file_put_contents(trailingslashit(easy_checkin_sig_dir()) . $name, $bin) === false) {
        return '';
    }
    return $name;
}

/** Absolute path of a stored signature, or ''. Never user-derived. */
function easy_checkin_signature_path($ref) {
    if (!is_string($ref) || $ref === '' || basename($ref) !== $ref) {
        return '';
    }
    $dir = realpath(easy_checkin_sig_dir());
    if (!$dir) {
        return '';
    }
    $real = realpath($dir . DIRECTORY_SEPARATOR . $ref);
    if (!$real || strpos($real, $dir) !== 0 || !is_file($real)) {
        return '';
    }
    return $real;
}

function easy_checkin_signature_url($ref) {
    return home_url('/check-in-signature/' . rawurlencode($ref) . '/');
}

/* ==========================================================================
 * Rewrite rules + request handling
 *
 * /check-in/<64-hex-token>/  the student page (QR target)
 * /c/<6-char-code>/          the same page, for a student whose camera
 *                            failed (the code under the QR on the tent card)
 * /check-in-signature/<file> staff-only signature viewer
 * ========================================================================== */

function easy_checkin_register_rewrites()
{
    add_rewrite_rule('^check-in/([a-f0-9]{64})/?$', 'index.php?easy_checkin=1&easy_checkin_token=$matches[1]', 'top');
    add_rewrite_rule('^c/([A-Za-z0-9]{6})/?$', 'index.php?easy_checkin=1&easy_checkin_code=$matches[1]', 'top');
    add_rewrite_rule('^check-in-signature/([a-zA-Z0-9._-]+)/?$', 'index.php?easy_checkin_sig=$matches[1]', 'top');
}

add_action('init', 'easy_checkin_register_rewrites');

add_filter('query_vars', function ($vars) {
    $vars[] = 'easy_checkin';
    $vars[] = 'easy_checkin_token';
    $vars[] = 'easy_checkin_code';
    $vars[] = 'easy_checkin_sig';
    return $vars;
});

add_action('template_redirect', function () {
    $sig = get_query_var('easy_checkin_sig');
    if (is_string($sig) && $sig !== '') {
        easy_checkin_serve_signature(sanitize_file_name(rawurldecode($sig)));
        exit;
    }
    if (get_query_var('easy_checkin')) {
        easy_checkin_serve_page();
        exit;
    }
});

/* Signatures are staff-only: same access helper as certificate data. */
function easy_checkin_serve_signature($ref) {
    if (!is_user_logged_in()) {
        wp_redirect(wp_login_url(easy_checkin_signature_url($ref)));
        exit;
    }
    if (!easy_cert_rest_can_access()) {
        status_header(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'You are not authorized to view this signature.';
        exit;
    }
    $path = easy_checkin_signature_path($ref);
    if ($path === '') {
        status_header(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Signature not found.';
        exit;
    }
    nocache_headers();
    header('Content-Type: image/png');
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

/* ==========================================================================
 * The public check-in page
 *
 * Server-rendered steps on one URL:
 *  1. Landing: class confirmation + "find your booking" (email or phone).
 *  2. Confirm step: certificate name and employer prefilled from the
 *     booking, emergency contact, course-specific fields, waiver and
 *     signature. Reached only with a proof value minted by a successful
 *     lookup, so the roster entry is never exposed to a bare form post.
 *  3. Done: a big "checked in" screen the instructor can see at a glance.
 * Students with no booking take the walk-in path and land flagged
 * needs_review for the instructor to approve.
 * ========================================================================== */

function easy_checkin_client_ip() {
    return isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '';
}

/**
 * Simple per-key rate limit on transients: at most $limit hits per
 * $window seconds. Returns false once the budget is spent. This (plus
 * the honeypot) is the bot protection for the public forms; the site
 * has no shared Turnstile helper in the Suite to reuse.
 */
function easy_checkin_rate_ok($key, $limit, $window) {
    $name = 'easy_ci_rl_' . md5($key);
    $hits = get_transient($name);
    $hits = is_array($hits) ? $hits : array();
    $cutoff = time() - $window;
    $hits = array_values(array_filter($hits, function ($t) use ($cutoff) {
        return (int) $t > $cutoff;
    }));
    if (count($hits) >= $limit) {
        set_transient($name, $hits, $window);
        return false;
    }
    $hits[] = time();
    set_transient($name, $hits, $window);
    return true;
}

/** Proof that a roster record was reached through a successful lookup. */
function easy_checkin_proof($event_id, $subject) {
    return hash_hmac('sha256', (int) $event_id . '|' . $subject, wp_salt());
}

/** Digits-only phone comparison value (drops a leading country code 1). */
function easy_checkin_phone_digits($phone) {
    $d = preg_replace('/\D+/', '', (string) $phone);
    if (strlen($d) === 11 && $d[0] === '1') {
        $d = substr($d, 1);
    }
    return $d;
}

/**
 * Match a booking by email or phone against this event's roster only.
 * Returns the single matched roster record, or null. Only the matched
 * student's own entry is ever revealed; when several entries share a
 * booking contact (an employer booked several seats), the first one
 * that has not checked in yet is used.
 */
function easy_checkin_find_booking($event_id, $needle) {
    $needle = trim((string) $needle);
    if ($needle === '' || !function_exists('easy_roster_get')) {
        return null;
    }
    $email = is_email($needle) ? strtolower($needle) : '';
    $digits = easy_checkin_phone_digits($needle);
    $first_checked_in = null;
    foreach (easy_roster_get($event_id) as $rec) {
        $hit = false;
        if ($email !== '' && !empty($rec['email']) && strtolower($rec['email']) === $email) {
            $hit = true;
        }
        if (!$hit && strlen($digits) >= 7 && !empty($rec['phone'])
            && easy_checkin_phone_digits($rec['phone']) === $digits) {
            $hit = true;
        }
        if (!$hit) {
            continue;
        }
        if (empty($rec['checkin_status']) || $rec['checkin_status'] === 'booked') {
            return $rec;
        }
        if ($first_checked_in === null) {
            $first_checked_in = $rec; // resubmission updates this entry
        }
    }
    return $first_checked_in;
}

/** Class facts for the landing confirmation, read the way other modules read events. */
function easy_checkin_class_facts($event_id) {
    $event_id = (int) $event_id;
    $facts = array(
        'title' => (string) get_the_title($event_id),
        'when' => '',
        'location' => '',
        'instructor' => '',
    );
    $start = 0;
    $all_day = get_post_meta($event_id, '_EventAllDay', true) === 'yes';
    if (function_exists('easy_ics_event_times')) {
        $times = easy_ics_event_times($event_id);
        if ($times) {
            $start = (int) $times[0];
            $all_day = !empty($times[2]);
        }
    }
    if (!$start) {
        $s = get_post_meta($event_id, '_EventStartDate', true);
        $start = is_string($s) && $s !== '' ? (int) strtotime($s) : 0;
    }
    if ($start > 0) {
        $facts['when'] = function_exists('wp_date') ? wp_date('l, F j, Y', $start) : date_i18n('l, F j, Y', $start);
        if (!$all_day) {
            $facts['when'] .= ' at ' . (function_exists('wp_date') ? wp_date('g:i A', $start) : date_i18n('g:i A', $start));
        }
    }
    if (function_exists('easy_ics_event_location')) {
        $facts['location'] = (string) easy_ics_event_location($event_id);
    }
    if ($facts['location'] === '') {
        $venue_id = (int) get_post_meta($event_id, '_EventVenueID', true);
        if ($venue_id > 0) {
            $facts['location'] = (string) get_the_title($venue_id);
        }
    }
    $org_ids = array();
    if (function_exists('easy_ics_event_organizer_ids')) {
        $org_ids = easy_ics_event_organizer_ids($event_id);
    } else {
        $raw = get_post_meta($event_id, '_EventOrganizerID', true);
        if (is_numeric($raw)) {
            $org_ids = array((int) $raw);
        }
    }
    $names = array();
    foreach ($org_ids as $oid) {
        $name = get_the_title((int) $oid);
        if ($name) {
            $names[] = $name;
        }
    }
    $facts['instructor'] = implode(', ', $names);
    return $facts;
}

/* ---------- page frame ---------- */

function easy_checkin_page_head($title) {
    nocache_headers();
    header('X-Robots-Tag: noindex, nofollow');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="robots" content="noindex, nofollow">';
    echo '<title>' . esc_html($title) . ' - EASY Safety Training</title>';
    echo '<style>'
        . 'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f4f6f4;color:#1d2327;}'
        . 'main{max-width:34rem;margin:0 auto;padding:1.25rem 1rem 3rem;}'
        . 'h1{font-size:1.5rem;line-height:1.25;margin:.5rem 0;}'
        . 'h2{font-size:1.15rem;margin:1.25rem 0 .5rem;}'
        . 'p{line-height:1.5;}'
        . '.card{background:#fff;border:1px solid #dcdcde;border-radius:.75rem;padding:1rem 1.25rem;margin:1rem 0;}'
        . '.fact{margin:.25rem 0;}'
        . 'label{display:block;font-weight:600;margin:1rem 0 .35rem;}'
        . 'input[type=text],input[type=email],input[type=tel],input[type=date]{width:100%;box-sizing:border-box;font-size:1.125rem;padding:.8rem;border:1px solid #8c8f94;border-radius:.5rem;}'
        . 'button.go,input[type=submit].go{display:block;width:100%;box-sizing:border-box;font-size:1.2rem;font-weight:700;padding:1rem;margin:1.25rem 0;background:#1e7a34;color:#fff;border:0;border-radius:.6rem;cursor:pointer;}'
        . 'button.alt{display:block;width:100%;box-sizing:border-box;font-size:1.05rem;padding:.85rem;margin:.5rem 0;background:#fff;color:#1d2327;border:2px solid #1d2327;border-radius:.6rem;cursor:pointer;}'
        . '.err{background:#fcf0f1;border:1px solid #d63638;border-radius:.5rem;padding:.75rem 1rem;}'
        . '.waiver{max-height:16rem;overflow:auto;border:1px solid #dcdcde;border-radius:.5rem;padding:.75rem 1rem;background:#fafafa;white-space:pre-wrap;line-height:1.5;}'
        . '.sigwrap{border:2px dashed #8c8f94;border-radius:.5rem;background:#fff;}'
        . 'canvas.sig{display:block;width:100%;height:11rem;touch-action:none;}'
        . '.hp{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;}'
        . '.done{text-align:center;padding:2rem 1rem;}'
        . '.check{width:6rem;height:6rem;line-height:6rem;border-radius:50%;background:#1e7a34;color:#fff;font-size:3.5rem;margin:1rem auto;}'
        . '.small{font-size:.95rem;color:#50575e;}'
        . '</style></head><body><main>';
}

function easy_checkin_page_foot() {
    echo '</main></body></html>';
}

/** Plain message page used for bad, expired and closed links, and for a class whose waiver is not ready. */
function easy_checkin_message_page($heading, $body, $status = 200) {
    status_header($status);
    easy_checkin_page_head($heading);
    echo '<h1>' . esc_html($heading) . '</h1>';
    echo '<div class="card"><p>' . esc_html($body) . '</p>';
    echo '<p>If you are at the class now, please speak to your instructor. You can also call the office at '
        . esc_html(EASY_CHECKIN_OFFICE_PHONE) . '.</p></div>';
    easy_checkin_page_foot();
    exit;
}

function easy_checkin_serve_page() {
    $token = get_query_var('easy_checkin_token');
    $code = get_query_var('easy_checkin_code');
    $via_code = false;
    $event_id = 0;
    if (is_string($token) && $token !== '') {
        $event_id = easy_checkin_find_event_by_token($token);
        $self_url = easy_checkin_token_url($token);
        $rate_key = 'token:' . hash('sha256', $token);
    } else {
        $code = is_string($code) ? strtoupper($code) : '';
        $event_id = easy_checkin_find_event_by_code($code);
        $self_url = $code !== '' ? easy_checkin_code_url($code) : home_url('/check-in/');
        $rate_key = 'code:' . $code;
        $via_code = true;
    }
    if ($event_id <= 0) {
        easy_checkin_message_page(
            'This check-in link does not work',
            'The link or code does not match a class. Check that you scanned the code for today\'s class, or ask your instructor for the current one.',
            404
        );
    }
    $rec = easy_checkin_record($event_id);
    if ($rec['status'] === 'closed') {
        easy_checkin_message_page('Check-in is closed', 'Check-in for this class has been closed by the instructor.');
    }
    if (!easy_checkin_is_open($rec)) {
        easy_checkin_message_page('This check-in link has expired', 'The check-in link for this class is no longer active.');
    }
    // The waiver gate: with the waiver step on (the default), the page
    // stays inactive until an approved waiver text has been saved in
    // the Suite settings. No placeholder legal text, ever.
    if (!empty($rec['toggles']['waiver']) && !easy_checkin_waiver_ready($rec['waiver_type'])) {
        easy_checkin_message_page(
            'Check-in is not open yet',
            'Online check-in for this class is not open yet. Please check in with your instructor when you arrive.'
        );
    }
    $facts = easy_checkin_class_facts($event_id);
    $step = isset($_POST['easy_ci_step']) ? sanitize_key(wp_unslash($_POST['easy_ci_step'])) : '';
    if ($step === 'find' || $step === 'walkin' || $step === 'submit') {
        easy_checkin_handle_post($event_id, $rec, $facts, $self_url, $rate_key, $step, $via_code);
        return; // the handler exits, or falls through to the landing on a bad nonce
    }
    easy_checkin_render_landing($event_id, $facts, $self_url, '');
}

/** Shared POST guards: nonce + honeypot. Returns false when the post must be dropped. */
function easy_checkin_post_ok() {
    if (!isset($_POST['easy_ci_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['easy_ci_nonce'])), 'easy_checkin_public')) {
        return false;
    }
    // Honeypot: a field real students never see or fill in.
    if (!empty($_POST['easy_ci_middle_name'])) {
        return false;
    }
    return true;
}

function easy_checkin_handle_post($event_id, $rec, $facts, $self_url, $rate_key, $step, $via_code) {
    if (!easy_checkin_post_ok()) {
        easy_checkin_render_landing($event_id, $facts, $self_url, 'That form could not be accepted. Please try again.');
        return;
    }
    $ip = easy_checkin_client_ip();
    if ($step === 'find') {
        if (!easy_checkin_rate_ok($rate_key . '|find|' . $ip, 12, 10 * MINUTE_IN_SECONDS)) {
            easy_checkin_render_landing($event_id, $facts, $self_url, 'Too many tries. Please wait a few minutes, or check in with your instructor.');
            return;
        }
        $needle = isset($_POST['easy_ci_lookup']) ? sanitize_text_field(wp_unslash($_POST['easy_ci_lookup'])) : '';
        $match = easy_checkin_find_booking($event_id, $needle);
        if ($match === null) {
            easy_checkin_render_landing($event_id, $facts, $self_url, 'We could not find a booking with that email or phone number. Check what you booked with, or use the "I do not have a booking" button below.', true);
            return;
        }
        easy_checkin_render_confirm($event_id, $rec, $facts, $self_url, $match, null, '');
        exit;
    }
    if ($step === 'walkin') {
        easy_checkin_render_confirm($event_id, $rec, $facts, $self_url, null, null, '');
        exit;
    }
    if ($step === 'submit') {
        if (!easy_checkin_rate_ok($rate_key . '|submit|' . $ip, 6, 10 * MINUTE_IN_SECONDS)) {
            easy_checkin_message_page('Too many tries', 'Please wait a few minutes and scan the class code again, or check in with your instructor.');
        }
        easy_checkin_handle_submit($event_id, $rec, $facts, $self_url);
        return;
    }
}

function easy_checkin_render_landing($event_id, $facts, $self_url, $notice, $offer_walkin = false) {
    status_header(200);
    easy_checkin_page_head('Class check-in');
    echo '<h1>You are checking in to:</h1>';
    echo '<div class="card">';
    echo '<p class="fact"><strong>' . esc_html($facts['title']) . '</strong></p>';
    if ($facts['when'] !== '') {
        echo '<p class="fact">' . esc_html($facts['when']) . '</p>';
    }
    if ($facts['location'] !== '') {
        echo '<p class="fact">' . esc_html($facts['location']) . '</p>';
    }
    if ($facts['instructor'] !== '') {
        echo '<p class="fact">Instructor: ' . esc_html($facts['instructor']) . '</p>';
    }
    echo '</div>';
    if ($notice !== '') {
        echo '<p class="err" role="alert">' . esc_html($notice) . '</p>';
    }
    echo '<form method="post" action="' . esc_url($self_url) . '">';
    wp_nonce_field('easy_checkin_public', 'easy_ci_nonce');
    echo '<input type="hidden" name="easy_ci_step" value="find">';
    echo '<div class="hp" aria-hidden="true"><label>Middle name<input type="text" name="easy_ci_middle_name" tabindex="-1" autocomplete="off"></label></div>';
    echo '<label for="easy_ci_lookup">The email or phone number you booked with</label>';
    echo '<input type="text" id="easy_ci_lookup" name="easy_ci_lookup" inputmode="email" autocomplete="email" required>';
    echo '<button type="submit" class="go">Find my booking</button>';
    echo '</form>';
    echo '<form method="post" action="' . esc_url($self_url) . '">';
    wp_nonce_field('easy_checkin_public', 'easy_ci_nonce');
    echo '<input type="hidden" name="easy_ci_step" value="walkin">';
    echo '<div class="hp" aria-hidden="true"><label>Middle name<input type="text" name="easy_ci_middle_name" tabindex="-1" autocomplete="off"></label></div>';
    echo '<button type="submit" class="alt">I do not have a booking (walk-in)</button>';
    echo '</form>';
    echo '<p class="small">Your information goes only to this class\'s sign-in list. If anything does not work, your instructor can check you in another way. Office: '
        . esc_html(EASY_CHECKIN_OFFICE_PHONE) . '.</p>';
    easy_checkin_page_foot();
    exit;
}

/**
 * The confirm step. $match is the roster record found by lookup, or
 * null for the walk-in path (blank form, flagged for review).
 */
function easy_checkin_render_confirm($event_id, $rec, $facts, $self_url, $match, $old, $error) {
    $is_walkin = $match === null;
    $val = function ($key) use ($match, $old) {
        if (is_array($old) && isset($old[$key])) {
            return (string) $old[$key];
        }
        return $match && isset($match[$key]) ? (string) $match[$key] : '';
    };
    status_header(200);
    easy_checkin_page_head('Check in');
    echo '<h1>Check in: ' . esc_html($facts['title']) . '</h1>';
    if ($error !== '') {
        echo '<p class="err" role="alert">' . esc_html($error) . '</p>';
    }
    if ($is_walkin) {
        echo '<p>Fill in your details below. Your instructor will confirm your spot in class.</p>';
    } else {
        echo '<p>We found your booking. Please check that your name is spelled the way it should appear on your certificate.</p>';
    }
    echo '<form method="post" action="' . esc_url($self_url) . '" id="easy-ci-form">';
    wp_nonce_field('easy_checkin_public', 'easy_ci_nonce');
    echo '<input type="hidden" name="easy_ci_step" value="submit">';
    if ($is_walkin) {
        echo '<input type="hidden" name="easy_ci_mode" value="walkin">';
        $proof_subject = 'walkin';
    } else {
        echo '<input type="hidden" name="easy_ci_mode" value="booked">';
        echo '<input type="hidden" name="easy_ci_rid" value="' . esc_attr($match['id']) . '">';
        $proof_subject = (string) $match['id'];
    }
    echo '<input type="hidden" name="easy_ci_proof" value="' . esc_attr(easy_checkin_proof($event_id, $proof_subject)) . '">';
    echo '<div class="hp" aria-hidden="true"><label>Middle name<input type="text" name="easy_ci_middle_name" tabindex="-1" autocomplete="off"></label></div>';

    echo '<label for="ci_name">Your full name, as it should appear on your certificate</label>';
    echo '<input type="text" id="ci_name" name="ci_name" value="' . esc_attr($val('name')) . '" autocomplete="name" required>';

    echo '<label for="ci_employer">Employer (leave blank if none)</label>';
    echo '<input type="text" id="ci_employer" name="ci_employer" value="' . esc_attr($val('employer')) . '" autocomplete="organization">';

    if ($is_walkin) {
        echo '<label for="ci_phone">Your phone number</label>';
        echo '<input type="tel" id="ci_phone" name="ci_phone" value="' . esc_attr($val('phone')) . '" autocomplete="tel" required>';
        echo '<label for="ci_email">Your email</label>';
        echo '<input type="email" id="ci_email" name="ci_email" value="' . esc_attr($val('email')) . '" autocomplete="email" required>';
    }

    if (!empty($rec['toggles']['emergency'])) {
        echo '<h2>Emergency contact</h2>';
        echo '<label for="ci_em_name">Emergency contact name</label>';
        echo '<input type="text" id="ci_em_name" name="ci_emergency_name" value="' . esc_attr($val('emergency_name')) . '" required>';
        echo '<label for="ci_em_phone">Emergency contact phone</label>';
        echo '<input type="tel" id="ci_em_phone" name="ci_emergency_phone" value="' . esc_attr($val('emergency_phone')) . '" autocomplete="tel" required>';
    }

    if (!empty($rec['toggles']['recert'])) {
        echo '<label for="ci_recert">Expiry date on your current certificate</label>';
        echo '<input type="date" id="ci_recert" name="ci_recert_expiry" value="' . esc_attr($val('recert_expiry')) . '" required>';
    }

    if (!empty($rec['toggles']['id_dob'])) {
        // Only rendered when the class explicitly collects ID. The
        // fields ask for the last 4 digits only, never the full number.
        echo '<label for="ci_id4">Last 4 digits of your ID</label>';
        echo '<input type="text" id="ci_id4" name="ci_id_last4" value="' . esc_attr($val('id_last4')) . '" maxlength="4" inputmode="numeric" required>';
        echo '<label for="ci_dob">Your date of birth</label>';
        echo '<input type="date" id="ci_dob" name="ci_dob" value="' . esc_attr($val('dob')) . '" required>';
    }

    if (!empty($rec['toggles']['waiver'])) {
        $waiver = easy_checkin_waiver($rec['waiver_type']);
        echo '<h2>Participation waiver</h2>';
        echo '<div class="waiver" tabindex="0">' . esc_html($waiver['text']) . '</div>';
        echo '<p><label style="font-weight:400;"><input type="checkbox" name="ci_agree" value="1" required style="width:1.4rem;height:1.4rem;vertical-align:middle;"> '
            . 'I have read and agree to the waiver above.</label></p>';
        echo '<label for="ci_sig_canvas">Sign in the box (use your finger)</label>';
        echo '<div class="sigwrap"><canvas class="sig" id="ci_sig_canvas" width="640" height="220" aria-label="Signature box"></canvas></div>';
        echo '<input type="hidden" name="ci_signature" id="ci_signature" value="">';
        echo '<button type="button" class="alt" id="ci_sig_clear">Clear signature</button>';
    }

    echo '<button type="submit" class="go">Check in</button>';
    echo '</form>';
    if (!empty($rec['toggles']['waiver'])) {
        // Signature pad: pointer events cover finger, stylus and mouse.
        // The drawing is sent as a PNG data URL in the hidden field.
        echo '<script>(function(){'
            . 'var c=document.getElementById("ci_sig_canvas"),h=document.getElementById("ci_signature"),x=c.getContext("2d"),down=false,drew=false,lx=0,ly=0;'
            . 'x.lineWidth=3;x.lineCap="round";x.strokeStyle="#1d2327";'
            . 'function pos(e){var r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};}'
            . 'c.addEventListener("pointerdown",function(e){down=true;var p=pos(e);lx=p.x;ly=p.y;c.setPointerCapture(e.pointerId);});'
            . 'c.addEventListener("pointermove",function(e){if(!down)return;drew=true;var p=pos(e);x.beginPath();x.moveTo(lx,ly);x.lineTo(p.x,p.y);x.stroke();lx=p.x;ly=p.y;});'
            . 'function end(){down=false;}'
            . 'c.addEventListener("pointerup",end);c.addEventListener("pointercancel",end);'
            . 'document.getElementById("ci_sig_clear").addEventListener("click",function(){x.clearRect(0,0,c.width,c.height);drew=false;h.value="";});'
            . 'document.getElementById("easy-ci-form").addEventListener("submit",function(){h.value=drew?c.toDataURL("image/png"):"";});'
            . '})();</script>';
    }
    easy_checkin_page_foot();
}

function easy_checkin_handle_submit($event_id, $rec, $facts, $self_url) {
    if (!easy_checkin_is_open($rec)) {
        easy_checkin_message_page('Check-in is closed', 'Check-in for this class closed while you were filling in the form. Please speak to your instructor.');
    }
    if (!function_exists('easy_roster_get') || !function_exists('easy_roster_set')) {
        easy_checkin_message_page('Check-in is not available', 'The class list is not available right now. Please check in with your instructor.');
    }
    $post = function ($key) {
        return isset($_POST[$key]) ? sanitize_text_field(wp_unslash($_POST[$key])) : '';
    };
    $mode = $post('easy_ci_mode') === 'walkin' ? 'walkin' : 'booked';
    $rid = $post('easy_ci_rid');
    $proof = $post('easy_ci_proof');
    $subject = $mode === 'walkin' ? 'walkin' : $rid;
    if ($proof === '' || !hash_equals(easy_checkin_proof($event_id, $subject), $proof)) {
        easy_checkin_message_page('That form has expired', 'Please scan the class code again and start over. Your information was not saved.', 400);
    }

    $roster = easy_roster_get($event_id);
    $index = null;
    $stored = null;
    if ($mode === 'booked') {
        foreach ($roster as $i => $r) {
            if (isset($r['id']) && (string) $r['id'] === $rid) {
                $index = $i;
                $stored = $r;
                break;
            }
        }
        if ($stored === null) {
            easy_checkin_message_page('Your booking changed', 'Your booking is no longer on the class list. Please speak to your instructor, or use the walk-in option.', 400);
        }
    } else {
        // The record id format matches what the roster sanitizer assigns,
        // so the signature file can be named before the record exists.
        $rid = 'r_' . wp_generate_uuid4();
        $stored = array();
    }

    $old = array(
        'name' => $post('ci_name'),
        'employer' => $post('ci_employer'),
        'phone' => $post('ci_phone'),
        'email' => $post('ci_email'),
        'emergency_name' => $post('ci_emergency_name'),
        'emergency_phone' => $post('ci_emergency_phone'),
        'recert_expiry' => $post('ci_recert_expiry'),
        'id_last4' => $post('ci_id_last4'),
        'dob' => $post('ci_dob'),
    );
    $fail = function ($msg) use ($event_id, $rec, $facts, $self_url, $mode, $stored, $old) {
        easy_checkin_render_confirm($event_id, $rec, $facts, $self_url, $mode === 'walkin' ? null : $stored, $old, $msg);
        exit;
    };

    if ($old['name'] === '') {
        $fail('Please enter your name the way it should appear on your certificate.');
    }
    if ($mode === 'walkin') {
        if ($old['phone'] === '' || $old['email'] === '' || !is_email($old['email'])) {
            $fail('Please enter your phone number and a valid email so the office can reach you about this class.');
        }
    }
    if (!empty($rec['toggles']['emergency']) && ($old['emergency_name'] === '' || $old['emergency_phone'] === '')) {
        $fail('Please add an emergency contact name and phone number.');
    }
    if (!empty($rec['toggles']['recert']) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $old['recert_expiry'])) {
        $fail('Please enter the expiry date on your current certificate.');
    }
    if (!empty($rec['toggles']['id_dob'])) {
        if (!preg_match('/^[0-9]{4}$/', $old['id_last4'])) {
            $fail('Please enter the last 4 digits of your ID.');
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $old['dob'])) {
            $fail('Please enter your date of birth.');
        }
    }

    // Merge onto the stored record so payment, notes, source and order
    // details from the booking survive untouched.
    $new = $stored;
    $new['id'] = $rid;
    $new['name'] = $old['name'];
    $new['employer'] = $old['employer'];
    if ($mode === 'walkin') {
        $new['phone'] = $old['phone'];
        $new['email'] = $old['email'];
        $new['payment'] = '';
        $new['source'] = 'manual';
    }
    if (!empty($rec['toggles']['emergency'])) {
        $new['emergency_name'] = $old['emergency_name'];
        $new['emergency_phone'] = $old['emergency_phone'];
    }
    if (!empty($rec['toggles']['recert'])) {
        $new['recert_expiry'] = $old['recert_expiry'];
    }
    if (!empty($rec['toggles']['id_dob'])) {
        $new['id_last4'] = $old['id_last4'];
        $new['dob'] = $old['dob'];
    }

    // A name that differs from the booked name is exactly what must not
    // silently reach a certificate, so it is flagged for the instructor.
    $name_changed = $mode === 'booked'
        && strtolower(trim((string) $stored['name'])) !== strtolower(trim($old['name']));
    $new['checkin_status'] = ($mode === 'walkin' || $name_changed) ? 'needs_review' : 'checked_in';
    $new['checkin_source'] = $mode === 'walkin' ? 'walkin' : 'qr';
    $new['checkin_at'] = time();
    $days = isset($stored['attendance_days']) && is_array($stored['attendance_days']) ? $stored['attendance_days'] : array();
    $today = function_exists('wp_date') ? wp_date('Y-m-d') : date_i18n('Y-m-d');
    $days[$today] = true;
    $new['attendance_days'] = $days;

    if (!empty($rec['toggles']['waiver'])) {
        if (empty($_POST['ci_agree'])) {
            $fail('Please read the waiver and tick the "I agree" box.');
        }
        $sig_data = isset($_POST['ci_signature']) ? (string) wp_unslash($_POST['ci_signature']) : '';
        if ($sig_data === '') {
            $fail('Please sign in the signature box.');
        }
        $waiver = easy_checkin_waiver($rec['waiver_type']);
        $sig_ref = easy_checkin_save_signature($event_id, $rid, $sig_data);
        if ($sig_ref === '') {
            $fail('Your signature could not be saved. Please sign again and resubmit.');
        }
        $new['waiver_signature'] = $sig_ref;
        $new['waiver_version'] = $waiver['version'];
        $new['waiver_text_hash'] = hash('sha256', $waiver['text']);
        $new['waiver_signed_at'] = time();
    }

    if ($mode === 'walkin') {
        $roster[] = $new;
    } else {
        $roster[$index] = $new;
    }
    $saved = easy_roster_set($event_id, $roster, 0);
    if (is_wp_error($saved)) {
        easy_checkin_message_page('Something went wrong', 'Your check-in could not be saved. Please show this screen to your instructor so they can check you in another way.');
    }
    easy_checkin_render_done($facts, $new);
}

function easy_checkin_render_done($facts, $record) {
    status_header(200);
    easy_checkin_page_head('Checked in');
    $first = '';
    if (!empty($record['name'])) {
        $parts = preg_split('/\s+/', trim((string) $record['name']));
        $first = $parts[0];
    }
    echo '<div class="done">';
    echo '<div class="check" aria-hidden="true">&#10003;</div>';
    echo '<h1>You are checked in' . ($first !== '' ? ', ' . esc_html($first) : '') . '.</h1>';
    echo '<p><strong>' . esc_html($facts['title']) . '</strong></p>';
    if (($record['checkin_status'] ?? '') === 'needs_review') {
        echo '<p>Your instructor will confirm your details at the start of class. Please keep this screen handy.</p>';
    } else {
        echo '<p>Show this screen to your instructor. You are all set.</p>';
    }
    echo '</div>';
    easy_checkin_page_foot();
    exit;
}

/* ==========================================================================
 * Admin: the event check-in box, lifecycle actions, print pack
 * ========================================================================== */

add_action('admin_enqueue_scripts', function ($hook) {
    if (($hook === 'post.php' || $hook === 'post-new.php') && get_post_type() === 'tribe_events') {
        wp_enqueue_script(
            'easy-checkin-qrcode',
            plugin_dir_url(EASY_SUITE_FILE) . 'includes/assets/qrcode.js',
            array(),
            '1.4.4',
            true
        );
    }
});

/** The just-minted plaintext token for this admin user, shown once (15 minutes). */
function easy_checkin_fresh_token($event_id) {
    $t = get_transient('easy_checkin_token_' . (int) $event_id . '_' . get_current_user_id());
    return is_string($t) && preg_match('/^[a-f0-9]{64}$/', $t) ? $t : '';
}

add_action('add_meta_boxes_tribe_events', function () {
    add_meta_box(
        'easy-checkin',
        'Class check-in',
        'easy_checkin_metabox',
        'tribe_events',
        'side',
        'default'
    );
});

function easy_checkin_metabox($post) {
    $event_id = (int) $post->ID;
    $rec = easy_checkin_record($event_id);
    wp_nonce_field('easy_checkin_box', 'easy_checkin_nonce');
    echo '<input type="hidden" name="easy_checkin_present" value="1">';

    $msg = isset($_GET['easy_checkin_msg']) ? sanitize_key(wp_unslash($_GET['easy_checkin_msg'])) : '';
    $notices = array(
        'created' => 'Check-in link created. Download or print the QR code now: for security, the full link is only shown right after it is created.',
        'regenerated' => 'New check-in link created. The old link and old code no longer work. Download or print the new QR code now.',
        'closed' => 'Check-in is closed for this class.',
    );
    if (isset($notices[$msg])) {
        echo '<div class="notice notice-success inline"><p>' . esc_html($notices[$msg]) . '</p></div>';
    }

    $fresh = easy_checkin_fresh_token($event_id);
    $qr_url = $fresh !== '' ? easy_checkin_token_url($fresh)
        : ($rec['short_code'] !== '' ? easy_checkin_code_url($rec['short_code']) : '');
    $expires_txt = $rec['expires'] > 0
        ? (function_exists('wp_date') ? wp_date('M j, Y g:i A', $rec['expires']) : date_i18n('M j, Y g:i A', $rec['expires']))
        : '';

    if ($rec['status'] === 'none') {
        echo '<p>No check-in link yet for this class.</p>';
    } elseif ($rec['status'] === 'closed') {
        echo '<p><strong>Check-in is closed.</strong></p>';
    } else {
        echo '<p><strong>Check-in is open.</strong>'
            . ($expires_txt !== '' ? ' The link works until ' . esc_html($expires_txt) . '.' : '') . '</p>';
    }

    if ($qr_url !== '' && $rec['status'] === 'open') {
        echo '<div style="text-align:center;">'
            . '<canvas id="easy-ci-qr" width="220" height="220" style="width:220px;height:220px;" aria-label="Check-in QR code"></canvas>'
            . '</div>';
        echo '<p style="text-align:center;font-size:20px;letter-spacing:2px;"><strong>' . esc_html($rec['short_code']) . '</strong></p>';
        echo '<p class="description" style="text-align:center;">If a phone camera fails, the student types '
            . esc_html(str_replace(home_url('/'), '', easy_checkin_code_url($rec['short_code']))) . ' in their browser.</p>';
        echo '<p><label for="easy_ci_url"><strong>Check-in link</strong></label></p>';
        echo '<p><input type="text" id="easy_ci_url" class="widefat" readonly value="' . esc_attr($qr_url) . '"></p>';
        if ($fresh === '') {
            echo '<p class="description">This is the short-code link. The full link from the QR code at creation time is not stored anywhere, by design. Use "Make a new link" below if you need the full link again.</p>';
        }
        echo '<p>'
            . '<button type="button" class="button" id="easy-ci-download">Download QR code</button> '
            . '<a class="button" target="_blank" rel="noopener" href="' . esc_url(wp_nonce_url(
                admin_url('admin-post.php?action=easy_checkin_print&event_id=' . $event_id),
                'easy_checkin_print_' . $event_id
            )) . '">Print sign-in pack</a></p>';
        echo '<script>(function(){'
            . 'if(typeof qrcode==="undefined")return;'
            . 'var qr=qrcode(0,"M");qr.addData(' . wp_json_encode($qr_url) . ');qr.make();'
            . 'var c=document.getElementById("easy-ci-qr"),x=c.getContext("2d"),n=qr.getModuleCount(),cell=Math.floor(220/n),off=Math.floor((220-cell*n)/2);'
            . 'x.fillStyle="#fff";x.fillRect(0,0,220,220);x.fillStyle="#000";'
            . 'for(var r=0;r<n;r++)for(var col=0;col<n;col++)if(qr.isDark(r,col))x.fillRect(off+col*cell,off+r*cell,cell,cell);'
            . 'document.getElementById("easy-ci-download").addEventListener("click",function(){'
            . 'var a=document.createElement("a");a.download="check-in-qr.png";a.href=c.toDataURL("image/png");a.click();});'
            . '})();</script>';
    }

    // Lifecycle buttons. These run through admin-post so they never sit
    // inside the event edit form itself.
    $mk = function ($action, $label, $confirm = '') use ($event_id) {
        $url = wp_nonce_url(
            admin_url('admin-post.php?action=easy_checkin_' . $action . '&event_id=' . $event_id),
            'easy_checkin_' . $action . '_' . $event_id
        );
        $onclick = $confirm !== '' ? ' onclick="return confirm(' . esc_attr(wp_json_encode($confirm)) . ');"' : '';
        return '<a class="button" href="' . esc_url($url) . '"' . $onclick . '>' . esc_html($label) . '</a> ';
    };
    echo '<p>';
    if ($rec['status'] === 'none') {
        echo $mk('create', 'Create check-in link');
    } elseif ($rec['status'] === 'open') {
        echo $mk('regenerate', 'Make a new link', 'The current link and code will stop working right away. Make a new one?');
        echo $mk('close', 'Close check-in', 'Students will no longer be able to check in for this class. Close check-in?');
    } else {
        echo $mk('regenerate', 'Reopen with a new link', 'This makes a fresh link and code and opens check-in again. Continue?');
    }
    echo '</p>';

    if (!empty($rec['toggles']['waiver']) && !easy_checkin_waiver_ready($rec['waiver_type'])) {
        echo '<p style="color:#d63638;"><strong>The check-in page is not open yet:</strong> no '
            . esc_html($rec['waiver_type']) . ' waiver text has been saved. Add it under '
            . '<a href="' . esc_url(admin_url('admin.php?page=easy-suite-checkin')) . '">EASY Suite, Class check-in</a>. '
            . 'Students will see a "not open yet" message until then.</p>';
    }

    // Per-class choices, saved with the event like the seat product box.
    echo '<hr><p><label for="easy_ci_waiver_type"><strong>Waiver for this class</strong></label></p>';
    echo '<p><select id="easy_ci_waiver_type" name="easy_ci_waiver_type" class="widefat">'
        . '<option value="classroom"' . selected($rec['waiver_type'], 'classroom', false) . '>Classroom waiver</option>'
        . '<option value="practical"' . selected($rec['waiver_type'], 'practical', false) . '>Practical training waiver</option>'
        . '</select></p>';
    $toggle = function ($key, $label, $desc) use ($rec) {
        echo '<p><label><input type="checkbox" name="easy_ci_toggle_' . esc_attr($key) . '" value="1"'
            . checked(!empty($rec['toggles'][$key]), true, false) . '> ' . esc_html($label) . '</label>';
        if ($desc !== '') {
            echo '<br><span class="description">' . esc_html($desc) . '</span>';
        }
        echo '</p>';
    };
    $toggle('emergency', 'Emergency contact required', 'Recommended on for in-person classes.');
    $toggle('waiver', 'Waiver and signature', 'Students read the waiver and sign on their phone.');
    $toggle('recert', 'Ask for current certificate expiry', 'Only for recertification classes.');
    $toggle('id_dob', 'Check ID (last 4 digits and birth date)', 'Leave off unless this class requires ID. Off is the normal setting.');
    echo '<p class="description">These choices save when you save the class (Update button).</p>';

    // Who has checked in, read from the roster the students land on.
    if (function_exists('easy_roster_get')) {
        $checked = array();
        $review = array();
        foreach (easy_roster_get($event_id) as $r) {
            $st = isset($r['checkin_status']) ? (string) $r['checkin_status'] : '';
            if ($st === 'checked_in' || $st === 'manual') {
                $checked[] = $r;
            } elseif ($st === 'needs_review') {
                $review[] = $r;
            }
        }
        if ($checked || $review) {
            echo '<hr><p><strong>' . count($checked) . ' checked in'
                . ($review ? ', ' . count($review) . ' to review' : '') . '</strong></p>';
            echo '<ul style="margin-top:0;">';
            foreach (array_merge($review, $checked) as $r) {
                $needs = ($r['checkin_status'] ?? '') === 'needs_review';
                echo '<li>' . ($needs ? '<strong>Review:</strong> ' : '') . esc_html((string) $r['name']);
                if (!empty($r['checkin_at'])) {
                    echo ' <span class="description">(' . esc_html(function_exists('wp_date') ? wp_date('g:i A', (int) $r['checkin_at']) : date_i18n('g:i A', (int) $r['checkin_at'])) . ')</span>';
                }
                if (!empty($r['waiver_signature'])) {
                    echo ' <a href="' . esc_url(easy_checkin_signature_url($r['waiver_signature'])) . '" target="_blank" rel="noopener">signature</a>';
                }
                echo '</li>';
            }
            echo '</ul>';
        }
    }
}

/* Toggles + waiver choice save with the event (same pattern as the seat product box). */
add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }
    if (empty($_POST['easy_checkin_present'])
        || !isset($_POST['easy_checkin_nonce'])
        || !wp_verify_nonce(sanitize_key(wp_unslash($_POST['easy_checkin_nonce'])), 'easy_checkin_box')) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }
    $rec = easy_checkin_record($post_id);
    $rec['waiver_type'] = isset($_POST['easy_ci_waiver_type']) && $_POST['easy_ci_waiver_type'] === 'practical' ? 'practical' : 'classroom';
    foreach (array('emergency', 'waiver', 'recert', 'id_dob') as $key) {
        $rec['toggles'][$key] = !empty($_POST['easy_ci_toggle_' . $key]);
    }
    easy_checkin_save_record($post_id, $rec);
}, 10, 3);

/* ---------- lifecycle actions ---------- */

function easy_checkin_admin_action($action) {
    $event_id = isset($_GET['event_id']) ? (int) $_GET['event_id'] : 0;
    if ($event_id <= 0 || get_post_type($event_id) !== 'tribe_events'
        || !current_user_can('edit_post', $event_id)
        || !check_admin_referer('easy_checkin_' . $action . '_' . $event_id)) {
        wp_die(esc_html__('Not allowed.', 'easy-suite'), 403);
    }
    return $event_id;
}

function easy_checkin_back_to_event($event_id, $msg) {
    wp_redirect(add_query_arg('easy_checkin_msg', $msg, get_edit_post_link($event_id, 'raw')));
    exit;
}

add_action('admin_post_easy_checkin_create', function () {
    $event_id = easy_checkin_admin_action('create');
    $token = easy_checkin_mint($event_id, false);
    if ($token !== '') {
        set_transient('easy_checkin_token_' . $event_id . '_' . get_current_user_id(), $token, 15 * MINUTE_IN_SECONDS);
    }
    easy_checkin_back_to_event($event_id, 'created');
});

add_action('admin_post_easy_checkin_regenerate', function () {
    $event_id = easy_checkin_admin_action('regenerate');
    $token = easy_checkin_mint($event_id, true);
    if ($token !== '') {
        set_transient('easy_checkin_token_' . $event_id . '_' . get_current_user_id(), $token, 15 * MINUTE_IN_SECONDS);
    }
    easy_checkin_back_to_event($event_id, 'regenerated');
});

add_action('admin_post_easy_checkin_close', function () {
    $event_id = easy_checkin_admin_action('close');
    easy_checkin_close($event_id);
    easy_checkin_back_to_event($event_id, 'closed');
});

/* ---------- print sign-in pack ---------- */

add_action('admin_post_easy_checkin_print', function () {
    $event_id = easy_checkin_admin_action('print');
    $rec = easy_checkin_record($event_id);
    $facts = easy_checkin_class_facts($event_id);
    $fresh = easy_checkin_fresh_token($event_id);
    $qr_url = $fresh !== '' ? easy_checkin_token_url($fresh)
        : ($rec['short_code'] !== '' ? easy_checkin_code_url($rec['short_code']) : home_url('/'));
    $typed = str_replace(array('https://', 'http://'), '', $qr_url);
    $roster = function_exists('easy_roster_get') ? easy_roster_get($event_id) : array();

    nocache_headers();
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sign-in pack - '
        . esc_html($facts['title']) . '</title><style>'
        . 'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#000;margin:2rem;}'
        . '.tent{text-align:center;page-break-after:always;}'
        . '.tent h1{font-size:2rem;margin:.5rem 0;}'
        . '.tent .code{font-size:1.8rem;letter-spacing:3px;font-weight:700;}'
        . '.tent .url{font-size:1.2rem;}'
        . 'table{width:100%;border-collapse:collapse;}'
        . 'th,td{border:1px solid #666;padding:.55rem .5rem;text-align:left;font-size:.95rem;}'
        . 'td.sig{width:28%;} td.emg{width:30%;}'
        . '.noprint{margin-bottom:1.5rem;}'
        . '@media print{.noprint{display:none;} body{margin:1rem;}}'
        . '</style></head><body>';
    echo '<p class="noprint"><button onclick="window.print()" style="font-size:1.1rem;padding:.6rem 1.2rem;">Print this pack</button> '
        . 'Page 1 is the tent card for the door or table. Page 2 is the paper sign-in sheet, the backup for dead phones and rooms with no signal.</p>';

    echo '<section class="tent">';
    echo '<p>EASY Safety Training</p>';
    echo '<h1>' . esc_html($facts['title']) . '</h1>';
    if ($facts['when'] !== '') {
        echo '<p>' . esc_html($facts['when']) . '</p>';
    }
    if ($facts['instructor'] !== '') {
        echo '<p>Instructor: ' . esc_html($facts['instructor']) . '</p>';
    }
    echo '<h2>Please scan and check in</h2>';
    echo '<canvas id="pack-qr" width="360" height="360" style="width:360px;height:360px;"></canvas>';
    if ($rec['short_code'] !== '') {
        echo '<p>No camera? Type <strong>' . esc_html(str_replace(home_url('/'), '', easy_checkin_code_url($rec['short_code']))) . '</strong> in your phone browser.</p>';
    }
    echo '<p class="url">' . esc_html($typed) . '</p>';
    echo '</section>';

    echo '<section>';
    echo '<h2 style="text-align:center;">Sign-in sheet: ' . esc_html($facts['title']) . '</h2>';
    if ($facts['when'] !== '') {
        echo '<p style="text-align:center;">' . esc_html($facts['when'])
            . ($facts['instructor'] !== '' ? ' - Instructor: ' . esc_html($facts['instructor']) : '') . '</p>';
    }
    echo '<table><thead><tr><th style="width:4%;">#</th><th>Name (printed)</th><th class="sig">Signature</th><th class="emg">Emergency contact (name and phone)</th></tr></thead><tbody>';
    $rows = max(12, count($roster));
    for ($i = 0; $i < $rows; $i++) {
        $name = isset($roster[$i]['name']) ? (string) $roster[$i]['name'] : '';
        echo '<tr><td>' . (int) ($i + 1) . '</td><td>' . esc_html($name) . '</td><td class="sig">&nbsp;</td><td class="emg">&nbsp;</td></tr>';
    }
    echo '</tbody></table></section>';

    $lib = plugin_dir_path(EASY_SUITE_FILE) . 'includes/assets/qrcode.js';
    if (is_readable($lib)) {
        echo '<script>' . file_get_contents($lib) . '</script>';
        echo '<script>(function(){if(typeof qrcode==="undefined")return;'
            . 'var qr=qrcode(0,"M");qr.addData(' . wp_json_encode($qr_url) . ');qr.make();'
            . 'var c=document.getElementById("pack-qr"),x=c.getContext("2d"),n=qr.getModuleCount(),cell=Math.floor(360/n),off=Math.floor((360-cell*n)/2);'
            . 'x.fillStyle="#fff";x.fillRect(0,0,360,360);x.fillStyle="#000";'
            . 'for(var r=0;r<n;r++)for(var col=0;col<n;col++)if(qr.isDark(r,col))x.fillRect(off+col*cell,off+r*cell,cell,cell);'
            . '})();</script>';
    }
    echo '</body></html>';
    exit;
});

/* ---------- waiver texts settings page ---------- */

add_action('admin_menu', function () {
    add_submenu_page(
        'easy-suite',
        'EASY Suite class check-in',
        'Class check-in',
        'manage_options',
        'easy-suite-checkin',
        'easy_checkin_settings_page'
    );
}, 20);

function easy_checkin_settings_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }
    if (isset($_POST['easy_checkin_waivers_nonce'])
        && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['easy_checkin_waivers_nonce'])), 'easy_checkin_save_waivers')) {
        foreach (array('classroom', 'practical') as $type) {
            $text = isset($_POST['easy_ci_waiver_' . $type]) ? sanitize_textarea_field(wp_unslash($_POST['easy_ci_waiver_' . $type])) : '';
            $version = isset($_POST['easy_ci_waiver_' . $type . '_version']) ? sanitize_text_field(wp_unslash($_POST['easy_ci_waiver_' . $type . '_version'])) : '';
            update_option('easy_checkin_waiver_' . $type, $text, false);
            update_option('easy_checkin_waiver_' . $type . '_version', $version, false);
        }
        echo '<div class="notice notice-success is-dismissible"><p><strong>Waiver texts saved.</strong> Classes using a waiver go live for check-in as soon as their text is here.</p></div>';
    }
    echo '<div class="wrap" style="max-width:820px;"><h1>Class check-in: waiver texts</h1>';
    echo '<p>Students read and sign the waiver for their class on their phone when they check in. '
        . 'There are two texts: one for classroom courses and one for practical (hands-on) training. '
        . 'Each class picks which one it uses in the Class check-in box on the class edit screen.</p>';
    echo '<p><strong>Until a text is saved here, the check-in page for classes using that waiver stays closed</strong> '
        . 'and tells students to check in with their instructor. Changing a text later never changes what earlier students signed: '
        . 'the version label and the exact text are recorded with every signature.</p>';
    echo '<p>Give each text a version label (for example "October 2026") and bump it whenever the wording changes, so a signature can always be tied to the words that were shown.</p>';
    echo '<form method="post" action="">';
    wp_nonce_field('easy_checkin_save_waivers', 'easy_checkin_waivers_nonce');
    foreach (array('classroom' => 'Classroom waiver', 'practical' => 'Practical training waiver') as $type => $label) {
        $w = easy_checkin_waiver($type);
        echo '<h2>' . esc_html($label) . '</h2>';
        echo '<p><label for="easy_ci_waiver_' . esc_attr($type) . '_version"><strong>Version label</strong></label><br>'
            . '<input type="text" class="regular-text" id="easy_ci_waiver_' . esc_attr($type) . '_version" name="easy_ci_waiver_' . esc_attr($type) . '_version" value="' . esc_attr($w['version']) . '" placeholder="e.g. October 2026"></p>';
        echo '<p><label for="easy_ci_waiver_' . esc_attr($type) . '"><strong>Waiver text</strong></label><br>'
            . '<textarea class="large-text" rows="14" id="easy_ci_waiver_' . esc_attr($type) . '" name="easy_ci_waiver_' . esc_attr($type) . '">' . esc_textarea($w['text']) . '</textarea></p>';
        if (trim($w['text']) !== '') {
            echo '<p class="description">Saved text fingerprint: ' . esc_html(substr(hash('sha256', $w['text']), 0, 12)) . ' (recorded with each signature as proof of the exact wording).</p>';
        } else {
            echo '<p class="description">No text saved yet. Classes using this waiver cannot check in online.</p>';
        }
    }
    echo '<p><button type="submit" class="button button-primary">Save waiver texts</button></p>';
    echo '</form></div>';
}
