<?php
/**
 * Online courses: practical evaluations (booking, results, certificates).
 *
 * NL OHS Regulations s.252 needs every forklift operator to show their
 * competence to an instructor in person, so an online course with a
 * practical is never finished by the theory alone. This module is that
 * hands-on step:
 *
 *   1. An instructor (or the office, for any instructor) posts a practical
 *      time: course, date, start and end, location and how many learners
 *      it takes.
 *   2. A learner with an open enrollment in that course books one of the
 *      times (the [easy_practical_booking] page or the learn/ routes), or
 *      the office books it for them from the phone app. The practical is
 *      part of the course seat, so booking never asks for payment.
 *   3. The evaluator marks the booking passed, not passed or no show once
 *      the time has started. A pass completes the enrollment and creates
 *      the certificate with the evaluator as its instructor (decision 8).
 *      By default it is a draft that the office reviews and publishes;
 *      Settings can switch that to publishing right away (decision 6).
 *      Not passed and no show free the learner to book again.
 *
 * Tables (created and upgraded here, see EASY_PRACTICALS_DB):
 *   {prefix}easy_practical_slots     one row per practical time. Times in UTC.
 *   {prefix}easy_practical_bookings  one row per learner per booking. live is
 *                                    1 while the booking is waiting for a
 *                                    result and NULL otherwise, so a unique
 *                                    index on (enrollment_id, live) lets the
 *                                    database refuse a second live booking
 *                                    for one enrollment.
 *
 * Statuses:
 *   slot     open | cancelled
 *   booking  booked | cancelled | passed | failed | no_show
 * A booked enrollment is 'practical_booked'; the booking keeps the status it
 * came from so a cancel, a fail or a no show puts it back.
 *
 * Per-course settings (option easy_practical_courses, EASY Suite → Settings):
 * whether the course has a practical (default yes), the usernames qualified
 * to evaluate it (empty means anyone who can sign certificates; learner
 * questions fall back to this list too) and the certificate course a pass
 * issues.
 *
 * Routes (easy/v1/...):
 *   GET  practicals ?days_back                         staff
 *   POST practicals {course, evaluator?, date, start, end, location,
 *                    capacity, note}                   staff
 *   POST practicals/<id>/cancel {reason?}              the evaluator or office
 *   POST practicals/<id>/book {enrollment}             office
 *   GET  practicals/waiting                            office
 *   POST practical-bookings/<id>/result {result, note?, classes?}
 *                                                      the evaluator or office
 *   POST practical-bookings/<id>/cancel                the evaluator or office
 *   GET  learn/practicals                              signed-in learner
 *   POST learn/practicals/book {enrollment, slot}      signed-in learner
 *   POST learn/practicals/<id>/cancel                  signed-in learner
 * Staff means anyone who can edit certificates (instructors, office,
 * admins); instructors see and act on their own times only. Office means
 * the Online courses office rule (easy_licenses_can_manage) or the office
 * accounts that see full rosters (easy_suite_is_office_user).
 */

defined('ABSPATH') || exit;

define('EASY_PRACTICALS_DB', 1);
define('EASY_PRACTICAL_TZ', 'America/St_Johns');
define('EASY_PRACTICAL_RESULTS', ['passed', 'failed', 'no_show']);
// Learners can book or cancel up to this many hours before a time starts.
define('EASY_PRACTICAL_LEARNER_HOURS', 24);
define('EASY_PRACTICAL_MAX_CAPACITY', 20);
// Lift truck classes a forklift evaluation can cover (the desktop app's
// Class 1 to 5 checkboxes, printed in the certificate's course name).
define('EASY_PRACTICAL_FORKLIFT_CLASSES', ['1', '2', '3', '4', '5']);

/* ---------------- tables ---------------- */

function easy_practicals_table($name) {
    global $wpdb;
    return $wpdb->prefix . 'easy_practical_' . $name;
}

function easy_practicals_schema() {
    global $wpdb;
    $collate = $wpdb->get_charset_collate();
    $s = easy_practicals_table('slots');
    $b = easy_practicals_table('bookings');
    // dbDelta format: one column per line, two spaces after PRIMARY KEY.
    return [
        "CREATE TABLE $s (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  course varchar(64) NOT NULL,
  evaluator_id bigint(20) unsigned NOT NULL,
  starts_at datetime NOT NULL,
  ends_at datetime NOT NULL,
  location varchar(190) NOT NULL DEFAULT '',
  capacity smallint(5) unsigned NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'open',
  note text,
  created_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  cancelled_by bigint(20) unsigned NOT NULL DEFAULT 0,
  cancelled_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY starts_at (starts_at),
  KEY evaluator_starts (evaluator_id,starts_at),
  KEY course_starts (course,starts_at)
) $collate;",
        "CREATE TABLE $b (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  slot_id bigint(20) unsigned NOT NULL,
  enrollment_id bigint(20) unsigned NOT NULL,
  user_id bigint(20) unsigned NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'booked',
  live tinyint(1) unsigned DEFAULT 1,
  before_status varchar(20) NOT NULL DEFAULT '',
  booked_by bigint(20) unsigned NOT NULL DEFAULT 0,
  booked_at datetime NOT NULL,
  cancelled_by bigint(20) unsigned NOT NULL DEFAULT 0,
  cancelled_at datetime DEFAULT NULL,
  result_by bigint(20) unsigned NOT NULL DEFAULT 0,
  result_at datetime DEFAULT NULL,
  result_note text,
  classes varchar(32) NOT NULL DEFAULT '',
  cert_post_id bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY one_live (enrollment_id,live),
  KEY slot_status (slot_id,status),
  KEY user_id (user_id)
) $collate;",
    ];
}

function easy_practicals_tables_exist() {
    global $wpdb;
    foreach (['slots', 'bookings'] as $name) {
        $table = easy_practicals_table($name);
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
            return false;
        }
    }
    return true;
}

/** True once the tables are installed and the key tables they lean on are too. */
function easy_practicals_ready() {
    return (int) get_option('easy_practicals_db') === EASY_PRACTICALS_DB
        && function_exists('easy_licenses_ready') && easy_licenses_ready();
}

/** Create or upgrade the tables, the same way the key tables are. */
function easy_practicals_install() {
    if ((int) get_option('easy_practicals_db') === EASY_PRACTICALS_DB || get_transient('easy_practicals_db_failed')) {
        return (int) get_option('easy_practicals_db') === EASY_PRACTICALS_DB;
    }
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta(easy_practicals_schema());
    if (!easy_practicals_tables_exist()) {
        global $wpdb;
        set_transient('easy_practicals_db_failed', $wpdb->last_error ?: 'The tables were not created.', 10 * MINUTE_IN_SECONDS);
        return false;
    }
    update_option('easy_practicals_db', EASY_PRACTICALS_DB, true);
    delete_transient('easy_practicals_db_failed');
    return true;
}
add_action('init', 'easy_practicals_install', 6); // After the key tables (priority 5).

function easy_practicals_not_ready_error() {
    if (!function_exists('easy_licenses_ready')) {
        return new WP_Error('easy_practicals_not_ready', 'Practicals need the "Online courses: license keys" module, which is switched off.', ['status' => 503]);
    }
    return new WP_Error('easy_practicals_not_ready', 'Practical booking is not set up on the site yet. EASY Suite → Overview shows why.', ['status' => 503]);
}

/* ---------------- settings ---------------- */

/** Decision 6: false (default) = a pass makes a draft for the office to review. */
function easy_practical_auto_publish() {
    return (bool) get_option('easy_practical_auto_publish', false);
}

/** A pass needs the online theory finished first (default on). */
function easy_practical_require_theory() {
    return (bool) get_option('easy_practical_require_theory', true);
}

/**
 * Certificate courses a pass can issue: title value => [label, category].
 * Read from the cert ACF fields (one course_title field per category,
 * shown by conditional logic on course_category). When ACF can't be read,
 * only the forklift course is offered.
 */
