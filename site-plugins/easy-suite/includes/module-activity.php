<?php
/**
 * Site-wide activity log.
 *
 * Records who did what across every surface (phone app, desktop app,
 * wp-admin) at the server funnels every surface passes through, so the
 * answer to "who changed this class price, and when" lives on the site
 * itself instead of in one phone's local history. Read in wp-admin
 * (EASY Suite -> Activity) and by administrators over REST
 * (GET /easy/v1/activity). Management queue decisions are not copied
 * into the table; the readers fold them in at read time from the
 * queue's own records, so the queue stays the single source of truth.
 *
 * What is logged, and only this: classes created, published,
 * unpublished, trashed, restored, and edited (price and seat capacity
 * changes, with before and after values); certificates created,
 * published, returned to draft, and trashed; account signups approved
 * or rejected. No logins, no page views, no roster reads. Writes with
 * no acting user (cron, system processes) are skipped for classes and
 * certificates: an actorless row answers nobody's question. No student
 * contact details (email, phone) are ever written; certificate rows
 * carry the certificate title, which includes the student name, the
 * same exposure office accounts already have in certificate search.
 * Rows are kept for 12 months and pruned daily.
 */

defined('ABSPATH') || exit;

define('EASY_ACTIVITY_DB', 1);
define('EASY_ACTIVITY_CRON', 'easy_activity_daily');
define('EASY_ACTIVITY_TZ', 'America/St_Johns');
define('EASY_ACTIVITY_RETENTION_MONTHS', 12);

/* ---------------- table ---------------- */

function easy_activity_table() {
    global $wpdb;
    return $wpdb->prefix . 'easy_activity';
}

function easy_activity_schema() {
    global $wpdb;
    $collate = $wpdb->get_charset_collate();
    $t = easy_activity_table();
    // dbDelta format: one column per line, two spaces after PRIMARY KEY.
    return array(
        "CREATE TABLE $t (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  created_at datetime NOT NULL,
  user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  kind varchar(16) NOT NULL DEFAULT '',
  object_id bigint(20) unsigned NOT NULL DEFAULT 0,
  title varchar(190) NOT NULL DEFAULT '',
  action varchar(32) NOT NULL DEFAULT '',
  detail longtext,
  PRIMARY KEY  (id),
  KEY created_at (created_at),
  KEY kind_created (kind,created_at),
  KEY user_created (user_id,created_at)
) $collate;",
    );
}

function easy_activity_table_exists() {
    global $wpdb;
    $table = easy_activity_table();
    return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table;
}

/** True once the table is installed at the current schema version. */
function easy_activity_ready() {
    return (int) get_option('easy_activity_db') === EASY_ACTIVITY_DB;
}

/**
 * Create or upgrade the table when the stored schema version differs.
 * Same pattern as the license tables: dbDelta only adds what is
 * missing, and a failure is retried at most every ten minutes.
 */
function easy_activity_install() {
    if (easy_activity_ready() || get_transient('easy_activity_db_failed')) {
        return easy_activity_ready();
    }
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta(easy_activity_schema());
    if (!easy_activity_table_exists()) {
        global $wpdb;
        set_transient('easy_activity_db_failed', $wpdb->last_error ?: 'The table was not created.', 10 * MINUTE_IN_SECONDS);
        return false;
    }
    update_option('easy_activity_db', EASY_ACTIVITY_DB, true);
    delete_transient('easy_activity_db_failed');
    return true;
}
add_action('init', 'easy_activity_install', 5);

/* ---------------- writing ---------------- */

/**
 * Insert one row. created_at is site time, matching how the queue
 * stamps its records, so every surface agrees on what "today" means.
 */
function easy_activity_insert($kind, $object_id, $title, $action, $user_id, $detail) {
    global $wpdb;
    if (!easy_activity_ready()) {
        return false;
    }
    $ok = $wpdb->insert(easy_activity_table(), array(
        'created_at' => current_time('mysql'),
        'user_id'    => max(0, (int) $user_id),
        'kind'       => substr((string) $kind, 0, 16),
        'object_id'  => max(0, (int) $object_id),
        'title'      => substr((string) $title, 0, 190),
        'action'     => substr((string) $action, 0, 32),
        'detail'     => $detail ? wp_json_encode($detail) : null,
    ), array('%s', '%d', '%s', '%d', '%s', '%s', '%s'));
    return $ok !== false;
}

/** Coarse request surface: the log can tell REST from wp-admin, not phone from desktop. */
function easy_activity_surface() {
    if (defined('REST_REQUEST') && REST_REQUEST) {
        return 'rest';
    }
    return is_admin() ? 'admin' : 'site';
}

