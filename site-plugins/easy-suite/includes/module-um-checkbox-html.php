<?php
/**
 * Module: Allow HTML in Ultimate Member checkbox labels (was the Code
 * Snippet "UM: Allow HTML in checkbox labels").
 *
 * UM sanitizes field option labels as plain text in the form builder; this
 * switches them to wp_kses (post-safe HTML) so a checkbox such as "I agree
 * to the <a>privacy policy</a>" keeps its link. Only admins edit UM forms.
 */

defined('ABSPATH') || exit;

// While the original Code Snippet is still switched on, let it run alone.
if (easy_suite_snippet_still_active('um-checkbox-html')) {
    return;
}

add_filter('um_builder_input_map', function ($map) {
    $map['_options']['sanitize'] = 'wp_kses';
    return $map;
});
