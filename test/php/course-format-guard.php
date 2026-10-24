<?php
/**
 * Checks EASY Suite's Course Builder format guard without WordPress: the
 * few WordPress functions the save path calls are stubbed below with an
 * in-memory post and its meta. Run: php test/php/course-format-guard.php
 */

define('ABSPATH', __DIR__);
define('EASY_SUITE_VERSION', 'test');

class WP_Error {
    public $code; public $message; public $data;
    public function __construct($code = '', $message = '', $data = null) { $this->code = $code; $this->message = $message; $this->data = $data; }
}
class WP_Post {
    public $ID; public $post_name; public $post_title = ''; public $post_modified_gmt = '2026-10-24 00:00:00';
    public $post_type = 'easy_course'; public $post_status = 'private';
}
class WP_REST_Request {
    private $body;
    public function __construct($body) { $this->body = $body; }
    public function get_body() { return $this->body; }
}

$GLOBALS['posts'] = [];
$GLOBALS['meta'] = [];
function add_action() {}
function register_post_type() {}
function is_wp_error($v) { return $v instanceof WP_Error; }
function wp_json_encode($v, $flags = 0) { return json_encode($v, $flags); }
function wp_slash($v) { return addslashes($v); }
function wp_get_current_user() { return (object) ['ID' => 1, 'user_login' => 'tester']; }
function get_current_user_id() { return 1; }
function get_posts($args) {
    return array_values(array_filter($GLOBALS['posts'], function ($p) use ($args) {
        return isset($args['name']) && $p->post_name === $args['name'];
    }));
}
function get_post($id) { return $GLOBALS['posts'][$id] ?? null; }
function wp_update_post($arr) { $GLOBALS['posts'][$arr['ID']]->post_title = $arr['post_title']; }
function get_post_meta($id, $key, $single) { return $GLOBALS['meta'][$id][$key] ?? ''; }
function update_post_meta($id, $key, $value, $prev = '') {
    $cur = $GLOBALS['meta'][$id][$key] ?? null;
    if ($prev !== '' && (string) $cur !== (string) $prev) return false;
    $GLOBALS['meta'][$id][$key] = is_string($value) ? stripslashes($value) : $value;
    return true;
}

require __DIR__ . '/../../site-plugins/easy-suite/includes/module-courses.php';

$failures = 0;
function check($ok, $label) {
    global $failures;
    echo ($ok ? 'ok   ' : 'FAIL ') . $label . "\n";
    if (!$ok) $failures++;
}

function seed($stored) {
    $p = new WP_Post();
    $p->ID = 7;
    $p->post_name = 'c_test';
    $GLOBALS['posts'] = [7 => $p];
    $GLOBALS['meta'] = [7 => [
        '_easy_course_data'   => json_encode($stored),
        '_easy_course_rev'    => 3,
        '_easy_course_status' => 'draft',
    ]];
}

function save($body) {
    $req = new WP_REST_Request(json_encode($body));
    $input = easy_course_content_from_request($req, 'c_test');
    return is_wp_error($input) ? $input : easy_course_save_content('c_test', $input);
}

$v1 = ['title' => 'Old', 'chapters' => []];
$v2 = ['schemaVersion' => 2, 'title' => 'Newer', 'chapters' => []];

seed($v1);
$r = save(['course' => $v1, 'baseRev' => 3]);
check($r instanceof WP_Post && (int) get_post_meta(7, '_easy_course_rev', true) === 4, 'v1 course, app from before versioning: saves');

seed($v1);
$r = save(['course' => ['schemaVersion' => 1] + $v1, 'baseRev' => 3, 'schema' => 1]);
check($r instanceof WP_Post, 'v1 course, current app: saves');

seed($v2);
$r = save(['course' => $v2, 'baseRev' => 3]);
check(is_wp_error($r) && $r->data['status'] === 426, 'v2 course, app from before versioning echoing schemaVersion 2: refused with 426');
check((int) get_post_meta(7, '_easy_course_rev', true) === 3, '... and nothing was written');

seed($v2);
$r = save(['course' => $v2, 'baseRev' => 3, 'schema' => 1]);
check(is_wp_error($r) && $r->data['status'] === 426, 'v2 course, schema 1 app: refused with 426');

seed($v2);
$r = save(['course' => $v2, 'baseRev' => 3, 'schema' => 2]);
check($r instanceof WP_Post, 'v2 course, schema 2 app: saves');

seed($v2);
$r = save(['course' => $v2, 'baseRev' => 2, 'schema' => 2]);
check(is_wp_error($r) && $r->data['status'] === 409, 'stale baseRev still gets 409');

seed($v1);
$r = save(['course' => ['schemaVersion' => '2'] + $v1, 'baseRev' => 3, 'schema' => 1]);
check(is_wp_error($r) && $r->data['status'] === 400, 'unreadable schemaVersion: 400');

$snap = easy_course_snapshot_content((object) ($v2 + ['id' => 'c_test', 'status' => 'draft']));
check(isset($snap->schemaVersion) && $snap->schemaVersion === 2 && !isset($snap->status), 'review snapshot keeps schemaVersion, drops workflow fields');
check(easy_course_schema_of((object) $v1) === 1 && easy_course_schema_of((object) $v2) === 2, 'schema_of: missing = 1');

echo $failures ? "\n$failures failed\n" : "\nall passed\n";
exit($failures ? 1 : 0);
