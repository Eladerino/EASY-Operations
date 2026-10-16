<?php
/**
 * Online courses: license keys (slice 1 of the online-courses plan).
 *
 * Every seat on an online course is a single-use key such as
 * EASY-7K2P-9QXA-4MZD: 12 characters from 31 symbols that can't be misread
 * (2-9, and A-Z without I, L and O), drawn from random_int(). Redeeming a
 * key claims it for the learner's account and opens an enrollment pinned to
 * the course's approved Course Builder version.
 *
 * Tables (created and upgraded here, see EASY_LICENSES_DB):
 *   {prefix}easy_licenses     one row per key. The code is stored without the
 *                             EASY- prefix and dashes, under a unique index.
 *   {prefix}easy_enrollments  one row per learner per redeemed key. open_slot
 *                             is 1 while the enrollment is open and NULL
 *                             otherwise, so a unique index on (user_id,
 *                             course, open_slot) lets the database itself
 *                             refuse a second open enrollment in a course.
 *   {prefix}easy_progress     finished chapters and quiz attempts, written by
 *                             the course player (slice 3).
 *
 * Times are stored in UTC. Statuses:
 *   key         issued | redeemed | revoked | expired
 *   enrollment  active | theory_complete | practical_booked | completed |
 *               expired | suspended
 *
 * Rules:
 *   - an unused key expires N months after it was issued (Settings, default
 *     12, decision 4);
 *   - access lasts N days from redemption (Settings, default 0 = no limit
 *     until EASY settles decision 3);
 *   - a revoked key can't be redeemed; revoking a redeemed key suspends its
 *     enrollment unless the course was already completed;
 *   - a learner with an open enrollment in a course can't use a second key
 *     for it, so the key stays free for a coworker;
 *   - failed tries are capped at 10 per account per hour.
 *
 * Routes (easy/v1/...):
 *   POST learn/redeem {key}                     signed-in learner
 *   GET  learn/my-courses                       signed-in learner
 *   GET  licenses ?search&status&course&batch&page          office
 *   POST licenses {course, quantity, buyerName, buyerEmail, company,
 *                  supervisorEmail, note, sendEmail}         office
 *   POST licenses/<id>/revoke|restore|resend {email?}       office
 *   POST licenses/batch/<batch>/resend {email?}             office
 *   GET  enrollments ?search&status&course&page             office
 *   POST enrollments/<id>/extend {days}                     office
 * Office means the Course Builder reviewer rule: admins, anyone who can
 * publish certificates, and the extra reviewers listed in Settings.
 */

defined('ABSPATH') || exit;

define('EASY_LICENSES_DB', 1);
define('EASY_KEY_ALPHABET', '23456789ABCDEFGHJKMNPQRSTUVWXYZ');
define('EASY_KEY_LENGTH', 12);
define('EASY_LICENSES_CRON', 'easy_licenses_daily');
define('EASY_LICENSES_TZ', 'America/St_Johns');
define('EASY_LICENSES_MAX_ISSUE', 200);
define('EASY_REDEEM_MAX_FAILS', 10);
define('EASY_ENROLLMENT_OPEN', ['active', 'theory_complete', 'practical_booked']);

/* ---------------- tables ---------------- */

function easy_licenses_table($name) {
    global $wpdb;
    return $wpdb->prefix . 'easy_' . $name;
}

function easy_licenses_schema() {
    global $wpdb;
    $collate = $wpdb->get_charset_collate();
    $l = easy_licenses_table('licenses');
    $e = easy_licenses_table('enrollments');
    $p = easy_licenses_table('progress');
    // dbDelta format: one column per line, two spaces after PRIMARY KEY.
    return [
        "CREATE TABLE $l (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code char(12) NOT NULL,
  course varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'issued',
  batch varchar(32) NOT NULL DEFAULT '',
  source varchar(16) NOT NULL DEFAULT 'office',
  product_id bigint(20) unsigned NOT NULL DEFAULT 0,
  order_id bigint(20) unsigned NOT NULL DEFAULT 0,
  order_item_id bigint(20) unsigned NOT NULL DEFAULT 0,
  buyer_id bigint(20) unsigned NOT NULL DEFAULT 0,
  buyer_name varchar(190) NOT NULL DEFAULT '',
  buyer_email varchar(190) NOT NULL DEFAULT '',
  company varchar(190) NOT NULL DEFAULT '',
  supervisor_email varchar(190) NOT NULL DEFAULT '',
  issued_by bigint(20) unsigned NOT NULL DEFAULT 0,
  issued_at datetime NOT NULL,
  expires_at datetime NOT NULL,
  redeemed_by bigint(20) unsigned NOT NULL DEFAULT 0,
  redeemed_at datetime DEFAULT NULL,
  revoked_by bigint(20) unsigned NOT NULL DEFAULT 0,
  revoked_at datetime DEFAULT NULL,
  emailed_at datetime DEFAULT NULL,
  note text,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code),
  KEY course_status (course,status),
  KEY status_expires (status,expires_at),
  KEY batch (batch),
  KEY order_id (order_id),
  KEY buyer_email (buyer_email),
  KEY redeemed_by (redeemed_by)
) $collate;",
        "CREATE TABLE $e (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  course varchar(64) NOT NULL,
  course_version int(10) unsigned NOT NULL DEFAULT 0,
  license_id bigint(20) unsigned NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',
  open_slot tinyint(1) unsigned DEFAULT 1,
  suspended_from varchar(20) NOT NULL DEFAULT '',
  progress tinyint(3) unsigned NOT NULL DEFAULT 0,
  cert_name varchar(190) NOT NULL DEFAULT '',
  started_at datetime NOT NULL,
  last_active_at datetime DEFAULT NULL,
  access_until datetime DEFAULT NULL,
  completed_at datetime DEFAULT NULL,
  cert_post_id bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY one_open (user_id,course,open_slot),
  KEY license_id (license_id),
  KEY course_status (course,status),
  KEY status_access (status,access_until)
) $collate;",
        "CREATE TABLE $p (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  enrollment_id bigint(20) unsigned NOT NULL,
  item varchar(64) NOT NULL,
  kind varchar(16) NOT NULL,
  score smallint(5) unsigned DEFAULT NULL,
  attempt smallint(5) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY enrollment_item (enrollment_id,item)
) $collate;",
    ];
}

function easy_licenses_tables_exist() {
    global $wpdb;
    foreach (['licenses', 'enrollments', 'progress'] as $name) {
        $table = easy_licenses_table($name);
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
            return false;
        }
    }
    return true;
}

/** True once the tables are installed at the current schema version. */
function easy_licenses_ready() {
    return (int) get_option('easy_licenses_db') === EASY_LICENSES_DB;
}

