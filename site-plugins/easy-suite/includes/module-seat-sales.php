<?php
/**
 * Module: Seat sales via WooCommerce.
 *
 * Course seats sell as plain WooCommerce products (one product per class
 * date, stock = seats) — no ticket-plugin commerce, no subscriptions.
 * The Events Calendar stays as the event display/calendar system.
 *
 * What this module does:
 *  - Links a seat product to each class event (meta both ways) with an
 *    event-edit meta box, including a "create seat product" shortcut.
 *  - Shows seats remaining + add-to-cart on the single event page.
 *  - Collects per-seat certificate info at WooCommerce checkout
 *    (name as on certificate, employer, phone, email) for every seat.
 *  - On a confirmed order, appends the attendees to the class roster
 *    (source 'checkout', payment 'paid') — the same roster Pam edits.
 *  - When the roster changes through the app (manual enrollment), adjusts
 *    the linked product's stock by the delta (add restores on delete).
 *
 * Note: field injection below targets the classic shortcode checkout.
 * If the site ever moves to Checkout Blocks, this needs a blocks-based
 * equivalent.
 */

defined('ABSPATH') || exit;

/**
 * WooCommerce may load after EASY Suite (alphabetical plugin order), so the
 * module always registers its hooks and each WooCommerce-dependent callback
 * bails unless WooCommerce is actually active. (A file-scope
 * function_exists('wc_get_product') guard silently disabled the entire module,
 * including the event meta box — fixed in 2.2.13.)
 */
function easy_seats_wc_ready() {
    return function_exists('wc_get_product');
}

define('EASY_SEAT_PRODUCT_META', '_easy_seat_product_id'); // on tribe_events
define('EASY_SEAT_EVENT_META', '_easy_seat_event_id');     // on product

/* ------------------------------------------------------------------
 * Linking: event <-> product
 * ------------------------------------------------------------------ */

/** Product ID linked to an event, or 0. */
function easy_seat_product_id($event_id) {
    return (int) get_post_meta((int) $event_id, EASY_SEAT_PRODUCT_META, true);
}

/** Event ID linked to a product, or 0. */
function easy_seat_event_id($product_id) {
    return (int) get_post_meta((int) $product_id, EASY_SEAT_EVENT_META, true);
}

/** Link both ways. Pass 0 as product to unlink. */
function easy_seat_link($event_id, $product_id) {
    $event_id   = (int) $event_id;
    $product_id = (int) $product_id;
    $old = easy_seat_product_id($event_id);
    if ($old && $old !== $product_id) {
        delete_post_meta($old, EASY_SEAT_EVENT_META);
    }
    if ($product_id > 0) {
        update_post_meta($event_id, EASY_SEAT_PRODUCT_META, $product_id);
        update_post_meta($product_id, EASY_SEAT_EVENT_META, $event_id);
    } else {
        delete_post_meta($event_id, EASY_SEAT_PRODUCT_META);
    }
}

/* Meta box on the event edit screen. */
add_action('add_meta_boxes_tribe_events', function () {
    add_meta_box(
        'easy-seat-product',
        'Seat sales',
        'easy_seat_product_metabox',
        'tribe_events',
        'side',
        'default'
    );
});

function easy_seat_product_metabox($post) {
    if (!easy_seats_wc_ready()) {
        echo '<p>WooCommerce is not active; seat sales are unavailable.</p>';
        return;
    }
    $pid = easy_seat_product_id($post->ID);
    wp_nonce_field('easy_seat_product_save', 'easy_seat_product_nonce');
    echo '<p><label for="easy_seat_product_id"><strong>Seat product</strong></label></p>';
    echo '<p><input type="number" id="easy_seat_product_id" name="easy_seat_product_id" value="'
        . esc_attr($pid > 0 ? $pid : '') . '" class="widefat" min="0" step="1" placeholder="WooCommerce product ID" /></p>';
    if ($pid > 0) {
        $product = wc_get_product($pid);
        if ($product) {
            $stock = $product->managing_stock() ? (int) $product->get_stock_quantity() : null;
            echo '<p>Linked: <a href="' . esc_url(get_edit_post_link($pid)) . '">'
                . esc_html($product->get_name()) . '</a>'
                . ($stock !== null ? ' (' . $stock . ' in stock)' : '') . '</p>';
        } else {
            echo '<p style="color:#d63638;">Product #' . esc_html($pid) . ' not found.</p>';
        }
    }
    echo '<p class="description">One product per class date; its stock is the seat count. '
        . 'The event page shows seats remaining with an add-to-cart button.</p>';
    echo '<p><button type="submit" name="easy_create_seat_product" value="1" class="button">'
        . 'Create seat product for this class</button></p>';
    echo '<p class="description">Creates a hidden draft product named after the class. '
        . 'Set its price and stock, then publish it.</p>';
}

