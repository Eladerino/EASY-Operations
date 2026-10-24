<?php
/**
 * Course Builder media: photos, narration audio and (optionally) video
 * files for courses, uploaded from the app. Part of the courses module.
 *
 * Files live in uploads/easy-course-media/ under random names, with
 * server-level deny rules (same as the certificate PDFs), so nobody can
 * open them by URL. They are read back through the REST route below, which
 * only course authors and reviewers can use for now; the course player will
 * add enrolled learners.
 *
 *   easy_course_media  one private post per file: original name, stored
 *                      file name, MIME type, size, kind, uploader. Not an
 *                      attachment, so files never appear in the Media
 *                      Library or wp/v2/media.
 *
 * Courses refer to a file as { id, name, size, type } (renderer/course-schema.js).
 *
 * Routes (easy/v1/course-builder/...):
 *   POST media  multipart: file, kind (image|audio|video)   authors
 *   GET  media/<id>                                        authors + reviewers
 */

defined('ABSPATH') || exit;

define('EASY_COURSE_MEDIA_SUBDIR', 'easy-course-media');

/** What each kind accepts: extension => MIME type, and a size cap in bytes. */
function easy_course_media_kinds() {
    return [
        'image' => [
            'mimes' => ['jpg|jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'],
            'max'   => 15 * 1024 * 1024,
        ],
        'audio' => [
            'mimes' => ['mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav'],
            'max'   => 60 * 1024 * 1024,
        ],
        'video' => [
            'mimes' => ['mp4|m4v' => 'video/mp4', 'webm' => 'video/webm'],
            'max'   => 500 * 1024 * 1024,
        ],
    ];
}

/** Largest file the site takes for a kind (the kind's cap or PHP's upload limit). */
function easy_course_media_max_bytes($kind) {
    $kinds = easy_course_media_kinds();
    if (!isset($kinds[$kind])) {
        return 0;
    }
    $php = (int) wp_max_upload_size();
    return $php > 0 ? min($php, $kinds[$kind]['max']) : $kinds[$kind]['max'];
}

add_action('init', function () {
    register_post_type('easy_course_media', [
        'label'               => 'Course media',
        'public'              => false,
        'publicly_queryable'  => false,
        'exclude_from_search' => true,
        'show_ui'             => false,
        'show_in_rest'        => false,
        'rewrite'             => false,
        'query_var'           => false,
        'can_export'          => true,
        'supports'            => ['title', 'author'],
    ]);
});

/** uploads/easy-course-media/, created with deny rules on first use. */
function easy_course_media_dir() {
    $upload = wp_upload_dir();
    $dir = trailingslashit($upload['basedir']) . EASY_COURSE_MEDIA_SUBDIR;
    if (!is_dir($dir)) {
        wp_mkdir_p($dir);
    }
    $ht = trailingslashit($dir) . '.htaccess';
    if (!file_exists($ht)) {
        file_put_contents($ht,
            "# EASY Suite: block direct web access to course media.\n" .
            "# Files here are served only through easy/v1/course-builder/media.\n" .
            "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n" .
            "<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n"
        );
    }
    $ix = trailingslashit($dir) . 'index.php';
    if (!file_exists($ix)) {
        file_put_contents($ix, "<?php\n// Silence is golden.\n");
    }
    return $dir;
}

function easy_course_media_export(WP_Post $post) {
    return [
        'id'   => $post->ID,
        'name' => $post->post_title,
        'size' => (int) get_post_meta($post->ID, '_easy_media_size', true),
        'type' => (string) get_post_meta($post->ID, '_easy_media_type', true),
        'kind' => (string) get_post_meta($post->ID, '_easy_media_kind', true),
    ];
}