function easy_practical_cert_courses() {
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $out = [];
    if (function_exists('acf_get_field_groups') && function_exists('acf_get_fields')) {
        foreach (acf_get_field_groups(['post_type' => 'cert']) as $group) {
            $fields = (array) acf_get_fields($group);
            $category_keys = [];
            foreach ($fields as $field) {
                if (($field['name'] ?? '') === 'course_category') {
                    $category_keys[] = $field['key'];
                }
            }
            foreach ($fields as $field) {
                if (($field['name'] ?? '') !== 'course_title' || empty($field['choices']) || !is_array($field['choices'])) {
                    continue;
                }
                $category = '';
                foreach ((array) ($field['conditional_logic'] ?? []) as $and_group) {
                    foreach ((array) $and_group as $rule) {
                        if (in_array($rule['field'] ?? '', $category_keys, true) && ($rule['operator'] ?? '') === '==') {
                            $category = (string) ($rule['value'] ?? '');
                        }
                    }
                }
                foreach ($field['choices'] as $value => $label) {
                    if (!isset($out[$value])) {
                        $out[$value] = ['label' => (string) $label, 'category' => $category];
                    }
                }
            }
        }
    }
    if (!$out) {
        $out['counter-balance-forklift'] = ['label' => 'Counter Balance Forklift', 'category' => 'powered-mobile-equipment'];
    }
    return $cache = $out;
}

/**
 * One course's practical settings: required (bool), evaluators (usernames),
 * cert_title (a cert course_title value, '' = not set). A course never
 * configured has a practical, any certificate signer can evaluate it, and
 * a course with "forklift" in its title issues Counter Balance Forklift.
 */
function easy_practical_course_settings($cid) {
    $all = get_option('easy_practical_courses', []);
    $row = (is_array($all) && isset($all[$cid]) && is_array($all[$cid])) ? $all[$cid] : [];
    $cert_title = isset($row['cert_title']) ? (string) $row['cert_title'] : null;
    if ($cert_title === null) {
        $title = function_exists('easy_licenses_course_title') ? easy_licenses_course_title($cid) : $cid;
        $cert_title = stripos((string) $title, 'forklift') !== false ? 'counter-balance-forklift' : '';
    }
    return [
        'required'   => array_key_exists('required', $row) ? (bool) $row['required'] : true,
        'evaluators' => array_values(array_filter(array_map('strval', (array) ($row['evaluators'] ?? [])))),
        'cert_title' => $cert_title,
    ];
}

function easy_practical_course_required($cid) {
    return easy_practical_course_settings($cid)['required'];
}

/** The cert course a pass in this course issues: [value, label, category], or null. */
function easy_practical_cert_course_for($cid) {
    $value = easy_practical_course_settings($cid)['cert_title'];
    $courses = easy_practical_cert_courses();
    if ($value === '' || !isset($courses[$value])) {
        return null;
    }
    return ['value' => $value, 'label' => $courses[$value]['label'], 'category' => $courses[$value]['category']];
}

function easy_practical_is_forklift($cid) {
    $cert = easy_practical_cert_course_for($cid);
    return $cert && $cert['value'] === 'counter-balance-forklift';
}

/* ---------------- people ---------------- */

function easy_practical_cert_cap($which = 'edit_posts') {
    $pto = get_post_type_object('cert');
    return ($pto && !empty($pto->cap->$which)) ? $pto->cap->$which : $which;
}

/** Anyone who can sign certificates: instructors, office, admins. */
function easy_practical_is_staff($user = null) {
    $user = $user ?: wp_get_current_user();
    return $user && $user->ID && user_can($user, easy_practical_cert_cap());
}

/** Office: books for learners, posts times for any instructor, sees everything. */
function easy_practical_is_office($user = null) {
    $user = $user ?: wp_get_current_user();
    if (!$user || !$user->ID) {
        return false;
    }
    return (function_exists('easy_licenses_can_manage') && easy_licenses_can_manage($user))
        || (function_exists('easy_suite_is_office_user') && easy_suite_is_office_user($user));
}

function easy_practical_rest_staff() {
    return is_user_logged_in() && easy_practical_is_staff();
}

function easy_practical_rest_office() {
    return is_user_logged_in() && easy_practical_is_office();
}

/**
 * Accounts that may evaluate a course: the course's list when it has one,
 * otherwise everyone who can sign certificates. Sorted by name.
 */
function easy_practical_evaluators($cid = '') {
    $settings = $cid !== '' ? easy_practical_course_settings($cid) : ['evaluators' => []];
    $users = [];
    if ($settings['evaluators']) {
        foreach ($settings['evaluators'] as $login) {
            $u = get_user_by('login', $login);
            if ($u && easy_practical_is_staff($u)) {
                $users[$u->ID] = $u;
            }
        }
    } else {
        foreach (get_users(['capability' => easy_practical_cert_cap(), 'fields' => 'all']) as $u) {
            $users[$u->ID] = $u;
        }
    }
    uasort($users, function ($a, $b) { return strcasecmp($a->display_name, $b->display_name); });
    return array_values($users);
}

function easy_practical_can_evaluate($user_id, $cid) {
    foreach (easy_practical_evaluators($cid) as $u) {
        if ((int) $u->ID === (int) $user_id) {
            return true;
        }
    }
    return false;
}

/** The name an evaluator signs certificates with (the same one the desktop app stamps). */
function easy_practical_evaluator_name($user_id) {
    $u = $user_id ? get_userdata((int) $user_id) : null;
    return $u ? $u->display_name : '';
}

/** id + display name, for API shapes. */
function easy_practical_person($user_id) {
    $u = $user_id ? get_userdata((int) $user_id) : null;
    return $u ? ['id' => (int) $u->ID, 'name' => $u->display_name] : null;
}

/* ---------------- time ---------------- */

function easy_practical_tz() {
    return new DateTimeZone(EASY_PRACTICAL_TZ);
}

/** St. John's date + "HH:MM" to a UTC datetime string, or null when invalid. */
function easy_practical_local_to_utc($date, $time) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $time)) {
        return null;
    }
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d H:i', $date . ' ' . $time, easy_practical_tz());
    if (!$dt || $dt->format('Y-m-d H:i') !== $date . ' ' . $time) {
        return null; // Not a real date (Feb 30) or a time skipped by daylight saving.
    }
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

function easy_practical_local($utc, $format) {
    return wp_date($format, strtotime($utc . ' UTC'), easy_practical_tz());
}

/** "Sat, Nov 1, 9:00 AM to 12:00 PM" in St. John's time. */
function easy_practical_when($slot) {
    $same_year = easy_practical_local($slot->starts_at, 'Y') === wp_date('Y', time(), easy_practical_tz());
    return easy_practical_local($slot->starts_at, $same_year ? 'D, M j, g:i A' : 'D, M j, Y, g:i A')
        . ' to ' . easy_practical_local($slot->ends_at, 'g:i A');
}

function easy_practical_now() {
    return gmdate('Y-m-d H:i:s');
}

function easy_practical_utc_plus($modify, $from = null) {
    $base = new DateTimeImmutable($from ? $from . ' UTC' : 'now', new DateTimeZone('UTC'));
    return $base->modify($modify)->format('Y-m-d H:i:s');
}

/* ---------------- reading rows ---------------- */

function easy_practical_slot($id) {
    global $wpdb;
    $t = easy_practicals_table('slots');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE id = %d", (int) $id));
}

function easy_practical_booking($id) {
    global $wpdb;
    $t = easy_practicals_table('bookings');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE id = %d", (int) $id));
}

/** Bookings on a slot, oldest first. $live_only skips finished and cancelled ones. */
function easy_practical_slot_bookings($slot_id, $live_only = false) {
    global $wpdb;
    $t = easy_practicals_table('bookings');
    $sql = "SELECT * FROM $t WHERE slot_id = %d" . ($live_only ? ' AND live = 1' : " AND status <> 'cancelled'") . ' ORDER BY id ASC';
    return $wpdb->get_results($wpdb->prepare($sql, (int) $slot_id)) ?: [];
}

function easy_practical_live_count($slot_id) {
    global $wpdb;
    $t = easy_practicals_table('bookings');
    return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t WHERE slot_id = %d AND live = 1", (int) $slot_id));
}

/** Taken places: live bookings plus results already recorded (a passed learner still used the place). */
function easy_practical_taken($slot_id) {
    global $wpdb;
    $t = easy_practicals_table('bookings');
    return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t WHERE slot_id = %d AND status <> 'cancelled'", (int) $slot_id));
}