/**
 * Create or upgrade the tables when the stored schema version differs.
 * dbDelta only adds what is missing, so running it twice is harmless; a
 * failure is retried at most every ten minutes.
 */
function easy_licenses_install() {
    if (easy_licenses_ready() || get_transient('easy_licenses_db_failed')) {
        return easy_licenses_ready();
    }
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta(easy_licenses_schema());
    if (!easy_licenses_tables_exist()) {
        global $wpdb;
        set_transient('easy_licenses_db_failed', $wpdb->last_error ?: 'The tables were not created.', 10 * MINUTE_IN_SECONDS);
        return false;
    }
    update_option('easy_licenses_db', EASY_LICENSES_DB, true);
    delete_transient('easy_licenses_db_failed');
    return true;
}
add_action('init', 'easy_licenses_install', 5);

function easy_licenses_not_ready_error() {
    return new WP_Error('easy_licenses_not_ready', 'Online course keys are not set up on the site yet. EASY Suite → Overview shows why.', ['status' => 503]);
}

/* ---------------- settings ---------------- */

/** Months before an unused key expires (decision 4: 12). */
function easy_licenses_key_months() {
    $months = (int) get_option('easy_license_key_months', 12);
    return ($months >= 1 && $months <= 60) ? $months : 12;
}

/** Days of access after redeeming; 0 means no limit (decision 3 is still open). */
function easy_licenses_access_days() {
    $days = (int) get_option('easy_license_access_days', 0);
    return ($days >= 0 && $days <= 3650) ? $days : 0;
}

/* ---------------- time ---------------- */

function easy_licenses_now() {
    return gmdate('Y-m-d H:i:s');
}

function easy_licenses_utc_plus($modify, $from = null) {
    $base = new DateTimeImmutable($from ? $from . ' UTC' : 'now', new DateTimeZone('UTC'));
    return $base->modify($modify)->format('Y-m-d H:i:s');
}

function easy_licenses_iso($utc) {
    return $utc ? gmdate('c', strtotime($utc . ' UTC')) : null;
}

/** "Oct 3" this year, "Oct 3, 2027" otherwise, in St. John's time. */
function easy_licenses_date($utc, $always_year = false) {
    if (!$utc) {
        return '';
    }
    $tz = new DateTimeZone(EASY_LICENSES_TZ);
    $ts = strtotime($utc . ' UTC');
    $same_year = wp_date('Y', $ts, $tz) === wp_date('Y', time(), $tz);
    return wp_date(($always_year || !$same_year) ? 'M j, Y' : 'M j', $ts, $tz);
}

/* ---------------- keys ---------------- */

function easy_key_generate() {
    $code = '';
    $max = strlen(EASY_KEY_ALPHABET) - 1;
    for ($i = 0; $i < EASY_KEY_LENGTH; $i++) {
        $code .= EASY_KEY_ALPHABET[random_int(0, $max)];
    }
    return $code;
}

function easy_key_format($code) {
    return 'EASY-' . implode('-', str_split((string) $code, 4));
}

/**
 * The stored code for whatever a learner typed: any case, with or without
 * dashes, spaces or the EASY- prefix. Empty string when it can't be a key.
 */
function easy_key_normalize($input) {
    $code = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) $input));
    if (strlen($code) === EASY_KEY_LENGTH + 4 && strpos($code, 'EASY') === 0) {
        $code = substr($code, 4);
    }
    if (strlen($code) !== EASY_KEY_LENGTH || strspn($code, EASY_KEY_ALPHABET) !== EASY_KEY_LENGTH) {
        return '';
    }
    return $code;
}

/* ---------------- people ---------------- */

/** Office staff: the Course Builder reviewer rule. */
function easy_licenses_can_manage($user = null) {
    if (function_exists('easy_course_is_reviewer')) {
        return easy_course_is_reviewer($user);
    }
    $user = $user ?: wp_get_current_user();
    return $user && $user->ID && user_can($user, 'manage_options');
}

function easy_licenses_rest_can_manage() {
    return is_user_logged_in() && easy_licenses_can_manage();
}

/** Name for a certificate, prefilled from the account. */
function easy_licenses_user_full_name(WP_User $user) {
    $name = trim($user->first_name . ' ' . $user->last_name);
    return $name !== '' ? $name : $user->display_name;
}

function easy_licenses_person($user_id) {
    $user = $user_id ? get_userdata((int) $user_id) : null;
    return $user ? ['id' => (int) $user->ID, 'name' => easy_licenses_user_full_name($user), 'email' => $user->user_email] : null;
}

/* ---------------- courses ---------------- */

/**
 * A Course Builder course as keys see it: id, title and approved version
 * (0 until a version is approved). The title is the approved version's
 * when there is one. Null when the course doesn't exist.
 */
function easy_licenses_course($cid) {
    static $cache = [];
    $cid = (string) $cid;
    if (array_key_exists($cid, $cache)) {
        return $cache[$cid];
    }
    $info = null;
    $post = function_exists('easy_course_post') && $cid !== '' ? easy_course_post($cid) : null;
    if ($post) {
        $version = (int) get_post_meta($post->ID, '_easy_course_approved_version', true);
        $title = $post->post_title;
        if ($version > 0 && function_exists('easy_course_final_package')) {
            $package = easy_course_final_package($post);
            if ($package && isset($package['course']->title) && is_string($package['course']->title) && $package['course']->title !== '') {
                $title = $package['course']->title;
            } elseif (!$package) {
                $version = 0; // The approved snapshot is gone; treat as not approved.
            }
        }
        $info = ['id' => $cid, 'title' => $title !== '' ? $title : 'Untitled course', 'version' => $version];
    }
    return $cache[$cid] = $info;
}

/** Every Course Builder course, approved ones first, then by title. */
function easy_licenses_courses() {
    if (!function_exists('easy_course_post')) {
        return [];
    }
    $out = [];
    $posts = get_posts([
        'post_type'        => 'easy_course',
        'post_status'      => 'private',
        'numberposts'      => -1,
        'orderby'          => 'title',
        'order'            => 'ASC',
        'suppress_filters' => true,
    ]);
    foreach ($posts as $post) {
        $info = easy_licenses_course($post->post_name);
        if ($info) {
            $out[$post->post_name] = $info;
        }
    }
    uasort($out, function ($a, $b) {
        return [($b['version'] > 0), strtolower($a['title'])] <=> [($a['version'] > 0), strtolower($b['title'])];
    });
    return $out;
}

function easy_licenses_course_title($cid) {
    $course = easy_licenses_course($cid);
    return $course ? $course['title'] : $cid;
}

/* ---------------- reading rows ---------------- */

function easy_licenses_get($id) {
    global $wpdb;
    $table = easy_licenses_table('licenses');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", (int) $id));
}

