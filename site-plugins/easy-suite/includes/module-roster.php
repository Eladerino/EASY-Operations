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
    // System stamps ride along untouched (ints only); writers set them.
    $out['added']    = isset($rec['added']) ? max(0, (int) $rec['added']) : 0;
    $out['added_by'] = isset($rec['added_by']) ? max(0, (int) $rec['added_by']) : 0;
    return $out;
}

/* ------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------ */

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
    return array(
        'event_id' => $event_id,
        'roster'   => easy_roster_get($event_id),
    );
}

function easy_roster_rest_put($request) {
    $event_id = (int) $request['event_id'];
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
    $user   = wp_get_current_user();
    $result = easy_roster_set($event_id, $roster, ($user && $user->ID) ? (int) $user->ID : 0);
    if (is_wp_error($result)) {
        return $result;
    }
    return array(
        'event_id' => $event_id,
        'roster'   => $result,
    );
}