add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    if (!easy_seats_wc_ready()) {
        return;
    }
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }
    if (!isset($_POST['easy_seat_product_nonce'])
        || !wp_verify_nonce(sanitize_key(wp_unslash($_POST['easy_seat_product_nonce'])), 'easy_seat_product_save')) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    // "Create seat product" shortcut.
    if (!empty($_POST['easy_create_seat_product'])) {
        $pid = easy_seat_create_product($post_id);
        if ($pid > 0) {
            easy_seat_link($post_id, $pid);
        }
        return;
    }

    $pid = isset($_POST['easy_seat_product_id']) ? (int) $_POST['easy_seat_product_id'] : 0;
    if ($pid > 0 && get_post_type($pid) !== 'product') {
        $pid = 0;
    }
    easy_seat_link($post_id, $pid);
}, 10, 3);

/** Create a hidden draft seat product for an event. Returns product ID or 0. */
function easy_seat_create_product($event_id) {
    $event_id = (int) $event_id;
    if (get_post_type($event_id) !== 'tribe_events') {
        return 0;
    }
    $product = new WC_Product_Simple();
    // Name carries the class date so buyers always know which session they're booking.
    $date_label = function_exists('tribe_get_start_date')
        ? tribe_get_start_date($event_id, false, 'M j, Y') : '';
    $product_name = get_the_title($event_id)
        . ($date_label !== '' ? ' — ' . $date_label : '')
        . ' — seat';
    $product->set_name($product_name);
    $product->set_status('draft');
    $product->set_catalog_visibility('hidden');
    $product->set_virtual(true); // seats don't ship
    $product->set_manage_stock(true);
    $product->set_stock_quantity(0);
    $product->set_price(0);
    $pid = $product->save();
    return $pid > 0 ? (int) $pid : 0;
}

/* ------------------------------------------------------------------
 * Event page: seats remaining + add to cart
 * ------------------------------------------------------------------ */

add_action('tribe_events_single_event_after_the_content', function () {
    if (!function_exists('tribe_get_event') || !easy_seats_wc_ready()) {
        return;
    }
    $event_id = get_the_ID();
    if (get_post_type($event_id) !== 'tribe_events') {
        return;
    }
    $pid = easy_seat_product_id($event_id);
    if ($pid <= 0) {
        return;
    }
    $product = wc_get_product($pid);
    if (!$product || !$product->is_purchasable() || $product->get_status() !== 'publish') {
        return;
    }

    echo '<div class="easy-seat-sales" style="margin:2em 0;padding:1.25em;border:1px solid #ddd;border-radius:6px;">';
    echo '<h3 style="margin-top:0;">' . esc_html__('Book your seat', 'easy-suite') . '</h3>';

    // What you're buying: class name + date, so there's no ambiguity at checkout.
    $event_date = function_exists('tribe_get_start_date')
        ? tribe_get_start_date($event_id, false, 'l, F j, Y') : '';
    $event_time = function_exists('tribe_get_start_date')
        ? tribe_get_start_date($event_id, false, 'g:i A') : '';
    $event_end = function_exists('tribe_get_end_date')
        ? tribe_get_end_date($event_id, false, 'g:i A') : '';
    if ($event_date !== '') {
        $when = $event_date;
        if ($event_time !== '') {
            $when .= ', ' . $event_time;
            if ($event_end !== '' && $event_end !== $event_time) {
                $when .= ' – ' . $event_end;
            }
        }
        echo '<p><strong>' . esc_html(get_the_title($event_id)) . '</strong><br>' . esc_html($when) . '</p>';
    }

    $stock = $product->managing_stock() ? (int) $product->get_stock_quantity() : null;
    if ($stock !== null) {
        if ($stock <= 0) {
            echo '<p><strong>This class is full.</strong> Contact us to join the waitlist.</p>';
            echo '</div>';
            return;
        }
        /* translators: %d: number of seats */
        echo '<p>' . sprintf(esc_html(_n('%d seat remaining', '%d seats remaining', $stock, 'easy-suite')), $stock) . '</p>';
    }

    echo '<p class="price" style="font-size:1.25em;font-weight:600;">' . wp_kses_post($product->get_price_html()) . '</p>';
    // Straight to checkout: one seat, one buyer, no cart detour.
    $checkout_url = function_exists('wc_get_checkout_url')
        ? add_query_arg('add-to-cart', $pid, wc_get_checkout_url())
        : $product->add_to_cart_url();
    echo '<p><a class="button alt" href="' . esc_url($checkout_url) . '">'
        . esc_html__('Book now', 'easy-suite') . '</a></p>';
    echo '<p class="description" style="font-size:.9em;color:#646970;">'
        . esc_html__('At checkout you will enter each attendee’s name and email exactly as they should appear on the certificate.', 'easy-suite') . '</p>';
    echo '</div>';
});