function easy_licenses_get_by_code($code) {
    global $wpdb;
    $table = easy_licenses_table('licenses');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE code = %s", (string) $code));
}

function easy_enrollment_get($id) {
    global $wpdb;
    $table = easy_licenses_table('enrollments');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", (int) $id));
}

/** Enrollments opened with a key, newest first. */
function easy_enrollments_for_license($license_id) {
    global $wpdb;
    $table = easy_licenses_table('enrollments');
    return $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE license_id = %d ORDER BY id DESC", (int) $license_id));
}

/** The learner's open enrollment in a course, if any. */
function easy_enrollment_open($user_id, $course) {
    global $wpdb;
    $table = easy_licenses_table('enrollments');
    return $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM $table WHERE user_id = %d AND course = %s AND open_slot = 1 ORDER BY id DESC LIMIT 1",
        (int) $user_id, (string) $course
    ));
}

/** A key's status with the clock applied: unused keys past their date read as expired before the daily job catches up. */
function easy_licenses_key_status($row) {
    if ($row->status === 'issued' && $row->expires_at <= easy_licenses_now()) {
        return 'expired';
    }
    return $row->status;
}

function easy_enrollment_status($row) {
    if ($row->status === 'active' && $row->access_until && $row->access_until <= easy_licenses_now()) {
        return 'expired';
    }
    return $row->status;
}

/** API shape of a key (office view). */
function easy_licenses_export_key($row) {
    return [
        'id'         => (int) $row->id,
        'key'        => easy_key_format($row->code),
        'course'     => $row->course,
        'courseTitle'=> easy_licenses_course_title($row->course),
        'status'     => easy_licenses_key_status($row),
        'batch'      => $row->batch,
        'source'     => $row->source,
        'orderId'    => (int) $row->order_id,
        'buyer'      => [
            'name'            => $row->buyer_name,
            'email'           => $row->buyer_email,
            'company'         => $row->company,
            'supervisorEmail' => $row->supervisor_email,
        ],
        'redeemedBy' => easy_licenses_person($row->redeemed_by),
        'issuedBy'   => easy_licenses_person($row->issued_by),
        'issuedAt'   => easy_licenses_iso($row->issued_at),
        'expiresAt'  => easy_licenses_iso($row->expires_at),
        'redeemedAt' => easy_licenses_iso($row->redeemed_at),
        'revokedAt'  => easy_licenses_iso($row->revoked_at),
        'emailedAt'  => easy_licenses_iso($row->emailed_at),
        'note'       => (string) $row->note,
    ];
}

/** API shape of an enrollment. The learner block is for the office only. */
function easy_enrollment_export($row, $with_learner = false) {
    $course = easy_licenses_course($row->course);
    $out = [
        'id'           => (int) $row->id,
        'course'       => $row->course,
        'courseTitle'  => $course ? $course['title'] : $row->course,
        'version'      => (int) $row->course_version,
        'status'       => easy_enrollment_status($row),
        'progress'     => (int) $row->progress,
        'certName'     => $row->cert_name,
        'startedAt'    => easy_licenses_iso($row->started_at),
        'lastActiveAt' => easy_licenses_iso($row->last_active_at),
        'accessUntil'  => easy_licenses_iso($row->access_until),
        'completedAt'  => easy_licenses_iso($row->completed_at),
        'certPostId'   => (int) $row->cert_post_id,
    ];
    if ($with_learner) {
        $out['learner'] = easy_licenses_person($row->user_id);
        $out['licenseId'] = (int) $row->license_id;
    }
    return $out;
}

/* ---------------- issuing ---------------- */

/**
 * Issue keys for one course. $args: course, quantity, buyer_name,
 * buyer_email, company, supervisor_email, note, source, order_id,
 * order_item_id, product_id, buyer_id, issued_by. Returns the new rows.
 */
function easy_licenses_issue(array $args) {
    global $wpdb;
    if (!easy_licenses_ready()) {
        return easy_licenses_not_ready_error();
    }
    $cid = strtolower(trim((string) ($args['course'] ?? '')));
    $course = preg_match('/^[a-z0-9_-]{1,64}$/', $cid) ? easy_licenses_course($cid) : null;
    if (!$course) {
        return new WP_Error('easy_key_no_course', 'Pick a course for the keys.', ['status' => 400]);
    }
    if ($course['version'] < 1) {
        return new WP_Error('easy_key_course_not_approved', '"' . $course['title'] . '" has no approved version yet. Approve it in the app\'s Course Builder before issuing keys.', ['status' => 400]);
    }
    $quantity = (int) ($args['quantity'] ?? 0);
    if ($quantity < 1 || $quantity > EASY_LICENSES_MAX_ISSUE) {
        return new WP_Error('easy_key_quantity', 'Issue between 1 and ' . EASY_LICENSES_MAX_ISSUE . ' keys at a time.', ['status' => 400]);
    }
    $buyer_email = sanitize_email((string) ($args['buyer_email'] ?? ''));
    if (!is_email($buyer_email)) {
        return new WP_Error('easy_key_email', 'Enter the buyer\'s email address. It\'s where the keys are sent and how the office finds them later.', ['status' => 400]);
    }
    $supervisor = sanitize_email((string) ($args['supervisor_email'] ?? ''));
    if (trim((string) ($args['supervisor_email'] ?? '')) !== '' && !is_email($supervisor)) {
        return new WP_Error('easy_key_supervisor', 'The supervisor email doesn\'t look right.', ['status' => 400]);
    }

    $now = easy_licenses_now();
    $base = [
        'course'           => $cid,
        'status'           => 'issued',
        'batch'            => bin2hex(random_bytes(8)),
        'source'           => in_array($args['source'] ?? '', ['office', 'shop'], true) ? $args['source'] : 'office',
        'product_id'       => (int) ($args['product_id'] ?? 0),
        'order_id'         => (int) ($args['order_id'] ?? 0),
        'order_item_id'    => (int) ($args['order_item_id'] ?? 0),
        'buyer_id'         => (int) ($args['buyer_id'] ?? 0),
        'buyer_name'       => mb_substr(sanitize_text_field((string) ($args['buyer_name'] ?? '')), 0, 190),
        'buyer_email'      => $buyer_email,
        'company'          => mb_substr(sanitize_text_field((string) ($args['company'] ?? '')), 0, 190),
        'supervisor_email' => $supervisor,
        'issued_by'        => (int) ($args['issued_by'] ?? get_current_user_id()),
        'issued_at'        => $now,
        'expires_at'       => easy_licenses_utc_plus('+' . easy_licenses_key_months() . ' months', $now),
        'note'             => mb_substr(sanitize_textarea_field((string) ($args['note'] ?? '')), 0, 2000),
    ];

    $table = easy_licenses_table('licenses');
    $ids = [];
    $wpdb->query('START TRANSACTION');
    for ($i = 0; $i < $quantity; $i++) {
        $inserted = false;
        // A clash with an existing code is astronomically unlikely; draw again if it happens.
        for ($try = 0; $try < 5 && !$inserted; $try++) {
            $inserted = (bool) $wpdb->insert($table, $base + ['code' => easy_key_generate()]);
        }
        if (!$inserted) {
            $error = $wpdb->last_error;
            $wpdb->query('ROLLBACK');
            if ($ids) {
                // Tables without transactions keep what was inserted; take those keys back out.
                $wpdb->query("DELETE FROM $table WHERE id IN (" . implode(',', array_map('intval', $ids)) . ")");
            }
            return new WP_Error('easy_key_insert', 'The keys could not be saved: ' . ($error ?: 'database error') . '.', ['status' => 500]);
        }
        $ids[] = (int) $wpdb->insert_id;
    }
    $wpdb->query('COMMIT');

    $rows = $wpdb->get_results("SELECT * FROM $table WHERE id IN (" . implode(',', $ids) . ") ORDER BY id ASC");
    do_action('easy_licenses_issued', $rows, $args);
    return $rows;
}