/* ---------------- per-request collector ----------------
 *
 * One save fires several hooks (a status transition, two meta writes,
 * save_post). Facts are collected per object during the request and
 * written as a single row on shutdown: a status fact wins the headline
 * action, meta diffs attach as detail, a save with diffs but no status
 * change headlines as "edited", and a save with neither is dropped.
 * That drop is what keeps TEC's internal re-saves and no-change saves
 * out of the log.
 */

function &easy_activity_bucket($kind, $object_id) {
    if (!isset($GLOBALS['easy_activity_collect']) || !is_array($GLOBALS['easy_activity_collect'])) {
        $GLOBALS['easy_activity_collect'] = array();
    }
    $key = $kind . ':' . (int) $object_id;
    if (!isset($GLOBALS['easy_activity_collect'][$key])) {
        $GLOBALS['easy_activity_collect'][$key] = array(
            'kind'       => $kind,
            'object_id'  => (int) $object_id,
            'user_id'    => (int) get_current_user_id(),
            'title'      => '',
            'status'     => null,
            'created_as' => '',
            'changes'    => array(),
            'meta_from'  => array(),
            'surface'    => easy_activity_surface(),
        );
    }
    $bucket = &$GLOBALS['easy_activity_collect'][$key];
    if ($bucket['user_id'] <= 0) {
        $uid = (int) get_current_user_id();
        if ($uid > 0) {
            $bucket['user_id'] = $uid;
        }
    }
    return $bucket;
}

/**
 * Map a post status transition to a log action, or null when the
 * transition says nothing the log cares about (same-status saves,
 * autosaves, inherit).
 */
function easy_activity_status_action($old_status, $new_status) {
    if ($new_status === 'auto-draft' || $new_status === 'inherit') {
        return null;
    }
    $was_live = in_array($old_status, array('publish', 'draft', 'pending', 'private', 'future'), true);
    if (!$was_live) {
        // From new (or trash): a first appearance is a creation; coming
        // back from the trash is a restore.
        return $old_status === 'trash' ? 'restored' : 'created';
    }
    if ($new_status === 'trash') {
        return 'trashed';
    }
    if ($new_status === 'publish' && $old_status !== 'publish') {
        return 'published';
    }
    if ($old_status === 'publish' && in_array($new_status, array('draft', 'pending'), true)) {
        return 'unpublished';
    }
    return null;
}

function easy_activity_flush() {
    if (!empty($GLOBALS['easy_activity_flushed'])) {
        return;
    }
    $GLOBALS['easy_activity_flushed'] = true;
    $buckets = isset($GLOBALS['easy_activity_collect']) && is_array($GLOBALS['easy_activity_collect'])
        ? $GLOBALS['easy_activity_collect'] : array();
    $GLOBALS['easy_activity_collect'] = array();
    foreach ($buckets as $bucket) {
        // Only real changes count: a meta entry needs both sides.
        $changes = array();
        foreach ($bucket['changes'] as $change) {
            if (array_key_exists('from', $change) && array_key_exists('to', $change)
                && (string) $change['from'] !== (string) $change['to']) {
                $changes[] = $change;
            }
        }
        $action = $bucket['status'];
        if ($action === null && !empty($changes)) {
            $action = 'edited';
        }
        if ($action === null) {
            continue; // A save that changed nothing the log tracks.
        }
        if ($bucket['user_id'] <= 0) {
            continue; // Actorless (cron/system) class and cert writes are skipped.
        }
        $title = $bucket['title'];
        if ($title === '') {
            $title = (string) get_the_title($bucket['object_id']);
        }
        $detail = array('surface' => $bucket['surface']);
        if (!empty($changes)) {
            $detail['changes'] = $changes;
        }
        if ($action === 'created' && $bucket['created_as'] !== '') {
            $detail['created_as'] = $bucket['created_as'];
        }
        easy_activity_insert($bucket['kind'], $bucket['object_id'], $title, $action, $bucket['user_id'], $detail);
    }
}
add_action('shutdown', 'easy_activity_flush');

/* ---------------- classes and certificates: status transitions ---------------- */

add_action('transition_post_status', function ($new_status, $old_status, $post) {
    if (!($post instanceof WP_Post)) {
        return;
    }
    if ($post->post_type !== 'tribe_events' && $post->post_type !== 'cert') {
        return;
    }
    $action = easy_activity_status_action($old_status, $new_status);
    if ($action === null) {
        return;
    }
    $kind = $post->post_type === 'cert' ? 'cert' : 'class';
    $bucket = &easy_activity_bucket($kind, $post->ID);
    $bucket['status'] = $action;
    if ($action === 'created') {
        $bucket['created_as'] = $new_status === 'publish' ? 'publish' : 'draft';
    }
    if ((string) $post->post_title !== '') {
        $bucket['title'] = (string) $post->post_title;
    }
    unset($bucket);
}, 10, 3);