/* ------------------------------------------------------------------
 * Capacity + price sync: the app sets cost and seats on the class;
 * this keeps the linked WooCommerce product in step.
 * ------------------------------------------------------------------ */

define('EASY_SEAT_CAPACITY_META', '_easy_seat_capacity');

/**
 * Sync the linked seat product's price and stock from the event.
 * Price follows the event cost; stock follows capacity minus students
 * already on the roster. Only touches an already-linked product.
 */
function easy_seats_sync_event_to_product($event_id) {
    if (!easy_seats_wc_ready()) {
        return;
    }
    $event_id = (int) $event_id;
    if (get_post_type($event_id) !== 'tribe_events') {
        return;
    }
    $pid = easy_seat_product_id($event_id);
    if ($pid <= 0) {
        return;
    }
    $product = wc_get_product($pid);
    if (!$product) {
        return;
    }
    $cost = get_post_meta($event_id, '_EventCost', true);
    if (is_string($cost)) {
        $cost = trim($cost);
    }
    if ($cost !== '' && is_numeric($cost)) {
        $product->set_regular_price((string) $cost);
    }
    $capacity = get_post_meta($event_id, EASY_SEAT_CAPACITY_META, true);
    if ($capacity !== '' && is_numeric($capacity)) {
        $capacity = max(0, (int) $capacity);
        $roster = function_exists('easy_roster_get') ? easy_roster_get($event_id) : array();
        $taken = is_array($roster) ? count($roster) : 0;
        $product->set_manage_stock(true);
        $product->set_stock_quantity(max(0, $capacity - $taken));
    }
    $product->save();
}
add_action('save_post_tribe_events', 'easy_seats_sync_event_to_product', 20);

// REST field so the app can read and write the seat capacity on a class.
add_action('rest_api_init', function () {
    if (!function_exists('register_rest_field')) {
        return;
    }
    register_rest_field('tribe_events', 'easy_seats', array(
        'get_callback' => function ($event) {
            $id = isset($event['id']) ? (int) $event['id'] : 0;
            $v = $id > 0 ? get_post_meta($id, EASY_SEAT_CAPACITY_META, true) : '';
            return $v === '' ? null : (int) $v;
        },
        'update_callback' => function ($value, $event) {
            $id = is_object($event) ? (int) $event->ID : (isset($event['id']) ? (int) $event['id'] : 0);
            if ($id <= 0) {
                return;
            }
            if ($value === null || $value === '') {
                delete_post_meta($id, EASY_SEAT_CAPACITY_META);
            } else {
                update_post_meta($id, EASY_SEAT_CAPACITY_META, max(0, (int) $value));
            }
            easy_seats_sync_event_to_product($id);
        },
        'schema' => array('type' => 'integer', 'context' => array('view', 'edit')),
    ));
});

/* ------------------------------------------------------------------
 * Checkout: per-seat certificate info
 * ------------------------------------------------------------------ */

/** Cart items that are seat products: [{key, product, event_id, qty}]. */
function easy_seat_cart_items() {
    $out = array();
    if (!WC()->cart) {
        return $out;
    }
    foreach (WC()->cart->get_cart() as $key => $item) {
        $pid = (int) $item['product_id'];
        $eid = easy_seat_event_id($pid);
        if ($eid <= 0 || get_post_type($eid) !== 'tribe_events') {
            continue;
        }
        $product = wc_get_product($pid);
        if (!$product) {
            continue;
        }
        $out[] = array(
            'key'      => $key,
            'product'  => $product,
            'event_id' => $eid,
            'qty'      => (int) $item['quantity'],
        );
    }
    return $out;
}