/* ---------------- redeeming ---------------- */

function easy_licenses_fail_count($user_id) {
    $log = get_transient('easy_redeem_fails_' . (int) $user_id);
    $since = time() - HOUR_IN_SECONDS;
    return is_array($log) ? count(array_filter($log, function ($t) use ($since) { return (int) $t > $since; })) : 0;
}

/** Record a failed try and return the error to show. */
function easy_licenses_fail($user_id, $code, $message, $status) {
    $key = 'easy_redeem_fails_' . (int) $user_id;
    $since = time() - HOUR_IN_SECONDS;
    $log = get_transient($key);
    $log = is_array($log) ? array_values(array_filter($log, function ($t) use ($since) { return (int) $t > $since; })) : [];
    $log[] = time();
    set_transient($key, $log, HOUR_IN_SECONDS);
    return new WP_Error($code, $message, ['status' => $status]);
}

/**
 * Why a key can't be redeemed by this learner right now, or null when it
 * can. Tries that probe someone else's key count towards the hourly cap.
 */
function easy_licenses_unavailable($row, $user_id) {
    $status = easy_licenses_key_status($row);
    if ($status === 'redeemed') {
        if ((int) $row->redeemed_by === (int) $user_id) {
            return new WP_Error('easy_key_yours', 'You\'ve already added this key. The course is in My Courses.', ['status' => 409]);
        }
        return easy_licenses_fail($user_id, 'easy_key_used', 'This key was already used on ' . easy_licenses_date($row->redeemed_at) . '.', 409);
    }
    if ($status === 'revoked') {
        return easy_licenses_fail($user_id, 'easy_key_revoked', 'This key has been cancelled. Contact EASY if you think that\'s a mistake.', 410);
    }
    if ($status === 'expired') {
        return easy_licenses_fail($user_id, 'easy_key_expired', 'This key expired on ' . easy_licenses_date($row->expires_at) . '.', 410);
    }
    return null;
}

/**
 * Redeem a key for a learner. The key is claimed with one conditional
 * UPDATE (only an unexpired, issued key matches), so exactly one account
 * can win it however many try at once. The enrollment insert then relies
 * on the one_open index, so a learner can't end up with two open
 * enrollments in a course either.
 */
function easy_licenses_redeem($user_id, $input) {
    global $wpdb;
    $user_id = (int) $user_id;
    if (!easy_licenses_ready()) {
        return easy_licenses_not_ready_error();
    }
    if ($user_id < 1 || !get_userdata($user_id)) {
        return new WP_Error('easy_key_login', 'Sign in to add a key to your account.', ['status' => 401]);
    }
    if (easy_licenses_fail_count($user_id) >= EASY_REDEEM_MAX_FAILS) {
        return new WP_Error('easy_key_rate_limited', 'Too many tries. Please wait an hour and try again, or contact EASY.', ['status' => 429]);
    }
    $code = easy_key_normalize($input);
    $row = $code !== '' ? easy_licenses_get_by_code($code) : null;
    if (!$row) {
        return easy_licenses_fail($user_id, 'easy_key_unknown', 'We don\'t recognise that key. Check it against your email: keys look like EASY-7K2P-9QXA-4MZD.', 404);
    }
    $error = easy_licenses_unavailable($row, $user_id);
    if ($error) {
        return $error;
    }
    $course = easy_licenses_course($row->course);
    if (!$course || $course['version'] < 1) {
        return new WP_Error('easy_key_course_closed', 'This course isn\'t open yet. Contact EASY and we\'ll sort it out.', ['status' => 409]);
    }
    if (easy_enrollment_open($user_id, $row->course)) {
        return new WP_Error('easy_key_already_enrolled', 'You already have ' . $course['title'] . ' in My Courses, so this key is still free for someone else.', ['status' => 409]);
    }

    $keys = easy_licenses_table('licenses');
    $enrollments = easy_licenses_table('enrollments');
    $now = easy_licenses_now();
    $days = easy_licenses_access_days();
    $user = get_userdata($user_id);

    $wpdb->query('START TRANSACTION');
    $claimed = $wpdb->query($wpdb->prepare(
        "UPDATE $keys SET status = 'redeemed', redeemed_by = %d, redeemed_at = %s WHERE id = %d AND status = 'issued' AND expires_at > %s",
        $user_id, $now, (int) $row->id, $now
    ));
    if ($claimed !== 1) {
        $wpdb->query('ROLLBACK');
        $fresh = easy_licenses_get($row->id);
        return ($fresh ? easy_licenses_unavailable($fresh, $user_id) : null)
            ?: new WP_Error('easy_key_busy', 'That key was just being used. Please try again.', ['status' => 409]);
    }
    $suppress = $wpdb->suppress_errors(true);
    $inserted = $wpdb->insert($enrollments, [
        'user_id'        => $user_id,
        'course'         => $row->course,
        'course_version' => $course['version'],
        'license_id'     => (int) $row->id,
        'status'         => 'active',
        'open_slot'      => 1,
        'cert_name'      => mb_substr(easy_licenses_user_full_name($user), 0, 190),
        'started_at'     => $now,
        'access_until'   => $days > 0 ? easy_licenses_utc_plus('+' . $days . ' days', $now) : null,
    ]);
    $wpdb->suppress_errors($suppress);
    if (!$inserted) {
        $wpdb->query('ROLLBACK');
        // Without transactions the claim above survived the rollback; give the key back.
        $wpdb->query($wpdb->prepare(
            "UPDATE $keys SET status = 'issued', redeemed_by = 0, redeemed_at = NULL WHERE id = %d AND redeemed_by = %d AND status = 'redeemed'",
            (int) $row->id, $user_id
        ));
        if (easy_enrollment_open($user_id, $row->course)) {
            return new WP_Error('easy_key_already_enrolled', 'You already have ' . $course['title'] . ' in My Courses, so this key is still free for someone else.', ['status' => 409]);
        }
        return new WP_Error('easy_key_enroll_failed', 'We couldn\'t open the course just now. Please try again.', ['status' => 500]);
    }
    $enrollment_id = (int) $wpdb->insert_id;
    $wpdb->query('COMMIT');

    do_action('easy_license_redeemed', $enrollment_id, (int) $row->id, $user_id);
    return easy_enrollment_get($enrollment_id);
}

