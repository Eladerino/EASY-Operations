<?php
/**
 * Course Builder sync for the EASY Operations app.
 *
 * The app's Course Builder used to keep courses in each machine's local
 * storage and pass reviews around as JSON files. This module makes the site
 * the shared copy: authors' edits upload as they work, reviews land in every
 * reviewer's inbox, and approved versions are stored here for the module
 * player to read later.
 *
 *   easy_course       one private post per course. post_name = the app's
 *                     course id; the course JSON is in _easy_course_data.
 *                     _easy_course_rev counts saves so two machines editing
 *                     the same course can't silently overwrite each other.
 *   easy_course_snap  one private post per review snapshot (post_parent =
 *                     the course): version, state, who sent and decided it.
 *
 * Roles. Authors (listed under EASY Suite → Settings; nobody until
 * configured) create and edit.
 * Reviewers are admins, anyone who can publish certificates, and any extra
 * usernames listed in Settings. Everyone else gets 403.
 *
 * Course content is stored as the app sends it (size-capped, re-encoded,
 * never rendered by WordPress). Anything that displays it must escape it, as
 * the app does.
 *
 * Format versions. Each course says which format it is in (schemaVersion,
 * missing = 1); the app upgrades older ones when it reads them (see
 * renderer/course-schema.js). Saves send `schema`, the newest format that
 * app understands (missing = 1, which covers apps from before versioning).
 * A save over a course stored in a newer format than that is refused with
 * 426, so an old app can't strip fields it doesn't know about. Snapshots and
 * the final package carry schemaVersion so the module player can tell too.
 *
 * Routes (easy/v1/course-builder/...):
 *   GET    me                             roles + pending review count
 *   GET    courses                        every course
 *   GET    courses/<id>                   one course
 *   POST   courses/<id>   {course, baseRev}   create (baseRev 0) or update
 *   DELETE courses/<id>                   move to trash with its snapshots
 *   POST   courses/<id>/review {course, baseRev}  save, then snapshot for review
 *   POST   courses/<id>/withdraw          pull the pending snapshot back
 *   GET    courses/<id>/final             approved package for the player
 *   GET    reviews                        newest 50 snapshots, pending first
 *   POST   reviews/<sid>/approve
 *   POST   reviews/<sid>/send-back {note}
 *   GET|POST authors {authors: []}
 */

defined('ABSPATH') || exit;

define('EASY_COURSE_ID_PATTERN', '[a-z0-9_-]{1,64}');
define('EASY_COURSE_MAX_BYTES', 2 * 1024 * 1024);
define('EASY_COURSE_DEFAULT_AUTHORS', []);

add_action('init', function () {
    $common = [
        'public'              => false,
        'publicly_queryable'  => false,
        'exclude_from_search' => true,
        'show_ui'             => false,
        'show_in_rest'        => false,
        'rewrite'             => false,
        'query_var'           => false,
        'can_export'          => true,
        'supports'            => ['title', 'author'],
    ];
    register_post_type('easy_course', $common + ['label' => 'Builder courses']);
    register_post_type('easy_course_snap', $common + ['label' => 'Course review snapshots']);
});

/* ---------------- roles ---------------- */

function easy_course_usernames_option($option, $default) {
    $raw = get_option($option, false);
    if ($raw === false) {
        return $default;
    }
    $names = array_map('strtolower', array_map('trim', preg_split('/[\s,]+/', (string) $raw)));
    return array_values(array_unique(array_filter($names)));
}

function easy_course_authors() {
    return easy_course_usernames_option('easy_course_authors', EASY_COURSE_DEFAULT_AUTHORS);
}

function easy_course_extra_reviewers() {
    return easy_course_usernames_option('easy_course_reviewers', []);
}

function easy_course_login($user = null) {
    $user = $user ?: wp_get_current_user();
    return ($user && $user->ID) ? strtolower($user->user_login) : '';
}

function easy_course_is_author($user = null) {
    $login = easy_course_login($user);
    return $login !== '' && in_array($login, easy_course_authors(), true);
}