/** Render one seat's fields. */
function easy_seat_fields_html($field_key, $seat_no, $event_title, $event_date_label = '') {
    $f = function ($name, $label, $required, $type = 'text', $placeholder = '') use ($field_key, $seat_no) {
        $id = esc_attr("{$field_key}_{$seat_no}_{$name}");
        $nm = esc_attr("easy_seats[{$field_key}][{$seat_no}][{$name}]");
        $req = $required ? ' <abbr class="required" title="required">*</abbr>' : '';
        return '<p class="form-row form-row-wide">'
            . '<label for="' . $id . '">' . esc_html($label) . $req . '</label>'
            . '<input type="' . esc_attr($type) . '" id="' . $id . '" name="' . $nm . '"'
            . ' placeholder="' . esc_attr($placeholder) . '" class="input-text"'
            . ($type === 'email' ? ' autocomplete="email"' : '')
            . ($required ? ' required' : '') . ' /></p>';
    };
    $html = '<fieldset class="easy-seat-fieldset" style="border:1px solid #ddd;border-radius:6px;padding:1em;margin:0 0 1em;">';
    /* translators: 1: seat number, 2: class title, 3: class date */
    $legend = $event_date_label !== ''
        ? sprintf(esc_html__('Seat %1$d — %2$s (%3$s)', 'easy-suite'), $seat_no, $event_title, $event_date_label)
        : sprintf(esc_html__('Seat %1$d — %2$s', 'easy-suite'), $seat_no, $event_title);
    $html .= '<legend style="padding:0 .5em;font-weight:600;">' . $legend . '</legend>';
    $html .= $f('name', 'Name (as it should appear on the certificate)', true, 'text', 'e.g. Jordan Smith');
    $html .= $f('employer', 'Employer / company', false);
    $html .= $f('phone', 'Phone', false, 'tel');
    $html .= $f('email', 'Email (certificate notifications go here)', true, 'email');
    $html .= '</fieldset>';
    return $html;
}

add_action('woocommerce_after_checkout_billing_form', function ($checkout) {
    $items = easy_seat_cart_items();
    if (empty($items)) {
        return;
    }
    echo '<div class="easy-seat-attendees"><h3>' . esc_html__('Who is attending?', 'easy-suite') . '</h3>';
    echo '<p>' . esc_html__('We print certificates from these details — please double-check spelling.', 'easy-suite') . '</p>';
    foreach ($items as $it) {
        $title = get_the_title($it['event_id']);
        $date_label = function_exists('tribe_get_start_date')
            ? tribe_get_start_date($it['event_id'], false, 'M j, Y') : '';
        for ($i = 1; $i <= $it['qty']; $i++) {
            // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — built by easy_seat_fields_html with escaping
            echo easy_seat_fields_html($it['key'], $i, $title, $date_label);
        }
    }
    echo '</div>';
});

add_action('woocommerce_checkout_process', function () {
    $items = easy_seat_cart_items();
    if (empty($items) || empty($_POST['easy_seats']) || !is_array($_POST['easy_seats'])) {
        if (!empty($items)) {
            wc_add_notice(__('Please enter the attendee details for each seat.', 'easy-suite'), 'error');
        }
        return;
    }
    $posted = wp_unslash($_POST['easy_seats']);
    foreach ($items as $it) {
        if (empty($posted[$it['key']]) || !is_array($posted[$it['key']])) {
            wc_add_notice(__('Please enter the attendee details for each seat.', 'easy-suite'), 'error');
            return;
        }
        for ($i = 1; $i <= $it['qty']; $i++) {
            $seat = isset($posted[$it['key']][$i]) && is_array($posted[$it['key']][$i])
                ? $posted[$it['key']][$i] : array();
            $name = isset($seat['name']) ? trim((string) $seat['name']) : '';
            if ($name === '') {
                wc_add_notice(
                    /* translators: %d: seat number */
                    sprintf(__('Seat %d is missing the certificate name.', 'easy-suite'), $i),
                    'error'
                );
            }
            $email = isset($seat['email']) ? trim((string) $seat['email']) : '';
            if ($email === '') {
                wc_add_notice(
                    sprintf(__('Seat %d is missing the attendee email address.', 'easy-suite'), $i),
                    'error'
                );
            } elseif (!is_email($email)) {
                wc_add_notice(
                    sprintf(__('Seat %d has an invalid email address.', 'easy-suite'), $i),
                    'error'
                );
            }
        }
    }
});