function easy_practical_live_for_enrollment($enrollment_id) {
    global $wpdb;
    $t = easy_practicals_table('bookings');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE enrollment_id = %d AND live = 1 LIMIT 1", (int) $enrollment_id));
}

/** True when the online part of the course is done (the course player sets these). */
function easy_practical_theory_done($enrollment, $booking = null) {
    return (int) $enrollment->progress >= 100
        || $enrollment->status === 'theory_complete'
        || ($booking && $booking->before_status === 'theory_complete');
}

/** Name, email, phone and company for the people who coordinate a practical. */
function easy_practical_learner($enrollment) {
    $u = get_userdata((int) $enrollment->user_id);
    $company = '';
    $supervisor = '';
    if ($enrollment->license_id && function_exists('easy_licenses_get')) {
        $key = easy_licenses_get($enrollment->license_id);
        if ($key) {
            $company = (string) $key->company;
            $supervisor = (string) $key->supervisor_email;
        }
    }
    return [
        'id'              => (int) $enrollment->user_id,
        'name'            => $enrollment->cert_name !== '' ? $enrollment->cert_name : ($u ? $u->display_name : ''),
        'email'           => $u ? $u->user_email : '',
        'phone'           => $u ? (string) get_user_meta($u->ID, 'phone_number', true) : '',
        'company'         => $company,
        'supervisorEmail' => $supervisor,
    ];
}

/* ---------------- API shapes ---------------- */

function easy_practical_export_booking($b, $enrollment = null) {
    $enrollment = $enrollment ?: (function_exists('easy_enrollment_get') ? easy_enrollment_get($b->enrollment_id) : null);
    return [
        'id'          => (int) $b->id,
        'slotId'      => (int) $b->slot_id,
        'enrollmentId'=> (int) $b->enrollment_id,
        'status'      => $b->status,
        'learner'     => $enrollment ? easy_practical_learner($enrollment) : ['id' => (int) $b->user_id, 'name' => '', 'email' => '', 'phone' => '', 'company' => '', 'supervisorEmail' => ''],
        'theoryDone'  => $enrollment ? easy_practical_theory_done($enrollment, $b) : false,
        'progress'    => $enrollment ? (int) $enrollment->progress : 0,
        'bookedAt'    => easy_licenses_iso($b->booked_at),
        'bookedBy'    => easy_practical_person($b->booked_by),
        'resultAt'    => easy_licenses_iso($b->result_at),
        'resultBy'    => easy_practical_person($b->result_by),
        'resultNote'  => (string) $b->result_note,
        'classes'     => $b->classes !== '' ? explode(',', $b->classes) : [],
        'certPostId'  => (int) $b->cert_post_id,
        'certStatus'  => $b->cert_post_id ? (string) get_post_status((int) $b->cert_post_id) : '',
    ];
}

/** A slot as staff see it, with its learners. */
function easy_practical_export_slot($s) {
    $now = easy_practical_now();
    $bookings = easy_practical_slot_bookings($s->id);
    $cert = easy_practical_cert_course_for($s->course);
    return [
        'id'          => (int) $s->id,
        'course'      => $s->course,
        'courseTitle' => easy_licenses_course_title($s->course),
        'forklift'    => easy_practical_is_forklift($s->course),
        'certCourse'  => $cert ? $cert['label'] : '',
        'evaluator'   => easy_practical_person($s->evaluator_id),
        'mine'        => (int) $s->evaluator_id === get_current_user_id(),
        'startsAt'    => easy_licenses_iso($s->starts_at),
        'endsAt'      => easy_licenses_iso($s->ends_at),
        'date'        => easy_practical_local($s->starts_at, 'Y-m-d'),
        'startTime'   => easy_practical_local($s->starts_at, 'H:i'),
        'endTime'     => easy_practical_local($s->ends_at, 'H:i'),
        'when'        => easy_practical_when($s),
        'location'    => $s->location,
        'capacity'    => (int) $s->capacity,
        'taken'       => count($bookings),
        'status'      => $s->status,
        'started'     => $s->starts_at <= $now,
        'ended'       => $s->ends_at <= $now,
        'note'        => (string) $s->note,
        'bookings'    => array_map('easy_practical_export_booking', $bookings),
    ];
}

/** A slot as a learner sees it: no other learners. */
function easy_practical_export_slot_public($s) {
    $evaluator = easy_practical_person($s->evaluator_id);
    return [
        'id'        => (int) $s->id,
        'when'      => easy_practical_when($s),
        'date'      => easy_practical_local($s->starts_at, 'Y-m-d'),
        'startsAt'  => easy_licenses_iso($s->starts_at),
        'location'  => $s->location,
        'evaluator' => $evaluator ? $evaluator['name'] : '',
        'placesLeft'=> max(0, (int) $s->capacity - easy_practical_taken($s->id)),
    ];
}

/* ---------------- slots ---------------- */

/**
 * Post a practical time. $args: course, evaluator (user id; office only,
 * otherwise the actor), date, start, end (St. John's), location, capacity,
 * note.
 */
function easy_practical_create_slot(array $args, $actor_id) {
    global $wpdb;
    if (!easy_practicals_ready()) {
        return easy_practicals_not_ready_error();
    }
    $actor = get_userdata((int) $actor_id);
    if (!$actor || !easy_practical_is_staff($actor)) {
        return new WP_Error('easy_practical_forbidden', 'Only instructors and the office can post practical times.', ['status' => 403]);
    }
    $cid = strtolower(trim((string) ($args['course'] ?? '')));
    $course = preg_match('/^[a-z0-9_-]{1,64}$/', $cid) ? easy_licenses_course($cid) : null;
    if (!$course) {
        return new WP_Error('easy_practical_course', 'Pick the course this practical is for.', ['status' => 400]);
    }
    if (!easy_practical_course_required($cid)) {
        return new WP_Error('easy_practical_course_off', '"' . $course['title'] . '" is set up without a practical. That can be changed in EASY Suite → Settings.', ['status' => 400]);
    }
    $office = easy_practical_is_office($actor);
    $evaluator = (int) ($args['evaluator'] ?? 0);
    if (!$evaluator || !$office) {
        $evaluator = (int) $actor->ID; // Instructors post their own times.
    }
    if (!easy_practical_can_evaluate($evaluator, $cid)) {
        $name = easy_practical_evaluator_name($evaluator) ?: 'That person';
        return new WP_Error('easy_practical_evaluator', $name . ' isn\'t on the list of evaluators for ' . $course['title'] . '. The list is in EASY Suite → Settings.', ['status' => 400]);
    }
    $starts = easy_practical_local_to_utc((string) ($args['date'] ?? ''), (string) ($args['start'] ?? ''));
    $ends = easy_practical_local_to_utc((string) ($args['date'] ?? ''), (string) ($args['end'] ?? ''));
    if (!$starts || !$ends) {
        return new WP_Error('easy_practical_time', 'Enter a date, a start time and an end time.', ['status' => 400]);
    }
    if ($ends <= $starts) {
        return new WP_Error('easy_practical_order', 'The end time has to be after the start time.', ['status' => 400]);
    }
    if ($starts <= easy_practical_now()) {
        return new WP_Error('easy_practical_past', 'That time has already started. Pick a time in the future.', ['status' => 400]);
    }
    $capacity = (int) ($args['capacity'] ?? 1);
    if ($capacity < 1 || $capacity > EASY_PRACTICAL_MAX_CAPACITY) {
        return new WP_Error('easy_practical_capacity', 'A practical time takes 1 to ' . EASY_PRACTICAL_MAX_CAPACITY . ' learners.', ['status' => 400]);
    }
    $location = mb_substr(sanitize_text_field((string) ($args['location'] ?? '')), 0, 190);
    if ($location === '') {
        return new WP_Error('easy_practical_location', 'Enter where the practical happens, so the learner knows where to go.', ['status' => 400]);
    }
    $t = easy_practicals_table('slots');
    $clash = $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM $t WHERE evaluator_id = %d AND status = 'open' AND starts_at < %s AND ends_at > %s LIMIT 1",
        $evaluator, $ends, $starts
    ));
    if ($clash) {
        $other = easy_practical_slot($clash);
        return new WP_Error('easy_practical_clash', easy_practical_evaluator_name($evaluator) . ' already has a practical then (' . easy_practical_when($other) . ').', ['status' => 409]);
    }
    $ok = $wpdb->insert($t, [
        'course'       => $cid,
        'evaluator_id' => $evaluator,
        'starts_at'    => $starts,
        'ends_at'      => $ends,
        'location'     => $location,
        'capacity'     => $capacity,
        'status'       => 'open',
        'note'         => mb_substr(sanitize_textarea_field((string) ($args['note'] ?? '')), 0, 2000),
        'created_by'   => (int) $actor->ID,
        'created_at'   => easy_practical_now(),
    ]);
    if (!$ok) {
        return new WP_Error('easy_practical_insert', 'The practical time could not be saved: ' . ($wpdb->last_error ?: 'database error') . '.', ['status' => 500]);
    }
    $slot = easy_practical_slot($wpdb->insert_id);
    do_action('easy_practical_slot_created', $slot);
    return $slot;
}

