<?php
/**
 * Module: Instructor calendar feed (was EASY Instructor Calendar Feed 1.0.4).
 *
 * Pretty URL:  /instructor-calendar/<organizer-slug>.ics
 * The rewrite rule is flushed by EASY Suite on activation and version change.
 */

defined('ABSPATH') || exit;


/* ------------------------------------------------------------------
 * Rewrite rule + query vars
 *
 * Pretty URL:  https://easysafety.ca/instructor-calendar/scott-glynn.ics
 * Fallback:    https://easysafety.ca/?easy_instructor_ics=1&instructor_organizer=scott-glynn
 * ------------------------------------------------------------------ */

add_action('init', 'easy_ics_add_rewrite_rule');

function easy_ics_add_rewrite_rule() {
    add_rewrite_rule(
        '^instructor-calendar/([^/]+)\.ics/?$',
        'index.php?easy_instructor_ics=1&instructor_organizer=$matches[1]',
        'top'
    );
}

add_filter('query_vars', 'easy_ics_query_vars');

function easy_ics_query_vars($vars) {
    $vars[] = 'easy_instructor_ics';
    $vars[] = 'instructor_organizer';
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
    $input = get_query_var('instructor_organizer');
    if (!$input && isset($_GET['instructor_organizer'])) {
        $input = sanitize_text_field(wp_unslash($_GET['instructor_organizer']));
    }
    if (!$input) {
        status_header(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Missing instructor. Example: /instructor-calendar/scott-glynn.ics';
        exit;
    }

    if (!post_type_exists('tribe_events')) {
        status_header(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'The Events Calendar is not active on this site.';
        exit;
    }

    $organizer = easy_ics_find_organizer($input);
    if (!$organizer) {
        status_header(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Instructor not found: ' . esc_html($input) . '. Check Events > Organizers in wp-admin for the exact organizer name — the feed matches on slug, name, or post ID.';
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
 * Organizer lookup — accepts ID, slug, or display name
 * ------------------------------------------------------------------ */

function easy_ics_find_organizer($input) {
    $input = trim((string) $input);
    if ($input === '') {
        return null;
    }

    // 1) Numeric post ID.
    if (ctype_digit($input)) {
        $p = get_post((int) $input);
        if ($p && $p->post_type === 'tribe_organizer') {
            return $p;
        }
    }

    // 2) Slug.
    $p = get_page_by_path(sanitize_title($input), OBJECT, 'tribe_organizer');
    if ($p) {
        return $p;
    }

    // 3) Name search — exact (case-insensitive) title match wins,
    //    otherwise the first search hit.
    $q = new WP_Query(array(
        'post_type'      => 'tribe_organizer',
        'post_status'    => 'publish',
        's'              => $input,
        'posts_per_page' => 10,
        'fields'         => 'ids',
        'no_found_rows'  => true,
    ));
    if ($q->have_posts()) {
        foreach ($q->posts as $id) {
            if (strcasecmp(trim(get_the_title($id)), $input) === 0) {
                return get_post($id);
            }
        }
        return get_post($q->posts[0]);
    }

    // 4) Normalized comparison across all organizers. WordPress search
    //    treats "scott-glynn" as one hyphenated token, so it never matches
    //    a title of "Scott Glynn" — normalize both sides instead. This also
    //    covers case differences and deduplicated slugs ("scott-glynn-2").
    $norm = easy_ics_normalize_name($input);
    if ($norm !== '') {
        $all = get_posts(array(
            'post_type'   => 'tribe_organizer',
            'post_status' => 'publish',
            'numberposts' => 200,
        ));
        foreach ($all as $o) {
            if (easy_ics_normalize_name($o->post_title) === $norm) {
                return $o;
            }
        }
        // Loose slug prefix match as a last resort.
        $slug = sanitize_title($input);
        if ($slug !== '') {
            foreach ($all as $o) {
                if (strpos($o->post_name, $slug) === 0) {
                    return $o;
                }
            }
        }
    }

    return null;
}

function easy_ics_normalize_name($s) {
    $s = html_entity_decode((string) $s, ENT_QUOTES, 'UTF-8');
    $s = strtolower($s);
    return preg_replace('/[^a-z0-9]/', '', $s);
}

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

        // NOTE: DESCRIPTION is deliberately omitted. The event description
        // carries the full preset course outline (coverage, duration,
        // prerequisites, chapter list) — useful on the website, but just
        // clutter inside a calendar event. The URL below links to the full
        // details for anyone who wants them.
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