/*
 * Refresh the class title snapshot on save, so a rename in the same
 * request is the title the row carries. Priority 30 runs after the
 * seat-sales stash writes (priorities 15 and 20), so any meta they
 * write has fired its meta hooks before the request ends; the
 * collector reads meta facts from the meta funnel below, never from
 * postmeta mid-save.
 */
add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }
    if (!($post instanceof WP_Post)) {
        return;
    }
    $bucket = &easy_activity_bucket('class', $post_id);
    if ((string) $post->post_title !== '') {
        $bucket['title'] = (string) $post->post_title;
    }
    unset($bucket);
}, 30, 3);

/* ---------------- classes: price and seat capacity diffs ----------------
 *
 * Every write to _EventCost and _easy_seat_capacity, from every
 * surface, funnels through update_post_meta / add_post_meta /
 * delete_post_meta. The "before" side is captured in the pre-write
 * filters, while the old value is still in the database; the "after"
 * side lands in the post-write actions. This is what dodges the
 * _EventCost timing trap: TEC writes the cost after save_post fires,
 * so a logger reading postmeta during save_post logs prices one save
 * behind, while the meta funnel sees each write as it happens, late
 * writes included. A key written twice in one request keeps the first
 * "before" and the last "after".
 */

function easy_activity_watched_meta() {
    return array(
        '_EventCost'           => 'price',
        '_easy_seat_capacity'  => 'seats',
    );
}

function easy_activity_meta_target($object_id, $meta_key) {
    $watched = easy_activity_watched_meta();
    if (!isset($watched[$meta_key])) {
        return null;
    }
    if (get_post_type($object_id) !== 'tribe_events') {
        return null;
    }
    return $watched[$meta_key];
}

function easy_activity_meta_capture_from($object_id, $meta_key) {
    $field = easy_activity_meta_target($object_id, $meta_key);
    if ($field === null) {
        return;
    }
    $bucket = &easy_activity_bucket('class', $object_id);
    if (!isset($bucket['meta_from'][$field])) {
        $old = get_post_meta($object_id, $meta_key, true);
        $bucket['meta_from'][$field] = is_scalar($old) ? (string) $old : '';
    }
    unset($bucket);
}

function easy_activity_meta_record_to($object_id, $meta_key, $meta_value, $is_delete) {
    $field = easy_activity_meta_target($object_id, $meta_key);
    if ($field === null) {
        return;
    }
    $bucket = &easy_activity_bucket('class', $object_id);
    if (!isset($bucket['changes'][$field])) {
        $bucket['changes'][$field] = array('field' => $field);
        if (isset($bucket['meta_from'][$field])) {
            $bucket['changes'][$field]['from'] = $bucket['meta_from'][$field];
        }
    }
    $bucket['changes'][$field]['to'] = $is_delete ? '' : (is_scalar($meta_value) ? (string) $meta_value : '');
    unset($bucket);
}

add_filter('update_post_metadata', function ($check, $object_id, $meta_key) {
    easy_activity_meta_capture_from($object_id, $meta_key);
    return $check;
}, 10, 3);

add_filter('add_post_metadata', function ($check, $object_id, $meta_key) {
    easy_activity_meta_capture_from($object_id, $meta_key);
    return $check;
}, 10, 3);

add_action('updated_post_meta', function ($meta_id, $object_id, $meta_key, $meta_value) {
    easy_activity_meta_record_to($object_id, $meta_key, $meta_value, false);
}, 10, 4);

add_action('added_post_meta', function ($meta_id, $object_id, $meta_key, $meta_value) {
    easy_activity_meta_record_to($object_id, $meta_key, $meta_value, false);
}, 10, 4);

add_action('deleted_post_meta', function ($meta_ids, $object_id, $meta_key, $meta_value) {
    easy_activity_meta_record_to($object_id, $meta_key, $meta_value, true);
}, 10, 4);

/* ---------------- accounts: decisions at the account_status funnel ----------------
 *
 * The app and desktop decide through easy_approvals_apply_decision();
 * Ultimate Member's own members screen decides without touching the
 * Suite at all. Both write the same account_status user meta, which is
 * UM's own record of the decision, so that write is the one funnel
 * that sees every decision. Transitions into approved or rejected are
 * logged; arrivals (awaiting_admin_review) are not team actions and
 * are left to the Approvals count. Rows go through the same collector
 * (kind account, object is the user being decided on).
 */

