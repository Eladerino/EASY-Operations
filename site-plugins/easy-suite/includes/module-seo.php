<?php
/**
 * Module: SEO noindex for utility and private pages.
 *
 * Originally EASY Core module 6. The page list default (EASY_NOINDEX_PATHS)
 * lives in helpers.php because the Settings page uses it too.
 */

defined('ABSPATH') || exit;

/* ==========================================================================
 * Module 6: SEO — noindex utility and private pages
 * --------------------------------------------------------------------------
 * Yoast's per-page noindex toggle would not persist on this site (it
 * reverted on save), so the noindex is applied here instead. Cart,
 * checkout, account, login, and portal pages — plus the private
 * /list-a-product/ page — are kept out of search results and out of
 * Yoast's XML sitemap.
 * ========================================================================== */

/**
 * Is the current front-end page one of the noindexed paths?
 */
function easy_seo_is_noindexed_page() {
    if (!is_page()) {
        return false;
    }
    $page = get_queried_object();
    if (!($page instanceof WP_Post)) {
        return false;
    }
    // Hierarchical path, e.g. "instructor-portal/submit-an-invoice".
    $path = trim(get_page_uri($page), '/');
    foreach (easy_core_get_noindex_paths() as $p) {
        if ($path === trim($p, '/')) {
            return true;
        }
    }
    foreach (EASY_NOINDEX_PATH_PREFIXES as $prefix) {
        $prefix = trim($prefix, '/');
        if ($path === $prefix || strpos($path . '/', $prefix . '/') === 0) {
            return true;
        }
    }
    return false;
}

/* Robots meta: noindex, nofollow on the listed pages. Priority 20 runs
 * after Yoast's own wp_robots filter so ours wins; the wpseo_robots filter
 * covers Yoast's rendered tag directly. */
add_filter('wp_robots', function ($robots) {
    if (easy_seo_is_noindexed_page()) {
        unset($robots['index'], $robots['follow']);
        $robots['noindex']  = true;
        $robots['nofollow'] = true;
    }
    return $robots;
}, 20);

add_filter('wpseo_robots', function ($robots) {
    if (easy_seo_is_noindexed_page()) {
        return 'noindex, nofollow';
    }
    return $robots;
});

/* Keep the listed pages out of Yoast's XML sitemap. */
add_filter('wpseo_exclude_from_sitemap_by_post_ids', function ($excluded) {
    $excluded = array_map('intval', (array) $excluded);
    $add_path = function ($path) use (&$excluded) {
        $page = get_page_by_path(trim($path, '/'));
        if ($page instanceof WP_Post) {
            $excluded[] = (int) $page->ID;
        }
    };
    foreach (easy_core_get_noindex_paths() as $p) {
        $add_path($p);
    }
    foreach (EASY_NOINDEX_PATH_PREFIXES as $prefix) {
        $parent = get_page_by_path(trim($prefix, '/'));
        if ($parent instanceof WP_Post) {
            $children = get_pages(['child_of' => $parent->ID, 'post_type' => 'page']);
            foreach ((array) $children as $child) {
                $excluded[] = (int) $child->ID;
            }
        }
    }
    return array_values(array_unique($excluded));
});

