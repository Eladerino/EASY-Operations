<?php
/**
 * Module: Instructor calendar feed (was EASY Instructor Calendar Feed 1.0.4).
 *
 * Pretty URL:  /instructor-calendar/<64-hex-token>.ics
 *
 * Each instructor (tribe_organizer) gets a secret 64-char token stored in
 * post meta. The token makes the feed URL unguessable; regenerating it kills
 * the old URL instantly. Slug-based URLs (e.g. /instructor-calendar/scott-glynn.ics)
 * returned 404 starting in 2.2.5, so instructors re-subscribe once with their
 * tokened link (Pam distributes them). Roster names appear in the feed;
 * phone/email/payment stay in the app only.
 *
 * The rewrite rule is flushed by EASY Suite on activation and version change.
 */

defined('ABSPATH') || exit;


/* ------------------------------------------------------------------
 * Rewrite rule + query vars
 *
 * Pretty URL:  https://easysafety.ca/instructor-calendar/<64-hex-token>.ics
 * Fallback:    https://easysafety.ca/?easy_instructor_ics=1&ics_token=<token>
 * ------------------------------------------------------------------ */

add_action('init', 'easy_ics_add_rewrite_rule');

function easy_ics_add_rewrite_rule() {
    add_rewrite_rule(
        '^instructor-calendar/([a-f0-9]{64})\.ics/?$',
        'index.php?easy_instructor_ics=1&ics_token=$matches[1]',
        'top'
    );
}

add_filter('query_vars', 'easy_ics_query_vars');

function easy_ics_query_vars($vars) {
    $vars[] = 'easy_instructor_ics';
    $vars[] = 'ics_token';
    return $vars;
}

/* ------------------------------------------------------------------
 * Request handling
 * ------------------------------------------------------------------ */

add_action('template_redirect', 'easy_ics_maybe_serve');

function easy_ics_maybe_serve() {
    if (!get_query_var('easy_instructor_ics')) {
        return;
    }
    easy_ics_serve_feed();
    exit;
}