/** The evaluator of a slot or the office may manage it. */
function easy_practical_can_manage_slot($slot, $user_id) {
    $user = get_userdata((int) $user_id);
    return $user && ((int) $slot->evaluator_id === (int) $user->ID || easy_practical_is_office($user));
}

/** Cancel a time and every live booking on it; learners get an email. */
function easy_practical_cancel_slot($id, $actor_id, $reason = '') {
    global $wpdb;
    $slot = easy_practical_slot($id);
    if (!$slot) {
        return new WP_Error('easy_practical_missing', 'That practical time doesn\'t exist.', ['status' => 404]);
    }
    if (!easy_practical_can_manage_slot($slot, $actor_id)) {
        return new WP_Error('easy_practical_forbidden', 'Only the evaluator or the office can cancel this practical.', ['status' => 403]);
    }
    if ($slot->status === 'cancelled') {
        return new WP_Error('easy_practical_already', 'This practical time is already cancelled.', ['status' => 409]);
    }
    foreach (easy_practical_slot_bookings($slot->id) as $b) {
        if ($b->status !== 'booked') {
            return new WP_Error('easy_practical_has_results', 'A result is already recorded on this practical, so it can\'t be cancelled. Cancel the other bookings one at a time instead.', ['status' => 409]);
        }
    }
    $reason = mb_substr(sanitize_textarea_field((string) $reason), 0, 500);
    $cancelled = 0;
    foreach (easy_practical_slot_bookings($slot->id, true) as $b) {
        $done = easy_practical_cancel_booking($b->id, $actor_id, false, $reason, true);
        if (!is_wp_error($done)) {
            $cancelled++;
        }
    }
    $wpdb->update(easy_practicals_table('slots'), [
        'status'       => 'cancelled',
        'cancelled_by' => (int) $actor_id,
        'cancelled_at' => easy_practical_now(),
        'note'         => trim($slot->note . ($reason !== '' ? "\nCancelled: " . $reason : '')),
    ], ['id' => (int) $slot->id]);
    return ['slot' => easy_practical_slot($slot->id), 'cancelled' => $cancelled];
}

/* ---------------- booking ---------------- */

/** Runs $fn while holding a database lock on one slot, so two bookings can't both take the last place. */
function easy_practical_with_slot_lock($slot_id, callable $fn) {
    global $wpdb;
    $lock = 'easy_practical_' . substr(md5($wpdb->prefix), 0, 8) . '_' . (int) $slot_id;
    $locked = $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $lock));
    if ((string) $locked === '0') {
        return new WP_Error('easy_practical_busy', 'Someone else is booking this time right now. Please try again in a moment.', ['status' => 429]);
    }
    if ((string) $locked !== '1') {
        // Fail closed, as key redeeming does: running without the lock could overbook.
        return new WP_Error('easy_practical_lock_error', 'Something went wrong on our end. Please try again in a moment.', ['status' => 500]);
    }
    try {
        return $fn();
    } finally {
        $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
    }
}

/**
 * Book an enrollment onto a slot. $as_learner applies the learner rules
 * (own enrollment, booking closes EASY_PRACTICAL_LEARNER_HOURS before);
 * the office can book until the time ends.
 */
function easy_practical_book($slot_id, $enrollment_id, $actor_id, $as_learner) {
    if (!easy_practicals_ready()) {
        return easy_practicals_not_ready_error();
    }
    return easy_practical_with_slot_lock($slot_id, function () use ($slot_id, $enrollment_id, $actor_id, $as_learner) {
        return easy_practical_book_locked($slot_id, $enrollment_id, $actor_id, $as_learner);
    });
}

function easy_practical_book_locked($slot_id, $enrollment_id, $actor_id, $as_learner) {
    global $wpdb;
    $slot = easy_practical_slot($slot_id);
    $enrollment = easy_enrollment_get($enrollment_id);
    if (!$slot || $slot->status !== 'open') {
        return new WP_Error('easy_practical_missing', 'That practical time isn\'t available any more. Pick another one.', ['status' => 404]);
    }
    if (!$enrollment || ($as_learner && (int) $enrollment->user_id !== (int) $actor_id)) {
        return new WP_Error('easy_practical_enrollment', 'That course enrollment wasn\'t found.', ['status' => 404]);
    }
    if (!$as_learner && !easy_practical_is_office(get_userdata((int) $actor_id))) {
        return new WP_Error('easy_practical_forbidden', 'Only the office can book a practical for someone else.', ['status' => 403]);
    }
    if ($slot->course !== $enrollment->course) {
        return new WP_Error('easy_practical_wrong_course', 'That practical time is for a different course.', ['status' => 400]);
    }
    if (!easy_practical_course_required($enrollment->course)) {
        return new WP_Error('easy_practical_course_off', 'This course doesn\'t have a practical.', ['status' => 400]);
    }
    $status = easy_enrollment_status($enrollment);
    if ($status === 'practical_booked' || easy_practical_live_for_enrollment($enrollment->id)) {
        return new WP_Error('easy_practical_already_booked', 'A practical is already booked for this course. Cancel that one first to pick a different time.', ['status' => 409]);
    }
    if (!in_array($status, ['active', 'theory_complete'], true)) {
        $why = [
            'completed' => 'This course is already finished.',
            'expired'   => 'Access to this course has ended. Contact EASY to extend it.',
            'suspended' => 'This course is on hold. Contact EASY.',
        ];
        return new WP_Error('easy_practical_enrollment_closed', $why[$status] ?? 'This course can\'t have a practical booked right now.', ['status' => 409]);
    }
    $now = easy_practical_now();
    $cutoff = $as_learner ? easy_practical_utc_plus('+' . EASY_PRACTICAL_LEARNER_HOURS . ' hours', $now) : $now;
    if ($as_learner ? $slot->starts_at <= $cutoff : $slot->ends_at <= $now) {
        return new WP_Error('easy_practical_too_late', $as_learner
            ? 'Practicals can be booked up to ' . EASY_PRACTICAL_LEARNER_HOURS . ' hours ahead. For this time, call EASY at (709) 221-7233.'
            : 'That practical time is over.', ['status' => 409]);
    }
    if (easy_practical_taken($slot->id) >= (int) $slot->capacity) {
        return new WP_Error('easy_practical_full', 'That practical time is full. Pick another one.', ['status' => 409]);
    }

    $suppress = $wpdb->suppress_errors(true);
    $inserted = $wpdb->insert(easy_practicals_table('bookings'), [
        'slot_id'       => (int) $slot->id,
        'enrollment_id' => (int) $enrollment->id,
        'user_id'       => (int) $enrollment->user_id,
        'status'        => 'booked',
        'live'          => 1,
        'before_status' => $status,
        'booked_by'     => (int) $actor_id,
        'booked_at'     => $now,
    ]);
    $wpdb->suppress_errors($suppress);
    if (!$inserted) {
        return new WP_Error('easy_practical_already_booked', 'A practical is already booked for this course.', ['status' => 409]);
    }
    $booking = easy_practical_booking($wpdb->insert_id);
    easy_enrollment_set_status($enrollment, 'practical_booked');
    easy_practical_email_booked($booking, $slot, $enrollment, (int) $actor_id);
    do_action('easy_practical_booked', $booking, $slot, $enrollment);
    return $booking;
}

