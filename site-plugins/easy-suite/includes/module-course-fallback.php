<?php
/**
 * Module: "No upcoming sessions" message on course pages (was Code Snippet
 * "EASY: No upcoming sessions fallback (course pages)").
 *
 * Course pages (two levels deep) show an Avada Events element with the
 * class "upcoming-courses"; when it renders nothing, show a contact message.
 */

defined('ABSPATH') || exit;

// While the original Code Snippet is still switched on, let it run alone.
if (easy_suite_snippet_still_active('course-fallback')) {
    return;
}
add_filter( 'do_shortcode_tag', 'easy_suite_course_no_events_fallback', 10, 3 );
function easy_suite_course_no_events_fallback( $output, $tag, $attr ) {
	if ( 'fusion_events' !== $tag ) {
		return $output;
	}
	$attr = is_array( $attr ) ? $attr : array();
	$classes = isset( $attr['class'] ) ? $attr['class'] : '';
	$classes = (string) $classes;
	if ( false === stripos( $classes, 'upcoming-courses' ) ) {
		return $output;
	}
	if ( ! function_exists( 'is_singular' ) ) {
		return $output;
	}
	if ( ! is_singular( 'page' ) ) {
		return $output;
	}
	$queried = get_queried_object();
	if ( ! $queried instanceof WP_Post ) {
		return $output;
	}
	if ( 'page' !== $queried->post_type ) {
		return $output;
	}
	$ancestors = get_post_ancestors( $queried );
	if ( count( $ancestors ) < 2 ) {
		return $output;
	}
	$text = (string) $output;
	$pat = '#<a[^>]*fusion-builder-placeholder[^>]*>';
	$pat .= '.*?</a>#s';
	$text = preg_replace( $pat, '', $text );
	$text = preg_replace( '/<!--.*?-->/s', '', $text );
	$text = trim( strip_tags( $text ) );
	if ( '' !== $text ) {
		return $output;
	}
	$m1 = "<div class='upcoming-courses-empty'><p>";
	$m2 = "No upcoming sessions are currently ";
	$m3 = "scheduled for this course. ";
	$m4 = "Call (709) 221-7233, email ";
	$m5 = "<a href='mailto:pam@easysafety.ca'>";
	$m6 = "pam@easysafety.ca</a>, or ";
	$m7 = "<a href='" . esc_url( home_url( '/contact/' ) ) . "'>";
	$m8 = "contact us</a> and we'll arrange ";
	$m9 = "training that fits your schedule.</p></div>";
	return $m1 . $m2 . $m3 . $m4 . $m5 . $m6 . $m7 . $m8 . $m9;
}
// End EASY course fallback.
