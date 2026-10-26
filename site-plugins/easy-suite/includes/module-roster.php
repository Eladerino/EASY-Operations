<?php
/**
 * Module: Class rosters (manual enrollment).
 *
 * Per-class student rosters stored as post meta on tribe_events
 * (_easy_roster). Two writers feed the same roster:
 *
 *  - the EASY Operations desktop app (Pam enrolling phone/walk-in students
 *    through the Schedule tab's Add Students editor) over REST;
 *  - the ticket checkout, once per-seat attendee capture is wired in.
 *
 * The app sees the full record (name, employer, phone, email, payment,
 * notes). Calendar contexts (the tokened instructor ICS feed) show names
 * only — see easy_roster_names().
 */

defined('ABSPATH') || exit;

define('EASY_ROSTER_META', '_easy_roster');
define('EASY_ROSTER_MAX_STUDENTS', 500);
define('EASY_ROSTER_REV_META', '_easy_roster_rev');

/* ------------------------------------------------------------------
 * Record shape + sanitization
 * ------------------------------------------------------------------ */

/** String fields and their max lengths. name is required. */
function easy_roster_field_spec() {
    return array(
        'name'     => 100, // as it should appear on the certificate
        'employer' => 100,
        'phone'    => 40,
        'email'    => 100,
        'payment'  => 20,  // paid|unpaid|po|comp
        'notes'    => 500,
        'source'   => 10,  // manual|checkout
        // Check-in fields (module-checkin.php). Optional: records that
        // never went through check-in simply carry them empty.
        'emergency_name'   => 100,
        'emergency_phone'  => 40,
        'recert_expiry'    => 10,  // Y-m-d, only when the class collects it
        'waiver_version'   => 40,  // version label of the text that was signed
        'waiver_text_hash' => 64,  // sha256 of the exact text that was signed
        'waiver_signature' => 120, // private signature file name (never a URL)
        'checkin_status'   => 16,  // booked|checked_in|needs_review|manual
        'checkin_source'   => 10,  // qr|manual|walkin
        // Collected only when a class has ID check switched on (the
        // check-in toggle defaults off, so these stay empty otherwise).
        // id_last4 allows 8 chars here so an over-long entry reaches the
        // exact-length check below and is dropped, not silently cut to 4.
        'id_last4'         => 8,   // last 4 digits only, never the full ID
        'dob'              => 10,  // Y-m-d
    );
}

/**
 * Sanitize one roster record. Returns the clean record, or null when the
 * record is unusable (missing/invalid name or email).
 */
function easy_roster_sanitize_record($rec) {
    if (!is_array($rec)) {
        return null;
    }
    $out = array();
    foreach (easy_roster_field_spec() as $key => $max) {
        $v = isset($rec[$key]) && is_string($rec[$key]) ? trim($rec[$key]) : '';
        $v = function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
        $out[$key] = sanitize_text_field($v);
    }
    if ($out['name'] === '') {
        return null;
    }
    if ($out['email'] !== '' && !is_email($out['email'])) {
        return null;
    }
    $out['payment'] = strtolower($out['payment']);
    if (!in_array($out['payment'], array('paid', 'unpaid', 'po', 'comp', ''), true)) {
        $out['payment'] = '';
    }
    if (!in_array($out['source'], array('manual', 'checkout'), true)) {
        $out['source'] = 'manual';
    }
    // Check-in enums: an unknown value means "not checked in", never a
    // status the rest of the system cannot read.
    if (!in_array($out['checkin_status'], array('booked', 'checked_in', 'needs_review', 'manual', ''), true)) {
        $out['checkin_status'] = '';
    }
    if (!in_array($out['checkin_source'], array('qr', 'manual', 'walkin', ''), true)) {
        $out['checkin_source'] = '';
    }
    // The signature reference is the file name module-checkin.php mints
    // (sig-<event>-<hash>.png) inside the private signatures folder.
    // Anything else, path-like or not, is dropped: the gated serve route
    // only ever resolves names inside that one folder.
    $out['waiver_signature'] = basename($out['waiver_signature']);
    if (!preg_match('/^sig-\d+-[a-f0-9]{12}\.png$/', $out['waiver_signature'])) {
        $out['waiver_signature'] = '';
    }
    // Recert expiry only survives as a plain Y-m-d date.
    if ($out['recert_expiry'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $out['recert_expiry'])) {
        $out['recert_expiry'] = '';
    }
    if ($out['dob'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $out['dob'])) {
        $out['dob'] = '';
    }
    if ($out['id_last4'] !== '' && !preg_match('/^[0-9]{4}$/', $out['id_last4'])) {
        $out['id_last4'] = '';
    }
    // Check-in stamps ride along like `added` (ints only); writers set them.
    $out['checkin_at']       = isset($rec['checkin_at']) ? max(0, (int) $rec['checkin_at']) : 0;
    $out['waiver_signed_at'] = isset($rec['waiver_signed_at']) ? max(0, (int) $rec['waiver_signed_at']) : 0;
    // Per-day attendance for multi-day classes: a Y-m-d => true map.
    $out['attendance_days'] = array();
    if (isset($rec['attendance_days']) && is_array($rec['attendance_days'])) {
        foreach ($rec['attendance_days'] as $day => $present) {
            if (is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) && $present) {
                $out['attendance_days'][$day] = true;
            }
        }
    }
    // System stamps ride along untouched (ints only); writers set them.
    $out['added']    = isset($rec['added']) ? max(0, (int) $rec['added']) : 0;
    $out['added_by'] = isset($rec['added_by']) ? max(0, (int) $rec['added_by']) : 0;
    // Stable record id, assigned once: lets writers tell records apart
    // across saves (checkout protection, cancel/refund removal).
    $rid = isset($rec['id']) && is_string($rec['id']) ? trim($rec['id']) : '';
    $rid = preg_replace('/[^a-zA-Z0-9_-]/', '', $rid);
    if ($rid === '' && function_exists('wp_generate_uuid4')) {
        $rid = 'r_' . wp_generate_uuid4();
    }
    $out['id'] = substr($rid, 0, 60);
    // The WooCommerce order this record came from (checkout records only).
    $out['order_id'] = isset($rec['order_id']) ? max(0, (int) $rec['order_id']) : 0;
    return $out;
}