/* ---------------- office actions ---------------- */

/**
 * Set an enrollment's status, keeping open_slot in step. Returns false when
 * reopening it would give the learner two open enrollments in the course.
 */
function easy_enrollment_set_status($row, $status, array $extra = []) {
    global $wpdb;
    $open = in_array($status, EASY_ENROLLMENT_OPEN, true);
    $suppress = $wpdb->suppress_errors(true);
    $done = $wpdb->update(
        easy_licenses_table('enrollments'),
        ['status' => $status, 'open_slot' => $open ? 1 : null] + $extra,
        ['id' => (int) $row->id]
    );
    $wpdb->suppress_errors($suppress);
    return $done !== false;
}

/** Revoke a key. A redeemed key's enrollment is suspended unless already completed. */
function easy_licenses_revoke($id, $note = '') {
    global $wpdb;
    $row = easy_licenses_get($id);
    if (!$row) {
        return new WP_Error('easy_key_missing', 'That key doesn\'t exist.', ['status' => 404]);
    }
    if ($row->status === 'revoked') {
        return new WP_Error('easy_key_already_revoked', 'That key is already revoked.', ['status' => 409]);
    }
    $note = sanitize_textarea_field((string) $note);
    $wpdb->update(easy_licenses_table('licenses'), [
        'status'     => 'revoked',
        'revoked_at' => easy_licenses_now(),
        'revoked_by' => get_current_user_id(),
        'note'       => trim($row->note . ($note !== '' ? "\n" . 'Revoked: ' . $note : '')),
    ], ['id' => (int) $row->id]);
    $suspended = 0;
    foreach (easy_enrollments_for_license($row->id) as $enrollment) {
        if (in_array($enrollment->status, EASY_ENROLLMENT_OPEN, true) || $enrollment->status === 'expired') {
            easy_enrollment_set_status($enrollment, 'suspended', ['suspended_from' => $enrollment->status]);
            $suspended++;
        }
    }
    do_action('easy_license_revoked', (int) $row->id, $suspended);
    return ['key' => easy_licenses_get($row->id), 'suspended' => $suspended];
}

/** Undo a revoke: back to redeemed (and the enrollment reopened) or to issued. */
function easy_licenses_restore($id) {
    global $wpdb;
    $row = easy_licenses_get($id);
    if (!$row) {
        return new WP_Error('easy_key_missing', 'That key doesn\'t exist.', ['status' => 404]);
    }
    if ($row->status !== 'revoked') {
        return new WP_Error('easy_key_not_revoked', 'Only a revoked key can be restored.', ['status' => 409]);
    }
    foreach (easy_enrollments_for_license($row->id) as $enrollment) {
        if ($enrollment->status !== 'suspended') {
            continue;
        }
        $back = in_array($enrollment->suspended_from, array_merge(EASY_ENROLLMENT_OPEN, ['expired']), true) ? $enrollment->suspended_from : 'active';
        if (!easy_enrollment_set_status($enrollment, $back, ['suspended_from' => ''])) {
            $person = easy_licenses_person($enrollment->user_id);
            return new WP_Error('easy_key_restore_clash', ($person ? $person['name'] : 'The learner') . ' has since started this course with another key, so this one can\'t be restored.', ['status' => 409]);
        }
    }
    $wpdb->update(easy_licenses_table('licenses'), [
        'status'     => $row->redeemed_by ? 'redeemed' : ($row->expires_at <= easy_licenses_now() ? 'expired' : 'issued'),
        'revoked_at' => null,
        'revoked_by' => 0,
    ], ['id' => (int) $row->id]);
    return ['key' => easy_licenses_get($row->id)];
}

/**
 * Give an enrollment more time: N days from today or from its current end,
 * whichever is later. An enrollment that ran out is reopened.
 */
function easy_enrollment_extend($id, $days) {
    $row = easy_enrollment_get($id);
    $days = (int) $days;
    if (!$row) {
        return new WP_Error('easy_enrollment_missing', 'That enrollment doesn\'t exist.', ['status' => 404]);
    }
    if ($days < 1 || $days > 365) {
        return new WP_Error('easy_enrollment_days', 'Extend by 1 to 365 days.', ['status' => 400]);
    }
    $status = easy_enrollment_status($row);
    if (!in_array($status, ['active', 'expired'], true)) {
        return new WP_Error('easy_enrollment_not_extendable', 'Only an active or expired enrollment can be extended.', ['status' => 409]);
    }
    if (!$row->access_until && $status === 'active') {
        return new WP_Error('easy_enrollment_no_limit', 'This enrollment has no end date, so there\'s nothing to extend.', ['status' => 409]);
    }
    $now = easy_licenses_now();
    $from = ($row->access_until && $row->access_until > $now) ? $row->access_until : $now;
    $until = easy_licenses_utc_plus('+' . $days . ' days', $from);
    if (!easy_enrollment_set_status($row, 'active', ['access_until' => $until])) {
        return new WP_Error('easy_enrollment_clash', 'This learner has since started the course again with another key, so this enrollment can\'t be reopened.', ['status' => 409]);
    }
    return easy_enrollment_get($row->id);
}

/* ---------------- key email ---------------- */

/**
 * Where learners type a key: the My Courses page once it exists (slice 3).
 * Empty until then, which keeps key emails switched off.
 */
function easy_licenses_redeem_url() {
    $page = get_page_by_path('student-portal/courses');
    $url = ($page instanceof WP_Post && $page->post_status === 'publish') ? get_permalink($page) : '';
    return (string) apply_filters('easy_licenses_redeem_url', $url);
}

/**
 * Email keys (all for one course) to the buyer, or to $to when given.
 * One branded HTML email with a plain-text part.
 */
