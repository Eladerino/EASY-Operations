<?php
/**
 * Module: Login & register form styling (was the Code Snippets
 * "EASY: Register page - quiet login link" and
 * "EASY: Login page - quiet register link").
 *
 * On the Ultimate Member register form (410) the secondary "Login" button
 * becomes "Already have an account? Log in"; on the login form (411) the
 * secondary "Register" button becomes "Don't have an account? Register".
 * The primary submit button on both uses the site green.
 */

defined('ABSPATH') || exit;

// While the original Code Snippets are still switched on, let them run alone.
if (easy_suite_snippet_still_active('um-forms')) {
    return;
}

/** UM form ids => [class, lead-in text, link text, fallback path]. */
function easy_suite_um_quiet_link_forms() {
    return [
        410 => ['easy-quiet-login', 'Already have an account? ', 'Log in', '/login/'],
        411 => ['easy-quiet-register', "Don't have an account? ", 'Register', '/register/'],
    ];
}

add_filter('do_shortcode_tag', function ($output, $tag, $attr) {
    if ($tag !== 'ultimatemember' || !is_array($attr) || empty($attr['form_id'])) {
        return $output;
    }
    $forms = easy_suite_um_quiet_link_forms();
    $form_id = (int) $attr['form_id'];
    if (!isset($forms[$form_id])) {
        return $output;
    }
    [$class, $lead, $text, $fallback] = $forms[$form_id];

    // Find the <a> carrying the secondary button class.
    $html = (string) $output;
    $pos = strpos($html, 'um-button um-alt');
    if ($pos === false) {
        return $output;
    }
    $start = strrpos(substr($html, 0, $pos), '<a ');
    $end = strpos($html, '</a>', $pos);
    if ($start === false || $end === false) {
        return $output;
    }
    $end += 4;
    $anchor = substr($html, $start, $end - $start);

    // Keep UM's own link target (it carries any redirect), else the page.
    $url = home_url($fallback);
    if (preg_match('/href=(["\'])(.*?)\1/', $anchor, $m)) {
        $url = html_entity_decode($m[2], ENT_QUOTES);
    }
    $replacement = '<span class="' . esc_attr($class) . '">' . esc_html($lead)
        . '<a href="' . esc_url($url) . '">' . esc_html($text) . '</a></span>';
    return substr_replace($html, $replacement, $start, $end - $start);
}, 10, 3);

add_action('wp_head', function () {
    $green = '#1eb250';
    $hover = '#34ba61';
    $css = '';
    foreach (['.um-register', '.um-login'] as $form) {
        $css .= "{$form} #um-submit-btn.um-button{background:{$green};border-color:{$green};color:#fff;}"
            . "{$form} #um-submit-btn.um-button:hover,{$form} #um-submit-btn.um-button:focus{background:{$hover};border-color:{$hover};color:#fff;}";
    }
    foreach (['.um-register' => 'easy-quiet-login', '.um-login' => 'easy-quiet-register'] as $form => $class) {
        $css .= "{$form} .um-col-alt .um-right .{$class}{display:block;margin-top:12px;font-size:14px;color:#666;}"
            . "{$form} .um-col-alt .um-right .{$class} a{text-decoration:underline;}";
    }
    echo '<style id="easy-suite-um-forms">' . $css . '</style>';
});
