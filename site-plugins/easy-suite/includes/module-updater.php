<?php
/**
 * Module: GitHub self-updater.
 *
 * WordPress only offers updates for plugins that have an update source, so
 * the Plugins screen learns about new EASY Suite versions from the
 * EASY-Operations GitHub releases. A "Publish Suite" workflow run attaches
 * easy-suite-<version>.zip to a prerelease there; this module spots the
 * newest such asset and hands it to the normal update flow, so updating is
 * the usual "Update now" click instead of a manual zip upload. The manual
 * upload keeps working as a fallback.
 *
 * The check runs only inside WordPress's own update-transient flow (the
 * Plugins screen refresh and the twice-daily update cron), its parsed
 * result is cached in a site transient for 12 hours, and any failure to
 * reach or parse GitHub is silent: no notices, no errors, nothing offered.
 */

defined('ABSPATH') || exit;

/** Where suite release zips are published. */
define('EASY_SUITE_UPDATER_RELEASES_URL', 'https://api.github.com/repos/Eladerino/EASY-Operations/releases?per_page=30');

/** Site transient holding the parsed newest-release result. */
define('EASY_SUITE_UPDATER_CACHE_KEY', 'easy_suite_updater_release');

/**
 * The newest easy-suite-<version>.zip found in the repo's releases, as
 * array('version', 'package', 'url'); an empty array when the releases
 * were read fine but carry no suite zip; null when no result is
 * available (fetch or parse failed, or fetching was not allowed and the
 * cache was cold).
 *
 * Callers in the update-transient flow pass $allow_fetch = true, which is
 * the only path allowed to hit the network, and only when the 12-hour
 * cache has expired. Everyone else reads the cache or gets null.
 */
function easy_suite_updater_latest($allow_fetch) {
    $cached = get_site_transient(EASY_SUITE_UPDATER_CACHE_KEY);
    if ($cached !== false) {
        return is_array($cached) && !empty($cached) ? $cached : (is_array($cached) ? [] : null);
    }
    if (!$allow_fetch) {
        return null;
    }

    $response = wp_remote_get(EASY_SUITE_UPDATER_RELEASES_URL, [
        'timeout' => 10,
        'headers' => [
            'Accept'     => 'application/vnd.github+json',
            'User-Agent' => 'EASY-Suite/' . EASY_SUITE_VERSION . ' (WordPress plugin updater)',
        ],
    ]);
    if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) {
        return null;
    }
    $releases = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($releases)) {
        return null;
    }

    $best = null;
    foreach ($releases as $release) {
        if (!is_array($release) || empty($release['assets']) || !is_array($release['assets'])) {
            continue;
        }
        foreach ($release['assets'] as $asset) {
            if (!is_array($asset) || empty($asset['name']) || empty($asset['browser_download_url'])) {
                continue;
            }
            if (!preg_match('/^easy-suite-(\d+\.\d+\.\d+)\.zip$/', (string) $asset['name'], $m)) {
                continue;
            }
            if ($best === null || version_compare($m[1], $best['version'], '>')) {
                $best = [
                    'version' => $m[1],
                    'package' => (string) $asset['browser_download_url'],
                    'url'     => isset($release['html_url']) ? (string) $release['html_url'] : '',
                ];
            }
        }
    }

    // Cache the parsed result, including "no suite zip found", so the
    // network is touched at most once per cache window. Failures above
    // returned early and are never cached.
    set_site_transient(EASY_SUITE_UPDATER_CACHE_KEY, $best === null ? [] : $best, 12 * HOUR_IN_SECONDS);
    return $best;
}

/**
 * Feed the newest GitHub release into the Plugins update transient, the
 * same shape WordPress core builds for wordpress.org plugins: a response
 * entry when the release is newer than the installed version, otherwise
 * a no_update entry so core does not treat the plugin as unknown.
 */
function easy_suite_updater_check_for_update($value) {
    if (!is_object($value) || empty($value->checked) || !isset($value->checked['easy-suite/easy-suite.php'])) {
        return $value;
    }
    $latest = easy_suite_updater_latest(true);
    if ($latest === null || empty($latest)) {
        return $value;
    }

    $item = new stdClass();
    $item->id          = 'https://github.com/Eladerino/EASY-Operations';
    $item->slug        = 'easy-suite';
    $item->plugin      = 'easy-suite/easy-suite.php';
    $item->url         = $latest['url'];
    $item->tested      = '';
    $item->requires    = '6.5';
    $item->requires_php = '8.0';

    if (version_compare($latest['version'], EASY_SUITE_VERSION, '>')) {
        $item->new_version = $latest['version'];
        $item->package     = $latest['package'];
        $value->response['easy-suite/easy-suite.php'] = $item;
    } else {
        $item->new_version = EASY_SUITE_VERSION;
        $item->package     = '';
        $value->no_update['easy-suite/easy-suite.php'] = $item;
    }
    return $value;
}
add_filter('pre_set_site_transient_update_plugins', 'easy_suite_updater_check_for_update');

/**
 * "View details" content for the Plugins screen update row. Reads the
 * cached release result only (never the network); when no release data
 * is available the incoming value passes through untouched.
 */
function easy_suite_updater_plugin_information($result, $action, $args) {
    if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'easy-suite') {
        return $result;
    }
    $latest = easy_suite_updater_latest(false);
    if ($latest === null || empty($latest)) {
        return $result;
    }

    $info = new stdClass();
    $info->name          = 'EASY Suite';
    $info->slug          = 'easy-suite';
    $info->version       = $latest['version'];
    $info->download_link = $latest['package'];
    $info->homepage      = $latest['url'];
    $info->sections      = [
        'description' => 'The EASY Suite plugin for easysafety.ca: certificate data and PDFs, certificate emails, the site routes the EASY Operations and EASY Manager apps use, online course keys, and the remaining site integrations.',
        'changelog'   => 'Release notes and the matching easy-suite-' . $latest['version'] . '.zip live on the GitHub release page: ' . $latest['url'],
    ];
    return $info;
}
add_filter('plugins_api', 'easy_suite_updater_plugin_information', 20, 3);