function easy_activity_account_capture_from($user_id, $meta_key) {
    if ($meta_key !== 'account_status') {
        return;
    }
    $bucket = &easy_activity_bucket('account', $user_id);
    if (!isset($bucket['meta_from']['account_status'])) {
        $old = get_user_meta($user_id, 'account_status', true);
        $bucket['meta_from']['account_status'] = is_scalar($old) ? (string) $old : '';
    }
    unset($bucket);
}

function easy_activity_account_record($user_id, $meta_key, $meta_value) {
    if ($meta_key !== 'account_status') {
        return;
    }
    $new = is_scalar($meta_value) ? (string) $meta_value : '';
    if ($new !== 'approved' && $new !== 'rejected') {
        return;
    }
    $bucket = &easy_activity_bucket('account', $user_id);
    $from = isset($bucket['meta_from']['account_status']) ? $bucket['meta_from']['account_status'] : '';
    if ($from === $new) {
        unset($bucket);
        return;
    }
    $bucket['status'] = $new;
    $user = get_userdata($user_id);
    if ($user) {
        $bucket['title'] = $user->display_name !== '' ? $user->display_name : $user->user_login;
    }
    unset($bucket);
}

add_filter('update_user_metadata', function ($check, $user_id, $meta_key) {
    easy_activity_account_capture_from($user_id, $meta_key);
    return $check;
}, 10, 3);

add_filter('add_user_metadata', function ($check, $user_id, $meta_key) {
    easy_activity_account_capture_from($user_id, $meta_key);
    return $check;
}, 10, 3);

add_action('updated_user_meta', function ($meta_id, $user_id, $meta_key, $meta_value) {
    easy_activity_account_record($user_id, $meta_key, $meta_value);
}, 10, 4);

add_action('added_user_meta', function ($meta_id, $user_id, $meta_key, $meta_value) {
    easy_activity_account_record($user_id, $meta_key, $meta_value);
}, 10, 4);

/* ---------------- queue rows, folded in by reference ----------------
 *
 * Queue decisions are already recorded in the easy_mgmt_queue_responses
 * option with decided_by / decided_at and resolved { by, at } stamps.
 * Readers synthesize rows from that option at read time; nothing is
 * copied into the activity table, so reopening a question in the queue
 * simply removes its row here too. Queue rows exist only while the
 * decision stands.
 */

/** Resolve a queue actor stamp (a user login) to a display name and ID when possible. */
function easy_activity_actor_from_login($login) {
    if (!is_string($login) || $login === '') {
        return array('', 0);
    }
    $user = get_user_by('login', $login);
    if ($user) {
        return array($user->display_name !== '' ? $user->display_name : $user->user_login, (int) $user->ID);
    }
    return array($login, 0);
}

/** Site-time 'Y-m-d H:i:s' string to a millisecond timestamp, read as site time. */
function easy_activity_ts_ms($site_time) {
    if (!is_string($site_time) || $site_time === '') {
        return 0;
    }
    try {
        $dt = new DateTimeImmutable($site_time, wp_timezone());
    } catch (Exception $e) {
        return 0;
    }
    return (int) $dt->getTimestamp() * 1000;
}

/**
 * Synthesized queue rows in the shared item shape, newest facts only:
 * one "answered" row per decided question and one "resolved" row per
 * resolved question, from the queue's own stamps. IDs are negative so
 * they can never collide with table IDs.
 */