function easy_course_is_reviewer($user = null) {
    $user = $user ?: wp_get_current_user();
    if (!$user || !$user->ID) {
        return false;
    }
    if (user_can($user, 'manage_options')) {
        return true;
    }
    $pto = get_post_type_object('cert');
    $publish_cap = ($pto && !empty($pto->cap->publish_posts)) ? $pto->cap->publish_posts : 'publish_posts';
    if (user_can($user, $publish_cap)) {
        return true;
    }
    return in_array(easy_course_login($user), easy_course_extra_reviewers(), true);
}

function easy_course_rest_can_access() {
    return is_user_logged_in() && (easy_course_is_author() || easy_course_is_reviewer());
}

function easy_course_rest_can_author() {
    return is_user_logged_in() && easy_course_is_author();
}

function easy_course_rest_can_review() {
    return is_user_logged_in() && easy_course_is_reviewer();
}

function easy_course_rest_can_manage_authors() {
    return is_user_logged_in() && (easy_course_is_author() || current_user_can('manage_options'));
}

/* ---------------- storage ---------------- */

/** Fields the site owns: the app never sets these on save. */
function easy_course_workflow_keys() {
    return ['status', 'reviewVersion', 'approvedVersion', 'liveEditedSinceReview', 'reviewNote'];
}

function easy_course_post($cid) {
    $posts = get_posts([
        'post_type'        => 'easy_course',
        'name'             => $cid,
        'post_status'      => 'private',
        'numberposts'      => 1,
        'suppress_filters' => true,
    ]);
    return ($posts && $posts[0]->post_name === $cid) ? $posts[0] : null;
}

