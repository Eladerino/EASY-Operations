<?php
/**
 * Module: Shop — instructor-only products and the "List a Product" form.
 *
 * Originally EASY Core modules 3 and 5.
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module 3: EASY Role-Based Product Visibility
 * --------------------------------------------------------------------------
 * Products in the "Instructor Materials" product category are visible only
 * to instructors, shop managers, and administrators. All other products
 * (e.g. safety equipment, rentals) remain public for everyone.
 *
 * Covers: shop loop, search results, related products, product widgets,
 * product-category lists, and direct single-product URLs (non-privileged
 * visitors are redirected to the instructor login with a notice).
 * ========================================================================== */

define('EASY_INSTRUCTOR_CAT_SLUG', 'instructor-materials');

/**
 * Instructors, shop managers, and administrators may see (and buy)
 * instructor-only training materials. Everyone else sees public products.
 */
function easy_user_can_see_instructor_products() {
    if (!is_user_logged_in()) {
        return false;
    }
    $user    = wp_get_current_user();
    $allowed = ['administrator', 'shop_manager', 'instructor'];
    return (bool) array_intersect($allowed, (array) $user->roles);
}

function easy_product_is_instructor_only($product_id) {
    return has_term(EASY_INSTRUCTOR_CAT_SLUG, 'product_cat', (int) $product_id);
}

/* Hide from shop loop, search, related products, and widgets. */
add_filter('woocommerce_product_is_visible', function ($visible, $product_id) {
    if ($visible && easy_product_is_instructor_only($product_id) && !easy_user_can_see_instructor_products()) {
        return false;
    }
    return $visible;
}, 10, 2);

/* Exclude from product queries as a second layer (loops that bypass the filter). */
add_filter('woocommerce_product_query_tax_query', function ($tax_query, $query) {
    if (!easy_user_can_see_instructor_products()) {
        $tax_query[] = [
            'taxonomy' => 'product_cat',
            'field'    => 'slug',
            'terms'    => [EASY_INSTRUCTOR_CAT_SLUG],
            'operator' => 'NOT IN',
        ];
    }
    return $tax_query;
}, 10, 2);

/* Block direct access to single product pages. */
add_action('template_redirect', function () {
    if (function_exists('is_product') && is_product()) {
        $product_id = get_queried_object_id();
        if (easy_product_is_instructor_only($product_id) && !easy_user_can_see_instructor_products()) {
            if (function_exists('wc_add_notice')) {
                wc_add_notice(
                    __('This product is available to instructors only. Please log in with your instructor account.', 'easy-core'),
                    'notice'
                );
            }
            wp_safe_redirect(home_url('/instructor-login/'));
            exit;
        }
    }
});

/* Hide the category itself from category lists/widgets for non-privileged users. */
add_filter('get_terms', function ($terms, $taxonomies, $args) {
    if (!is_admin()
        && in_array('product_cat', (array) $taxonomies, true)
        && !easy_user_can_see_instructor_products()
    ) {
        $terms = array_filter($terms, function ($term) {
            return !($term instanceof WP_Term && $term->slug === EASY_INSTRUCTOR_CAT_SLUG);
        });
    }
    return $terms;
}, 10, 3);

/* Friendlier empty-shop message (replaces WooCommerce's default
 * "No products were found matching your selection."). Runs on init so it
 * executes after WooCommerce registers its own template hooks. */
add_action('init', function () {
    remove_action('woocommerce_no_products_found', 'wc_no_products_found', 10);
    add_action('woocommerce_no_products_found', 'easy_core_no_products_found', 10);
});

function easy_core_no_products_found() {
    echo '<p class="woocommerce-info">'
        . esc_html__('There are no products available in the shop right now. Please check back soon.', 'easy-core')
        . '</p>';
}

/* ==========================================================================
 * Module 5: Front-end product submission ("List a Product")
 * --------------------------------------------------------------------------
 * [easy_product_form] shortcode: a friendly front-end form so non-technical
 * staff (e.g. Dad) can list shop products without touching wp-admin.
 *
 * - Only instructor, shop_manager, and administrator roles may submit.
 * - Listings are created as PENDING products — an admin or shop manager
 *   reviews and publishes them. Nothing goes live by accident.
 * - The category picker only offers public categories; the
 *   "Instructor Materials" category can never be selected here.
 * ========================================================================== */