/* ------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
 * Revision tracking (optimistic concurrency for the app's editor)
 *
 * Every roster write bumps the revision. The app sends back the
 * revision it loaded; a mismatch means someone else (e.g. an online
 * seat sale) changed the list meanwhile, and the save is rejected.
 * ------------------------------------------------------------------ */

/** Current roster revision for an event (seeded on first read). */
function easy_roster_revision($event_id) {
    $event_id = (int) $event_id;
    $rev = (int) get_post_meta($event_id, EASY_ROSTER_REV_META, true);
    if ($rev < 1) {
        $rev = 1;
        update_post_meta($event_id, EASY_ROSTER_REV_META, $rev);
    }
    return $rev;
}

/** Bump the roster revision after any write. Every writer must call this. */
function easy_roster_bump_revision($event_id) {
    $event_id = (int) $event_id;
    $rev = (int) get_post_meta($event_id, EASY_ROSTER_REV_META, true);
    $rev = max(1, $rev) + 1;
    update_post_meta($event_id, EASY_ROSTER_REV_META, $rev);
    return $rev;
}

/** Read the roster for an event. Always returns an array. */
function easy_roster_get($event_id) {
    $event_id = (int) $event_id;
    if ($event_id <= 0) {
        return array();
    }
    $raw = get_post_meta($event_id, EASY_ROSTER_META, true);
    if (!is_array($raw)) {
        return array();
    }
    $out = array();
    foreach (array_slice($raw, 0, EASY_ROSTER_MAX_STUDENTS) as $rec) {
        if (!is_array($rec) || empty($rec['name'])) {
            continue;
        }
        $out[] = $rec;
    }
    return array_values($out);
}

/**
 * Replace the roster for an event with a sanitized copy.
 * Returns the stored roster, or WP_Error.
 */
function easy_roster_set($event_id, $roster, $user_id = 0) {
    $event_id = (int) $event_id;
    if ($event_id <= 0 || get_post_type($event_id) !== 'tribe_events') {
        return new WP_Error('easy_roster_bad_event', 'Not a class event.', array('status' => 400));
    }
    if (!is_array($roster)) {
        return new WP_Error('easy_roster_bad_roster', 'Roster must be an array of student records.', array('status' => 400));
    }
    $clean = array();
    foreach (array_slice($roster, 0, EASY_ROSTER_MAX_STUDENTS) as $rec) {
        $s = easy_roster_sanitize_record($rec);
        if ($s === null) {
            continue;
        }
        if ($s['added'] === 0) {
            $s['added'] = time();
        }
        if ($s['added_by'] === 0 && $user_id > 0) {
            $s['added_by'] = (int) $user_id;
        }
        $clean[] = $s;
    }
    $old_roster = easy_roster_get($event_id);
    update_post_meta($event_id, EASY_ROSTER_META, $clean);
    easy_roster_bump_revision($event_id);

    /**
     * Fires after a roster is replaced.
     *
     * @param int   $event_id
     * @param array $clean    Sanitized roster that was stored.
     * @param array $old      Roster as it was before this write.
     * @param int   $user_id  WP user that wrote it (0 = system/checkout).
     */
    do_action('easy_roster_updated', $event_id, $clean, $old_roster, (int) $user_id);

    return $clean;
}

/** Student names for an event — the only roster data calendar contexts get. */
function easy_roster_names($event_id) {
    $names = array();
    foreach (easy_roster_get($event_id) as $rec) {
        if (!empty($rec['name'])) {
            $names[] = $rec['name'];
        }
    }
    return $names;
}