function easy_ics_serve_feed() {
    $token = get_query_var('ics_token');
    if (!$token && isset($_GET['ics_token'])) {
        $token = sanitize_text_field(wp_unslash($_GET['ics_token']));
    }

    // Never confirm whether a feed exists: a bad or missing token is a
    // plain 404, identical to a nonexistent page.
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        status_header(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Not found.';
        exit;
    }

    if (!post_type_exists('tribe_events')) {
        status_header(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'The Events Calendar is not active on this site.';
        exit;
    }

    $organizer = easy_ics_find_organizer_by_token($token);
    if (!$organizer) {
        status_header(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Not found.';
        exit;
    }

    $now  = time();
    $from = $now - 30 * DAY_IN_SECONDS;   // keep a little history
    $to   = $now + 365 * DAY_IN_SECONDS;  // ...and a year ahead

    $events = easy_ics_get_instructor_events((int) $organizer->ID, $from, $to);
    $ics    = easy_ics_build($organizer, $events);

    nocache_headers();
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="' . sanitize_file_name($organizer->post_name . '-classes.ics') . '"');
    echo $ics;
    exit;
}

/* ------------------------------------------------------------------
 * Feed tokens — one secret per instructor (tribe_organizer)
 *
 * The token lives in post meta (_easy_ics_token) and is the only thing
 * that identifies a feed. There is no slug/name fallback: without the
 * exact token the feed is a 404, which keeps student names in the feed
 * behind an unguessable URL.
 * ------------------------------------------------------------------ */

define('EASY_ICS_TOKEN_META', '_easy_ics_token');

/** The instructor's feed token, generating one on first use. */
function easy_ics_get_token($organizer_id) {
    $organizer_id = (int) $organizer_id;
    if ($organizer_id <= 0) {
        return '';
    }
    $token = get_post_meta($organizer_id, EASY_ICS_TOKEN_META, true);
    if (is_string($token) && preg_match('/^[a-f0-9]{64}$/', $token)) {
        return $token;
    }
    return easy_ics_regenerate_token($organizer_id);
}

/** Fresh token for an instructor. The previous feed URL dies instantly. */
function easy_ics_regenerate_token($organizer_id) {
    $organizer_id = (int) $organizer_id;
    if ($organizer_id <= 0) {
        return '';
    }
    $token = bin2hex(random_bytes(32));
    update_post_meta($organizer_id, EASY_ICS_TOKEN_META, $token);
    return $token;
}

/** Find the organizer that owns a feed token (timing-safe compare). */
function easy_ics_find_organizer_by_token($token) {
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    $ids = get_posts(array(
        'post_type'      => 'tribe_organizer',
        'post_status'    => 'publish',
        'numberposts'    => 200,
        'fields'         => 'ids',
        'no_found_rows'  => true,
        'meta_key'       => EASY_ICS_TOKEN_META,
        'meta_compare'   => 'EXISTS',
    ));
    foreach ($ids as $id) {
        $stored = get_post_meta($id, EASY_ICS_TOKEN_META, true);
        if (is_string($stored) && $stored !== '' && hash_equals($stored, $token)) {
            return get_post($id);
        }
    }
    return null;
}

/** Public feed URL for an instructor. */
function easy_ics_feed_url($organizer_id) {
    $token = easy_ics_get_token($organizer_id);
    if ($token === '') {
        return '';
    }
    return home_url('/instructor-calendar/' . $token . '.ics');
}

/* One-time migration: mint a token for every existing organizer. */
add_action('admin_init', function () {
    if (get_option('easy_ics_tokens_migrated') === '2.2.5') {
        return;
    }
    $ids = get_posts(array(
        'post_type'     => 'tribe_organizer',
        'post_status'   => 'publish',
        'numberposts'   => 500,
        'fields'        => 'ids',
        'no_found_rows' => true,
    ));
    foreach ($ids as $id) {
        easy_ics_get_token($id);
    }
    update_option('easy_ics_tokens_migrated', '2.2.5');
});

/* ------------------------------------------------------------------
 * Default venue — every class shows a location
 *
 * Most classes run at EASY Safety itself, but the "Where" line and the
 * venue block only render when the event has a venue set — the rest show
 * nothing and students are left to assume. To make the location explicit,
 * events saved without a venue get the EASY Safety Training venue.
 * An explicitly set venue is never overwritten; virtual classes (title
 * contains "Virtual") are skipped. For off-site classes Pam picks the
 * venue when creating the event.
 * ------------------------------------------------------------------ */

/** Post ID of the "EASY Safety Training" venue (44 Austin Street); 0 when missing. */
function easy_default_venue_id() {
    static $found = null;
    if ($found !== null) {
        return $found;
    }
    $found = 0;
    $p = get_page_by_path('easy-safety-training', OBJECT, 'tribe_venue');
    if ($p) {
        $found = (int) $p->ID;
        return $found;
    }
    $venues = get_posts(array(
        'post_type'     => 'tribe_venue',
        'post_status'   => 'publish',
        'numberposts'   => 100,
        'fields'        => 'ids',
        'no_found_rows' => true,
    ));
    foreach ($venues as $vid) {
        if (strcasecmp(trim(get_the_title($vid)), 'EASY Safety Training') === 0) {
            $found = (int) $vid;
            return $found;
        }
    }
    return $found;
}

/** True when the event looks virtual — never gets the office venue. */
function easy_event_is_virtual($post_id) {
    $title = get_the_title($post_id);
    return $title && stripos($title, 'virtual') !== false;
}

/** Fill in the default venue when an event is saved without one. Runs late
 * so TEC's own save handler goes first. */
add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }
    if (function_exists('easy_ics_event_venue_id') && easy_ics_event_venue_id($post_id)) {
        return; // explicit venue — never overwrite
    }
    if (easy_event_is_virtual($post_id)) {
        return;
    }
    $vid = easy_default_venue_id();
    if ($vid > 0) {
        update_post_meta($post_id, '_EventVenueID', $vid);
    }
}, 20, 3);

/* One-time backfill: venue-less published events get the default venue. */
add_action('admin_init', function () {
    if (get_option('easy_default_venue_backfilled') === '2.2.5') {
        return;
    }
    $vid = easy_default_venue_id();
    if ($vid > 0) {
        $events = get_posts(array(
            'post_type'     => 'tribe_events',
            'post_status'   => 'publish',
            'numberposts'   => 500,
            'fields'        => 'ids',
            'no_found_rows' => true,
        ));
        foreach ($events as $eid) {
            if (function_exists('easy_ics_event_venue_id') && easy_ics_event_venue_id($eid)) {
                continue;
            }
            if (easy_event_is_virtual($eid)) {
                continue;
            }
            update_post_meta($eid, '_EventVenueID', $vid);
        }
    }
    update_option('easy_default_venue_backfilled', '2.2.5');
});