function easy_activity_queue_rows() {
    if (!function_exists('easy_mgmt_queue_get_responses') || !function_exists('easy_mgmt_queue_questions')) {
        return array();
    }
    $all = easy_mgmt_queue_get_responses();
    $answers = isset($all['answers']) && is_array($all['answers']) ? $all['answers'] : array();
    $decided = isset($all['decided']) ? (array) $all['decided'] : array();
    $resolved = function_exists('easy_mgmt_queue_get_resolved') ? easy_mgmt_queue_get_resolved($all) : array();
    $labels = array();
    $by_key = array();
    foreach (easy_mgmt_queue_questions() as $q) {
        if (is_array($q) && !empty($q['key'])) {
            $labels[$q['key']] = isset($q['label']) ? (string) $q['label'] : $q['key'];
            $by_key[$q['key']] = $q;
        }
    }
    $rows = array();
    $n = 0;
    foreach ($decided as $key) {
        if (!isset($labels[$key])) {
            continue; // Ghost key: the question is gone, so is its row.
        }
        $ans = isset($answers[$key]) && is_array($answers[$key]) ? $answers[$key] : array();
        $by = isset($ans['decided_by']) ? $ans['decided_by'] : (isset($all['submitted_by']) ? $all['submitted_by'] : null);
        $at = isset($ans['decided_at']) ? $ans['decided_at'] : (isset($all['submitted_at']) ? $all['submitted_at'] : null);
        list($actor, $actor_id) = easy_activity_actor_from_login(is_string($by) ? $by : '');
        $summary = '';
        if (isset($by_key[$key]) && function_exists('easy_mgmt_queue_format_answer')) {
            $formatted = easy_mgmt_queue_format_answer($by_key[$key], $ans);
            if (is_string($formatted) && $formatted !== '') {
                $summary = 'Answer: ' . $formatted;
            }
        }
        $n++;
        $rows[] = array(
            'id'       => -$n,
            'kind'     => 'queue',
            'title'    => $labels[$key],
            'action'   => 'answered',
            'summary'  => $summary,
            'actor'    => $actor,
            'actor_id' => $actor_id,
            'at'       => easy_activity_ts_ms(is_string($at) ? $at : ''),
            'at_iso'   => is_string($at) ? str_replace(' ', 'T', $at) : '',
            'source'   => 'queue',
        );
        if (isset($resolved[$key])) {
            list($ractor, $ractor_id) = easy_activity_actor_from_login(
                isset($resolved[$key]['by']) && is_string($resolved[$key]['by']) ? $resolved[$key]['by'] : ''
            );
            $rat = isset($resolved[$key]['at']) ? $resolved[$key]['at'] : null;
            $n++;
            $rows[] = array(
                'id'       => -$n,
                'kind'     => 'queue',
                'title'    => $labels[$key],
                'action'   => 'resolved',
                'summary'  => '',
                'actor'    => $ractor,
                'actor_id' => $ractor_id,
                'at'       => easy_activity_ts_ms(is_string($rat) ? $rat : ''),
                'at_iso'   => is_string($rat) ? str_replace(' ', 'T', $rat) : '',
                'source'   => 'queue',
            );
        }
    }
    return $rows;
}

/* ---------------- shared query (REST + admin) ---------------- */

function easy_activity_format_price($value) {
    $v = trim(str_replace(array('$', ','), '', (string) $value));
    if ($v === '') {
        return '(no price set)';
    }
    if (is_numeric($v)) {
        $f = (float) $v;
        return '$' . ($f == (int) $f ? number_format((int) $f) : number_format($f, 2));
    }
    return (string) $value;
}

function easy_activity_format_seats($value) {
    $v = trim((string) $value);
    return $v === '' ? '(no seat limit set)' : (string) (int) $v;
}

/** Rendered detail line for a table row, derived from its stored detail JSON. */
function easy_activity_summary($action, $detail) {
    if (!is_array($detail) || empty($detail['changes']) || !is_array($detail['changes'])) {
        return '';
    }
    $parts = array();
    foreach ($detail['changes'] as $change) {
        if (!is_array($change) || !isset($change['field'])) {
            continue;
        }
        if ($change['field'] === 'price') {
            $parts[] = 'Price ' . easy_activity_format_price(isset($change['from']) ? $change['from'] : '')
                . ' to ' . easy_activity_format_price(isset($change['to']) ? $change['to'] : '');
        } elseif ($change['field'] === 'seats') {
            $parts[] = 'Seats ' . easy_activity_format_seats(isset($change['from']) ? $change['from'] : '')
                . ' to ' . easy_activity_format_seats(isset($change['to']) ? $change['to'] : '');
        }
    }
    return implode(', ', $parts);
}

/** One table row in the shared item shape. */
function easy_activity_item_from_row($row) {
    $detail = null;
    if (isset($row->detail) && $row->detail !== null && $row->detail !== '') {
        $decoded = json_decode((string) $row->detail, true);
        $detail = is_array($decoded) ? $decoded : null;
    }
    $actor = '';
    $user_id = (int) $row->user_id;
    if ($user_id > 0) {
        $user = get_userdata($user_id);
        if ($user) {
            $actor = $user->display_name !== '' ? $user->display_name : $user->user_login;
        }
    }
    return array(
        'id'       => (int) $row->id,
        'kind'     => (string) $row->kind,
        'title'    => (string) $row->title,
        'action'   => (string) $row->action,
        'summary'  => easy_activity_summary((string) $row->action, $detail),
        'detail'   => $detail,
        'actor'    => $actor,
        'actor_id' => $user_id,
        'at'       => easy_activity_ts_ms((string) $row->created_at),
        'at_iso'   => str_replace(' ', 'T', (string) $row->created_at),
        'source'   => 'log',
    );
}

