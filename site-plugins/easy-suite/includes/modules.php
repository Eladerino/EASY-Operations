<?php
/**
 * Module registry and on/off switches.
 *
 * Each module lives in includes/module-<key>.php. Switches are stored in the
 * easy_suite_modules option (key => bool); a module missing from the option
 * falls back to its default, so new modules arrive switched on (or off) as
 * declared here. "locked" modules carry the certificate privacy guarantees
 * and cannot be switched off from the settings page.
 */

defined('ABSPATH') || exit;

function easy_suite_module_registry() {
    return [
        'cert-rest' => [
            'label'       => 'Certificate data & privacy',
            'description' => 'ACF fields on the cert REST endpoint (allowlisted and validated), the REST/search/media/feed privacy gates, instructor identity enforcement, and server-side cleanup of replaced certificate PDFs. The EASY Operations app depends on this.',
            'default'     => true,
            'locked'      => true,
        ],
        'cert-pdf' => [
            'label'       => 'Certificate PDF gatekeeper',
            'description' => 'Private easy-certs/ folder, /cert-pdf/<number>/ downloads for the owner and staff, old-link redirects, the migration tool, and PDF auto-trash with its certificate.',
            'default'     => true,
            'locked'      => true,
        ],
        'approvals' => [
            'label'       => 'App bridge: approvals & expiring certs',
            'description' => 'REST routes the EASY Operations app uses for the Accounts approval queue (easy/v1/pending-users) and expiring certificates (easy/v1/expiring-certs).',
            'default'     => true,
            'locked'      => false,
        ],
        'courses' => [
            'label'       => 'App bridge: Course Builder sync',
            'description' => 'Stores Course Builder courses on the site so every computer sees the same copy, and runs the review queue (send for review, approve, send back) inside the app instead of passing files around. Authors and reviewers are set under Settings.',
            'default'     => true,
            'locked'      => false,
        ],
        'licenses' => [
            'label'       => 'Online courses: license keys',
            'description' => 'Single-use course keys (EASY-XXXX-XXXX-XXXX), the route learners redeem them through, and EASY Suite → Online courses for issuing, looking up, revoking and resending keys. Creates three database tables the first time it runs. Needs Course Builder sync for its course list.',
            'default'     => true,
            'locked'      => false,
        ],
        'notifications' => [
            'label'       => 'Certificate emails',
            'description' => 'Student email on publish, 30/7-day and expired reminders, and the twice-daily employer digest with certificate PDFs.',
            'default'     => true,
            'locked'      => false,
        ],
        'calendar' => [
            'label'       => 'Instructor calendar feed',
            'description' => 'Public read-only ICS feed per instructor at /instructor-calendar/<name>.ics.',
            'default'     => true,
            'locked'      => false,
        ],
        'shop' => [
            'label'       => 'Shop: instructor-only products & "List a Product"',
            'description' => 'Hides the Instructor Materials category from non-instructors and provides the [easy_product_form] listing form.',
            'default'     => true,
            'locked'      => false,
        ],
        'seo' => [
            'label'       => 'SEO noindex for utility pages',
            'description' => 'Keeps login, account, cart, portal and certificate pages out of search results and the sitemap.',
            'default'     => true,
            'locked'      => false,
        ],
        'cert-archive' => [
            'label'       => 'Staff certificate archive: show all',
            'description' => 'The staff /cert/ archive lists every certificate instead of only the newest 10, so its expiry filter covers everything.',
            'default'     => true,
            'locked'      => false,
        ],
        'course-fallback' => [
            'label'       => 'Course pages: "no upcoming sessions" message',
            'description' => 'Shows a contact message under "Next Available Courses" when a course has nothing scheduled. (Was the "No upcoming sessions fallback" snippet.)',
            'default'     => true,
            'locked'      => false,
        ],
        'um-forms' => [
            'label'       => 'Login & register form styling',
            'description' => 'Turns the secondary button on the Ultimate Member login/register forms into a quiet text link and colours the main button green. (Was the two "quiet link" snippets.)',
            'default'     => true,
            'locked'      => false,
        ],
        'cert-page-redirect' => [
            'label'       => 'Certificates page login redirect',
            'description' => 'Sends logged-out visitors from /view-certificates/ to /login/ and back after login. (Was the "Certificates page login redirect" snippet.)',
            'default'     => true,
            'locked'      => false,
        ],
        'email-wrapper' => [
            'label'       => 'Branded email wrapper',
            'description' => 'Wraps outgoing site emails (account, password, form emails) in the EASY branded layout. Certificate emails are already styled and are left alone. (Was the "Branded email wrapper" snippet.)',
            'default'     => true,
            'locked'      => false,
        ],
        'um-checkbox-html' => [
            'label'       => 'Allow HTML in Ultimate Member checkbox labels',
            'description' => 'Lets checkbox labels in UM forms contain links (e.g. to the privacy policy). (Was the "UM: Allow HTML in checkbox labels" snippet.)',
            'default'     => true,
            'locked'      => false,
        ],
    ];
}

/** Stored switch state merged over defaults; locked modules always on. */
function easy_suite_module_states() {
    $stored = get_option('easy_suite_modules', []);
    $stored = is_array($stored) ? $stored : [];
    $out = [];
    foreach (easy_suite_module_registry() as $key => $m) {
        if (!empty($m['locked'])) {
            $out[$key] = true;
        } elseif (array_key_exists($key, $stored)) {
            $out[$key] = (bool) $stored[$key];
        } else {
            $out[$key] = (bool) $m['default'];
        }
    }
    return $out;
}

/** Module keys to load this request, in registry order. */
function easy_suite_enabled_modules() {
    $out = [];
    foreach (easy_suite_module_states() as $key => $on) {
        if ($on && is_readable(EASY_SUITE_DIR . 'includes/module-' . $key . '.php')) {
            $out[] = $key;
        }
    }
    return $out;
}

function easy_suite_module_enabled($key) {
    $states = easy_suite_module_states();
    return !empty($states[$key]);
}