/* ------------------------------------------------------------------
 * REST — the EASY Operations app's Add Students editor
 * ------------------------------------------------------------------ */

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/roster/(?P<event_id>\d+)', array(
        array(
            'methods'             => 'GET',
            'callback'            => 'easy_roster_rest_get',
            'permission_callback' => 'easy_cert_rest_can_access',
        ),
        array(
            'methods'             => 'PUT',
            'callback'            => 'easy_roster_rest_put',
            'permission_callback' => 'easy_cert_rest_can_access',
        ),
    ));
});

function easy_roster_rest_get($request) {
    $event_id = (int) $request['event_id'];
    if (get_post_type($event_id) !== 'tribe_events') {
        return new WP_Error('easy_roster_bad_event', 'Not a class event.', array('status' => 404));
    }
    // Full rosters carry student phone numbers, emails and payment
    // state, so reads are office-only. (There is no account-to-
    // instructor mapping on the site, so "their own classes" cannot be
    // resolved; instructors see names only, in their calendar feed.)
    if (!easy_suite_is_office_user()) {
        return new WP_Error('easy_roster_forbidden', 'Class student lists are only available to office accounts.', array('status' => 403));
    }
    return array(
        'event_id' => $event_id,
        'roster'   => easy_roster_get($event_id),
        'revision' => easy_roster_revision($event_id),
    );
}

function easy_roster_rest_put($request) {
    $event_id = (int) $request['event_id'];
    if (get_post_type($event_id) !== 'tribe_events') {
        return new WP_Error('easy_roster_bad_event', 'Not a class event.', array('status' => 404));
    }
    // Roster edits need the same rights as editing the class itself.
    // (The app only shows the Students editor when the account can edit
    // events, so no legitimate app flow loses access here.)
    if (!current_user_can('edit_post', $event_id)) {
        return new WP_Error('easy_roster_forbidden', 'This account is not allowed to edit this class.', array('status' => 403));
    }
    $params   = $request->get_json_params();
    if (!is_array($params) || !array_key_exists('roster', $params)) {
        // Also accept form-encoded for easy curl testing.
        $params = $request->get_body_params();
    }
    $roster = (is_array($params) && isset($params['roster']) && is_array($params['roster']))
        ? $params['roster']
        : null;
    if ($roster === null) {
        return new WP_Error('easy_roster_bad_roster', 'Send a JSON body like {"roster": [...]}.', array('status' => 400));
    }
    // Optimistic concurrency: reject the save when the roster changed
    // since the app loaded it (e.g. a seat sold online meanwhile).
    // Older clients that send no revision are handled below.
    $sent_revision = (is_array($params) && isset($params['revision'])) ? (int) $params['revision'] : null;
    $current_revision = easy_roster_revision($event_id);
    if ($sent_revision !== null && $sent_revision !== $current_revision) {
        return new WP_Error(
            'easy_roster_conflict',
            'The student list changed since you opened it (for example, a seat was sold online). The latest version is included below. Please check it and try again.',
            array(
                'status'   => 409,
                'roster'   => easy_roster_get($event_id),
                'revision' => $current_revision,
            )
        );
    }
    // Students who paid online can only leave the roster through a
    // cancelled/refunded order (or an administrator) — never here.
    $old_checkout_ids = array();
    foreach (easy_roster_get($event_id) as $rec) {
        if (is_array($rec) && isset($rec['source']) && $rec['source'] === 'checkout' && !empty($rec['id'])) {
            $old_checkout_ids[(string) $rec['id']] = true;
        }
    }
    // A save with no revision comes from an app older than 1.2.4, which
    // can't tell that a seat sold online after it loaded the list. Once
    // the list holds online buyers, refuse it rather than risk writing
    // over them; updating the app fixes it.
    if ($sent_revision === null && !empty($old_checkout_ids)) {
        return new WP_Error(
            'easy_roster_update_app',
            'This class has students who paid online, and this version of the app can\'t save their list safely. Update EASY Operations (restart it to install the update), then try again.',
            array('status' => 403)
        );
    }
    if (!empty($old_checkout_ids)) {
        $new_ids = array();
        foreach ($roster as $rec) {
            if (is_array($rec) && !empty($rec['id'])) {
                $new_ids[(string) $rec['id']] = true;
            }
        }
        $removed = array_diff_key($old_checkout_ids, $new_ids);
        if (!empty($removed) && !current_user_can('manage_options')) {
            return new WP_Error(
                'easy_roster_checkout_locked',
                'This list includes students who paid online. They can only be removed by cancelling or refunding the order.',
                array('status' => 403)
            );
        }
    }
    $user   = wp_get_current_user();
    $result = easy_roster_set($event_id, $roster, ($user && $user->ID) ? (int) $user->ID : 0);
    if (is_wp_error($result)) {
        return $result;
    }
    return array(
        'event_id' => $event_id,
        'roster'   => $result,
        'revision' => easy_roster_revision($event_id),
    );
}