/* ------------------------------------------------------------------
 * Event query — published tribe_events in the window, filtered by
 * organizer in PHP (robust across TEC storage versions, including
 * the custom tables introduced in TEC 6.x).
 * ------------------------------------------------------------------ */

function easy_ics_get_instructor_events($organizer_id, $from_ts, $to_ts) {
    $base_args = array(
        'post_type'      => 'tribe_events',
        'post_status'    => 'publish',
        'posts_per_page' => 500,
        'no_found_rows'  => true,
        'orderby'        => 'meta_value',
        'meta_key'       => '_EventStartDate',
        'order'          => 'ASC',
    );

    // Prefer a meta-bounded query; fall back to unbounded if TEC no
    // longer dual-writes _EventStartDate (PHP-side filtering still
    // enforces the window either way).
    $bounded = $base_args;
    $bounded['meta_query'] = array(
        array(
            'key'     => '_EventStartDate',
            'value'   => array(
                easy_ics_site_date($from_ts),
                easy_ics_site_date($to_ts),
            ),
            'compare' => 'BETWEEN',
            'type'    => 'DATETIME',
        ),
    );

    $q = new WP_Query($bounded);
    if (!$q->have_posts()) {
        $q = new WP_Query($base_args);
    }

    $out = array();
    foreach ($q->posts as $p) {
        $org_ids = easy_ics_event_organizer_ids($p->ID);
        $match   = false;
        foreach ($org_ids as $oid) {
            if ((int) $oid === (int) $organizer_id) {
                $match = true;
                break;
            }
        }
        if (!$match) {
            continue;
        }

        $times = easy_ics_event_times($p->ID);
        if (!$times) {
            continue;
        }
        list($start_ts, $end_ts, $all_day) = $times;

        if ($end_ts < $from_ts || $start_ts > $to_ts) {
            continue;
        }

        $out[] = array(
            'post'    => $p,
            'start'   => $start_ts,
            'end'     => $end_ts,
            'all_day' => $all_day,
        );
    }

    usort($out, function ($a, $b) {
        return $a['start'] - $b['start'];
    });

    return $out;
}

function easy_ics_event_organizer_ids($event_id) {
    // Preferred: TEC's own helper when available.
    if (function_exists('tribe_get_organizer_ids')) {
        $ids = tribe_get_organizer_ids($event_id);
        if (!empty($ids)) {
            return array_map('intval', (array) $ids);
        }
    }

    // Fallback: raw meta (single ID, list, or serialized array).
    $raw = get_post_meta($event_id, '_EventOrganizerID', false);
    $ids = array();
    foreach ((array) $raw as $v) {
        if (is_array($v)) {
            foreach ($v as $x) {
                if (is_numeric($x)) {
                    $ids[] = (int) $x;
                }
            }
        } elseif (is_numeric($v)) {
            $ids[] = (int) $v;
        } elseif (is_string($v) && preg_match_all('/\d+/', $v, $m)) {
            foreach ($m[0] as $x) {
                $ids[] = (int) $x;
            }
        }
    }
    return array_values(array_unique($ids));
}

/**
 * Returns array(start_ts, end_ts, all_day) with UTC timestamps, or null.
 */
