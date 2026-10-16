<?php
/**
 * Module: Staff certificate archive shows every certificate.
 *
 * The child theme's archive-cert.php renders the main query and filters it by
 * expiry date in PHP, but the main query only carried the site-wide
 * "posts per page" (10), so the filter and on-screen list only ever saw the
 * newest 10 certificates (the CSV export already ran its own full query).
 * For users the theme lets in (administrators and instructors), the main
 * archive query now returns everything, newest first.
 */

defined('ABSPATH') || exit;

add_action('pre_get_posts', function ($q) {
    if (is_admin() || !$q->is_main_query() || !$q->is_post_type_archive('cert') || is_feed()) {
        return;
    }
    if (!is_user_logged_in()) {
        return;
    }
    // Same role check (and filter) as the theme template.
    $allowed = apply_filters('easy_cert_archive_allowed_roles', ['administrator', 'instructor']);
    if (!array_intersect((array) $allowed, (array) wp_get_current_user()->roles)) {
        return;
    }
    $q->set('posts_per_page', -1);
    $q->set('no_found_rows', true);
    $q->set('orderby', 'date');
    $q->set('order', 'DESC');
});
