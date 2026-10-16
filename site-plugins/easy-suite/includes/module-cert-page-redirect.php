<?php
/**
 * Module: Certificates page login redirect (was the Code Snippet
 * "Certificates page login redirect").
 *
 * Logged-out visitors to /view-certificates/ go to the Ultimate Member login
 * page with redirect_to pointing back, so they land on their certificates
 * after logging in. Only that page triggers it, so no loop is possible.
 */

defined('ABSPATH') || exit;

// While the original Code Snippet is still switched on, let it run alone.
if (easy_suite_snippet_still_active('cert-page-redirect')) {
    return;
}

add_action('template_redirect', function () {
    if (is_user_logged_in() || !is_page('view-certificates')) {
        return;
    }
    wp_safe_redirect(add_query_arg('redirect_to', rawurlencode(home_url('/view-certificates/')), home_url('/login/')), 302);
    exit;
});