function easy_licenses_email(array $rows, $to = '') {
    global $wpdb;
    $rows = array_values(array_filter($rows, function ($r) { return in_array(easy_licenses_key_status($r), ['issued', 'redeemed'], true); }));
    if (!$rows) {
        return new WP_Error('easy_key_email_none', 'None of these keys can be sent: they are revoked or expired.', ['status' => 409]);
    }
    $redeem_url = easy_licenses_redeem_url();
    if ($redeem_url === '') {
        return new WP_Error('easy_key_email_off', 'Key emails start once the My Courses page is built, because the email links to it. Until then, read or copy the keys to the customer.', ['status' => 409]);
    }
    $to = sanitize_email($to ?: $rows[0]->buyer_email);
    if (!is_email($to)) {
        return new WP_Error('easy_key_email_to', 'There\'s no valid email address to send these keys to.', ['status' => 400]);
    }

    $course = easy_licenses_course_title($rows[0]->course);
    $count = count($rows);
    $name = $rows[0]->buyer_name;
    $expires = easy_licenses_date(min(array_map(function ($r) { return $r->expires_at; }, $rows)), true);
    $logo = 'https://easysafety.ca/wp-content/login-logo.png';
    $contact = 'pam@easysafety.ca';
    $phone = '(709) 221-7233';

    $subject = $count === 1 ? "Your key for {$course}" : "Your {$count} keys for {$course}";
    $key_lines_html = '';
    $key_lines_text = '';
    foreach ($rows as $r) {
        $used = $r->status === 'redeemed' ? ' (already used)' : '';
        $key_lines_html .= '<p style="margin:6px 0;font-size:17px;font-family:Consolas,Menlo,monospace;letter-spacing:1px;">'
            . esc_html(easy_key_format($r->code)) . '<span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#777;letter-spacing:0;">' . esc_html($used) . '</span></p>';
        $key_lines_text .= easy_key_format($r->code) . $used . "\n";
    }
    $intro = $count === 1
        ? 'Here is your key for <strong>' . esc_html($course) . '</strong>.'
        : 'Here are your ' . $count . ' keys for <strong>' . esc_html($course) . '</strong>. Each key opens the course for one person, so pass one to each learner.';
    $intro_text = $count === 1
        ? "Here is your key for {$course}."
        : "Here are your {$count} keys for {$course}. Each key opens the course for one person, so pass one to each learner.";

    $message = '
<div style="font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:40px 0; background:#f5f7fa;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr><td style="padding:30px 40px 10px 40px;text-align:center;">
      <img src="' . esc_url($logo) . '" alt="Easy Safety Logo" width="170" style="display:block;margin:0 auto 10px auto;">
      <h1 style="margin:0;font-size:24px;color:#12853C;font-weight:700;">' . ($count === 1 ? 'Your course key' : 'Your course keys') . '</h1>
    </td></tr>
    <tr><td style="padding:20px 40px 30px 40px;">
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;">' . ($name !== '' ? 'Hi <strong>' . esc_html($name) . '</strong>,' : 'Hello,') . '</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;">' . $intro . '</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;"><tr><td style="background:#f0f3f6;padding:15px 20px;border-radius:8px;">' . $key_lines_html . '</td></tr></table>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0;">To start, sign in or create a free account at easysafety.ca, open My Courses and enter the key. Each learner needs their own account.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="' . esc_url($redeem_url) . '" style="background:#12853C;color:#ffffff;text-decoration:none;padding:14px 28px;font-size:16px;font-weight:bold;border-radius:6px;display:inline-block;">Open My Courses</a>
      </div>
      <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 16px 0;">Keys that aren\'t used by ' . esc_html($expires) . ' expire.</p>
      <p style="font-size:15px;line-height:1.6;color:#444;margin-top:30px;">Questions? Contact us at <a href="mailto:' . esc_attr($contact) . '" style="color:#12853C;text-decoration:none;">' . esc_html($contact) . '</a> or call ' . esc_html($phone) . '.</p>
    </td></tr>
    <tr><td style="background:#f0f3f6;text-align:center;padding:15px;font-size:12px;color:#555;">EASY Safety Training &middot; 44 Austin Street, St. John\'s, NL A1B 4C2</td></tr>
  </table>
</div>';
    $plain = ($name !== '' ? "Hi {$name},\n\n" : "Hello,\n\n")
        . $intro_text . "\n\n" . $key_lines_text . "\n"
        . "To start, sign in or create a free account at easysafety.ca, open My Courses and enter the key. Each learner needs their own account.\n"
        . $redeem_url . "\n\n"
        . "Keys that aren't used by {$expires} expire.\n\n"
        . "Questions? Contact us at {$contact} or call {$phone}.\n\n"
        . "EASY Safety Training \u{00B7} 44 Austin Street, St. John's, NL A1B 4C2\n";

    $headers = [
        'Content-Type: text/html; charset=UTF-8',
        'From: EASY Safety <pam@easysafety.ca>',
        'Reply-To: ' . $contact,
    ];
    $alt = function ($phpmailer) use ($plain) {
        $phpmailer->AltBody = $plain;
    };
    add_action('phpmailer_init', $alt);
    try {
        $sent = wp_mail($to, $subject, $message, $headers);
    } finally {
        remove_action('phpmailer_init', $alt);
    }
    if (!$sent) {
        return new WP_Error('easy_key_email_failed', 'The email could not be sent. Check FluentSMTP\'s log.', ['status' => 500]);
    }
    $ids = implode(',', array_map(function ($r) { return (int) $r->id; }, $rows));
    $wpdb->query($wpdb->prepare("UPDATE " . easy_licenses_table('licenses') . " SET emailed_at = %s WHERE id IN ($ids)", easy_licenses_now()));
    return $to;
}

function easy_licenses_batch_rows($batch) {
    global $wpdb;
    $table = easy_licenses_table('licenses');
    return $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE batch = %s ORDER BY id ASC", (string) $batch));
}

/* ---------------- lists ---------------- */