/** Put an enrollment back to where it was before the booking, unless something else moved it on. */
function easy_practical_release_enrollment($booking) {
    $enrollment = easy_enrollment_get($booking->enrollment_id);
    if ($enrollment && $enrollment->status === 'practical_booked') {
        $back = in_array($booking->before_status, ['active', 'theory_complete'], true) ? $booking->before_status : 'active';
        easy_enrollment_set_status($enrollment, $back);
    }
}

/**
 * Cancel a live booking. A learner can cancel their own up to
 * EASY_PRACTICAL_LEARNER_HOURS before the time; the evaluator and the
 * office any time before a result is recorded. $quiet skips the evaluator
 * notice (the whole time is being cancelled).
 */
function easy_practical_cancel_booking($id, $actor_id, $as_learner, $reason = '', $quiet = false) {
    global $wpdb;
    $booking = easy_practical_booking($id);
    if (!$booking) {
        return new WP_Error('easy_practical_booking_missing', 'That booking doesn\'t exist.', ['status' => 404]);
    }
    $slot = easy_practical_slot($booking->slot_id);
    if ($as_learner) {
        if ((int) $booking->user_id !== (int) $actor_id) {
            return new WP_Error('easy_practical_booking_missing', 'That booking doesn\'t exist.', ['status' => 404]);
        }
        if ($slot && $slot->starts_at <= easy_practical_utc_plus('+' . EASY_PRACTICAL_LEARNER_HOURS . ' hours')) {
            return new WP_Error('easy_practical_too_late', 'Practicals can be cancelled online up to ' . EASY_PRACTICAL_LEARNER_HOURS . ' hours ahead. Please call EASY at (709) 221-7233.', ['status' => 409]);
        }
    } elseif (!$slot || !easy_practical_can_manage_slot($slot, $actor_id)) {
        return new WP_Error('easy_practical_forbidden', 'Only the evaluator or the office can cancel this booking.', ['status' => 403]);
    }
    if ($booking->status !== 'booked') {
        return new WP_Error('easy_practical_not_live', 'This booking already has a result or was cancelled.', ['status' => 409]);
    }
    $done = $wpdb->query($wpdb->prepare(
        "UPDATE " . easy_practicals_table('bookings') . " SET status = 'cancelled', live = NULL, cancelled_by = %d, cancelled_at = %s, result_note = %s WHERE id = %d AND status = 'booked'",
        (int) $actor_id, easy_practical_now(), mb_substr(sanitize_textarea_field((string) $reason), 0, 500), (int) $booking->id
    ));
    if ($done !== 1) {
        return new WP_Error('easy_practical_not_live', 'This booking already has a result or was cancelled.', ['status' => 409]);
    }
    easy_practical_release_enrollment($booking);
    $booking = easy_practical_booking($booking->id);
    if ($slot) {
        easy_practical_email_cancelled($booking, $slot, (int) $actor_id, $quiet);
    }
    do_action('easy_practical_cancelled', $booking, $slot);
    return $booking;
}

/* ---------------- results ---------------- */

/**
 * Record a result. Passed completes the enrollment and creates the
 * certificate; failed and no_show free the learner to book again. $classes
 * are lift truck classes for a forklift evaluation (required on a pass).
 */
function easy_practical_record_result($id, $result, $actor_id, $note = '', $classes = []) {
    global $wpdb;
    if (!easy_practicals_ready()) {
        return easy_practicals_not_ready_error();
    }
    $booking = easy_practical_booking($id);
    if (!$booking) {
        return new WP_Error('easy_practical_booking_missing', 'That booking doesn\'t exist.', ['status' => 404]);
    }
    $slot = easy_practical_slot($booking->slot_id);
    if (!$slot || !easy_practical_can_manage_slot($slot, $actor_id)) {
        return new WP_Error('easy_practical_forbidden', 'Only the evaluator or the office can record this result.', ['status' => 403]);
    }
    if (!in_array($result, EASY_PRACTICAL_RESULTS, true)) {
        return new WP_Error('easy_practical_result', 'Pick passed, not passed or no show.', ['status' => 400]);
    }
    if ($booking->status !== 'booked') {
        return new WP_Error('easy_practical_not_live', 'A result is already recorded for this booking.', ['status' => 409]);
    }
    if ($slot->starts_at > easy_practical_now()) {
        return new WP_Error('easy_practical_not_started', 'Results can be recorded once the practical has started (' . easy_practical_when($slot) . ').', ['status' => 409]);
    }
    $enrollment = easy_enrollment_get($booking->enrollment_id);
    if (!$enrollment) {
        return new WP_Error('easy_practical_enrollment', 'The course enrollment for this booking is gone.', ['status' => 404]);
    }
    $note = mb_substr(sanitize_textarea_field((string) $note), 0, 2000);
    $classes = array_values(array_intersect(EASY_PRACTICAL_FORKLIFT_CLASSES, array_map('strval', (array) $classes)));

    if ($result === 'passed') {
        if (easy_practical_require_theory() && !easy_practical_theory_done($enrollment, $booking)) {
            return new WP_Error('easy_practical_theory', 'The online part of this course isn\'t finished yet (' . (int) $enrollment->progress . '% done), so the practical can\'t be passed. Record it as not passed, or ask the learner to finish the online part and book again.', ['status' => 409]);
        }
        if (easy_practical_is_forklift($slot->course) && !$classes) {
            return new WP_Error('easy_practical_classes', 'Pick the forklift classes the learner was evaluated on.', ['status' => 400]);
        }
        if (in_array(easy_enrollment_status($enrollment), ['suspended'], true)) {
            return new WP_Error('easy_practical_enrollment_closed', 'This course is on hold (its key was revoked), so no certificate can be issued. Ask the office.', ['status' => 409]);
        }
    }

    // Claim the booking first, so two taps can never make two certificates.
    $claimed = $wpdb->query($wpdb->prepare(
        "UPDATE " . easy_practicals_table('bookings') . " SET status = %s, live = NULL, result_by = %d, result_at = %s, result_note = %s, classes = %s WHERE id = %d AND status = 'booked'",
        $result, (int) $actor_id, easy_practical_now(), $note, implode(',', $classes), (int) $booking->id
    ));
    if ($claimed !== 1) {
        return new WP_Error('easy_practical_not_live', 'A result is already recorded for this booking.', ['status' => 409]);
    }

    if ($result !== 'passed') {
        easy_practical_release_enrollment($booking);
        $booking = easy_practical_booking($booking->id);
        do_action('easy_practical_result', $booking, $slot, $enrollment);
        return ['booking' => $booking, 'cert' => null];
    }

    $cert = easy_practical_create_cert($booking, $slot, $enrollment, $classes);
    if (is_wp_error($cert)) {
        // Give the booking back so the result can be recorded again.
        $wpdb->update(easy_practicals_table('bookings'), [
            'status' => 'booked', 'live' => 1, 'result_by' => 0, 'result_at' => null, 'result_note' => null, 'classes' => '',
        ], ['id' => (int) $booking->id]);
        return $cert;
    }
    $wpdb->update(easy_practicals_table('bookings'), ['cert_post_id' => (int) $cert], ['id' => (int) $booking->id]);
    easy_enrollment_set_status($enrollment, 'completed', [
        'completed_at' => easy_practical_now(),
        'cert_post_id' => (int) $cert,
        'progress'     => 100,
    ]);
    $booking = easy_practical_booking($booking->id);
    do_action('easy_practical_result', $booking, $slot, $enrollment);
    return ['booking' => $booking, 'cert' => (int) $cert];
}

/** Three years on, with Feb 29 clamped to Feb 28 (the app's expiryPlus3Years). */
function easy_practical_expiry($ymd) {
    [$y, $m, $d] = array_map('intval', explode('-', $ymd));
    $last = (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $y + 3, $m)))->format('t');
    return sprintf('%04d-%02d-%02d', $y + 3, $m, min($d, $last));
}