function easy_course_media_upload(WP_REST_Request $request) {
    $kind = (string) $request->get_param('kind');
    $kinds = easy_course_media_kinds();
    if (!isset($kinds[$kind])) {
        return new WP_Error('easy_media_kind', 'Say what kind of file this is (image, audio or video).', ['status' => 400]);
    }
    $files = $request->get_file_params();
    $file = $files['file'] ?? null;
    if (!$file || !isset($file['tmp_name'], $file['name']) || !empty($file['error']) || !is_uploaded_file($file['tmp_name'])) {
        $too_big = $file && in_array((int) ($file['error'] ?? 0), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        return new WP_Error(
            $too_big ? 'easy_media_too_big' : 'easy_media_missing',
            $too_big ? 'That file is bigger than the site accepts.' : 'No file arrived. Try again.',
            ['status' => $too_big ? 413 : 400]
        );
    }
    $size = (int) filesize($file['tmp_name']);
    $max = easy_course_media_max_bytes($kind);
    if ($size < 1 || $size > $max) {
        return new WP_Error('easy_media_too_big', sprintf('That file is %s; the most the site takes for this is %s.', size_format($size), size_format($max)), ['status' => 413]);
    }
    // Checks the extension against the list and, for images, the real content.
    $check = wp_check_filetype_and_ext($file['tmp_name'], $file['name'], $kinds[$kind]['mimes']);
    if (empty($check['ext']) || empty($check['type'])) {
        return new WP_Error('easy_media_type', 'That kind of file isn\'t accepted here. Use ' . strtoupper(implode(', ', array_map(function ($e) {
            return str_replace('|', ', ', $e);
        }, array_keys($kinds[$kind]['mimes'])))) . '.', ['status' => 415]);
    }

    $dir = easy_course_media_dir();
    $stored = bin2hex(random_bytes(16)) . '.' . $check['ext'];
    if (!@move_uploaded_file($file['tmp_name'], trailingslashit($dir) . $stored)) {
        return new WP_Error('easy_media_store', 'The site could not store that file.', ['status' => 500]);
    }
    $name = mb_substr(sanitize_file_name(wp_basename($file['name'])), 0, 180);
    $id = wp_insert_post([
        'post_type'   => 'easy_course_media',
        'post_status' => 'private',
        'post_title'  => $name !== '' ? $name : $stored,
        'post_author' => get_current_user_id(),
    ], true);
    if (is_wp_error($id)) {
        @unlink(trailingslashit($dir) . $stored);
        return $id;
    }
    update_post_meta($id, '_easy_media_file', $stored);
    update_post_meta($id, '_easy_media_type', $check['type']);
    update_post_meta($id, '_easy_media_size', $size);
    update_post_meta($id, '_easy_media_kind', $kind);
    return new WP_REST_Response(easy_course_media_export(get_post($id)), 201);
}

function easy_course_media_stream(WP_REST_Request $request) {
    $post = get_post((int) $request['mid']);
    if (!$post || $post->post_type !== 'easy_course_media' || $post->post_status !== 'private') {
        return new WP_Error('easy_media_missing', 'That file is no longer on the site.', ['status' => 404]);
    }
    $stored = (string) get_post_meta($post->ID, '_easy_media_file', true);
    $path = trailingslashit(easy_course_media_dir()) . $stored;
    if (!preg_match('/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/', $stored) || !is_readable($path)) {
        return new WP_Error('easy_media_missing', 'That file is no longer on the site.', ['status' => 404]);
    }
    if (ini_get('zlib.output_compression')) {
        ini_set('zlib.output_compression', 'Off');
    }
    while (ob_get_level()) {
        ob_end_clean();
    }
    nocache_headers();
    header('Content-Type: ' . ((string) get_post_meta($post->ID, '_easy_media_type', true) ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . addcslashes($post->post_title, '"\\') . '"');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/course-builder/media', [
        'methods'             => 'POST',
        'permission_callback' => 'easy_course_rest_can_author',
        'callback'            => 'easy_course_media_upload',
    ]);
    register_rest_route('easy/v1', '/course-builder/media/(?P<mid>\d+)', [
        'methods'             => 'GET',
        'permission_callback' => 'easy_course_rest_can_access',
        'callback'            => 'easy_course_media_stream',
    ]);
});