/** Keys for the office lists. $args: search, status, course, batch, page, per_page. */
function easy_licenses_query(array $args) {
    global $wpdb;
    $table = easy_licenses_table('licenses');
    $where = ['1=1'];
    $params = [];
    $now = easy_licenses_now();

    $search = trim((string) ($args['search'] ?? ''));
    if ($search !== '') {
        $code = easy_key_normalize($search);
        if ($code !== '') {
            $where[] = 'l.code = %s';
            $params[] = $code;
        } elseif (preg_match('/^#?(\d{1,10})$/', $search, $m)) {
            $where[] = '(l.order_id = %d OR l.id = %d)';
            $params[] = (int) $m[1];
            $params[] = (int) $m[1];
        } else {
            $like = '%' . $wpdb->esc_like($search) . '%';
            $where[] = '(l.buyer_email LIKE %s OR l.buyer_name LIKE %s OR l.company LIKE %s OR u.user_email LIKE %s OR u.display_name LIKE %s)';
            array_push($params, $like, $like, $like, $like, $like);
        }
    }
    $status = (string) ($args['status'] ?? '');
    if ($status === 'issued') {
        $where[] = "l.status = 'issued' AND l.expires_at > %s";
        $params[] = $now;
    } elseif ($status === 'expired') {
        $where[] = "(l.status = 'expired' OR (l.status = 'issued' AND l.expires_at <= %s))";
        $params[] = $now;
    } elseif (in_array($status, ['redeemed', 'revoked'], true)) {
        $where[] = 'l.status = %s';
        $params[] = $status;
    }
    if (!empty($args['course'])) {
        $where[] = 'l.course = %s';
        $params[] = (string) $args['course'];
    }
    if (!empty($args['batch'])) {
        $where[] = 'l.batch = %s';
        $params[] = (string) $args['batch'];
    }

    $per_page = max(1, min(200, (int) ($args['per_page'] ?? 50)));
    $page = max(1, (int) ($args['page'] ?? 1));
    $from = "FROM $table l LEFT JOIN {$wpdb->users} u ON u.ID = l.redeemed_by WHERE " . implode(' AND ', $where);
    $count_sql = "SELECT COUNT(*) $from";
    $rows_sql = "SELECT l.* $from ORDER BY l.id DESC LIMIT %d OFFSET %d";
    $total = (int) $wpdb->get_var($params ? $wpdb->prepare($count_sql, $params) : $count_sql);
    $rows = $wpdb->get_results($wpdb->prepare($rows_sql, array_merge($params, [$per_page, ($page - 1) * $per_page])));
    return ['rows' => $rows ?: [], 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $per_page))];
}

/** Enrollments for the office lists. $args: search, status, course, page, per_page. */
function easy_enrollments_query(array $args) {
    global $wpdb;
    $table = easy_licenses_table('enrollments');
    $where = ['1=1'];
    $params = [];
    $now = easy_licenses_now();

    $search = trim((string) ($args['search'] ?? ''));
    if ($search !== '') {
        $like = '%' . $wpdb->esc_like($search) . '%';
        $where[] = '(u.user_email LIKE %s OR u.display_name LIKE %s OR u.user_login LIKE %s OR e.cert_name LIKE %s)';
        array_push($params, $like, $like, $like, $like);
    }
    $status = (string) ($args['status'] ?? '');
    if ($status === 'active') {
        $where[] = "e.status = 'active' AND (e.access_until IS NULL OR e.access_until > %s)";
        $params[] = $now;
    } elseif ($status === 'expired') {
        $where[] = "(e.status = 'expired' OR (e.status = 'active' AND e.access_until <= %s))";
        $params[] = $now;
    } elseif (in_array($status, ['theory_complete', 'practical_booked', 'completed', 'suspended'], true)) {
        $where[] = 'e.status = %s';
        $params[] = $status;
    }
    if (!empty($args['course'])) {
        $where[] = 'e.course = %s';
        $params[] = (string) $args['course'];
    }

    $per_page = max(1, min(200, (int) ($args['per_page'] ?? 50)));
    $page = max(1, (int) ($args['page'] ?? 1));
    $from = "FROM $table e LEFT JOIN {$wpdb->users} u ON u.ID = e.user_id WHERE " . implode(' AND ', $where);
    $count_sql = "SELECT COUNT(*) $from";
    $rows_sql = "SELECT e.* $from ORDER BY e.id DESC LIMIT %d OFFSET %d";
    $total = (int) $wpdb->get_var($params ? $wpdb->prepare($count_sql, $params) : $count_sql);
    $rows = $wpdb->get_results($wpdb->prepare($rows_sql, array_merge($params, [$per_page, ($page - 1) * $per_page])));
    return ['rows' => $rows ?: [], 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $per_page))];
}

/* ---------------- daily job ---------------- */

/** Mark unused keys past their date expired, and close enrollments whose access ran out. */
function easy_licenses_run_daily() {
    global $wpdb;
    if (!easy_licenses_ready()) {
        return null;
    }
    $now = easy_licenses_now();
    $keys = (int) $wpdb->query($wpdb->prepare(
        "UPDATE " . easy_licenses_table('licenses') . " SET status = 'expired' WHERE status = 'issued' AND expires_at <= %s",
        $now
    ));
    $enrollments = (int) $wpdb->query($wpdb->prepare(
        "UPDATE " . easy_licenses_table('enrollments') . " SET status = 'expired', open_slot = NULL WHERE status = 'active' AND access_until IS NOT NULL AND access_until <= %s",
        $now
    ));
    update_option('easy_licenses_last_run', ['at' => time(), 'keys' => $keys, 'enrollments' => $enrollments], false);
    return ['keys' => $keys, 'enrollments' => $enrollments];
}
add_action(EASY_LICENSES_CRON, 'easy_licenses_run_daily');

/* Daily at 3:15 AM St. John's time. */
add_action('init', function () {
    if (!wp_next_scheduled(EASY_LICENSES_CRON)) {
        $next = new DateTimeImmutable('tomorrow 03:15', new DateTimeZone(EASY_LICENSES_TZ));
        wp_schedule_event($next->getTimestamp(), 'daily', EASY_LICENSES_CRON);
    }
});

/* ---------------- health ---------------- */

/** Overview row: [label, ok|warn|error, detail]. */
function easy_licenses_health() {
    global $wpdb;
    $label = 'Online course keys';
    if (!easy_licenses_ready()) {
        $why = get_transient('easy_licenses_db_failed');
        return [$label, 'error', 'The key tables are not set up' . ($why ? ': ' . $why : '') . '. Keys can\'t be issued or redeemed.'];
    }
    $routes = function_exists('rest_get_server') ? array_keys(rest_get_server()->get_routes()) : [];
    if (!in_array('/easy/v1/learn/redeem', $routes, true)) {
        return [$label, 'error', 'The redeem route is missing.'];
    }
    $now = easy_licenses_now();
    $keys = easy_licenses_table('licenses');
    $unused = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $keys WHERE status = 'issued' AND expires_at > %s", $now));
    $soon = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $keys WHERE status = 'issued' AND expires_at > %s AND expires_at <= %s",
        $now, easy_licenses_utc_plus('+30 days', $now)
    ));
    $open = (int) $wpdb->get_var("SELECT COUNT(*) FROM " . easy_licenses_table('enrollments') . " WHERE open_slot = 1");
    $next = function_exists('easy_suite_next_run') ? easy_suite_next_run(EASY_LICENSES_CRON) : (wp_next_scheduled(EASY_LICENSES_CRON) ? 'scheduled' : null);
    $courses = easy_licenses_courses();
    $approved = count(array_filter($courses, function ($c) { return $c['version'] > 0; }));

    $state = 'ok';
    $notes = [];
    if (!function_exists('easy_course_post')) {
        $state = 'warn';
        $notes[] = 'Course Builder sync is switched off, so there are no courses to issue keys for.';
    } elseif (!$approved) {
        $notes[] = 'No course is approved in Course Builder yet, so no keys can be issued.';
    }
    if (!$next) {
        $state = 'warn';
        $notes[] = 'The daily expiry job is not scheduled.';
    }
    if ($soon) {
        $state = 'warn';
    }
    $access = easy_licenses_access_days();
    return [
        $label,
        $state,
        sprintf('%d unused key(s), %d expiring in the next 30 days. %d learner(s) in a course. %d of %d course(s) can have keys. ', $unused, $soon, $open, $approved, count($courses))
            . 'Unused keys expire after ' . easy_licenses_key_months() . ' months; access after redeeming: ' . ($access ? $access . ' days' : 'no time limit') . '. '
            . 'Next expiry job: ' . ($next ?: 'not scheduled') . '.'
            . ($notes ? ' ' . implode(' ', $notes) : ''),
    ];
}