/**
 * The certificate for a pass: the same fields, number, title and expiry
 * the desktop app writes, with the evaluator as instructor and author. A
 * draft for the office unless Settings says to publish right away. The
 * PDF is made when the office opens the draft in the desktop app.
 */
function easy_practical_create_cert($booking, $slot, $enrollment, array $classes) {
    $cert = easy_practical_cert_course_for($slot->course);
    if (!$cert) {
        return new WP_Error('easy_practical_cert_course', 'No certificate course is set for "' . easy_licenses_course_title($slot->course) . '". Set it in EASY Suite → Settings, then record the result again.', ['status' => 409]);
    }
    $learner = easy_practical_learner($enrollment);
    $evaluator = get_userdata((int) $slot->evaluator_id);
    $date = easy_practical_local($slot->starts_at, 'Y-m-d');
    $code = strtoupper(str_replace('-', '', $cert['value']));
    $number = substr(str_replace('-', '', $date), 2) . $code . '01';
    if (function_exists('easy_suite_next_free_cert_number')) {
        $number = easy_suite_next_free_cert_number($number);
        if (is_wp_error($number)) {
            return $number;
        }
    }
    $course_name = $cert['label'];
    if ($cert['value'] === 'counter-balance-forklift' && $classes) {
        $course_name .= ' (Class ' . implode('-', $classes) . ')';
    }
    $post_id = wp_insert_post([
        'post_type'   => 'cert',
        'post_status' => 'draft',
        'post_title'  => $date . ' - ' . $course_name . ' - ' . $learner['name'],
        'post_author' => (int) $slot->evaluator_id,
    ], true);
    if (is_wp_error($post_id)) {
        return new WP_Error('easy_practical_cert_failed', 'The certificate could not be created: ' . $post_id->get_error_message(), ['status' => 500]);
    }
    $fields = [
        'student_name'       => $learner['name'],
        'student_email'      => $learner['email'],
        'student_phone'      => $learner['phone'],
        'course_category'    => $cert['category'],
        'course_title'       => $cert['value'],
        'completion_date'    => $date,
        'expiry_date'        => easy_practical_expiry($date),
        'instructor'         => $evaluator ? $evaluator->display_name : '',
        'instructor_email'   => $evaluator ? $evaluator->user_email : '',
        'company'            => $learner['company'],
        'company_contact'    => $learner['supervisorEmail'],
        'certificate_number' => $number,
    ];
    foreach ($fields as $name => $value) {
        if (function_exists('update_field')) {
            update_field($name, $value, $post_id);
        } else {
            update_post_meta($post_id, $name, $value);
        }
    }
    update_post_meta($post_id, '_easy_practical_booking', (int) $booking->id);
    if (easy_practical_auto_publish()) {
        // Fields first: publishing is what sends the student their email.
        wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);
    }
    return (int) $post_id;
}

/* ---------------- lists ---------------- */

/**
 * Slots for the staff screen: everything from $days_back days ago on, plus
 * any older time still waiting for a result. Instructors get their own
 * times; the office gets everyone's.
 */
function easy_practical_staff_slots($user_id, $days_back = 30) {
    global $wpdb;
    $s = easy_practicals_table('slots');
    $b = easy_practicals_table('bookings');
    $since = easy_practical_utc_plus('-' . max(0, min(365, (int) $days_back)) . ' days');
    $where = "(s.starts_at >= %s OR EXISTS (SELECT 1 FROM $b x WHERE x.slot_id = s.id AND x.live = 1))";
    $params = [$since];
    if (!easy_practical_is_office(get_userdata((int) $user_id))) {
        $where .= ' AND s.evaluator_id = %d';
        $params[] = (int) $user_id;
    }
    return $wpdb->get_results($wpdb->prepare("SELECT s.* FROM $s s WHERE $where ORDER BY s.starts_at ASC, s.id ASC", $params)) ?: [];
}

/** Open future slots with room, for one course. $hours_ahead hides times starting sooner. */
function easy_practical_open_slots($cid, $hours_ahead = 0) {
    global $wpdb;
    $s = easy_practicals_table('slots');
    $from = easy_practical_utc_plus('+' . (int) $hours_ahead . ' hours');
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM $s WHERE course = %s AND status = 'open' AND starts_at > %s ORDER BY starts_at ASC LIMIT 60",
        (string) $cid, $from
    )) ?: [];
    return array_values(array_filter($rows, function ($slot) {
        return easy_practical_taken($slot->id) < (int) $slot->capacity;
    }));
}

/** Learners in a course with a practical who haven't booked one yet (office list). */
function easy_practical_waiting() {
    global $wpdb;
    $e = easy_licenses_table('enrollments');
    $rows = $wpdb->get_results("SELECT * FROM $e WHERE open_slot = 1 AND status IN ('active','theory_complete') ORDER BY started_at ASC, id ASC LIMIT 500") ?: [];
    $out = [];
    foreach ($rows as $row) {
        if (easy_enrollment_status($row) !== $row->status || !easy_practical_course_required($row->course)) {
            continue;
        }
        $out[] = [
            'enrollmentId' => (int) $row->id,
            'course'       => $row->course,
            'courseTitle'  => easy_licenses_course_title($row->course),
            'learner'      => easy_practical_learner($row),
            'theoryDone'   => easy_practical_theory_done($row),
            'progress'     => (int) $row->progress,
            'startedAt'    => easy_licenses_iso($row->started_at),
            'lastActiveAt' => easy_licenses_iso($row->last_active_at),
        ];
    }
    return $out;
}

/** The learner's practical picture: one entry per open course that has a practical. */
function easy_practical_for_learner($user_id) {
    global $wpdb;
    $e = easy_licenses_table('enrollments');
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM $e WHERE user_id = %d AND (open_slot = 1 OR status = 'completed') ORDER BY started_at DESC, id DESC",
        (int) $user_id
    )) ?: [];
    $out = [];
    $soon = easy_practical_utc_plus('+' . EASY_PRACTICAL_LEARNER_HOURS . ' hours');
    foreach ($rows as $row) {
        if (!easy_practical_course_required($row->course)) {
            continue;
        }
        $status = easy_enrollment_status($row);
        $live = easy_practical_live_for_enrollment($row->id);
        $slot = $live ? easy_practical_slot($live->slot_id) : null;
        $item = [
            'enrollment' => easy_enrollment_export($row),
            'status'     => $status,
            'booking'    => null,
            'slots'      => [],
            'canBook'    => !$live && in_array($status, ['active', 'theory_complete'], true),
        ];
        if ($live && $slot) {
            $item['booking'] = [
                'id'        => (int) $live->id,
                'slot'      => easy_practical_export_slot_public($slot),
                'canCancel' => $slot->starts_at > $soon,
            ];
        }
        if ($item['canBook']) {
            $item['slots'] = array_map('easy_practical_export_slot_public', easy_practical_open_slots($row->course, EASY_PRACTICAL_LEARNER_HOURS));
        }
        $out[] = $item;
    }
    return $out;
}

/* ---------------- email ---------------- */

/** A short email; the branded wrapper module dresses it. */
function easy_practical_mail($to, $subject, array $lines) {
    $to = sanitize_email((string) $to);
    if (!is_email($to)) {
        return false;
    }
    $html = '';
    foreach ($lines as $line) {
        $html .= '<p style="font-size:16px;line-height:1.6;margin:0 0 14px 0;">' . $line . '</p>';
    }
    return wp_mail($to, $subject, $html, [
        'Content-Type: text/html; charset=UTF-8',
        'From: EASY Safety Training <notifications@easysafety.ca>',
        'Reply-To: pam@easysafety.ca',
    ]);
}

function easy_practical_slot_lines($slot) {
    return [
        '<strong>When:</strong> ' . esc_html(easy_practical_when($slot)) . ' (Newfoundland time)',
        '<strong>Where:</strong> ' . esc_html($slot->location),
        '<strong>Evaluator:</strong> ' . esc_html(easy_practical_evaluator_name($slot->evaluator_id)),
    ];
}