/**
 * The one query both read surfaces use, so the admin tab and the REST
 * feed can never disagree. Queue rows merge in PHP: they number in the
 * dozens, so pulling a deep enough window of table rows and slicing
 * after the merge is safe at this scale.
 *
 * Args: kind (all|class|cert|account|queue), user_id (0 = anyone),
 * page, per_page. Returns array( items, total, page, per_page ).
 */
function easy_activity_query($args) {
    global $wpdb;
    $kind = isset($args['kind']) ? (string) $args['kind'] : 'all';
    if (!in_array($kind, array('all', 'class', 'cert', 'account', 'queue', 'checkin'), true)) {
        $kind = 'all';
    }
    $user_id = isset($args['user_id']) ? max(0, (int) $args['user_id']) : 0;
    $page = isset($args['page']) ? max(1, (int) $args['page']) : 1;
    $per_page = isset($args['per_page']) ? min(100, max(1, (int) $args['per_page'])) : 50;

    $queue_rows = array();
    if ($kind === 'all' || $kind === 'queue') {
        $queue_rows = easy_activity_queue_rows();
        if ($user_id > 0) {
            $queue_rows = array_values(array_filter($queue_rows, function ($r) use ($user_id) {
                return (int) $r['actor_id'] === $user_id;
            }));
        }
    }
    if ($kind === 'queue') {
        usort($queue_rows, function ($a, $b) {
            return $b['at'] <=> $a['at'];
        });
        return array(
            'items'    => array_slice($queue_rows, ($page - 1) * $per_page, $per_page),
            'total'    => count($queue_rows),
            'page'     => $page,
            'per_page' => $per_page,
        );
    }

    $items = array();
    $total = count($queue_rows);
    if (easy_activity_ready()) {
        $table = easy_activity_table();
        $where = array('1=1');
        $params = array();
        if ($kind !== 'all') {
            $where[] = 'kind = %s';
            $params[] = $kind;
        }
        if ($user_id > 0) {
            $where[] = 'user_id = %d';
            $params[] = $user_id;
        }
        $where_sql = implode(' AND ', $where);
        $count_sql = "SELECT COUNT(*) FROM $table WHERE $where_sql";
        $total += (int) ($params ? $wpdb->get_var($wpdb->prepare($count_sql, $params)) : $wpdb->get_var($count_sql));
        // Fetch enough table rows that merging the queue rows cannot
        // push a table row off the requested page.
        $window = $page * $per_page + count($queue_rows);
        $fetch_sql = "SELECT * FROM $table WHERE $where_sql ORDER BY created_at DESC, id DESC LIMIT %d";
        $fetch_params = array_merge($params, array($window));
        $rows = $wpdb->get_results($wpdb->prepare($fetch_sql, $fetch_params));
        foreach ((array) $rows as $row) {
            $items[] = easy_activity_item_from_row($row);
        }
    }
    $items = array_merge($items, $queue_rows);
    usort($items, function ($a, $b) {
        if ($a['at'] === $b['at']) {
            return $b['id'] <=> $a['id'];
        }
        return $b['at'] <=> $a['at'];
    });
    return array(
        'items'    => array_slice($items, ($page - 1) * $per_page, $per_page),
        'total'    => $total,
        'page'     => $page,
        'per_page' => $per_page,
    );
}

/* ---------------- REST ---------------- */

function easy_activity_rest_can_read() {
    return is_user_logged_in() && current_user_can('manage_options');
}

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/activity', array(
        'methods'             => 'GET',
        'callback'            => 'easy_activity_rest_get',
        'permission_callback' => 'easy_activity_rest_can_read',
        'args'                => array(
            'page' => array(
                'default'           => 1,
                'sanitize_callback' => 'absint',
                'validate_callback' => function ($param) {
                    return (int) $param >= 1;
                },
            ),
            'per_page' => array(
                'default'           => 50,
                'sanitize_callback' => 'absint',
                'validate_callback' => function ($param) {
                    $n = (int) $param;
                    return $n >= 1 && $n <= 100;
                },
            ),
            'kind' => array(
                'default'           => 'all',
                'sanitize_callback' => 'sanitize_key',
                'validate_callback' => function ($param) {
                    return in_array($param, array('all', 'class', 'cert', 'account', 'queue'), true);
                },
            ),
            'user' => array(
                'default'           => 0,
                'sanitize_callback' => 'absint',
            ),
        ),
    ));
});