function easy_course_json_encode($value) {
    return wp_json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Stored course content as an object (empty object when unreadable). */
function easy_course_stored_content($post_id) {
    $data = json_decode((string) get_post_meta($post_id, '_easy_course_data', true));
    return is_object($data) ? $data : new stdClass();
}

/** Comparable fingerprint of a course's content (timestamps left out). */
function easy_course_signature($content) {
    $copy = clone $content;
    unset($copy->updatedAt, $copy->createdAt);
    return md5((string) easy_course_json_encode($copy));
}

/** Format version of stored or incoming course content (missing = 1). */
function easy_course_schema_of($content) {
    $v = (is_object($content) && isset($content->schemaVersion)) ? $content->schemaVersion : 1;
    return (is_int($v) && $v >= 1) ? $v : 1;
}

function easy_course_iso($gmt) {
    return $gmt ? gmdate('c', strtotime($gmt . ' UTC')) : null;
}

/** API shape of one course: content with the site's workflow fields on top. */
function easy_course_export(WP_Post $post) {
    $course = easy_course_stored_content($post->ID);
    $course->id = $post->post_name;
    $course->status = (string) get_post_meta($post->ID, '_easy_course_status', true) ?: 'draft';
    $course->reviewVersion = (int) get_post_meta($post->ID, '_easy_course_review_version', true);
    $course->approvedVersion = (int) get_post_meta($post->ID, '_easy_course_approved_version', true);
    $course->liveEditedSinceReview = (bool) get_post_meta($post->ID, '_easy_course_edited_since', true);
    $course->reviewNote = (string) get_post_meta($post->ID, '_easy_course_review_note', true);
    return [
        'course'    => $course,
        'rev'       => (int) get_post_meta($post->ID, '_easy_course_rev', true),
        'updatedBy' => (string) get_post_meta($post->ID, '_easy_course_updated_by', true),
        'modified'  => easy_course_iso($post->post_modified_gmt),
    ];
}

/**
 * Read and check the course object from a request body. Decoded as objects
 * (not arrays) so empty {} values survive the round trip unchanged.
 */
function easy_course_content_from_request(WP_REST_Request $request, $cid) {
    // Route matching ignores case; course ids are lowercase (they become the post slug).
    if ($cid !== strtolower($cid)) {
        return new WP_Error('easy_course_invalid', 'Course ids are lowercase.', ['status' => 400]);
    }
    $body = json_decode((string) $request->get_body());
    $course = (is_object($body) && isset($body->course)) ? $body->course : null;
    if (!is_object($course)) {
        return new WP_Error('easy_course_invalid', 'The request has no course in it.', ['status' => 400]);
    }
    if (!isset($course->chapters) || !is_array($course->chapters)) {
        return new WP_Error('easy_course_invalid', 'A course needs a chapters list.', ['status' => 400]);
    }
    foreach (array_keys(get_object_vars($course)) as $key) {
        if ($key === '' || $key[0] === '_' || in_array($key, easy_course_workflow_keys(), true)) {
            unset($course->$key);
        }
    }
    $course->id = $cid;
    $course->title = isset($course->title) && is_string($course->title)
        ? mb_substr(trim($course->title), 0, 200) : '';
    $json = easy_course_json_encode($course);
    if ($json === false) {
        return new WP_Error('easy_course_invalid', 'The course could not be read.', ['status' => 400]);
    }
    if (isset($course->schemaVersion) && !(is_int($course->schemaVersion) && $course->schemaVersion >= 1)) {
        return new WP_Error('easy_course_invalid', 'The course format version is not readable.', ['status' => 400]);
    }
    if (strlen($json) > EASY_COURSE_MAX_BYTES) {
        return new WP_Error('easy_course_too_big', 'This course is too large to save (over 2 MB). Media files are not stored in the course, so check for very long pasted text.', ['status' => 413]);
    }
    $schema = (is_object($body) && isset($body->schema) && is_int($body->schema) && $body->schema >= 1) ? $body->schema : 1;
    return [
        'course'  => $course,
        'json'    => $json,
        'baseRev' => (is_object($body) && isset($body->baseRev)) ? (int) $body->baseRev : 0,
        'schema'  => $schema,
    ];
}

function easy_course_stale_error(WP_Post $post) {
    return new WP_Error(
        'easy_course_stale',
        'This course was changed on another computer since this copy was last saved.',
        ['status' => 409, 'current' => easy_course_export($post)]
    );
}

/**
 * Create or update a course from a checked request. Updates use the save
 * counter as a compare-and-set: the stored _easy_course_rev must equal the
 * baseRev the app last saw, and the increment itself only succeeds if no
 * other save got there first. The counter starts at 1, never 0:
 * update_post_meta() treats a previous value of '0' as "no previous value".
 */
function easy_course_save_content($cid, array $input) {
    $post = easy_course_post($cid);
    $title = $input['course']->title !== '' ? $input['course']->title : 'Untitled course';
    $login = easy_course_login();

    if (!$post) {
        if ($input['baseRev'] !== 0) {
            return new WP_Error('easy_course_gone', 'This course was deleted on the site.', ['status' => 410]);
        }
        $id = wp_insert_post([
            'post_type'   => 'easy_course',
            'post_status' => 'private',
            'post_title'  => $title,
            'post_name'   => $cid,
            'post_author' => get_current_user_id(),
        ], true);
        if (is_wp_error($id)) {
            return $id;
        }
        $created = get_post($id);
        if (!$created || $created->post_name !== $cid) {
            wp_delete_post($id, true);
            return new WP_Error('easy_course_id_taken', 'A course with this id already exists on the site.', ['status' => 409]);
        }
        update_post_meta($id, '_easy_course_data', wp_slash($input['json']));
        update_post_meta($id, '_easy_course_rev', 1);
        update_post_meta($id, '_easy_course_status', 'draft');
        update_post_meta($id, '_easy_course_updated_by', $login);
        return get_post($id);
    }

    $stored = easy_course_stored_content($post->ID);
    if (easy_course_schema_of($stored) > $input['schema']) {
        return new WP_Error(
            'easy_course_newer_format',
            'This course was saved by a newer version of EASY Operations. Update the app on this computer to keep editing it.',
            ['status' => 426]
        );
    }
    $rev = (int) get_post_meta($post->ID, '_easy_course_rev', true);
    if ($input['baseRev'] !== $rev) {
        return easy_course_stale_error($post);
    }
    $changed = easy_course_signature($stored) !== easy_course_signature($input['course']);
    // Compare-and-set: matches zero rows if another save already moved the counter on.
    if (!update_post_meta($post->ID, '_easy_course_rev', $rev + 1, (string) $rev)) {
        return easy_course_stale_error(get_post($post->ID));
    }
    update_post_meta($post->ID, '_easy_course_data', wp_slash($input['json']));
    update_post_meta($post->ID, '_easy_course_updated_by', $login);
    $status = (string) get_post_meta($post->ID, '_easy_course_status', true);
    if ($changed && ($status === 'in_review' || $status === 'approved')) {
        update_post_meta($post->ID, '_easy_course_edited_since', 1);
    }
    wp_update_post(['ID' => $post->ID, 'post_title' => $title]);
    return get_post($post->ID);
}

/* ---------------- snapshots ---------------- */

function easy_course_snapshots($course_post_id, $state = null) {
    $args = [
        'post_type'        => 'easy_course_snap',
        'post_parent'      => $course_post_id,
        'post_status'      => 'private',
        'numberposts'      => -1,
        'orderby'          => 'date',
        'order'            => 'DESC',
        'suppress_filters' => true,
    ];
    if ($state) {
        $args['meta_key'] = '_easy_snap_state';
        $args['meta_value'] = $state;
    }
    return get_posts($args);
}

function easy_course_export_snapshot(WP_Post $snap) {
    $parent = get_post($snap->post_parent);
    $content = json_decode((string) get_post_meta($snap->ID, '_easy_snap_data', true));
    return [
        'id'        => $snap->ID,
        'courseId'  => $parent ? $parent->post_name : '',
        'version'   => (int) get_post_meta($snap->ID, '_easy_snap_version', true),
        'state'     => (string) get_post_meta($snap->ID, '_easy_snap_state', true),
        'by'        => (string) get_post_meta($snap->ID, '_easy_snap_by', true),
        'at'        => easy_course_iso($snap->post_date_gmt),
        'note'      => (string) get_post_meta($snap->ID, '_easy_snap_note', true),
        'decidedBy' => (string) get_post_meta($snap->ID, '_easy_snap_decided_by', true),
        'decidedAt' => (string) get_post_meta($snap->ID, '_easy_snap_decided_at', true) ?: null,
        'course'    => is_object($content) ? $content : new stdClass(),
    ];
}

/** The part of a course a reviewer signs off on (same as the app's snapshotOf). */
function easy_course_snapshot_content($course) {
    $snap = new stdClass();
    foreach (['schemaVersion', 'title', 'description', 'passMark', 'maxAttempts', 'onFail', 'chapters', 'finalQuiz'] as $key) {
        if (property_exists($course, $key)) {
            $snap->$key = $course->$key;
        }
    }
    return $snap;
}

function easy_course_pending_review_count() {
    $q = new WP_Query([
        'post_type'        => 'easy_course_snap',
        'post_status'      => 'private',
        'meta_key'         => '_easy_snap_state',
        'meta_value'       => 'pending',
        'posts_per_page'   => 1,
        'fields'           => 'ids',
        'suppress_filters' => true,
    ]);
    return (int) $q->found_posts;
}

function easy_course_snap_or_error($sid) {
    $snap = get_post((int) $sid);
    if (!$snap || $snap->post_type !== 'easy_course_snap' || $snap->post_status !== 'private') {
        return new WP_Error('easy_course_review_missing', 'That review no longer exists.', ['status' => 404]);
    }
    $state = (string) get_post_meta($snap->ID, '_easy_snap_state', true);
    if ($state !== 'pending') {
        $what = ['approved' => 'approved', 'sent_back' => 'sent back', 'withdrawn' => 'withdrawn by the author'][$state] ?? 'handled';
        return new WP_Error('easy_course_review_handled', 'This review was already ' . $what . '.', ['status' => 409]);
    }
    $course = get_post($snap->post_parent);
    if (!$course || $course->post_type !== 'easy_course' || $course->post_status !== 'private') {
        return new WP_Error('easy_course_missing', 'The course for this review was deleted.', ['status' => 404]);
    }
    return [$snap, $course];
}

function easy_course_decide_snapshot(WP_Post $snap, $state, $note = '') {
    update_post_meta($snap->ID, '_easy_snap_state', $state);
    update_post_meta($snap->ID, '_easy_snap_decided_by', easy_course_login());
    update_post_meta($snap->ID, '_easy_snap_decided_at', gmdate('c'));
    if ($note !== '') {
        update_post_meta($snap->ID, '_easy_snap_note', wp_slash($note));
    }
}

function easy_course_final_package(WP_Post $course) {
    $version = (int) get_post_meta($course->ID, '_easy_course_approved_version', true);
    if ($version < 1) {
        return null;
    }
    foreach (easy_course_snapshots($course->ID, 'approved') as $snap) {
        if ((int) get_post_meta($snap->ID, '_easy_snap_version', true) === $version) {
            $s = easy_course_export_snapshot($snap);
            return [
                'package'       => 'easy-course-final',
                'format'        => 1,
                'kind'          => 'final',
                'schemaVersion' => easy_course_schema_of($s['course']),
                'courseId'      => $course->post_name,
                'version'       => $version,
                'approvedBy'    => $s['decidedBy'],
                'approvedAt'    => $s['decidedAt'],
                'course'        => $s['course'],
            ];
        }
    }
    return null;
}

/* ---------------- routes ---------------- */

function easy_course_from_route(WP_REST_Request $request) {
    $post = easy_course_post((string) $request['cid']);
    return $post ?: new WP_Error('easy_course_missing', 'That course is not on the site.', ['status' => 404]);
}

add_action('rest_api_init', function () {
    $ns = 'easy/v1';
    $cid = '/course-builder/courses/(?P<cid>' . EASY_COURSE_ID_PATTERN . ')';

    register_rest_route($ns, '/course-builder/me', [
        'methods'             => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback'            => function () {
            $reviewer = easy_course_is_reviewer();
            return [
                'user'             => easy_course_login(),
                'isAuthor'         => easy_course_is_author(),
                'isReviewer'       => $reviewer,
                'canManageAuthors' => easy_course_rest_can_manage_authors(),
                'authors'          => easy_course_authors(),
                'pendingReviews'   => $reviewer ? easy_course_pending_review_count() : 0,
                'version'          => EASY_SUITE_VERSION,
            ];
        },
    ]);

    register_rest_route($ns, '/course-builder/courses', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_course_rest_can_access',
        'callback'            => function () {
            $posts = get_posts([
                'post_type'        => 'easy_course',
                'post_status'      => 'private',
                'numberposts'      => -1,
                'orderby'          => 'modified',
                'order'            => 'DESC',
                'suppress_filters' => true,
            ]);
            return ['courses' => array_map('easy_course_export', $posts)];
        },
    ]);

    register_rest_route($ns, $cid, [
        [
            'methods'             => 'GET',
            'permission_callback' => 'easy_course_rest_can_access',
            'callback'            => function (WP_REST_Request $request) {
                $post = easy_course_from_route($request);
                return is_wp_error($post) ? $post : easy_course_export($post);
            },
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'permission_callback' => 'easy_course_rest_can_author',
            'callback'            => function (WP_REST_Request $request) {
                $cid = (string) $request['cid'];
                $input = easy_course_content_from_request($request, $cid);
                if (is_wp_error($input)) {
                    return $input;
                }
                $existed = (bool) easy_course_post($cid);
                $post = easy_course_save_content($cid, $input);
                if (is_wp_error($post)) {
                    return $post;
                }
                return new WP_REST_Response(easy_course_export($post), $existed ? 200 : 201);
            },
        ],
        [
            'methods'             => 'DELETE',
            'permission_callback' => 'easy_course_rest_can_author',
            'callback'            => function (WP_REST_Request $request) {
                $post = easy_course_from_route($request);
                if (is_wp_error($post)) {
                    return $post;
                }
                foreach (easy_course_snapshots($post->ID) as $snap) {
                    wp_trash_post($snap->ID);
                }
                wp_trash_post($post->ID);
                return ['deleted' => true, 'id' => (string) $request['cid']];
            },
        ],
    ]);

    register_rest_route($ns, $cid . '/review', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_course_rest_can_author',
        'callback'            => function (WP_REST_Request $request) {
            $cid = (string) $request['cid'];
            $input = easy_course_content_from_request($request, $cid);
            if (is_wp_error($input)) {
                return $input;
            }
            $current = easy_course_post($cid);
            if ($current && get_post_meta($current->ID, '_easy_course_status', true) === 'in_review') {
                return new WP_Error('easy_course_in_review', 'A version of this course is already with the reviewer. Withdraw it first to send a newer one.', ['status' => 409]);
            }
            $post = easy_course_save_content($cid, $input);
            if (is_wp_error($post)) {
                return $post;
            }
            $version = (int) get_post_meta($post->ID, '_easy_course_review_version', true) + 1;
            $snap_id = wp_insert_post([
                'post_type'   => 'easy_course_snap',
                'post_status' => 'private',
                'post_parent' => $post->ID,
                'post_title'  => $post->post_title . ' v' . $version,
                'post_name'   => $cid . '-v' . $version,
                'post_author' => get_current_user_id(),
            ], true);
            if (is_wp_error($snap_id)) {
                return $snap_id;
            }
            update_post_meta($snap_id, '_easy_snap_version', $version);
            update_post_meta($snap_id, '_easy_snap_state', 'pending');
            update_post_meta($snap_id, '_easy_snap_by', easy_course_login());
            update_post_meta($snap_id, '_easy_snap_data', wp_slash(easy_course_json_encode(easy_course_snapshot_content($input['course']))));

            update_post_meta($post->ID, '_easy_course_review_version', $version);
            update_post_meta($post->ID, '_easy_course_status', 'in_review');
            update_post_meta($post->ID, '_easy_course_edited_since', 0);
            update_post_meta($post->ID, '_easy_course_review_note', '');

            $out = easy_course_export(get_post($post->ID));
            $out['review'] = easy_course_export_snapshot(get_post($snap_id));
            return $out;
        },
    ]);

    register_rest_route($ns, $cid . '/withdraw', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_course_rest_can_author',
        'callback'            => function (WP_REST_Request $request) {
            $post = easy_course_from_route($request);
            if (is_wp_error($post)) {
                return $post;
            }
            foreach (easy_course_snapshots($post->ID, 'pending') as $snap) {
                easy_course_decide_snapshot($snap, 'withdrawn');
            }
            // An earlier approved version still stands; otherwise back to draft.
            $approved = (int) get_post_meta($post->ID, '_easy_course_approved_version', true);
            update_post_meta($post->ID, '_easy_course_status', $approved > 0 ? 'approved' : 'draft');
            if ($approved > 0) {
                update_post_meta($post->ID, '_easy_course_edited_since', 1);
            }
            return easy_course_export(get_post($post->ID));
        },
    ]);

    register_rest_route($ns, $cid . '/final', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_course_rest_can_access',
        'callback'            => function (WP_REST_Request $request) {
            $post = easy_course_from_route($request);
            if (is_wp_error($post)) {
                return $post;
            }
            $package = easy_course_final_package($post);
            return $package ?: new WP_Error('easy_course_not_approved', 'No version of this course has been approved yet.', ['status' => 404]);
        },
    ]);

    register_rest_route($ns, '/course-builder/reviews', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_course_rest_can_access',
        'callback'            => function () {
            $snaps = get_posts([
                'post_type'        => 'easy_course_snap',
                'post_status'      => 'private',
                'numberposts'      => 50,
                'orderby'          => 'date',
                'order'            => 'DESC',
                'suppress_filters' => true,
            ]);
            $out = array_map('easy_course_export_snapshot', $snaps);
            // Pending first, newest first within each group.
            usort($out, function ($a, $b) {
                $pa = $a['state'] === 'pending' ? 0 : 1;
                $pb = $b['state'] === 'pending' ? 0 : 1;
                return $pa !== $pb ? $pa - $pb : strcmp((string) $b['at'], (string) $a['at']);
            });
            return ['reviews' => $out];
        },
    ]);

    register_rest_route($ns, '/course-builder/reviews/(?P<sid>\d+)/approve', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_course_rest_can_review',
        'callback'            => function (WP_REST_Request $request) {
            $found = easy_course_snap_or_error($request['sid']);
            if (is_wp_error($found)) {
                return $found;
            }
            [$snap, $course] = $found;
            easy_course_decide_snapshot($snap, 'approved');
            update_post_meta($course->ID, '_easy_course_status', 'approved');
            update_post_meta($course->ID, '_easy_course_approved_version', (int) get_post_meta($snap->ID, '_easy_snap_version', true));
            update_post_meta($course->ID, '_easy_course_review_note', '');
            $out = easy_course_export(get_post($course->ID));
            $out['review'] = easy_course_export_snapshot(get_post($snap->ID));
            $out['final'] = easy_course_final_package(get_post($course->ID));
            return $out;
        },
    ]);

    register_rest_route($ns, '/course-builder/reviews/(?P<sid>\d+)/send-back', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_course_rest_can_review',
        'callback'            => function (WP_REST_Request $request) {
            $note = mb_substr(trim(sanitize_textarea_field((string) $request->get_param('note'))), 0, 2000);
            if ($note === '') {
                return new WP_Error('easy_course_note_required', 'Add a short note so the author knows what to fix.', ['status' => 400]);
            }
            $found = easy_course_snap_or_error($request['sid']);
            if (is_wp_error($found)) {
                return $found;
            }
            [$snap, $course] = $found;
            easy_course_decide_snapshot($snap, 'sent_back', $note);
            // An earlier approved version still stands; otherwise back to draft.
            $approved = (int) get_post_meta($course->ID, '_easy_course_approved_version', true);
            update_post_meta($course->ID, '_easy_course_status', $approved > 0 ? 'approved' : 'draft');
            update_post_meta($course->ID, '_easy_course_edited_since', $approved > 0 ? 1 : 0);
            update_post_meta($course->ID, '_easy_course_review_note', wp_slash($note));
            $out = easy_course_export(get_post($course->ID));
            $out['review'] = easy_course_export_snapshot(get_post($snap->ID));
            return $out;
        },
    ]);

    register_rest_route($ns, '/course-builder/authors', [
        [
            'methods'             => 'GET',
            'permission_callback' => 'easy_course_rest_can_access',
            'callback'            => function () {
                return ['authors' => easy_course_authors()];
            },
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'permission_callback' => 'easy_course_rest_can_manage_authors',
            'callback'            => function (WP_REST_Request $request) {
                $list = $request->get_param('authors');
                if (!is_array($list)) {
                    return new WP_Error('easy_course_invalid', 'Send the authors as a list of usernames.', ['status' => 400]);
                }
                $clean = [];
                $unknown = [];
                foreach ($list as $name) {
                    $name = strtolower(sanitize_user((string) $name, true));
                    if ($name === '') {
                        continue;
                    }
                    if (!get_user_by('login', $name)) {
                        $unknown[] = $name;
                        continue;
                    }
                    $clean[] = $name;
                }
                if ($unknown) {
                    return new WP_Error('easy_course_unknown_user', 'No WordPress account with the username ' . implode(', ', $unknown) . '.', ['status' => 400]);
                }
                $clean = array_values(array_unique($clean));
                if (!$clean) {
                    return new WP_Error('easy_course_invalid', 'Keep at least one course author.', ['status' => 400]);
                }
                update_option('easy_course_authors', implode("\n", $clean), false);
                return ['authors' => easy_course_authors()];
            },
        ],
    ]);
});