/** Learner confirmation, plus a heads-up to the evaluator when someone else booked it. */
function easy_practical_email_booked($booking, $slot, $enrollment, $actor_id) {
    $learner = easy_practical_learner($enrollment);
    $course = easy_licenses_course_title($slot->course);
    easy_practical_mail($learner['email'], 'Your practical for ' . $course . ' is booked', array_merge(
        ['Hi ' . esc_html($learner['name']) . ',', 'Your hands-on practical for <strong>' . esc_html($course) . '</strong> is booked.'],
        easy_practical_slot_lines($slot),
        [
            'Please finish the online part of the course before you come.',
            'Need to change the time? You can cancel online up to ' . EASY_PRACTICAL_LEARNER_HOURS . ' hours before and book another, or call us at (709) 221-7233.',
        ]
    ));
    if ((int) $actor_id !== (int) $slot->evaluator_id) {
        $evaluator = get_userdata((int) $slot->evaluator_id);
        if ($evaluator) {
            easy_practical_mail($evaluator->user_email, 'Practical booked: ' . $learner['name'] . ', ' . easy_practical_local($slot->starts_at, 'M j'), array_merge(
                [esc_html($learner['name']) . ($learner['company'] !== '' ? ' (' . esc_html($learner['company']) . ')' : '') . ' booked your practical for <strong>' . esc_html($course) . '</strong>.'],
                easy_practical_slot_lines($slot),
                ['It shows in EASY Manager under Practicals.']
            ));
        }
    }
}

function easy_practical_email_cancelled($booking, $slot, $actor_id, $quiet) {
    $enrollment = easy_enrollment_get($booking->enrollment_id);
    if (!$enrollment) {
        return;
    }
    $learner = easy_practical_learner($enrollment);
    $course = easy_licenses_course_title($slot->course);
    if ((int) $actor_id !== (int) $booking->user_id) {
        easy_practical_mail($learner['email'], 'Your practical for ' . $course . ' was cancelled', array_merge(
            ['Hi ' . esc_html($learner['name']) . ',', 'Your practical for <strong>' . esc_html($course) . '</strong> on ' . esc_html(easy_practical_when($slot)) . ' was cancelled.'],
            $booking->result_note !== '' ? ['<strong>Reason:</strong> ' . esc_html($booking->result_note)] : [],
            ['You can book another time from My Courses, or call us at (709) 221-7233 and we\'ll book one with you.']
        ));
    }
    if (!$quiet && (int) $actor_id !== (int) $slot->evaluator_id) {
        $evaluator = get_userdata((int) $slot->evaluator_id);
        if ($evaluator) {
            easy_practical_mail($evaluator->user_email, 'Practical cancelled: ' . $learner['name'] . ', ' . easy_practical_local($slot->starts_at, 'M j'), [
                esc_html($learner['name']) . '\'s practical for <strong>' . esc_html($course) . '</strong> on ' . esc_html(easy_practical_when($slot)) . ' was cancelled. The place is open again.',
            ]);
        }
    }
}

/* ---------------- health ---------------- */

function easy_practicals_health() {
    global $wpdb;
    $label = 'Practicals';
    if (!function_exists('easy_licenses_ready')) {
        return [$label, 'warn', 'Needs the "Online courses: license keys" module, which is switched off.'];
    }
    if ((int) get_option('easy_practicals_db') !== EASY_PRACTICALS_DB) {
        $why = get_transient('easy_practicals_db_failed');
        return [$label, 'error', 'The practical tables are not set up' . ($why ? ': ' . $why : '') . '. Practicals can\'t be posted or booked.'];
    }
    $now = easy_practical_now();
    $upcoming = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM " . easy_practicals_table('slots') . " WHERE status = 'open' AND starts_at > %s", $now));
    $waiting = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM " . easy_practicals_table('bookings') . " b JOIN " . easy_practicals_table('slots') . " s ON s.id = b.slot_id WHERE b.live = 1 AND s.starts_at <= %s",
        $now
    ));
    return [
        $label,
        $waiting ? 'warn' : 'ok',
        sprintf('%d upcoming practical time(s). %d booking(s) past their time with no result yet. ', $upcoming, $waiting)
            . 'A pass ' . (easy_practical_auto_publish() ? 'publishes the certificate right away.' : 'makes a certificate draft for the office to review.')
            . (easy_practical_require_theory() ? '' : ' The online part does not have to be finished before a pass.'),
    ];
}

/* ---------------- REST ---------------- */

add_action('rest_api_init', function () {
    $ns = 'easy/v1';
    $guard = function ($callback) {
        return function (WP_REST_Request $request) use ($callback) {
            if (!easy_practicals_ready()) {
                return easy_practicals_not_ready_error();
            }
            return $callback($request);
        };
    };
    $staff_view = function () {
        $uid = get_current_user_id();
        $office = easy_practical_is_office();
        $courses = [];
        foreach (easy_licenses_courses() as $cid => $c) {
            if (!easy_practical_course_required($cid)) {
                continue;
            }
            if (!$office && !easy_practical_can_evaluate($uid, $cid)) {
                continue;
            }
            $courses[] = [
                'id'         => $cid,
                'title'      => $c['title'],
                'forklift'   => easy_practical_is_forklift($cid),
                'evaluators' => $office ? array_map(function ($u) { return ['id' => (int) $u->ID, 'name' => $u->display_name]; }, easy_practical_evaluators($cid)) : [],
            ];
        }
        return [
            'office'        => $office,
            'me'            => easy_practical_person($uid),
            'autoPublish'   => easy_practical_auto_publish(),
            'requireTheory' => easy_practical_require_theory(),
            'courses'       => $courses,
            'classes'       => EASY_PRACTICAL_FORKLIFT_CLASSES,
        ];
    };

    register_rest_route($ns, '/practicals', [
        [
            'methods'             => 'GET',
            'permission_callback' => 'easy_practical_rest_staff',
            'callback'            => $guard(function (WP_REST_Request $request) use ($staff_view) {
                $days = $request->get_param('days_back');
                $slots = easy_practical_staff_slots(get_current_user_id(), $days === null ? 30 : (int) $days);
                return $staff_view() + ['slots' => array_map('easy_practical_export_slot', $slots)];
            }),
        ],
        [
            'methods'             => 'POST',
            'permission_callback' => 'easy_practical_rest_staff',
            'callback'            => $guard(function (WP_REST_Request $request) {
                $slot = easy_practical_create_slot([
                    'course'    => (string) $request->get_param('course'),
                    'evaluator' => (int) $request->get_param('evaluator'),
                    'date'      => (string) $request->get_param('date'),
                    'start'     => (string) $request->get_param('start'),
                    'end'       => (string) $request->get_param('end'),
                    'location'  => (string) $request->get_param('location'),
                    'capacity'  => (int) ($request->get_param('capacity') ?? 1),
                    'note'      => (string) $request->get_param('note'),
                ], get_current_user_id());
                return is_wp_error($slot) ? $slot : new WP_REST_Response(['slot' => easy_practical_export_slot($slot)], 201);
            }),
        ],
    ]);

    register_rest_route($ns, '/practicals/waiting', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_practical_rest_office',
        'callback'            => $guard(function () {
            $open = [];
            foreach (easy_licenses_courses() as $cid => $c) {
                if (easy_practical_course_required($cid)) {
                    $open[$cid] = array_map('easy_practical_export_slot_public', easy_practical_open_slots($cid));
                }
            }
            return ['learners' => easy_practical_waiting(), 'openSlots' => $open];
        }),
    ]);

    register_rest_route($ns, '/practicals/(?P<id>\d+)/cancel', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_practical_rest_staff',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $result = easy_practical_cancel_slot((int) $request['id'], get_current_user_id(), (string) $request->get_param('reason'));
            return is_wp_error($result) ? $result : ['slot' => easy_practical_export_slot($result['slot']), 'cancelled' => $result['cancelled']];
        }),
    ]);

    register_rest_route($ns, '/practicals/(?P<id>\d+)/book', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_practical_rest_office',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $booking = easy_practical_book((int) $request['id'], (int) $request->get_param('enrollment'), get_current_user_id(), false);
            if (is_wp_error($booking)) {
                return $booking;
            }
            return new WP_REST_Response(['slot' => easy_practical_export_slot(easy_practical_slot($booking->slot_id))], 201);
        }),
        'args' => ['enrollment' => ['required' => true, 'type' => 'integer']],
    ]);

    register_rest_route($ns, '/practical-bookings/(?P<id>\d+)/result', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_practical_rest_staff',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $classes = $request->get_param('classes');
            $out = easy_practical_record_result(
                (int) $request['id'],
                (string) $request->get_param('result'),
                get_current_user_id(),
                (string) $request->get_param('note'),
                is_array($classes) ? $classes : array_filter(explode(',', (string) $classes))
            );
            if (is_wp_error($out)) {
                return $out;
            }
            $cert = $out['cert'] ? get_post($out['cert']) : null;
            return [
                'slot' => easy_practical_export_slot(easy_practical_slot($out['booking']->slot_id)),
                'cert' => $cert ? [
                    'id'     => (int) $cert->ID,
                    'status' => $cert->post_status,
                    'number' => (string) get_post_meta($cert->ID, 'certificate_number', true),
                ] : null,
            ];
        }),
        'args' => ['result' => ['required' => true, 'type' => 'string', 'enum' => EASY_PRACTICAL_RESULTS]],
    ]);

    register_rest_route($ns, '/practical-bookings/(?P<id>\d+)/cancel', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_practical_rest_staff',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $booking = easy_practical_cancel_booking((int) $request['id'], get_current_user_id(), false, (string) $request->get_param('reason'));
            return is_wp_error($booking) ? $booking : ['slot' => easy_practical_export_slot(easy_practical_slot($booking->slot_id))];
        }),
    ]);

    register_rest_route($ns, '/learn/practicals', [
        'methods'             => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => $guard(function () {
            return ['courses' => easy_practical_for_learner(get_current_user_id())];
        }),
    ]);

    register_rest_route($ns, '/learn/practicals/book', [
        'methods'             => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $booking = easy_practical_book((int) $request->get_param('slot'), (int) $request->get_param('enrollment'), get_current_user_id(), true);
            return is_wp_error($booking) ? $booking : new WP_REST_Response(['courses' => easy_practical_for_learner(get_current_user_id())], 201);
        }),
        'args' => [
            'slot'       => ['required' => true, 'type' => 'integer'],
            'enrollment' => ['required' => true, 'type' => 'integer'],
        ],
    ]);

    register_rest_route($ns, '/learn/practicals/(?P<id>\d+)/cancel', [
        'methods'             => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => $guard(function (WP_REST_Request $request) {
            $booking = easy_practical_cancel_booking((int) $request['id'], get_current_user_id(), true);
            return is_wp_error($booking) ? $booking : ['courses' => easy_practical_for_learner(get_current_user_id())];
        }),
    ]);
});