/** Stash the attendees on the order. */
add_action('woocommerce_checkout_create_order', function ($order, $data) {
    $items = easy_seat_cart_items();
    if (empty($items) || empty($_POST['easy_seats']) || !is_array($_POST['easy_seats'])) {
        return;
    }
    $posted = wp_unslash($_POST['easy_seats']);
    $groups = array();
    foreach ($items as $it) {
        if (empty($posted[$it['key']]) || !is_array($posted[$it['key']])) {
            continue;
        }
        $seats = array();
        for ($i = 1; $i <= $it['qty']; $i++) {
            $seat = isset($posted[$it['key']][$i]) && is_array($posted[$it['key']][$i])
                ? $posted[$it['key']][$i] : array();
            $seats[] = array(
                'name'     => isset($seat['name']) ? sanitize_text_field((string) $seat['name']) : '',
                'employer' => isset($seat['employer']) ? sanitize_text_field((string) $seat['employer']) : '',
                'phone'    => isset($seat['phone']) ? sanitize_text_field((string) $seat['phone']) : '',
                'email'    => isset($seat['email']) ? sanitize_email((string) $seat['email']) : '',
            );
        }
        $groups[] = array(
            'product_id' => (int) $it['product']->get_id(),
            'event_id'   => (int) $it['event_id'],
            'seats'      => $seats,
        );
    }
    if (!empty($groups)) {
        $order->update_meta_data('_easy_seat_attendees', $groups);
    }
}, 10, 2);

/* ------------------------------------------------------------------
 * Order -> roster sync (confirmed orders only)
 * ------------------------------------------------------------------ */

add_action('woocommerce_order_status_processing', 'easy_seats_sync_order_roster');
add_action('woocommerce_order_status_completed', 'easy_seats_sync_order_roster');

function easy_seats_sync_order_roster($order_id) {
    $order = wc_get_order($order_id);
    if (!$order || $order->get_meta('_easy_roster_synced')) {
        return;
    }
    $groups = $order->get_meta('_easy_seat_attendees');
    if (empty($groups) || !is_array($groups)) {
        return;
    }
    foreach ($groups as $group) {
        $event_id = isset($group['event_id']) ? (int) $group['event_id'] : 0;
        if ($event_id <= 0 || get_post_type($event_id) !== 'tribe_events') {
            continue;
        }
        if (!function_exists('easy_roster_get') || !function_exists('easy_roster_sanitize_record')) {
            continue; // roster module switched off — nothing to sync into
        }
        $roster = easy_roster_get($event_id);
        foreach ((array) $group['seats'] as $seat) {
            $rec = easy_roster_sanitize_record(array(
                'name'     => isset($seat['name']) ? $seat['name'] : '',
                'employer' => isset($seat['employer']) ? $seat['employer'] : '',
                'phone'    => isset($seat['phone']) ? $seat['phone'] : '',
                'email'    => isset($seat['email']) ? $seat['email'] : '',
                'payment'  => 'paid',
                'source'   => 'checkout',
            ));
            if ($rec === null) {
                continue;
            }
            $rec['added'] = time();
            $roster[] = $rec;
        }
        // Direct meta write: WooCommerce already decremented stock at
        // checkout, so this must NOT go through easy_roster_set (which
        // fires the stock-adjust hook below).
        update_post_meta($event_id, '_easy_roster', array_slice($roster, 0, 500));
    }
    $order->update_meta_data('_easy_roster_synced', 1);
    $order->save();
}

/* ------------------------------------------------------------------
 * Manual enrollment -> product stock
 *
 * Pam's app edits fire easy_roster_updated (2.2.6+: with the old roster).
 * Adjust the linked product's stock by the headcount delta so the site
 * seat count stays honest. Checkout-driven changes bypass this hook
 * (see above), so there is no double decrement.
 * ------------------------------------------------------------------ */

add_action('easy_roster_updated', function ($event_id, $new_roster, $old_roster, $user_id) {
    if (!easy_seats_wc_ready()) {
        return;
    }
    if (!is_array($old_roster)) {
        $old_roster = array();
    }
    $delta = count($new_roster) - count($old_roster);
    if ($delta === 0) {
        return;
    }
    $product_id = easy_seat_product_id($event_id);
    if ($product_id <= 0) {
        return;
    }
    $product = wc_get_product($product_id);
    if (!$product || !$product->managing_stock()) {
        return;
    }
    wc_update_product_stock($product, abs($delta), $delta > 0 ? 'decrease' : 'increase');
}, 10, 4);