function easy_user_can_list_products() {
    if (!is_user_logged_in()) {
        return false;
    }
    $user = wp_get_current_user();
    return (bool) array_intersect(['administrator', 'shop_manager', 'instructor'], (array) $user->roles);
}

/**
 * The accounts allowed to see the product-submission page. Set under
 * EASY Suite → Settings (option easy_product_form_allowed_users, one
 * username per line). An empty list means nobody: the page stays hidden
 * until at least one account is listed.
 */
function easy_suite_product_form_users() {
    $raw = (string) get_option('easy_product_form_allowed_users', '');
    return array_values(array_filter(array_map('trim', preg_split('/[\s,]+/', $raw))));
}

/**
 * Can this account use "List a Product" (web page and app alike)?
 * Both gates the web form uses: the handpicked Settings list (page
 * access) and a listing-capable role (form access).
 */
function easy_suite_is_product_lister($user = null) {
    $user = $user ?: wp_get_current_user();
    if (!$user || !$user->ID) {
        return false;
    }
    $listed = array_map('strtolower', easy_suite_product_form_users());
    if (!in_array(strtolower($user->user_login), $listed, true)) {
        return false;
    }
    return (bool) array_intersect(['administrator', 'shop_manager', 'instructor'], (array) $user->roles);
}

/**
 * Page-level gate: any page containing [easy_product_form] is visible only
 * to the allowed user. Logged-out visitors are sent to log in first (with a
 * redirect back); anyone else gets a 404 as if the page didn't exist.
 */
add_action('template_redirect', function () {
    if (!is_page()) {
        return;
    }
    $post = get_post();
    if (!$post || !has_shortcode($post->post_content, 'easy_product_form')) {
        return;
    }
    if (!is_user_logged_in()) {
        wp_safe_redirect(wp_login_url(get_permalink($post)));
        exit;
    }
    $user = wp_get_current_user();
    if (!$user || !in_array($user->user_login, easy_suite_product_form_users(), true)) {
        global $wp_query;
        $wp_query->set_404();
        status_header(404);
        nocache_headers();
        include get_query_template('404');
        exit;
    }
});

/**
 * Public product categories only — never the instructor-only category,
 * and never the empty "General" catch-all.
 */
function easy_public_product_cats() {
    $terms = get_terms(['taxonomy' => 'product_cat', 'hide_empty' => false]);
    $out   = [];
    foreach ((array) $terms as $t) {
        if ($t instanceof WP_Term && !in_array($t->slug, [EASY_INSTRUCTOR_CAT_SLUG, 'general'], true)) {
            $out[] = $t;
        }
    }
    return $out;
}

add_shortcode('easy_product_form', function () {
    if (!easy_user_can_list_products()) {
        return '<p>' . esc_html__('Please log in with your instructor account to list products.', 'easy-core') . '</p>';
    }
    if (!class_exists('WooCommerce')) {
        return '<p>' . esc_html__('The shop is not available right now.', 'easy-core') . '</p>';
    }

    $cats = easy_public_product_cats();
    ob_start();
    ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data" class="easy-product-form">
        <input type="hidden" name="action" value="easy_add_product">
        <?php wp_nonce_field('easy_add_product'); ?>
        <?php if (isset($_GET['easy_added'])) : ?>
            <p class="woocommerce-message"><?php esc_html_e('Thanks! Your listing was submitted and is waiting for review before it goes live.', 'easy-core'); ?></p>
        <?php endif; ?>
        <p>
            <label><?php esc_html_e('What are you selling?', 'easy-core'); ?><br>
            <input type="text" name="easy_name" required maxlength="120" style="width:100%;"></label>
        </p>
        <p>
            <label><?php esc_html_e('Describe it (condition, size, anything a buyer should know)', 'easy-core'); ?><br>
            <textarea name="easy_desc" rows="5" style="width:100%;"></textarea></label>
        </p>
        <p>
            <label><?php esc_html_e('Price (CAD)', 'easy-core'); ?><br>
            <input type="text" name="easy_price" required inputmode="decimal" placeholder="0.00" style="max-width:12em;"></label>
        </p>
        <p>
            <label><?php esc_html_e('How many do you have in stock?', 'easy-core'); ?><br>
            <input type="number" name="easy_stock" required min="0" step="1" value="1" style="max-width:12em;"></label>
        </p>
        <?php if ($cats) : ?>
        <p>
            <label><?php esc_html_e('Category', 'easy-core'); ?><br>
            <select name="easy_cat">
                <?php foreach ($cats as $c) : ?>
                    <option value="<?php echo esc_attr($c->term_id); ?>"><?php echo esc_html($c->name); ?></option>
                <?php endforeach; ?>
            </select></label>
        </p>
        <?php endif; ?>
        <?php if (current_user_can('upload_files')) : ?>
        <p>
            <label><?php esc_html_e('Photo', 'easy-core'); ?><br>
            <input type="file" name="easy_image" accept="image/*"></label>
        </p>
        <?php else : ?>
        <p><em><?php esc_html_e('Photo uploads are not enabled for your account: ask Brandon to add photos to your listing.', 'easy-core'); ?></em></p>
        <?php endif; ?>
        <p><button type="submit" class="button"><?php esc_html_e('Submit for review', 'easy-core'); ?></button></p>
    </form>
    <?php
    $mine = get_posts([
        'post_type'      => 'product',
        'author'         => get_current_user_id(),
        'posts_per_page' => 10,
        'post_status'    => ['pending', 'draft', 'publish'],
        'orderby'        => 'date',
        'order'          => 'DESC',
    ]);
    if ($mine) {
        echo '<h3>' . esc_html__('Your listings', 'easy-core') . '</h3><ul>';
        foreach ($mine as $m) {
            echo '<li>' . esc_html($m->post_title) . ' - ' . esc_html(ucfirst($m->post_status)) . '</li>';
        }
        echo '</ul>';
    }
    return ob_get_clean();
});