/* ---------------- learner page: [easy_practical_booking] ---------------- */

function easy_practical_page_url() {
    $ref = wp_get_referer();
    return $ref ? $ref : home_url('/');
}

function easy_practical_page_redirect($type, $text) {
    set_transient('easy_practical_msg_' . get_current_user_id(), ['type' => $type, 'text' => $text], 120);
    wp_safe_redirect(easy_practical_page_url());
    exit;
}

add_action('admin_post_easy_practical_book', function () {
    check_admin_referer('easy_practical_learner');
    if (!easy_practicals_ready()) {
        easy_practical_page_redirect('error', easy_practicals_not_ready_error()->get_error_message());
    }
    $booking = easy_practical_book(absint($_POST['slot'] ?? 0), absint($_POST['enrollment'] ?? 0), get_current_user_id(), true);
    if (is_wp_error($booking)) {
        easy_practical_page_redirect('error', $booking->get_error_message());
    }
    $slot = easy_practical_slot($booking->slot_id);
    easy_practical_page_redirect('success', 'Your practical is booked for ' . easy_practical_when($slot) . '. A confirmation email is on its way.');
});

add_action('admin_post_easy_practical_cancel', function () {
    check_admin_referer('easy_practical_learner');
    if (!easy_practicals_ready()) {
        easy_practical_page_redirect('error', easy_practicals_not_ready_error()->get_error_message());
    }
    $booking = easy_practical_cancel_booking(absint($_POST['booking'] ?? 0), get_current_user_id(), true);
    if (is_wp_error($booking)) {
        easy_practical_page_redirect('error', $booking->get_error_message());
    }
    easy_practical_page_redirect('success', 'Your practical was cancelled. You can pick another time below.');
});

add_shortcode('easy_practical_booking', function () {
    if (!is_user_logged_in()) {
        return '<p>Please <a href="' . esc_url(wp_login_url(get_permalink())) . '">sign in</a> to book your practical.</p>';
    }
    if (!easy_practicals_ready()) {
        return '<p>Practical booking isn\'t open yet. Please call us at (709) 221-7233.</p>';
    }
    $courses = easy_practical_for_learner(get_current_user_id());
    $msg = get_transient('easy_practical_msg_' . get_current_user_id());
    if ($msg) {
        delete_transient('easy_practical_msg_' . get_current_user_id());
    }
    $action = esc_url(admin_url('admin-post.php'));
    $nonce = wp_nonce_field('easy_practical_learner', '_wpnonce', true, false);
    ob_start();
    echo '<div class="easy-practicals">';
    if ($msg) {
        $color = $msg['type'] === 'success' ? '#12853C' : '#b32d2e';
        echo '<p style="border-left:4px solid ' . esc_attr($color) . ';padding:8px 12px;background:#f6f7f7;">' . esc_html($msg['text']) . '</p>';
    }
    if (!$courses) {
        echo '<p>None of your courses need a practical right now.</p>';
    }
    foreach ($courses as $item) {
        $e = $item['enrollment'];
        echo '<div style="border:1px solid #dcdcde;border-radius:8px;padding:16px;margin:0 0 16px;">';
        echo '<h3 style="margin-top:0;">' . esc_html($e['courseTitle']) . '</h3>';
        if ($item['status'] === 'completed') {
            echo '<p>Practical passed. ' . (easy_practical_auto_publish() ? 'Your certificate is under My Certificates.' : 'Your certificate will appear under My Certificates once the office has reviewed it.') . '</p>';
        } elseif ($item['booking']) {
            $s = $item['booking']['slot'];
            echo '<p><strong>Your practical:</strong> ' . esc_html($s['when']) . '<br>' . esc_html($s['location']) . '<br>Evaluator: ' . esc_html($s['evaluator']) . '</p>';
            if ($item['booking']['canCancel']) {
                echo '<form method="post" action="' . $action . '" onsubmit="return confirm(\'Cancel this practical?\');">' . $nonce
                    . '<input type="hidden" name="action" value="easy_practical_cancel"><input type="hidden" name="booking" value="' . (int) $item['booking']['id'] . '">'
                    . '<button type="submit" class="button">Cancel this practical</button></form>';
            } else {
                echo '<p>To change this time now, please call us at (709) 221-7233.</p>';
            }
        } elseif (!$item['canBook']) {
            echo '<p>This course can\'t have a practical booked right now. Please call us at (709) 221-7233.</p>';
        } elseif (!$item['slots']) {
            echo '<p>There are no practical times open right now. New times are added often; check back soon or call us at (709) 221-7233.</p>';
        } else {
            echo '<p>Pick a time for your hands-on practical. It\'s included with your course.</p>';
            echo '<form method="post" action="' . $action . '">' . $nonce
                . '<input type="hidden" name="action" value="easy_practical_book"><input type="hidden" name="enrollment" value="' . (int) $e['id'] . '">';
            foreach ($item['slots'] as $i => $s) {
                echo '<label style="display:block;margin:0 0 10px;"><input type="radio" name="slot" value="' . (int) $s['id'] . '"' . ($i === 0 ? ' checked' : '') . '> '
                    . '<strong>' . esc_html($s['when']) . '</strong><br><span style="margin-left:22px;">' . esc_html($s['location']) . ', with ' . esc_html($s['evaluator'])
                    . ' (' . (int) $s['placesLeft'] . ($s['placesLeft'] === 1 ? ' place' : ' places') . ' left)</span></label>';
            }
            echo '<button type="submit" class="button button-primary">Book this time</button></form>';
        }
        echo '</div>';
    }
    echo '</div>';
    return ob_get_clean();
});