function easy_activity_rest_get($request) {
    $result = easy_activity_query(array(
        'kind'     => $request->get_param('kind'),
        'user_id'  => $request->get_param('user'),
        'page'     => $request->get_param('page'),
        'per_page' => $request->get_param('per_page'),
    ));
    return array(
        'items'    => $result['items'],
        'page'     => $result['page'],
        'per_page' => $result['per_page'],
        'total'    => $result['total'],
    );
}

/* ---------------- wp-admin page ---------------- */

/** Plain-language phrase for one item, matching the app's wording. */
function easy_activity_phrase($item) {
    $title = $item['title'] !== '' ? $item['title'] : '(untitled)';
    switch ($item['kind']) {
        case 'class':
            $verbs = array(
                'created'     => 'Created class',
                'published'   => 'Published class',
                'unpublished' => 'Unpublished class',
                'edited'      => 'Edited class',
                'trashed'     => 'Trashed class',
                'restored'    => 'Restored class',
            );
            $verb = isset($verbs[$item['action']]) ? $verbs[$item['action']] : 'Changed class';
            return $verb . ': ' . $title;
        case 'cert':
            $verbs = array(
                'created'     => 'Created certificate',
                'published'   => 'Published certificate',
                'unpublished' => 'Returned certificate to draft',
                'trashed'     => 'Trashed certificate',
                'restored'    => 'Restored certificate',
            );
            $verb = isset($verbs[$item['action']]) ? $verbs[$item['action']] : 'Changed certificate';
            return $verb . ': ' . $title;
        case 'account':
            if ($item['action'] === 'approved') {
                return 'Approved account signup: ' . $title;
            }
            if ($item['action'] === 'rejected') {
                return 'Rejected account signup: ' . $title;
            }
            return 'Account decision: ' . $title;
        case 'queue':
            if ($item['action'] === 'resolved') {
                return 'Marked resolved: ' . $title;
            }
            return 'Answered: ' . $title;
        case 'checkin':
            if ($item['action'] === 'checked_in') {
                $name = isset($item['detail']['name']) ? trim((string) $item['detail']['name']) : '';
                return 'Checked in: ' . ($name !== '' ? $name . ' (' . $title . ')' : $title);
            }
            $verbs = array(
                'link_created'     => 'Created check-in link',
                'link_regenerated' => 'Created a new check-in link',
                'closed'           => 'Closed check-in',
            );
            $verb = isset($verbs[$item['action']]) ? $verbs[$item['action']] : 'Check-in update';
            return $verb . ': ' . $title;
    }
    return $title;
}