add_action('admin_post_easy_add_product', function () {
    if (!easy_user_can_list_products() || !class_exists('WC_Product_Simple')) {
        wp_die(esc_html__('Not allowed.', 'easy-core'), 403);
    }
    check_admin_referer('easy_add_product');

    $name      = isset($_POST['easy_name']) ? sanitize_text_field(wp_unslash($_POST['easy_name'])) : '';
    $desc      = isset($_POST['easy_desc']) ? wp_kses_post(wp_unslash($_POST['easy_desc'])) : '';
    $price_raw = isset($_POST['easy_price']) ? sanitize_text_field(wp_unslash($_POST['easy_price'])) : '';
    $stock_raw = isset($_POST['easy_stock']) ? sanitize_text_field(wp_unslash($_POST['easy_stock'])) : '';
    $cat_id    = isset($_POST['easy_cat']) ? (int) $_POST['easy_cat'] : 0;

    $referer = wp_get_referer() ? wp_get_referer() : home_url('/');
    if ($name === '' || !preg_match('/^\d+(\.\d{1,2})?$/', $price_raw) || !preg_match('/^\d+$/', $stock_raw)) {
        wp_safe_redirect($referer);
        exit;
    }

    $product_id = easy_suite_create_pending_product([
        'name'     => $name,
        'desc'     => $desc,
        'price'    => $price_raw,
        'stock'    => $stock_raw,
        'cat_id'   => $cat_id,
        'author'   => get_current_user_id(),
    ]);

    if ($product_id && !empty($_FILES['easy_image']['name']) && current_user_can('upload_files')) {
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        $att_id = media_handle_upload('easy_image', $product_id);
        if (!is_wp_error($att_id)) {
            set_post_thumbnail($product_id, $att_id);
        }
    }

    wp_safe_redirect(add_query_arg('easy_added', '1', $referer));
    exit;
});

/**
 * Create one pending-review product from already-sanitized fields, the
 * way the web form does. Returns the product ID, or 0 when the fields
 * fail the form's own validation (name required, price "12" or "12.34",
 * stock a whole number) or WooCommerce is unavailable. The category is
 * dropped unless it is a real public category.
 */
function easy_suite_create_pending_product($fields) {
    if (!class_exists('WC_Product_Simple')) {
        return 0;
    }
    $name      = (string) ($fields['name'] ?? '');
    $price_raw = (string) ($fields['price'] ?? '');
    $stock_raw = (string) ($fields['stock'] ?? '');
    if ($name === '' || !preg_match('/^\d+(\.\d{1,2})?$/', $price_raw) || !preg_match('/^\d+$/', $stock_raw)) {
        return 0;
    }
    $cat_id      = (int) ($fields['cat_id'] ?? 0);
    $allowed_ids = array_map(function ($t) { return $t->term_id; }, easy_public_product_cats());
    if (!in_array($cat_id, $allowed_ids, true)) {
        $cat_id = 0;
    }
    $product = new WC_Product_Simple();
    $product->set_name($name);
    $product->set_description((string) ($fields['desc'] ?? ''));
    $product->set_status('pending');
    $product->set_regular_price($price_raw);
    $product->set_manage_stock(true);
    $product->set_stock_quantity((int) $stock_raw);
    if ($cat_id) {
        $product->set_category_ids([$cat_id]);
    }
    $product_id = (int) $product->save();
    if ($product_id && !empty($fields['author'])) {
        wp_update_post(['ID' => $product_id, 'post_author' => (int) $fields['author']]);
    }
    return $product_id;
}