function easy_ics_event_times($event_id) {
    $all_day = get_post_meta($event_id, '_EventAllDay', true) === 'yes';

    // 1) TEC UTC mirrors — most reliable when present.
    $start_utc = get_post_meta($event_id, '_EventStartDateUTC', true);
    $end_utc   = get_post_meta($event_id, '_EventEndDateUTC', true);
    if ($start_utc && $end_utc) {
        $s = strtotime($start_utc . ' UTC');
        $e = strtotime($end_utc . ' UTC');
        if ($s && $e) {
            return array($s, $e, $all_day);
        }
    }

    // 2) TEC template tags.
    if (function_exists('tribe_get_start_date') && function_exists('tribe_get_end_date')) {
        $s = tribe_get_start_date($event_id, false, 'U');
        $e = tribe_get_end_date($event_id, false, 'U');
        if (is_numeric($s) && is_numeric($e) && $s > 0 && $e > 0) {
            return array((int) $s, (int) $e, $all_day);
        }
    }

    // 3) Site-local meta parsed in the site timezone.
    $start_local = get_post_meta($event_id, '_EventStartDate', true);
    $end_local   = get_post_meta($event_id, '_EventEndDate', true);
    if ($start_local) {
        try {
            $tz = easy_ics_site_timezone();
            $s  = (int) (new DateTime($start_local, $tz))->getTimestamp();
            $e  = $end_local ? (int) (new DateTime($end_local, $tz))->getTimestamp() : $s + 3600;
            return array($s, $e, $all_day);
        } catch (Exception $ex) {
            return null;
        }
    }

    return null;
}

function easy_ics_event_venue_id($event_id) {
    if (function_exists('tribe_get_venue_id')) {
        $id = tribe_get_venue_id($event_id);
        if ($id) {
            return (int) $id;
        }
    }
    $id = get_post_meta($event_id, '_EventVenueID', true);
    return $id ? (int) $id : 0;
}

function easy_ics_event_location($event_id) {
    $parts    = array();
    $venue_id = easy_ics_event_venue_id($event_id);

    if ($venue_id) {
        $name = get_the_title($venue_id);
        if ($name) {
            $parts[] = $name;
        }

        // Address components: prefer TEC template tags, fall back to raw meta.
        // Every call is guarded — a wrong guess at a tag name must never fatal.
        $addr = function_exists('tribe_get_address') ? tribe_get_address($venue_id) : '';
        $city = function_exists('tribe_get_city') ? tribe_get_city($venue_id) : '';
        $prov = '';
        if (function_exists('tribe_get_stateprovince')) {
            $prov = tribe_get_stateprovince($venue_id);
        } elseif (function_exists('tribe_get_province')) {
            $prov = tribe_get_province($venue_id);
        }
        $zip = function_exists('tribe_get_zip') ? tribe_get_zip($venue_id) : '';
        foreach (array($addr, $city, $prov, $zip) as $v) {
            if ($v) {
                $parts[] = $v;
            }
        }

        if (count($parts) <= 1) {
            foreach (array('_VenueAddress', '_VenueCity', '_VenueProvince', '_VenueStateProvince', '_VenueZip') as $key) {
                $v = get_post_meta($venue_id, $key, true);
                if ($v) {
                    $parts[] = $v;
                }
            }
        }
    } elseif (function_exists('tribe_get_venue')) {
        // No venue post linked — whatever name TEC can resolve is better than nothing.
        $v = tribe_get_venue($event_id);
        if ($v) {
            $parts[] = $v;
        }
    }

    $parts = array_values(array_unique(array_filter(array_map('trim', $parts))));
    return html_entity_decode(implode(', ', $parts), ENT_QUOTES, 'UTF-8');
}

/* ------------------------------------------------------------------
 * Timezone helpers
 * ------------------------------------------------------------------ */

function easy_ics_site_timezone() {
    if (function_exists('wp_timezone')) {
        return wp_timezone();
    }
    $tz_string = get_option('timezone_string');
    if ($tz_string) {
        try {
            return new DateTimeZone($tz_string);
        } catch (Exception $e) {
            // fall through to default
        }
    }
    // EASY Safety default.
    return new DateTimeZone('America/St_Johns');
}

function easy_ics_site_date($ts, $fmt = 'Y-m-d H:i:s') {
    if (function_exists('wp_date')) {
        return wp_date($fmt, $ts);
    }
    $dt = new DateTime('@' . (int) $ts);
    $dt->setTimezone(easy_ics_site_timezone());
    return $dt->format($fmt);
}

/* ------------------------------------------------------------------
 * ICS building (RFC 5545)
 * ------------------------------------------------------------------ */

function easy_ics_escape($text) {
    $text = (string) $text;
    $text = str_replace('\\', '\\\\', $text);
    $text = str_replace(';', '\;', $text);
    $text = str_replace(',', '\,', $text);
    $text = str_replace("\r\n", '\n', $text);
    $text = str_replace("\n", '\n', $text);
    $text = str_replace("\r", '\n', $text);
    return $text;
}

