<?php
/**
 * Module: Past events — noindex.
 *
 * Single event pages (The Events Calendar) for classes whose end date has
 * passed get a robots noindex and are kept out of Yoast's XML sitemap.
 * Fully automatic: the date check runs on every page view, so there is no
 * list to maintain. Upcoming and current events are untouched, and events
 * with an unknown end date are left alone.
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module: Past events — noindex
 * --------------------------------------------------------------------------
 * Old class pages (e.g. a December 2022 fall-protection session) kept
 * showing up in search results. Instead of deleting them one by one,
 * any single tribe_events page whose end date is in the past is noindexed
 * automatically. Google drops the pages from results over the following
 * days; the pages themselves keep working for anyone with a direct link.
 * ========================================================================== */

/* Grace period after an event ends before it counts as past. Absorbs any
 * timezone skew between the stored local end date and the server clock. */
if (!defined('EASY_EVENT_NOINDEX_GRACE')) {
    define('EASY_EVENT_NOINDEX_GRACE', DAY_IN_SECONDS);
}

/**
 * End timestamp of a tribe_events post, or 0 when unknown.
 *
 * Reads the raw _EventEndDate meta directly so this works even when
 * The Events Calendar's own functions are unavailable.
 */
function easy_event_noindex_end_ts($post_id) {
    $end = get_post_meta((int) $post_id, '_EventEndDate', true);
    if (!is_string($end) || $end === '') {
        return 0;
    }
    $ts = strtotime($end);
    return $ts === false ? 0 : (int) $ts;
}

/**
 * True on a single event page whose class has ended (plus grace period).
 */
function easy_event_noindex_is_past_event() {
    if (!post_type_exists('tribe_events')) {
        return false;
    }
    if (!is_singular('tribe_events')) {
        return false;
    }
    $post = get_queried_object();
    if (!($post instanceof WP_Post)) {
        return false;
    }
    $end_ts = easy_event_noindex_end_ts($post->ID);
    if ($end_ts <= 0) {
        return false;
    }
    return $end_ts < (time() - EASY_EVENT_NOINDEX_GRACE);
}

/* Robots meta: noindex, nofollow on past event pages. Priority 20 runs
 * after Yoast's own wp_robots filter so ours wins; the wpseo_robots filter
 * covers Yoast's rendered tag directly. Mirrors module-seo.php. */
add_filter('wp_robots', function ($robots) {
    if (easy_event_noindex_is_past_event()) {
        unset($robots['index'], $robots['follow']);
        $robots['noindex']  = true;
        $robots['nofollow'] = true;
    }
    return $robots;
}, 20);

add_filter('wpseo_robots', function ($robots) {
    if (easy_event_noindex_is_past_event()) {
        return 'noindex, nofollow';
    }
    return $robots;
});

/* Keep past events out of Yoast's XML sitemap. */
add_filter('wpseo_exclude_from_sitemap_by_post_ids', function ($excluded) {
    if (!post_type_exists('tribe_events')) {
        return $excluded;
    }
    $cutoff = gmdate('Y-m-d H:i:s', time() - EASY_EVENT_NOINDEX_GRACE);
    $ids = get_posts([
        'post_type'      => 'tribe_events',
        'post_status'    => 'publish',
        'fields'         => 'ids',
        'posts_per_page' => -1,
        'no_found_rows'  => true,
        'meta_query'     => [[
            'key'     => '_EventEndDate',
            'value'   => $cutoff,
            'compare' => '<',
            'type'    => 'DATETIME',
        ]],
    ]);
    foreach ((array) $ids as $id) {
        $excluded[] = (int) $id;
    }
    return array_values(array_unique(array_map('intval', (array) $excluded)));
});