/* ==========================================================================
 * REST — "List an item" in EASY Manager (Suite 2.2.55)
 * --------------------------------------------------------------------------
 * The same listing flow as the web form, for the phone app: the app
 * uploads a photo through the core media endpoint first (the account's
 * own upload_files capability), then posts the listing here with the
 * attachment ID. Gated exactly like the page: handpicked Settings list
 * plus a listing-capable role. Listings are pending, never published.
 * ========================================================================== */

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/list-product', [
        [
            'methods'             => 'GET',
            'callback'            => 'easy_shop_rest_list_product_get',
            'permission_callback' => 'is_user_logged_in',
        ],
        [
            'methods'             => 'POST',
            'callback'            => 'easy_shop_rest_list_product_post',
            'permission_callback' => 'is_user_logged_in',
        ],
    ]);
});

function easy_shop_rest_list_product_get() {
    if (!easy_suite_is_product_lister()) {
        return new WP_Error('easy_list_product_forbidden', 'This account is not on the List a Product list.', ['status' => 403]);
    }
    $cats = [];
    foreach (easy_public_product_cats() as $t) {
        $cats[] = ['id' => (int) $t->term_id, 'name' => $t->name];
    }
    $mine = get_posts([
        'post_type'      => 'product',
        'author'         => get_current_user_id(),
        'posts_per_page' => 20,
        'post_status'    => ['pending', 'draft', 'publish'],
        'orderby'        => 'date',
        'order'          => 'DESC',
    ]);
    $listings = [];
    foreach ((array) $mine as $m) {
        $listings[] = [
            'id'     => (int) $m->ID,
            'name'   => $m->post_title,
            'status' => $m->post_status,
            'price'  => get_post_meta($m->ID, '_regular_price', true),
        ];
    }
    return ['categories' => $cats, 'listings' => $listings];
}

function easy_shop_rest_list_product_post($request) {
    if (!easy_suite_is_product_lister()) {
        return new WP_Error('easy_list_product_forbidden', 'This account is not on the List a Product list.', ['status' => 403]);
    }
    $params = $request->get_json_params();
    if (!is_array($params)) {
        $params = $request->get_body_params();
    }
    $params = is_array($params) ? $params : [];
    $name   = isset($params['name']) ? sanitize_text_field((string) $params['name']) : '';
    $name   = function_exists('mb_substr') ? mb_substr($name, 0, 120) : substr($name, 0, 120);
    $desc   = isset($params['description']) ? wp_kses_post((string) $params['description']) : '';
    $price  = isset($params['price']) ? sanitize_text_field((string) $params['price']) : '';
    $stock  = isset($params['stock']) ? sanitize_text_field((string) $params['stock']) : '';
    $cat_id = isset($params['category_id']) ? (int) $params['category_id'] : 0;

    $product_id = easy_suite_create_pending_product([
        'name'   => $name,
        'desc'   => $desc,
        'price'  => $price,
        'stock'  => $stock,
        'cat_id' => $cat_id,
        'author' => get_current_user_id(),
    ]);
    if (!$product_id) {
        return new WP_Error('easy_list_product_invalid', 'The listing could not be saved. Check the name, price (like 25 or 25.50) and how many you have in stock.', ['status' => 400]);
    }
    // Optional photo, already uploaded by the app: only an image the
    // account uploaded itself (or can edit) may become the photo.
    $image_id = isset($params['image_id']) ? (int) $params['image_id'] : 0;
    if ($image_id && current_user_can('upload_files')) {
        $att = get_post($image_id);
        if ($att && $att->post_type === 'attachment'
            && strpos((string) $att->post_mime_type, 'image/') === 0
            && ((int) $att->post_author === get_current_user_id() || current_user_can('edit_post', $image_id))
        ) {
            set_post_thumbnail($product_id, $image_id);
        }
    }
    return ['id' => $product_id, 'status' => 'pending'];
}