/* ---------------- REST ---------------- */

add_action('rest_api_init', function () {
    $ns = 'easy/v1';
    $guard = function ($callback) {
        return function (WP_REST_Request $request) use ($callback) {
            if (!easy_licenses_ready()) {
                return easy_licenses_not_ready_error();
            }
            return $callback($request);
        };
    };

    register_rest_route($ns, '/learn/redeem', [
        'methods'             => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $enrollment = easy_licenses_redeem(get_current_user_id(), (string) $request->get_param('key'));
            return is_wp_error($enrollment) ? $enrollment : ['enrollment' => easy_enrollment_export($enrollment)];
        }),
        'args' => ['key' => ['required' => true, 'type' => 'string']],
    ]);

    register_rest_route($ns, '/learn/my-courses', [
        'methods'             => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => $guard(function () {
            global $wpdb;
            $table = easy_licenses_table('enrollments');
            $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE user_id = %d ORDER BY started_at DESC, id DESC", get_current_user_id()));
            return ['enrollments' => array_map('easy_enrollment_export', $rows ?: [])];
        }),
    ]);

    register_rest_route($ns, '/licenses', [
        [
            'methods'             => 'GET',
            'permission_callback' => 'easy_licenses_rest_can_manage',
            'callback'            => $guard(function (WP_REST_Request $request) {
                $result = easy_licenses_query([
                    'search' => (string) $request->get_param('search'),
                    'status' => (string) $request->get_param('status'),
                    'course' => (string) $request->get_param('course'),
                    'batch'  => (string) $request->get_param('batch'),
                    'page'   => (int) $request->get_param('page'),
                ]);
                return ['keys' => array_map('easy_licenses_export_key', $result['rows'])] + array_diff_key($result, ['rows' => 1]);
            }),
        ],
        [
            'methods'             => 'POST',
            'permission_callback' => 'easy_licenses_rest_can_manage',
            'callback'            => $guard(function (WP_REST_Request $request) {
                $rows = easy_licenses_issue([
                    'course'           => (string) $request->get_param('course'),
                    'quantity'         => (int) $request->get_param('quantity'),
                    'buyer_name'       => (string) $request->get_param('buyerName'),
                    'buyer_email'      => (string) $request->get_param('buyerEmail'),
                    'company'          => (string) $request->get_param('company'),
                    'supervisor_email' => (string) $request->get_param('supervisorEmail'),
                    'note'             => (string) $request->get_param('note'),
                    'source'           => 'office',
                ]);
                if (is_wp_error($rows)) {
                    return $rows;
                }
                $out = ['batch' => $rows[0]->batch, 'keys' => array_map('easy_licenses_export_key', $rows), 'emailed' => null];
                if ($request->get_param('sendEmail')) {
                    $sent = easy_licenses_email($rows);
                    $out['emailed'] = is_wp_error($sent) ? ['ok' => false, 'error' => $sent->get_error_message()] : ['ok' => true, 'to' => $sent];
                    if (!is_wp_error($sent)) {
                        $out['keys'] = array_map('easy_licenses_export_key', easy_licenses_batch_rows($rows[0]->batch));
                    }
                }
                return new WP_REST_Response($out, 201);
            }),
        ],
    ]);

    register_rest_route($ns, '/licenses/(?P<id>\d+)/(?P<action>revoke|restore|resend)', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_licenses_rest_can_manage',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $id = (int) $request['id'];
            switch ($request['action']) {
                case 'revoke':
                    $result = easy_licenses_revoke($id, (string) $request->get_param('note'));
                    return is_wp_error($result) ? $result : ['key' => easy_licenses_export_key($result['key']), 'suspended' => $result['suspended']];
                case 'restore':
                    $result = easy_licenses_restore($id);
                    return is_wp_error($result) ? $result : ['key' => easy_licenses_export_key($result['key'])];
                default:
                    $row = easy_licenses_get($id);
                    if (!$row) {
                        return new WP_Error('easy_key_missing', 'That key doesn\'t exist.', ['status' => 404]);
                    }
                    $sent = easy_licenses_email([$row], (string) $request->get_param('email'));
                    return is_wp_error($sent) ? $sent : ['to' => $sent, 'key' => easy_licenses_export_key(easy_licenses_get($id))];
            }
        }),
    ]);

    register_rest_route($ns, '/licenses/batch/(?P<batch>[a-f0-9]{16})/resend', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_licenses_rest_can_manage',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $rows = easy_licenses_batch_rows((string) $request['batch']);
            if (!$rows) {
                return new WP_Error('easy_key_missing', 'No keys were issued together under that batch.', ['status' => 404]);
            }
            $sent = easy_licenses_email($rows, (string) $request->get_param('email'));
            return is_wp_error($sent) ? $sent : ['to' => $sent];
        }),
    ]);

    register_rest_route($ns, '/enrollments', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_licenses_rest_can_manage',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $result = easy_enrollments_query([
                'search' => (string) $request->get_param('search'),
                'status' => (string) $request->get_param('status'),
                'course' => (string) $request->get_param('course'),
                'page'   => (int) $request->get_param('page'),
            ]);
            $rows = array_map(function ($row) { return easy_enrollment_export($row, true); }, $result['rows']);
            return ['enrollments' => $rows] + array_diff_key($result, ['rows' => 1]);
        }),
    ]);

    register_rest_route($ns, '/enrollments/(?P<id>\d+)/extend', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_licenses_rest_can_manage',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $row = easy_enrollment_extend((int) $request['id'], (int) $request->get_param('days'));
            return is_wp_error($row) ? $row : ['enrollment' => easy_enrollment_export($row, true)];
        }),
    ]);
});

if (is_admin()) {
    require_once EASY_SUITE_DIR . 'includes/licenses-admin.php';
}