function easy_ics_fold($line) {
    // Fold at 75 octets per RFC 5545 (byte-based; fine for this feed).
    $out = '';
    while (strlen($line) > 75) {
        $out  .= substr($line, 0, 75) . "\r\n ";
        $line  = substr($line, 75);
    }
    return $out . $line;
}

function easy_ics_build($organizer, $events) {
    $cal_name = 'EASY Safety - ' . $organizer->post_title . ' Classes';

    $lines   = array();
    $lines[] = 'BEGIN:VCALENDAR';
    $lines[] = 'VERSION:2.0';
    $lines[] = 'PRODID:-//EASY Safety Training//Instructor Calendar//EN';
    $lines[] = 'CALSCALE:GREGORIAN';
    $lines[] = 'METHOD:PUBLISH';
    $lines[] = 'X-WR-CALNAME:' . easy_ics_escape($cal_name);

    $dtstamp = gmdate('Ymd\THis\Z');

    foreach ($events as $ev) {
        $p     = $ev['post'];
        $title = html_entity_decode(get_the_title($p->ID), ENT_QUOTES, 'UTF-8');

        // NOTE: the full DESCRIPTION (event post content) is deliberately
        // omitted. The event description carries the preset course outline
        // (coverage, duration, prerequisites, chapter list) — useful on the
        // website, but just clutter inside a calendar event. The URL below
        // links to the full details for anyone who wants them. The roster
        // block added further down is a separate, roster-only DESCRIPTION.
        $loc = easy_ics_event_location($p->ID);
        $url = get_permalink($p->ID);

        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:easy-event-' . $p->ID . '@easysafety.ca';
        $lines[] = 'DTSTAMP:' . $dtstamp;

        // RFC 5545 revision tracking: UID stays stable for the life of the
        // event, while SEQUENCE/LAST-MODIFIED tell picky clients (notably
        // Outlook) that an existing event's payload has changed and the new
        // copy must replace the old one. Unix timestamp as SEQUENCE is a
        // common trick — it always increases on each save.
        $modified_ts = (!empty($p->post_modified_gmt)) ? strtotime($p->post_modified_gmt . ' UTC') : 0;
        if ($modified_ts) {
            $lines[] = 'LAST-MODIFIED:' . gmdate('Ymd\THis\Z', $modified_ts);
            $lines[] = 'SEQUENCE:' . $modified_ts;
        } else {
            $lines[] = 'SEQUENCE:0';
        }

        if ($ev['all_day']) {
            // All-day dates in site timezone; DTEND is exclusive.
            $start_d = easy_ics_site_date($ev['start'], 'Ymd');
            $end_d   = easy_ics_site_date($ev['end'], 'Ymd');
            if ($end_d < $start_d) {
                $end_d = $start_d;
            }
            $exclusive = gmdate('Ymd', strtotime($end_d . ' +1 day UTC'));
            $lines[]   = 'DTSTART;VALUE=DATE:' . $start_d;
            $lines[]   = 'DTEND;VALUE=DATE:' . $exclusive;
        } else {
            $lines[] = 'DTSTART:' . gmdate('Ymd\THis\Z', $ev['start']);
            $lines[] = 'DTEND:' . gmdate('Ymd\THis\Z', $ev['end']);
        }

        $lines[] = 'SUMMARY:' . easy_ics_escape($title);
        if ($loc !== '') {
            $lines[] = 'LOCATION:' . easy_ics_escape($loc);
        }
        if ($url) {
            $lines[] = 'URL:' . easy_ics_escape($url);
        }
        // Class roster, names only: the instructor sees who to expect.
        // Phone/email/payment/notes stay in the app. Guarded so the feed
        // keeps working when the roster module is switched off.
        if (function_exists('easy_roster_names')) {
            $names = easy_roster_names($p->ID);
            if (!empty($names)) {
                $lines[] = 'DESCRIPTION:' . easy_ics_escape(
                    'Students (' . count($names) . "):\n- " . implode("\n- ", $names)
                );
            }
        }
        $lines[] = 'STATUS:CONFIRMED';
        $lines[] = 'END:VEVENT';
    }

    $lines[] = 'END:VCALENDAR';

    $out = '';
    foreach ($lines as $line) {
        $out .= easy_ics_fold($line) . "\r\n";
    }
    return $out;
}