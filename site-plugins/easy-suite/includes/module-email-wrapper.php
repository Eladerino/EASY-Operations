<?php
/**
 * Module: Branded email wrapper (was the Code Snippet "EASY: Branded email
 * wrapper").
 *
 * Note: the snippet had a PHP syntax error (an unescaped apostrophe in
 * "St. John's"), so Code Snippets never ran it and site emails went out
 * unwrapped. This copy is fixed, so switching this module on is the first
 * time the wrapper actually applies.
 *
 * Wrap every outgoing email body in the EASY Safety Training branded HTML shell
 * and force the Content-Type to text/html.
 *
 * Skips wrapping when the message already contains alt="Easy Safety Logo"
 * (certificate notification emails are already fully styled), when the message
 * is already a complete HTML document (contains <html), or when the headers
 * contain X-EASY-No-Wrap. Body styling only: recipients, subject and From
 * headers are never altered.
 */

defined('ABSPATH') || exit;

// While the original Code Snippet is still switched on, let it run alone.
if (easy_suite_snippet_still_active('email-wrapper')) {
    return;
}

add_filter( 'wp_mail', 'easy_suite_branded_email_wrapper', 10, 1 );

function easy_suite_branded_email_wrapper( $args ) {
	$message = isset( $args['message'] ) ? (string) $args['message'] : '';
	$headers = isset( $args['headers'] ) ? $args['headers'] : array();

	if ( '' === trim( $message ) ) {
		return $args;
	}

	$headers_string = is_array( $headers ) ? implode( "\n", $headers ) : (string) $headers;

	// Opt-out header.
	if ( false !== stripos( $headers_string, 'X-EASY-No-Wrap' ) ) {
		return $args;
	}

	// Certificate notification emails are already fully styled: never double-wrap them.
	if ( false !== strpos( $message, 'alt="Easy Safety Logo"' ) ) {
		return $args;
	}

	// Complete HTML documents (e.g. WooCommerce native templates) are left alone.
	if ( false !== stripos( $message, '<html' ) ) {
		return $args;
	}

	// Plain-text messages: escape, then convert newlines to <br>, before wrapping.
	if ( ! preg_match( '/<[a-zA-Z][^<>]*>/', $message ) ) {
		$message = nl2br( esc_html( $message ) );
	}

	$logo_url = 'https://easysafety.ca/wp-content/uploads/2026/10/EASYLOGO.png';

	// Open the outer wrapper table and the inner 600px content table.
	$shell_open = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f2f2;margin:0;padding:24px 0;"><tr><td align="center">';
	$shell_open .= '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">';
	// Header: white background, centered logo.
	$header_row = '<tr><td align="center" style="background-color:#ffffff;padding:26px 20px;border-bottom:3px solid #12853C;">';
	$header_row .= '<img src="' . esc_url( $logo_url ) . '" width="170" alt="EASY Safety Training" style="display:block;width:170px;max-width:100%;height:auto;border:0;" />';
	$header_row .= '</td></tr>';
	// Body: the original message on white, dark text, comfortable padding.
	$body_row = '<tr><td style="background-color:#ffffff;color:#333333;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;padding:30px 34px;">';
	$body_row .= '<style>a{color:#12853C;}h1,h2,h3{color:#12853C;}</style>';
	$body_row .= $message;
	$body_row .= '</td></tr>';
	// Footer.
	$footer_row = '<tr><td align="center" style="background-color:#ffffff;padding:22px 28px 30px;border-top:1px solid #e6e6e6;color:#777777;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;">';
	$footer_row .= 'EASY Safety Training &middot; St. John&#39;s, NL<br />';
	$footer_row .= 'Questions? Contact us at <a href="mailto:pam@easysafety.ca" style="color:#12853C;text-decoration:underline;">pam@easysafety.ca</a> or call <a href="tel:+17092217233" style="color:#12853C;text-decoration:underline;">(709) 221-7233</a>.';
	$footer_row .= '<br /><a href="https://easysafety.ca/privacy-policy/" style="color:#12853C;text-decoration:underline;">Privacy Policy</a>';
	$footer_row .= '</td></tr>';
	// Close the inner content table, then the outer wrapper table.
	$shell_close = '</table></td></tr></table>';

	$args['message'] = $shell_open . $header_row . $body_row . $footer_row . $shell_close;

	// Force the HTML content type without touching any other header.
	if ( is_array( $headers ) ) {
		$headers = array_values( array_filter( $headers, function( $h ) {
			return 0 !== stripos( ltrim( (string) $h ), 'Content-Type:' );
		} ) );
		$headers[] = 'Content-Type: text/html; charset=UTF-8';
		$args['headers'] = $headers;
	} else {
		$headers_string = preg_replace( '/^Content-Type:.*$/mi', '', $headers_string );
		$headers_string = trim( (string) $headers_string );
		if ( '' !== $headers_string ) {
			$headers_string .= "\n";
		}
		$headers_string .= 'Content-Type: text/html; charset=UTF-8';
		$args['headers'] = $headers_string;
	}

	return $args;
}