function easy_activity_admin_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }
    $kind = isset($_GET['kind']) ? sanitize_key(wp_unslash($_GET['kind'])) : 'all';
    if (!in_array($kind, array('all', 'class', 'cert', 'account', 'queue', 'checkin'), true)) {
        $kind = 'all';
    }
    $user_id = isset($_GET['user']) ? absint(wp_unslash($_GET['user'])) : 0;
    $page = isset($_GET['paged']) ? max(1, absint(wp_unslash($_GET['paged']))) : 1;
    $per_page = 50;

    $result = easy_activity_query(array(
        'kind'     => $kind,
        'user_id'  => $user_id,
        'page'     => $page,
        'per_page' => $per_page,
    ));
    $total_pages = max(1, (int) ceil($result['total'] / $per_page));

    // People filter: everyone with a row in the table.
    $people = array();
    if (easy_activity_ready()) {
        global $wpdb;
        $ids = $wpdb->get_col('SELECT DISTINCT user_id FROM ' . easy_activity_table() . ' WHERE user_id > 0 ORDER BY user_id');
        foreach ((array) $ids as $id) {
            $u = get_userdata((int) $id);
            if ($u) {
                $people[(int) $id] = $u->display_name !== '' ? $u->display_name : $u->user_login;
            }
        }
    }

    echo '<div class="wrap" style="max-width:1000px;"><h1>Activity</h1>';
    easy_suite_admin_tabs('easy-suite-activity');
    echo '<p>Who did what across the website, the desktop app, and the phone app: classes scheduled or edited, certificates published, account signups decided, management queue answers, and class check-ins. Queue activity reflects current decisions: reopening a question removes its entry here. Entries are kept for 12 months.</p>';

    $base = admin_url('admin.php?page=easy-suite-activity');
    $kind_labels = array(
        'all'     => 'All',
        'class'   => 'Classes',
        'cert'    => 'Certificates',
        'account' => 'Accounts',
        'queue'   => 'Queue',
        'checkin' => 'Check-ins',
    );
    echo '<p>';
    $first = true;
    foreach ($kind_labels as $k => $label) {
        if (!$first) {
            echo ' | ';
        }
        $first = false;
        $url = $k === 'all' ? $base : add_query_arg('kind', $k, $base);
        if ($user_id > 0) {
            $url = add_query_arg('user', $user_id, $url);
        }
        if ($k === $kind) {
            echo '<strong>' . esc_html($label) . '</strong>';
        } else {
            echo '<a href="' . esc_url($url) . '">' . esc_html($label) . '</a>';
        }
    }
    echo '</p>';

    if (!empty($people)) {
        echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '">';
        echo '<input type="hidden" name="page" value="easy-suite-activity">';
        if ($kind !== 'all') {
            echo '<input type="hidden" name="kind" value="' . esc_attr($kind) . '">';
        }
        echo '<label for="easy_activity_user">Person: </label>';
        echo '<select name="user" id="easy_activity_user">';
        echo '<option value="0"' . ($user_id === 0 ? ' selected' : '') . '>Everyone</option>';
        foreach ($people as $id => $name) {
            echo '<option value="' . (int) $id . '"' . ($user_id === $id ? ' selected' : '') . '>' . esc_html($name) . '</option>';
        }
        echo '</select> ';
        echo '<button type="submit" class="button">Filter</button>';
        echo '</form>';
    }

    if (empty($result['items'])) {
        echo '<p><em>No activity recorded yet.</em></p>';
    } else {
        echo '<table class="widefat striped"><thead><tr>'
            . '<th style="width:18%">When</th><th style="width:18%">Who</th>'
            . '<th style="width:34%">What</th><th>Details</th></tr></thead><tbody>';
        foreach ($result['items'] as $item) {
            $when = $item['at_iso'] !== '' ? $item['at_iso'] : '';
            if ($when !== '') {
                try {
                    $dt = new DateTimeImmutable(str_replace('T', ' ', $when), wp_timezone());
                    $when = $dt->format('M j, Y g:i A');
                } catch (Exception $e) {
                    $when = $item['at_iso'];
                }
            }
            echo '<tr><td>' . esc_html($when) . '</td>'
                . '<td>' . esc_html($item['actor'] !== '' ? $item['actor'] : '(unknown)') . '</td>'
                . '<td>' . esc_html(easy_activity_phrase($item)) . '</td>'
                . '<td>' . esc_html($item['summary']) . '</td></tr>';
        }
        echo '</tbody></table>';
        if ($total_pages > 1) {
            echo '<p>';
            if ($page > 1) {
                $prev = add_query_arg('paged', $page - 1, $kind === 'all' ? $base : add_query_arg('kind', $kind, $base));
                if ($user_id > 0) {
                    $prev = add_query_arg('user', $user_id, $prev);
                }
                echo '<a href="' . esc_url($prev) . '">&laquo; Newer</a> ';
            }
            echo 'Page ' . (int) $page . ' of ' . (int) $total_pages;
            if ($page < $total_pages) {
                $next = add_query_arg('paged', $page + 1, $kind === 'all' ? $base : add_query_arg('kind', $kind, $base));
                if ($user_id > 0) {
                    $next = add_query_arg('user', $user_id, $next);
                }
                echo ' <a href="' . esc_url($next) . '">Older &raquo;</a>';
            }
            echo '</p>';
        }
    }
    echo '</div>';
}

/* ---------------- daily prune ---------------- */

/**
 * Delete rows older than the retention window, in modest batches so a
 * big first cleanup never holds a long lock. The created_at index
 * keeps each batch cheap.
 */
function easy_activity_prune() {
    global $wpdb;
    if (!easy_activity_ready()) {
        return 0;
    }
    $base = new DateTimeImmutable(current_time('mysql'));
    $cutoff = $base->modify('-' . EASY_ACTIVITY_RETENTION_MONTHS . ' months')->format('Y-m-d H:i:s');
    $table = easy_activity_table();
    $deleted = 0;
    do {
        $batch = (int) $wpdb->query($wpdb->prepare(
            "DELETE FROM $table WHERE created_at < %s ORDER BY id LIMIT 500",
            $cutoff
        ));
        $deleted += $batch;
    } while ($batch >= 500);
    return $deleted;
}
add_action(EASY_ACTIVITY_CRON, 'easy_activity_prune');

/* Daily at 3:45 AM St. John's time, offset from the license job's 3:15. */
add_action('init', function () {
    if (!wp_next_scheduled(EASY_ACTIVITY_CRON)) {
        $next = new DateTimeImmutable('tomorrow 03:45', new DateTimeZone(EASY_ACTIVITY_TZ));
        wp_schedule_event($next->getTimestamp(), 'daily', EASY_ACTIVITY_CRON);
    }
});

