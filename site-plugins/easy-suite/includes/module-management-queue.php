<?php
/**
 * Module: Management queue — private decision forms for Colleen and Dad.
 *
 * A private page (shortcode [easy_management_queue]) visible only to the
 * usernames listed in the easy_mgmt_queue_users option. Combines the Terms of
 * Service decision form (for Colleen) with online-course pricing questions
 * (for Dad/Scott). On submit, answers are saved to the easy_mgmt_queue_responses
 * option and emailed to Brandon so he knows a decision was made.
 *
 * The page itself must be created in wp-admin (Pages → Add New), set to
 * Private, with the shortcode as its content, and kept out of all menus.
 */

defined('ABSPATH') || exit;

/** Usernames allowed to view the management queue page. */
function easy_mgmt_queue_allowed_users() {
    $raw = get_option('easy_mgmt_queue_users', '');
    $users = [];
    foreach (preg_split('/[\s,]+/', (string) $raw) as $u) {
        $u = strtolower(sanitize_user($u, true));
        if ($u !== '') {
            $users[] = $u;
        }
    }
    return array_unique($users);
}

/** Resend Domain Connect auto-configure link for the GoDaddy email setup.
 * Single-use; expires. Stored in an option (never in code): clear it in
 * EASY Suite > Settings once the email setup is done. */
function easy_mgmt_queue_resend_link() {
    return (string) get_option('easy_resend_domain_connect_link', '');
}

/** Where new management-queue decisions are emailed. */
function easy_mgmt_queue_notify_email() {
    $email = (string) get_option('easy_mgmt_queue_notify_email', '');
    if ($email === '') {
        $email = (string) get_option('admin_email', '');
    }
    return $email;
}

/** Whether the current visitor may see the queue. Admins always may (to preview). */
function easy_mgmt_queue_can_view() {
    if (!is_user_logged_in()) {
        return false;
    }
    $user = wp_get_current_user();
    if (in_array('administrator', (array) $user->roles, true)) {
        return true;
    }
    return in_array(strtolower($user->user_login), easy_mgmt_queue_allowed_users(), true);
}

/** Saved responses, keyed by question key. */
function easy_mgmt_queue_get_responses() {
    $saved = get_option('easy_mgmt_queue_responses', []);
    return is_array($saved) ? $saved : [];
}

/**
 * Resolved records, keyed by question key: { by, at } (site time).
 * A resolved question was decided and then acted on; it stays in the
 * decided list (the decision stands) but leaves the live queue lists
 * and shows in the archive instead. Stored in the same responses
 * option as the answers, alongside them.
 */
function easy_mgmt_queue_get_resolved($all = null) {
    if ($all === null) {
        $all = easy_mgmt_queue_get_responses();
    }
    $resolved = isset($all['resolved']) && is_array($all['resolved']) ? $all['resolved'] : [];
    $out = [];
    foreach ($resolved as $key => $rec) {
        if (is_array($rec)) {
            $out[$key] = [
                'by' => isset($rec['by']) ? $rec['by'] : null,
                'at' => isset($rec['at']) ? $rec['at'] : null,
            ];
        }
    }
    return $out;
}

/**
 * Decided keys that still match a live question. The stored decided
 * list can outlive a question (a question removed or the queue
 * re-entered under new keys leaves its key behind), and such ghost
 * keys must never inflate a count. Anything that turns the decided
 * list into a number goes through here. Accepts a responses array to
 * avoid a second read; reads the saved responses when omitted.
 */
function easy_mgmt_queue_live_decided_keys($all = null) {
    if ($all === null) {
        $all = easy_mgmt_queue_get_responses();
    }
    $decided = isset($all['decided']) ? (array) $all['decided'] : array();
    if (empty($decided)) {
        return array();
    }
    $live = array();
    foreach (easy_mgmt_queue_questions() as $q) {
        $live[] = $q['key'];
    }
    return array_values(array_intersect($decided, $live));
}

/**
 * Question definitions. Stored in the database (wp_options), NOT in code:
 * question text is internal business content. Each: key, section, label,
 * why (context), type (radio|radio_other|textarea), num (display number),
 * options[] for radio (each: value shown, note optional), info_html
 * (optional reference HTML shown above the question), depends_on
 * ([parent_key, parent_value]).
 */
function easy_mgmt_queue_questions() {
    $questions = get_option('easy_mgmt_queue_questions', array());
    if (!is_array($questions)) {
        return array();
    }
    // Back-compat: fold in questions added under the old separate option.
    $legacy = get_option('easy_mgmt_queue_custom_questions', array());
    if (is_array($legacy) && !empty($legacy)) {
        $keys = array();
        foreach ($questions as $q) {
            if (is_array($q) && !empty($q['key'])) {
                $keys[] = $q['key'];
            }
        }
        foreach ($legacy as $cq) {
            if (is_array($cq) && !empty($cq['key']) && !empty($cq['label']) && !in_array($cq['key'], $keys, true)) {
                $questions[] = $cq;
            }
        }
    }
    return array_values(array_filter($questions, function ($q) {
        return is_array($q) && !empty($q['key']) && !empty($q['label']);
    }));
}

/** Raw stored questions, including invalid ones (admin management). */
function easy_mgmt_queue_all_stored_questions() {
    $questions = get_option('easy_mgmt_queue_questions', array());
    return is_array($questions) ? array_values($questions) : array();
}

function easy_mgmt_queue_next_num($questions) {
    $num = 0;
    foreach ($questions as $q) {
        if (is_array($q) && !empty($q['num']) && (int) $q['num'] > $num) {
            $num = (int) $q['num'];
        }
    }
    return $num + 1;
}

/**
 * Validate and store a new question. Returns the question array on success,
 * or an error message string on failure. Shared by the admin screen and REST.
 */
function easy_mgmt_queue_add_question($section, $label, $why, $type, $options, $info_html = '') {
    $label = trim((string) $label);
    if ($label === '') {
        return 'Question text is required.';
    }
    if (!in_array($type, array('radio', 'radio_other', 'textarea'), true)) {
        $type = 'radio';
    }
    $clean_options = array();
    if ($type !== 'textarea' && is_array($options)) {
        foreach ($options as $opt) {
            $line = trim((string) (is_array($opt) ? $opt[0] : $opt));
            if ($line !== '') {
                $clean_options[] = array($line, '');
            }
        }
    }
    $questions = easy_mgmt_queue_all_stored_questions();
    $q = array(
        'key'     => 'custom_' . substr(md5($label . microtime(true)), 0, 12),
        'section' => trim((string) $section) !== '' ? trim((string) $section) : 'Additional questions',
        'label'   => $label,
        'why'     => trim((string) $why),
        'type'    => $type,
        'options' => $clean_options,
        'custom'  => true,
    );
    if ($type === 'radio_other') {
        $q['other_placeholder'] = 'Type an alternative';
    }
    if ($type !== 'textarea') {
        $q['num'] = easy_mgmt_queue_next_num($questions);
    }
    $info_html = trim((string) $info_html);
    if ($info_html !== '') {
        $q['info_html'] = $info_html;
    }
    $questions[] = $q;
    update_option('easy_mgmt_queue_questions', $questions, false);
    return $q;
}

/**
 * Update an existing question's fields. Returns true on success,
 * or an error message string on failure.
 */
function easy_mgmt_queue_update_question($key, $fields) {
    $questions = easy_mgmt_queue_all_stored_questions();
    $found = false;
    foreach ($questions as &$q) {
        if (!is_array($q) || ($q['key'] ?? '') !== $key) {
            continue;
        }
        $found = true;
        if (isset($fields['section'])) {
            $section = trim((string) $fields['section']);
            $q['section'] = $section !== '' ? $section : 'Additional questions';
        }
        if (isset($fields['label'])) {
            $label = trim((string) $fields['label']);
            if ($label === '') {
                return 'Question text is required.';
            }
            $q['label'] = $label;
        }
        if (isset($fields['why'])) {
            $q['why'] = trim((string) $fields['why']);
        }
        if (isset($fields['type']) && in_array($fields['type'], array('radio', 'radio_other', 'textarea'), true)) {
            $q['type'] = $fields['type'];
            if ($q['type'] === 'radio_other' && empty($q['other_placeholder'])) {
                $q['other_placeholder'] = 'Type an alternative';
            }
            if ($q['type'] === 'textarea') {
                unset($q['num']);
            } elseif (empty($q['num'])) {
                $q['num'] = easy_mgmt_queue_next_num($questions);
            }
        }
        if (isset($fields['options']) && is_array($fields['options'])) {
            $clean = array();
            foreach ($fields['options'] as $opt) {
                $line = trim((string) (is_array($opt) ? $opt[0] : $opt));
                if ($line !== '') {
                    $clean[] = array($line, '');
                }
            }
            $q['options'] = $clean;
        }
        if (array_key_exists('info_html', $fields)) {
            $info = trim((string) $fields['info_html']);
            if ($info === '') {
                unset($q['info_html']);
            } else {
                $q['info_html'] = $info;
            }
        }
    }
    unset($q);
    if (!$found) {
        return 'Question not found.';
    }
    update_option('easy_mgmt_queue_questions', array_values($questions), false);
    return true;
}

/**
 * Delete a question and its saved answer, if any.
 */
function easy_mgmt_queue_delete_question($key) {
    $questions = easy_mgmt_queue_all_stored_questions();
    $questions = array_values(array_filter($questions, function ($q) use ($key) {
        return !is_array($q) || ($q['key'] ?? '') !== $key;
    }));
    update_option('easy_mgmt_queue_questions', $questions, false);
    $resp = easy_mgmt_queue_get_responses();
    $dirty = false;
    if (isset($resp['answers'][$key])) {
        unset($resp['answers'][$key]);
        $decided = isset($resp['decided']) ? (array) $resp['decided'] : array();
        $resp['decided'] = array_values(array_diff($decided, array($key)));
        $dirty = true;
    }
    if (isset($resp['resolved'][$key])) {
        unset($resp['resolved'][$key]);
        $dirty = true;
    }
    if ($dirty) {
        update_option('easy_mgmt_queue_responses', $resp, false);
    }
    // Also drop it from the legacy custom-questions option if present there.
    $legacy = get_option('easy_mgmt_queue_custom_questions', array());
    if (is_array($legacy)) {
        $legacy = array_values(array_filter($legacy, function ($q) use ($key) {
            return !is_array($q) || ($q['key'] ?? '') !== $key;
        }));
        update_option('easy_mgmt_queue_custom_questions', $legacy, false);
    }
    return true;
}



/** Render one question. $saved = previously saved answer array for this key. */
/** Render one question. $answers = full saved answers array (keyed by question key). */
function easy_mgmt_queue_render_question($q, $answers) {
    $key     = $q['key'];
    $answers = is_array($answers) ? $answers : [];
    $mine    = isset($answers[$key]) && is_array($answers[$key]) ? $answers[$key] : [];
    $sel     = isset($mine['choice']) ? $mine['choice'] : '';
    $other   = isset($mine['other']) ? $mine['other'] : '';

    $dep_attr = '';
    if (!empty($q['depends_on'])) {
        [$pkey, $pval] = $q['depends_on'];
        $dep_attr = ' data-depends-on="' . esc_attr($pkey) . '" data-depends-val="' . esc_attr($pval) . '"';
        $pans = isset($answers[$pkey]) && is_array($answers[$pkey]) ? $answers[$pkey] : null;
        $pchoice = (is_array($pans) && isset($pans['choice'])) ? $pans['choice'] : '';
        // open_questions() only includes a dependent when the decided parent's
        // answer matches; then it renders visible. Otherwise it starts hidden
        // and the JS toggles it against the on-page parent radios.
        if ($pchoice !== $pval) {
            $dep_attr .= ' style="display:none"';
        }
    }

    if (!empty($q['info_html'])) {
        // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — admin-entered reference HTML
        echo '<div class="emq-info">' . $q['info_html'] . '</div>';
    }
    echo '<div class="emq-q"' . $dep_attr . ' data-qkey="' . esc_attr($key) . '">';
    echo '<h3>';
    if (!empty($q['num'])) {
        echo '<span class="emq-num">' . (int) $q['num'] . '.</span> ';
    }
    echo esc_html($q['label']) . '</h3>';
    if (!empty($q['why'])) {
        echo '<p class="emq-why">' . esc_html($q['why']) . '</p>';
    }

    $type = $q['type'];
    if ($type === 'radio' || $type === 'radio_other') {
        echo '<div class="emq-opts">';
        foreach ($q['options'] as $i => $opt) {
            [$val, $note] = $opt;
            $id = 'emq_' . $key . '_' . $i;
            $checked = ($sel === $val) ? ' checked' : '';
            echo '<label class="emq-opt" for="' . esc_attr($id) . '">';
            echo '<input type="radio" id="' . esc_attr($id) . '" name="emq[' . esc_attr($key) . '][choice]" value="' . esc_attr($val) . '"' . $checked . ' />';
            echo '<span class="emq-opt-text">' . esc_html($val);
            if ($note !== '') {
                echo '<span class="emq-opt-note">' . esc_html($note) . '</span>';
            }
            echo '</span></label>';
        }
        if ($type === 'radio_other') {
            $id = 'emq_' . $key . '_other';
            $checked = ($sel === '__other') ? ' checked' : '';
            $otype = !empty($q['other_type']) ? $q['other_type'] : 'text';
            $ph = !empty($q['other_placeholder']) ? $q['other_placeholder'] : 'Type an alternative';
            echo '<label class="emq-opt" for="' . esc_attr($id) . '">';
            echo '<input type="radio" id="' . esc_attr($id) . '" name="emq[' . esc_attr($key) . '][choice]" value="__other"' . $checked . ' />';
            echo '<span class="emq-opt-text">Something else';
            echo '<input class="emq-other-input" type="' . esc_attr($otype) . '" name="emq[' . esc_attr($key) . '][other]" value="' . esc_attr($other) . '" placeholder="' . esc_attr($ph) . '"' . ($checked ? '' : ' disabled') . ' />';
            echo '</span></label>';
        }
        echo '</div>';
    } elseif ($type === 'textarea') {
        $val = isset($mine['text']) ? $mine['text'] : '';
        echo '<textarea class="emq-free-input" name="emq[' . esc_attr($key) . '][text]" placeholder="' . esc_attr($q['placeholder'] ?? '') . '">' . esc_textarea($val) . '</textarea>';
    }
    echo '</div>';
}

/** Handle form submission. */
function easy_mgmt_queue_handle_submit() {
    if (!isset($_POST['emq_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_nonce'])), 'emq_submit')) {
        return;
    }
    if (!easy_mgmt_queue_can_view()) {
        return;
    }
    $user = wp_get_current_user();
    $raw = isset($_POST['emq']) && is_array($_POST['emq']) ? wp_unslash($_POST['emq']) : [];

    $clean = [];
    foreach (easy_mgmt_queue_questions() as $q) {
        $key = $q['key'];
        if (!isset($raw[$key]) || !is_array($raw[$key])) {
            continue;
        }
        $in = $raw[$key];
        if ($q['type'] === 'textarea') {
            $text = isset($in['text']) ? trim(sanitize_textarea_field($in['text'])) : '';
            if ($text !== '') {
                $clean[$key] = ['text' => $text];
            }
            continue;
        }
        $choice = isset($in['choice']) ? sanitize_text_field($in['choice']) : '';
        if ($choice === '') {
            continue;
        }
        // Validate the choice is one of the offered options (or __other).
        $valid = ['__other'];
        foreach ($q['options'] as $opt) {
            $valid[] = $opt[0];
        }
        if (!in_array($choice, $valid, true)) {
            continue;
        }
        $entry = ['choice' => $choice];
        if ($choice === '__other' && ($q['type'] === 'radio_other')) {
            $other = isset($in['other']) ? trim(sanitize_text_field($in['other'])) : '';
            if ($other !== '') {
                $entry['other'] = $other;
            }
        }
        $clean[$key] = $entry;
    }

    $all = easy_mgmt_queue_get_responses();
    $prev_answers = isset($all['answers']) ? $all['answers'] : [];
    $prev_decided = isset($all['decided']) ? (array) $all['decided'] : [];

    // Dependent answers (e.g. the "own terms" textarea) are only kept when
    // the parent question was answered with the matching choice — a hidden
    // field submitted via devtools is discarded. Mirrors the display rule
    // in easy_mgmt_queue_open_questions().
    foreach (easy_mgmt_queue_questions() as $q) {
        if (empty($q['depends_on'])) {
            continue;
        }
        [$pkey, $pval] = $q['depends_on'];
        $pans = isset($clean[$pkey]) ? $clean[$pkey] : (isset($prev_answers[$pkey]) ? $prev_answers[$pkey] : null);
        $pchoice = (is_array($pans) && isset($pans['choice'])) ? $pans['choice'] : '';
        if ($pchoice !== $pval) {
            unset($clean[$q['key']]);
        }
    }

    // Merge new answers over previous; newly answered questions become decided
    // and clear from the queue. Stamp who decided each question and when —
    // the page and the REST feed show this per-question attribution.
    $merged = array_merge($prev_answers, $clean);
    $now = current_time('mysql');
    foreach ($clean as $ckey => &$cans) {
        $cans['decided_by'] = $user->user_login;
        $cans['decided_at'] = $now;
        $merged[$ckey] = $cans;
    }
    unset($cans);
    $newly_decided = [];
    foreach ($clean as $key => $ans) {
        if (!in_array($key, $prev_decided, true)) {
            $prev_decided[] = $key;
            $newly_decided[] = $key;
        }
    }

    $all['answers'] = $merged;
    $all['decided'] = array_values(array_unique($prev_decided));
    // Self-healing prune: decided keys whose questions no longer exist
    // are dropped from storage, along with any resolved record they
    // carry (the same treatment question deletion gives them), so the
    // list written here only ever names live questions.
    $live_decided = easy_mgmt_queue_live_decided_keys($all);
    if (!empty($all['resolved']) && is_array($all['resolved'])) {
        foreach ((array) $all['decided'] as $dkey) {
            if (!in_array($dkey, $live_decided, true)) {
                unset($all['resolved'][$dkey]);
            }
        }
    }
    $all['decided'] = $live_decided;
    // A fresh answer for a question brings it back to plain decided:
    // any resolved record for a re-answered question no longer applies.
    if (!empty($all['resolved']) && is_array($all['resolved'])) {
        foreach ($clean as $ckey => $cans) {
            unset($all['resolved'][$ckey]);
        }
    }
    $all['submitted_by'] = $user->user_login;
    $all['submitted_at'] = current_time('mysql');
    update_option('easy_mgmt_queue_responses', $all, false);

    // Notify Brandon about the newly decided questions only.
    if (!empty($newly_decided)) {
        $by_key = [];
        foreach (easy_mgmt_queue_questions() as $q) {
            $by_key[$q['key']] = $q;
        }
        $lines = ['EASY Management Queue — new decisions', '', 'Decided by: ' . $user->user_login . ' (' . $user->display_name . ')', 'Decided at: ' . $all['submitted_at'] . ' (site time)', ''];
        foreach ($newly_decided as $key) {
            $q = isset($by_key[$key]) ? $by_key[$key] : null;
            $label = $q ? ((!empty($q['num']) ? $q['num'] . '. ' : '') . $q['label']) : $key;
            $a = $merged[$key];
            if (isset($a['text'])) {
                $lines[] = $label . ': ' . $a['text'];
            } elseif ($a['choice'] === '__other') {
                $lines[] = $label . ': ' . (isset($a['other']) ? $a['other'] : '(write-in selected; no text entered)');
            } else {
                $lines[] = $label . ': ' . $a['choice'];
            }
        }
        $remaining = count(easy_mgmt_queue_questions()) - count(easy_mgmt_queue_live_decided_keys($all));
        $lines[] = '';
        $lines[] = $remaining . ' question(s) still outstanding.';
        $notify_email = easy_mgmt_queue_notify_email();
        if ($notify_email !== '') {
            wp_mail($notify_email, 'Management queue: ' . count($newly_decided) . ' new decision(s) by ' . $user->display_name, implode("\n", $lines));
        }
    }

    // Redirect to avoid resubmission. Pass the decided question key so the
    // notice can name it (per-question saves).
    $saved_arg = '1';
    if (!empty($newly_decided)) {
        $saved_arg = reset($newly_decided);
    }
    wp_safe_redirect(add_query_arg('emq_saved', $saved_arg, get_permalink()));
    exit;
}
add_action('template_redirect', 'easy_mgmt_queue_handle_submit');

/** Questions not yet decided, respecting dependency visibility. */
function easy_mgmt_queue_open_questions() {
    $all = easy_mgmt_queue_get_responses();
    $decided = isset($all['decided']) ? (array) $all['decided'] : [];
    $resolved = easy_mgmt_queue_get_resolved($all);
    $answers = isset($all['answers']) ? $all['answers'] : [];
    $out = [];
    foreach (easy_mgmt_queue_questions() as $q) {
        if (in_array($q['key'], $decided, true)) {
            continue;
        }
        // Resolved questions are decided by definition; this guard keeps
        // one out of the open list even if its data is ever inconsistent.
        if (isset($resolved[$q['key']])) {
            continue;
        }
        // Dependent questions appear only when the parent is decided with the matching value.
        if (!empty($q['depends_on'])) {
            [$pkey, $pval] = $q['depends_on'];
            if (!in_array($pkey, $decided, true)) {
                continue;
            }
            $pans = isset($answers[$pkey]) ? $answers[$pkey] : null;
            $pchoice = (is_array($pans) && isset($pans['choice'])) ? $pans['choice'] : '';
            if ($pchoice !== $pval) {
                continue;
            }
        }
        $out[] = $q;
    }
    return $out;
}

/* --- Page text: the information sections around the questions ------------ */

/**
 * The key list for the queue page's information sections, with empty
 * defaults. The wording itself lives only in the stored option (edited
 * on the Management queue admin screen); since 2.2.37 the plugin code
 * carries no copy of it, so the text stays out of the public repo.
 * Sites that ran 2.2.35 or 2.2.36 already hold the full wording in the
 * option those versions seeded, and are unaffected. A key missing or
 * saved empty renders as empty, and the shortcode skips any section
 * whose heading and body are both empty. This is page-level text only;
 * a question's own reference HTML lives in its question record
 * (info_html) and is not part of this option.
 */
function easy_mgmt_queue_page_text_defaults() {
    return array(
        'lede'              => '',
        'whats_new_title'   => '',
        'whats_new_html'    => easy_mgmt_queue_whats_new_html(),
        'payments_title'    => '',
        'payments_html'     => '',
        'photos_title'      => '',
        'photos_html'       => '',
        'access_title'      => '',
        'access_html'       => '',
        'email_title'       => '',
        'email_html'        => '',
        'finish_html'       => '',
    );
}

/** Stored page text merged over the (empty) key defaults, key by key. */
function easy_mgmt_queue_page_text() {
    $text = easy_mgmt_queue_page_text_defaults();
    $stored = get_option('easy_mgmt_queue_page_text', array());
    if (is_array($stored)) {
        foreach ($text as $key => $default) {
            if (isset($stored[$key]) && is_string($stored[$key]) && $stored[$key] !== '') {
                $text[$key] = $stored[$key];
            }
        }
    }
    return $text;
}

/**
 * Seed the page-text option once, the first time an admin screen loads,
 * so the option exists with the full key structure. Since 2.2.37 the
 * seed writes empty strings only: sites upgrading from 2.2.35 or later
 * already carry their wording in this option (seeded with the full
 * text by those versions), so the seed is a no-op there and never
 * overwrites anything. A fresh install starts blank by design; an
 * admin types the wording into the Page text form.
 */
function easy_mgmt_queue_seed_page_text() {
    if (!current_user_can('manage_options')) {
        return;
    }
    if (get_option('easy_mgmt_queue_page_text') === false) {
        update_option('easy_mgmt_queue_page_text', easy_mgmt_queue_page_text_defaults(), false);
    }
}
add_action('admin_init', 'easy_mgmt_queue_seed_page_text');

/**
 * The What's New body HTML. The wording lives only in the stored
 * easy_mgmt_queue_page_text option (edited on the Management queue
 * admin screen); this provider simply returns the stored value, or an
 * empty string when nothing is stored.
 */
function easy_mgmt_queue_whats_new_html() {
    $stored = get_option('easy_mgmt_queue_page_text', array());
    if (is_array($stored) && isset($stored['whats_new_html']) && is_string($stored['whats_new_html'])) {
        return $stored['whats_new_html'];
    }
    return '';
}

/** Shortcode output. */
function easy_mgmt_queue_shortcode() {
    if (!easy_mgmt_queue_can_view()) {
        if (!is_user_logged_in()) {
            return '<p>This page is private. Please <a href="' . esc_url(wp_login_url(get_permalink())) . '">log in</a> to continue.</p>';
        }
        return '<p>This page is private and restricted to specific team members.</p>';
    }

    $saved_all = easy_mgmt_queue_get_responses();
    $saved = isset($saved_all['answers']) ? $saved_all['answers'] : [];
    $decided = isset($saved_all['decided']) ? (array) $saved_all['decided'] : [];
    $just_saved = false;
    if (isset($_GET['emq_saved'])) {
        $saved_key = sanitize_key(wp_unslash($_GET['emq_saved']));
        $just_saved = 'Answer saved. Brandon has been notified.';
        foreach (easy_mgmt_queue_questions() as $qq) {
            if (($qq['key'] ?? '') === $saved_key) {
                $just_saved = 'Answer saved for "' . $qq['label'] . '". Brandon has been notified.';
                break;
            }
        }
    }
    $open = easy_mgmt_queue_open_questions();
    $total = count(easy_mgmt_queue_questions());
    $live_decided = easy_mgmt_queue_live_decided_keys($saved_all);
    $resolved = easy_mgmt_queue_get_resolved($saved_all);
    $resolved_count = count(array_intersect(array_keys($resolved), $live_decided));
    $done_count = count($live_decided) - $resolved_count;
    $text = easy_mgmt_queue_page_text();

    ob_start();
    ?>
    <div class="emq-wrap">
        <h2>Management queue</h2>
        <?php if ($text['lede'] !== ''): ?><p class="emq-lede"><?php echo esc_html($text['lede']); ?></p><?php endif; ?>
        <p class="emq-progress"><strong><?php echo (int) $done_count; ?> of <?php echo (int) $total; ?></strong> decided.<?php if ($resolved_count > 0): ?> <strong><?php echo (int) $resolved_count; ?></strong> resolved and archived.<?php endif; ?></p>
        <?php if ($text['whats_new_title'] !== '' || $text['whats_new_html'] !== ''): ?><section class="emq-section">
            <div class="emq-section-head"><h3><?php echo esc_html($text['whats_new_title']); ?></h3><span class="emq-goes-where">Information only &mdash; no answer required</span></div>
            <?php
            // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
            echo $text['whats_new_html'];
            ?>
        </section><?php endif; ?>
        <?php if ($just_saved): ?>
            <div class="emq-notice"><?php echo esc_html($just_saved); ?></div>
        <?php endif; ?>
        <?php if (empty($open)): ?>
            <div class="emq-notice">All decisions are in. Thank you.</div>
        <?php else: ?>
            <?php
            // One form per question: saving an answer only ever submits that
            // question, so a stray selection elsewhere is never recorded.
            $last_section = null;
            foreach ($open as $q) {
                $section = $q['section'] ?? 'Questions';
                if ($section !== $last_section) {
                    if ($last_section !== null) {
                        echo '</section>';
                    }
                    echo '<section class="emq-section"><div class="emq-section-head"><h3>' . esc_html($section) . '</h3></div>';
                    $last_section = $section;
                }
                ?>
                <form method="post" action="" class="emq-qform">
                    <?php wp_nonce_field('emq_submit', 'emq_nonce'); ?>
                    <?php easy_mgmt_queue_render_question($q, $saved); ?>
                    <button type="submit" class="emq-submit emq-save-one">Save this answer</button>
                </form>
                <?php
            }
            if ($last_section !== null) {
                echo '</section>';
            }
            ?>
            <?php if ($text['payments_title'] !== '' || $text['payments_html'] !== ''): ?><section class="emq-section">
                <div class="emq-section-head"><h3><?php echo esc_html($text['payments_title']); ?></h3><span class="emq-goes-where">Information only — no answer required</span></div>
                <div class="emq-q"><?php
                    // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
                    echo $text['payments_html'];
                    ?></div>
            </section><?php endif; ?>
            <?php if ($text['photos_title'] !== '' || $text['photos_html'] !== ''): ?><section class="emq-section">
                <div class="emq-section-head"><h3><?php echo esc_html($text['photos_title']); ?></h3></div>
                <div class="emq-q"><?php
                    // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
                    echo $text['photos_html'];
                    ?></div>
            </section><?php endif; ?>
            <?php if ($text['access_title'] !== '' || $text['access_html'] !== ''): ?><section class="emq-section">
                <div class="emq-section-head"><h3><?php echo esc_html($text['access_title']); ?></h3><span class="emq-goes-where">Information only — no answer required</span></div>
                <div class="emq-q"><?php
                    // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
                    echo $text['access_html'];
                    ?></div>
            </section><?php endif; ?>
            <?php if ($text['email_title'] !== '' || $text['email_html'] !== ''): ?><section class="emq-section">
                <div class="emq-section-head"><h3><?php echo esc_html($text['email_title']); ?></h3></div>
                <?php if (easy_mgmt_queue_resend_link() !== '') : ?>
                <div class="emq-q"><?php
                    // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
                    echo $text['email_html'];
                    ?>
                    <a class="emq-action-btn" href="<?php echo esc_url(easy_mgmt_queue_resend_link()); ?>" target="_blank" rel="noopener">Complete email setup in GoDaddy</a>
                </div>
                <?php else : ?>
                <div class="emq-q">
                    <p class="emq-why">Email setup is complete.</p>
                </div>
                <?php endif; ?>
            </section><?php endif; ?>
            <?php if ($text['finish_html'] !== ''): ?><div class="emq-finish"><?php
                // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped, admin-saved page text (wp_kses_post on save)
                echo $text['finish_html'];
                ?></div><?php endif; ?>
        <?php endif; ?>
    </div>
    <style>
        .emq-wrap { max-width: 46rem; margin: 0 auto; }
        .emq-lede { color: #55645a; }
        .emq-progress { font-size: 1.05rem; color: #1b241e; }
        .emq-notice { background: #e3f0e6; border: 1px solid #1e6b3c; border-radius: 10px; padding: 0.8rem 1rem; margin: 1rem 0; font-weight: 600; color: #14532d; }
        .emq-notice-info { background: #eef2ee; border-color: #aebbae; color: #1b241e; font-weight: 400; }
        .emq-section { margin: 0 0 2rem; }
        .emq-section-head { display: flex; align-items: baseline; gap: 0.6rem; border-bottom: 2px solid #1e6b3c; padding-bottom: 0.45rem; margin-bottom: 0.5rem; }
        .emq-section-head h3 { font-size: 1.2rem; margin: 0; }
        .emq-goes-where { color: #55645a; font-size: 0.85rem; margin-left: auto; }
        .emq-q { background: #fff; border: 1px solid #d3dcd4; border-radius: 12px; padding: 1.1rem 1.2rem; margin: 0 0 1rem; }
        .emq-q h3 { font-size: 1.05rem; margin: 0 0 0.35rem; }
        .emq-num { color: #1e6b3c; font-weight: 800; }
        .emq-why { color: #55645a; font-size: 0.95rem; margin: 0 0 0.9rem; }
        .emq-opts { display: grid; gap: 0.55rem; }
        .emq-opt { display: flex; gap: 0.7rem; align-items: flex-start; border: 1.5px solid #d3dcd4; border-radius: 10px; padding: 0.8rem 0.9rem; cursor: pointer; }
        .emq-opt:hover { border-color: #aebbae; }
        .emq-opt:has(input:checked) { border-color: #1e6b3c; background: #e3f0e6; }
        .emq-opt input[type="radio"] { width: 1.2rem; height: 1.2rem; margin-top: 0.15rem; accent-color: #1e6b3c; flex: none; }
        .emq-opt-text { flex: 1; }
        .emq-opt-note { display: block; color: #55645a; font-size: 0.9rem; margin-top: 0.15rem; }
        .emq-other-input, .emq-free-input { width: 100%; font: inherit; font-size: 1rem; border: 1.5px solid #aebbae; border-radius: 8px; padding: 0.6rem 0.7rem; margin-top: 0.6rem; }
        .emq-price-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .emq-price-table th, .emq-price-table td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #e5e9ef; vertical-align: top; }
        .emq-price-table thead th { border-bottom: 2px solid #1e6b3c; white-space: nowrap; }
        .emq-other-input:disabled { opacity: 0.45; }
        .emq-free-input { min-height: 7rem; }
        .emq-list { margin: 0 0 1rem; padding-left: 1.25rem; }
        .emq-list li { margin-bottom: 0.35rem; }
        .emq-q a { color: #14532d; font-weight: 600; }
        .emq-finish { background: #fff; border: 1.5px solid #1e6b3c; border-radius: 12px; padding: 1.2rem; margin-top: 2rem; }
        .emq-submit { font: inherit; font-size: 1.05rem; font-weight: 700; color: #fff; background: #1e6b3c; border: none; border-radius: 10px; padding: 0.9rem 1.4rem; cursor: pointer; margin-top: 0.6rem; }
        .emq-submit:hover { filter: brightness(1.08); }
        .emq-qform { margin: 0; }
        .emq-save-one { font-size: 0.95rem; padding: 0.6rem 1.1rem; margin: 0 0 1.2rem; }
        .emq-info { margin: 0 0 1rem; }
        .emq-action-btn { display: inline-block; font-size: 1.02rem; font-weight: 700; color: #ffffff; background: #1e6b3c; border-radius: 10px; padding: 0.85rem 1.2rem; text-decoration: none; margin-top: 0.4rem; }
        .emq-action-btn:hover { filter: brightness(1.08); color: #ffffff; }
    </style>
    <script>
    (function () {
        // Toggle "other" text inputs.
        document.querySelectorAll('.emq-q').forEach(function (q) {
            var radios = q.querySelectorAll('input[type="radio"]');
            var otherInput = q.querySelector('.emq-other-input');
            function sync() {
                var otherRadio = q.querySelector('input[type="radio"][value="__other"]');
                if (otherInput && otherRadio) {
                    otherInput.disabled = !otherRadio.checked;
                }
                // Dependent panels (e.g. own-terms text shown only when "Yes").
                var depKey = q.getAttribute('data-depends-on');
                if (depKey) {
                    var depVal = q.getAttribute('data-depends-val');
                    var depQ = document.querySelector('.emq-q[data-qkey="' + depKey + '"]');
                    if (depQ) {
                        var depChecked = depQ.querySelector('input[type="radio"]:checked');
                        q.style.display = (depChecked && depChecked.value === depVal) ? '' : 'none';
                    }
                    // No parent on the page: it is already decided, and the
                    // server only shows this question when it applies, so
                    // leave it visible.
                }
            }
            radios.forEach(function (r) { r.addEventListener('change', syncAll); });
        });
        function syncAll() {
            document.querySelectorAll('.emq-q').forEach(function (q) {
                var radios = q.querySelectorAll('input[type="radio"]');
                var otherInput = q.querySelector('.emq-other-input');
                var otherRadio = q.querySelector('input[type="radio"][value="__other"]');
                if (otherInput && otherRadio) {
                    otherInput.disabled = !otherRadio.checked;
                }
                var depKey = q.getAttribute('data-depends-on');
                if (depKey) {
                    var depVal = q.getAttribute('data-depends-val');
                    var depQ = document.querySelector('.emq-q[data-qkey="' + depKey + '"]');
                    if (depQ) {
                        var depChecked = depQ.querySelector('input[type="radio"]:checked');
                        q.style.display = (depChecked && depChecked.value === depVal) ? '' : 'none';
                    }
                    // No parent on the page: it is already decided, and the
                    // server only shows this question when it applies, so
                    // leave it visible.
                }
            });
        }
        // Re-run when any radio changes (covers cross-question dependencies).
        document.querySelectorAll('.emq-q input[type="radio"]').forEach(function (r) {
            r.addEventListener('change', syncAll);
        });
        syncAll();
    })();
    </script>
    <?php
    return ob_get_clean();
}
add_shortcode('easy_management_queue', 'easy_mgmt_queue_shortcode');

/* --- Admin: view responses and manage custom questions ---------------------- */

function easy_mgmt_queue_admin_handle() {
    if (!current_user_can('manage_options')) {
        return;
    }
    // Add a question (stored in the database, not in code).
    if (isset($_POST['emq_add_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_add_nonce'])), 'emq_add_question')) {
        $options = array();
        if (isset($_POST['emq_new_options'])) {
            foreach (preg_split('/[\r\n]+/', (string) wp_unslash($_POST['emq_new_options'])) as $line) {
                $line = trim(sanitize_text_field($line));
                if ($line !== '') {
                    $options[] = $line;
                }
            }
        }
        $result = easy_mgmt_queue_add_question(
            isset($_POST['emq_new_section']) ? sanitize_text_field(wp_unslash($_POST['emq_new_section'])) : '',
            isset($_POST['emq_new_label']) ? sanitize_text_field(wp_unslash($_POST['emq_new_label'])) : '',
            isset($_POST['emq_new_why']) ? sanitize_textarea_field(wp_unslash($_POST['emq_new_why'])) : '',
            isset($_POST['emq_new_type']) ? sanitize_key(wp_unslash($_POST['emq_new_type'])) : 'radio',
            $options,
            isset($_POST['emq_new_info']) ? wp_kses_post(wp_unslash($_POST['emq_new_info'])) : ''
        );
        if (is_string($result)) {
            add_settings_error('emq_admin', 'emq_add_failed', $result, 'error');
        } else {
            add_settings_error('emq_admin', 'emq_added', 'Question added.', 'success');
        }
    }
    // Edit a question.
    if (isset($_POST['emq_edit_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_edit_nonce'])), 'emq_edit_question')) {
        $edit_key = isset($_POST['emq_edit_key']) ? sanitize_key(wp_unslash($_POST['emq_edit_key'])) : '';
        $options = array();
        if (isset($_POST['emq_edit_options'])) {
            foreach (preg_split('/[\r\n]+/', (string) wp_unslash($_POST['emq_edit_options'])) as $line) {
                $line = trim(sanitize_text_field($line));
                if ($line !== '') {
                    $options[] = $line;
                }
            }
        }
        $result = easy_mgmt_queue_update_question($edit_key, array(
            'section'   => isset($_POST['emq_edit_section']) ? sanitize_text_field(wp_unslash($_POST['emq_edit_section'])) : '',
            'label'     => isset($_POST['emq_edit_label']) ? sanitize_text_field(wp_unslash($_POST['emq_edit_label'])) : '',
            'why'       => isset($_POST['emq_edit_why']) ? sanitize_textarea_field(wp_unslash($_POST['emq_edit_why'])) : '',
            'type'      => isset($_POST['emq_edit_type']) ? sanitize_key(wp_unslash($_POST['emq_edit_type'])) : 'radio',
            'options'   => $options,
            'info_html' => isset($_POST['emq_edit_info']) ? wp_kses_post(wp_unslash($_POST['emq_edit_info'])) : '',
        ));
        if ($result === true) {
            add_settings_error('emq_admin', 'emq_edited', 'Question updated.', 'success');
        } else {
            add_settings_error('emq_admin', 'emq_edit_failed', is_string($result) ? $result : 'Could not update the question.', 'error');
        }
    }
    // Delete a question (and its saved answer, if any).
    if (isset($_POST['emq_del_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_del_nonce'])), 'emq_del_question')) {
        $del_key = isset($_POST['emq_del_key']) ? sanitize_key(wp_unslash($_POST['emq_del_key'])) : '';
        if ($del_key !== '') {
            easy_mgmt_queue_delete_question($del_key);
            add_settings_error('emq_admin', 'emq_deleted', 'Question deleted.', 'success');
        }
    }
    // Reopen a decided question (puts it back in the queue).
    if (isset($_POST['emq_reopen_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_reopen_nonce'])), 'emq_reopen_question')) {
        $reopen_key = isset($_POST['emq_reopen_key']) ? sanitize_key(wp_unslash($_POST['emq_reopen_key'])) : '';
        if ($reopen_key !== '') {
            $resp = easy_mgmt_queue_get_responses();
            $decided = isset($resp['decided']) ? (array) $resp['decided'] : [];
            $resp['decided'] = array_values(array_diff($decided, [$reopen_key]));
            if (isset($resp['resolved'][$reopen_key])) {
                unset($resp['resolved'][$reopen_key]);
            }
            update_option('easy_mgmt_queue_responses', $resp, false);
            add_settings_error('emq_admin', 'emq_reopened', 'Question reopened — it is back in the queue.', 'success');
        }
    }
    // Save the queue page's own information text (stored in the database,
    // not in code). What is saved is what renders: a section whose
    // heading and body are both empty is skipped on the page.
    if (isset($_POST['emq_page_text_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_page_text_nonce'])), 'emq_page_text')) {
        $clean = array();
        foreach (easy_mgmt_queue_page_text_defaults() as $pt_key => $pt_default) {
            $raw = isset($_POST['emq_pt_' . $pt_key]) ? (string) wp_unslash($_POST['emq_pt_' . $pt_key]) : '';
            if ($pt_key === 'lede') {
                $clean[$pt_key] = sanitize_textarea_field($raw);
            } elseif (substr($pt_key, -5) === '_html') {
                $clean[$pt_key] = wp_kses_post($raw);
            } else {
                $clean[$pt_key] = sanitize_text_field($raw);
            }
        }
        update_option('easy_mgmt_queue_page_text', $clean, false);
        add_settings_error('emq_admin', 'emq_page_text_saved', 'Page text saved.', 'success');
    }
}


function easy_mgmt_queue_format_answer($q, $a) {
    if (!is_array($a)) {
        return '(skipped)';
    }
    if (isset($a['text'])) {
        return $a['text'] !== '' ? $a['text'] : '(skipped)';
    }
    $choice = $a['choice'] ?? '';
    if ($choice === '') {
        return '(skipped)';
    }
    if ($choice === '__other') {
        return isset($a['other']) && $a['other'] !== '' ? $a['other'] : '(write-in selected; no text entered)';
    }
    return $choice;
}

function easy_mgmt_queue_admin_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to view this page.', 'easy-suite'));
    }
    easy_mgmt_queue_admin_handle();
    settings_errors('emq_admin');

    $responses = easy_mgmt_queue_get_responses();
    $answers = isset($responses['answers']) ? $responses['answers'] : [];
    $questions = easy_mgmt_queue_questions();

    echo '<div class="wrap" style="max-width:900px;"><h1>Management queue</h1>';
    easy_suite_admin_tabs('easy-suite-queue');
    echo '<p>Private decision page: <a href="' . esc_url(home_url('/management-queue/')) . '" target="_blank" rel="noopener">' . esc_html(home_url('/management-queue/')) . '</a> (Private page, shortcode <code>[easy_management_queue]</code>). Visible only to the usernames in EASY Suite → Settings → Management queue, plus administrators.</p>';

    // --- Submitted responses ---
    echo '<h2>Submitted responses</h2>';
    $decided = isset($responses['decided']) ? (array) $responses['decided'] : [];
    $resolved_map = easy_mgmt_queue_get_resolved($responses);
    if (empty($answers)) {
        echo '<p><em>No responses submitted yet.</em></p>';
    } else {
        echo '<p>Submitted by <strong>' . esc_html($responses['submitted_by'] ?? '?') . '</strong> at ' . esc_html($responses['submitted_at'] ?? '?') . ' (site time). '
            . count(easy_mgmt_queue_live_decided_keys($responses)) . ' of ' . count($questions) . ' decided.</p>';
        echo '<table class="widefat striped"><thead><tr><th style="width:30%">Question</th><th>Answer</th><th style="width:14%">Decided by</th><th style="width:10%">Status</th><th style="width:10%"></th></tr></thead><tbody>';
        foreach ($questions as $q) {
            $label = (!empty($q['num']) ? $q['num'] . '. ' : '') . $q['label'];
            $ans = isset($answers[$q['key']]) ? easy_mgmt_queue_format_answer($q, $answers[$q['key']]) : '(skipped)';
            $is_decided = in_array($q['key'], $decided, true);
            $is_resolved = $is_decided && isset($resolved_map[$q['key']]);
            $by = '?';
            if ($is_decided) {
                $a = isset($answers[$q['key']]) && is_array($answers[$q['key']]) ? $answers[$q['key']] : array();
                $who = isset($a['decided_by']) ? $a['decided_by'] : ($responses['submitted_by'] ?? '?');
                $when = isset($a['decided_at']) ? $a['decided_at'] : ($responses['submitted_at'] ?? '');
                $by = esc_html($who) . ($when !== '' ? '<br><span style="color:#666">' . esc_html($when) . '</span>' : '');
            }
            echo '<tr><td>' . esc_html($label) . '</td><td>' . esc_html($ans) . '</td><td>' . ($is_decided ? $by : '<span style="color:#8a6d1a">—</span>') . '</td>';
            echo '<td>' . ($is_resolved ? '<span style="color:#1e6b3c;font-weight:600">Resolved</span>' : ($is_decided ? '<span style="color:#1e6b3c;font-weight:600">Decided</span>' : '<span style="color:#8a6d1a">Open</span>')) . '</td>';
            echo '<td>';
            if ($is_decided) {
                echo '<form method="post" action="" style="margin:0">';
                wp_nonce_field('emq_reopen_question', 'emq_reopen_nonce');
                echo '<input type="hidden" name="emq_reopen_key" value="' . esc_attr($q['key']) . '">';
                echo '<button type="submit" class="button button-small">Reopen</button>';
                echo '</form>';
            }
            echo '</td></tr>';
        }
        echo '</tbody></table>';
    }

    // --- Questions (all stored in the database) ---
    echo '<h2>Questions</h2>';
    echo '<p>Questions live in the site database, not in the plugin code. Editing a question keeps its saved answer.</p>';
    $stored = easy_mgmt_queue_all_stored_questions();
    $edit_key = isset($_GET['emq_edit']) ? sanitize_key(wp_unslash($_GET['emq_edit'])) : '';
    $edit_q = null;
    if ($edit_key !== '') {
        foreach ($stored as $sq) {
            if (is_array($sq) && ($sq['key'] ?? '') === $edit_key) {
                $edit_q = $sq;
                break;
            }
        }
    }
    if (empty($stored)) {
        echo '<p><em>No questions yet. Add the first one below.</em></p>';
    } else {
        echo '<table class="widefat striped"><thead><tr><th style="width:6%">No.</th><th>Question</th><th>Section</th><th>Type</th><th style="width:16%"></th></tr></thead><tbody>';
        foreach ($stored as $sq) {
            $qlabel = (!empty($sq['num']) ? $sq['num'] . '. ' : '') . ($sq['label'] ?? '(untitled)');
            echo '<tr><td>' . esc_html(!empty($sq['num']) ? (string) (int) $sq['num'] : '—') . '</td>';
            echo '<td>' . esc_html($qlabel) . '</td><td>' . esc_html($sq['section'] ?? '') . '</td><td>' . esc_html($sq['type'] ?? '') . '</td>';
            echo '<td><a class="button button-small" href="' . esc_url(add_query_arg('emq_edit', $sq['key'])) . '">Edit</a> ';
            echo '<form method="post" action="" style="display:inline;margin:0">';
            wp_nonce_field('emq_del_question', 'emq_del_nonce');
            echo '<input type="hidden" name="emq_del_key" value="' . esc_attr($sq['key']) . '">';
            echo '<button type="submit" class="button button-small button-link-delete" onclick="return confirm(\'Delete this question and its saved answer?\')">Delete</button>';
            echo '</form></td></tr>';
        }
        echo '</tbody></table>';
    }

    if ($edit_q) {
        echo '<h3>Edit question</h3>';
        echo '<form method="post" action="">';
        wp_nonce_field('emq_edit_question', 'emq_edit_nonce');
        echo '<input type="hidden" name="emq_edit_key" value="' . esc_attr($edit_q['key']) . '">';
        echo '<table class="form-table"><tbody>';
        echo '<tr><th scope="row"><label for="emq_edit_section">Section heading</label></th><td><input type="text" id="emq_edit_section" name="emq_edit_section" class="regular-text" value="' . esc_attr($edit_q['section'] ?? '') . '"></td></tr>';
        echo '<tr><th scope="row"><label for="emq_edit_label">Question</label></th><td><input type="text" id="emq_edit_label" name="emq_edit_label" class="large-text" value="' . esc_attr($edit_q['label'] ?? '') . '" required></td></tr>';
        echo '<tr><th scope="row"><label for="emq_edit_why">Context / help text</label></th><td><textarea id="emq_edit_why" name="emq_edit_why" rows="3" class="large-text">' . esc_textarea($edit_q['why'] ?? '') . '</textarea></td></tr>';
        echo '<tr><th scope="row"><label for="emq_edit_type">Answer type</label></th><td><select id="emq_edit_type" name="emq_edit_type">';
        foreach (array('radio' => 'Multiple choice', 'radio_other' => 'Multiple choice + write-in', 'textarea' => 'Free text') as $tv => $tlabel) {
            echo '<option value="' . esc_attr($tv) . '"' . (($edit_q['type'] ?? '') === $tv ? ' selected' : '') . '>' . esc_html($tlabel) . '</option>';
        }
        echo '</select></td></tr>';
        $opt_lines = array();
        foreach ((array) ($edit_q['options'] ?? array()) as $opt) {
            $opt_lines[] = is_array($opt) ? $opt[0] : $opt;
        }
        echo '<tr><th scope="row"><label for="emq_edit_options">Choices</label></th><td><textarea id="emq_edit_options" name="emq_edit_options" rows="5" class="large-text code" placeholder="One choice per line">' . esc_textarea(implode("\n", $opt_lines)) . '</textarea><p class="description">One choice per line. Only used for multiple-choice types.</p></td></tr>';
        echo '<tr><th scope="row"><label for="emq_edit_info">Reference HTML</label></th><td><textarea id="emq_edit_info" name="emq_edit_info" rows="4" class="large-text code" placeholder="Optional HTML shown above the question">' . esc_textarea($edit_q['info_html'] ?? '') . '</textarea><p class="description">Optional. Shown above the question on the queue page.</p></td></tr>';
        echo '</tbody></table>';
        submit_button('Save changes');
        echo '</form>';
    }

    echo '<h3>Add a question</h3>';
    echo '<form method="post" action="">';
    wp_nonce_field('emq_add_question', 'emq_add_nonce');
    echo '<table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="emq_new_section">Section heading</label></th><td><input type="text" id="emq_new_section" name="emq_new_section" class="regular-text" placeholder="Additional questions"><p class="description">Groups the question under a heading on the page.</p></td></tr>';
    echo '<tr><th scope="row"><label for="emq_new_label">Question</label></th><td><input type="text" id="emq_new_label" name="emq_new_label" class="large-text" required></td></tr>';
    echo '<tr><th scope="row"><label for="emq_new_why">Context / help text</label></th><td><textarea id="emq_new_why" name="emq_new_why" rows="3" class="large-text"></textarea><p class="description">Shown under the question. Keep it factual and neutral.</p></td></tr>';
    echo '<tr><th scope="row"><label for="emq_new_type">Answer type</label></th><td><select id="emq_new_type" name="emq_new_type">'
        . '<option value="radio">Multiple choice</option>'
        . '<option value="radio_other">Multiple choice + write-in</option>'
        . '<option value="textarea">Free text</option>'
        . '</select></td></tr>';
    echo '<tr><th scope="row"><label for="emq_new_options">Choices</label></th><td><textarea id="emq_new_options" name="emq_new_options" rows="5" class="large-text code" placeholder="One choice per line"></textarea><p class="description">One choice per line. Only used for multiple-choice types.</p></td></tr>';
    echo '<tr><th scope="row"><label for="emq_new_info">Reference HTML</label></th><td><textarea id="emq_new_info" name="emq_new_info" rows="4" class="large-text code" placeholder="Optional HTML shown above the question"></textarea><p class="description">Optional. Shown above the question on the queue page.</p></td></tr>';
    echo '</tbody></table>';
    submit_button('Add question');
    echo '</form>';

    // --- Page text (the information sections on the queue page itself) ---
    echo '<h2>Page text</h2>';
    echo '<p>This is the information text shown on the queue page itself, around the questions: the introduction, the What&rsquo;s New summary, and the Payments, Photos, Facebook and LinkedIn access, and Email setup sections, plus the closing note. Per-question reference HTML is separate and stays on each question above. In the body fields, basic HTML works (paragraphs, bold, lists, links). A section whose heading and body are both left empty does not appear on the page; it comes back as soon as text is typed in again.</p>';
    $page_text = easy_mgmt_queue_page_text();
    echo '<form method="post" action="">';
    wp_nonce_field('emq_page_text', 'emq_page_text_nonce');
    echo '<table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="emq_pt_lede">Introduction</label></th><td><textarea id="emq_pt_lede" name="emq_pt_lede" rows="3" class="large-text">' . esc_textarea($page_text['lede']) . '</textarea><p class="description">The paragraph under the &ldquo;Management queue&rdquo; heading.</p></td></tr>';
    $pt_sections = array(
        array('whats_new', 'What&rsquo;s New', 20),
        array('payments', 'Payments', 8),
        array('photos', 'Photos', 8),
        array('access', 'Facebook and LinkedIn access', 10),
        array('email', 'Email setup', 10),
    );
    foreach ($pt_sections as $pt) {
        echo '<tr><th scope="row"><label for="emq_pt_' . $pt[0] . '_title">' . $pt[1] . ' heading</label></th><td><input type="text" id="emq_pt_' . $pt[0] . '_title" name="emq_pt_' . $pt[0] . '_title" class="large-text" value="' . esc_attr($page_text[$pt[0] . '_title']) . '"></td></tr>';
        echo '<tr><th scope="row"><label for="emq_pt_' . $pt[0] . '_html">' . $pt[1] . ' body HTML</label></th><td><textarea id="emq_pt_' . $pt[0] . '_html" name="emq_pt_' . $pt[0] . '_html" rows="' . (int) $pt[2] . '" class="large-text code">' . esc_textarea($page_text[$pt[0] . '_html']) . '</textarea></td></tr>';
    }
    echo '<tr><th scope="row"><label for="emq_pt_finish_html">Closing note HTML</label></th><td><textarea id="emq_pt_finish_html" name="emq_pt_finish_html" rows="3" class="large-text code">' . esc_textarea($page_text['finish_html']) . '</textarea></td></tr>';
    echo '</tbody></table>';
    submit_button('Save page text');
    echo '</form></div>';
}

/* ------------------------------------------------------------------
 * REST: management-queue feed + question management (companion app).
 * Admin-only: answers contain business decisions.
 * ------------------------------------------------------------------ */

function easy_mgmt_queue_rest_can_read() {
    return is_user_logged_in() && current_user_can('manage_options');
}

/**
 * One question in the REST feed's shape. Open questions carry no
 * answer; decided ones add the answer and its attribution; resolved
 * ones add the resolved record on top of the decided fields.
 */
function easy_mgmt_queue_rest_item($q, $all) {
    $answers = isset($all['answers']) && is_array($all['answers']) ? $all['answers'] : array();
    $decided = isset($all['decided']) ? (array) $all['decided'] : array();
    $resolved = easy_mgmt_queue_get_resolved($all);

    $item = array(
        'key'     => $q['key'],
        'section' => isset($q['section']) ? $q['section'] : '',
        'label'   => $q['label'],
        'type'    => $q['type'],
    );
    if (!empty($q['options'])) {
        $item['options'] = array_map(function ($opt) {
            return is_array($opt) ? $opt[0] : $opt;
        }, $q['options']);
    }
    if (in_array($q['key'], $decided, true)) {
        $item['decided'] = true;
        $ans = isset($answers[$q['key']]) && is_array($answers[$q['key']]) ? $answers[$q['key']] : array();
        $item['answer'] = easy_mgmt_queue_format_answer($q, $ans);
        // Per-question attribution; falls back to the last submitter for
        // answers decided before attribution was tracked.
        $item['decided_by'] = isset($ans['decided_by']) ? $ans['decided_by'] : (isset($all['submitted_by']) ? $all['submitted_by'] : null);
        $item['decided_at'] = isset($ans['decided_at']) ? $ans['decided_at'] : (isset($all['submitted_at']) ? $all['submitted_at'] : null);
        if (isset($resolved[$q['key']])) {
            $item['resolved_by'] = $resolved[$q['key']]['by'];
            $item['resolved_at'] = $resolved[$q['key']]['at'];
        }
    } else {
        $item['decided'] = false;
    }
    return $item;
}

function easy_mgmt_queue_rest_get() {
    $all = easy_mgmt_queue_get_responses();
    $decided = isset($all['decided']) ? (array) $all['decided'] : array();
    $resolved = easy_mgmt_queue_get_resolved($all);

    // Open list mirrors the page: undecided, visible questions only
    // (dependent questions stay hidden until their parent is decided).
    $open = array();
    foreach (easy_mgmt_queue_open_questions() as $q) {
        $open[] = easy_mgmt_queue_rest_item($q, $all);
    }

    // Decided and resolved are separate lists in the feed: a resolved
    // question leaves Decided for the archive.
    $decided_out = array();
    $resolved_out = array();
    foreach (easy_mgmt_queue_questions() as $q) {
        if (!in_array($q['key'], $decided, true)) {
            continue;
        }
        if (isset($resolved[$q['key']])) {
            $resolved_out[] = easy_mgmt_queue_rest_item($q, $all);
        } else {
            $decided_out[] = easy_mgmt_queue_rest_item($q, $all);
        }
    }
    // The archive shows the most recently resolved first. Resolved
    // stamps are site-time 'Y-m-d H:i:s' strings, which sort as text.
    usort($resolved_out, function ($a, $b) {
        $at = isset($a['resolved_at']) ? (string) $a['resolved_at'] : '';
        $bt = isset($b['resolved_at']) ? (string) $b['resolved_at'] : '';
        return strcmp($bt, $at);
    });

    return array(
        'open'     => $open,
        'decided'  => $decided_out,
        'resolved' => $resolved_out,
        'counts'   => array(
            'open'     => count($open),
            'decided'  => count($decided_out),
            'resolved' => count($resolved_out),
            'total'    => count($open) + count($decided_out) + count($resolved_out),
        ),
        'last_activity' => array(
            'by' => isset($all['submitted_by']) ? $all['submitted_by'] : null,
            'at' => isset($all['submitted_at']) ? $all['submitted_at'] : null,
        ),
    );
}

/**
 * POST /easy/v1/management-queue/questions — add a queue question (admin).
 * JSON body: { section, label, why, type: radio|radio_other|textarea,
 *              options: ["a","b"], info_html }.
 */
function easy_mgmt_queue_rest_add_question($request) {
    $params = $request->get_json_params();
    if (!is_array($params)) {
        $params = array();
    }
    $info_html = '';
    if (isset($params['info_html'])) {
        // Same treatment as the admin form: admins may include HTML,
        // limited to the tags WordPress allows in post content.
        $info_html = wp_kses_post((string) $params['info_html']);
    }
    $result = easy_mgmt_queue_add_question(
        isset($params['section']) ? $params['section'] : '',
        isset($params['label']) ? $params['label'] : '',
        isset($params['why']) ? $params['why'] : '',
        isset($params['type']) ? $params['type'] : 'radio',
        isset($params['options']) ? $params['options'] : array(),
        $info_html
    );
    if (is_string($result)) {
        return new WP_Error('easy_mgmt_queue_bad_question', $result, array('status' => 400));
    }
    return array('question' => $result);
}

/**
 * Clean one answer for one question, exactly as the queue page's form
 * handler (easy_mgmt_queue_handle_submit) cleans each submitted answer:
 * free text is trim(sanitize_textarea_field(...)) and must be non-empty;
 * a choice is sanitize_text_field(...) and must be one of the question's
 * defined option values (or '__other', which the form also accepts);
 * write-in text is kept only for radio_other questions, as
 * trim(sanitize_text_field(...)), and only when non-empty.
 * Returns the clean entry array, or a WP_Error when the answer is
 * unusable. (The form silently skips unusable answers; a REST caller
 * gets the reason instead, but nothing invalid is ever saved.)
 */
function easy_mgmt_queue_clean_answer($q, $params) {
    if ($q['type'] === 'textarea') {
        $text = isset($params['value']) ? trim(sanitize_textarea_field((string) $params['value'])) : '';
        if ($text === '') {
            return new WP_Error('easy_mgmt_queue_empty_answer', 'Write an answer first.', array('status' => 400));
        }
        return array('text' => $text);
    }
    $choice = isset($params['value']) ? sanitize_text_field((string) $params['value']) : '';
    if ($choice === '') {
        return new WP_Error('easy_mgmt_queue_empty_answer', 'Choose one of the answers first.', array('status' => 400));
    }
    $valid = array('__other');
    foreach ((array) (isset($q['options']) ? $q['options'] : array()) as $opt) {
        $valid[] = is_array($opt) ? $opt[0] : $opt;
    }
    if (!in_array($choice, $valid, true)) {
        return new WP_Error('easy_mgmt_queue_bad_choice', 'That is not one of the choices for this question.', array('status' => 400));
    }
    $entry = array('choice' => $choice);
    if ($choice === '__other' && $q['type'] === 'radio_other') {
        $other = isset($params['other']) ? trim(sanitize_text_field((string) $params['other'])) : '';
        if ($other !== '') {
            $entry['other'] = $other;
        }
    }
    return $entry;
}

/**
 * Save one cleaned answer, mirroring the form handler's merge, stamps,
 * decided-list handling and notification email. The answer replaces any
 * previous answer for the question; the question joins the decided list
 * (and Brandon is emailed) only when it was not already decided, just
 * as the form only notifies about newly decided questions.
 * Returns the full updated responses array.
 */
function easy_mgmt_queue_save_answer($key, $entry, $user) {
    $all = easy_mgmt_queue_get_responses();
    $prev_answers = isset($all['answers']) ? $all['answers'] : [];
    $prev_decided = isset($all['decided']) ? (array) $all['decided'] : [];

    $now = current_time('mysql');
    $entry['decided_by'] = $user->user_login;
    $entry['decided_at'] = $now;
    $merged = $prev_answers;
    $merged[$key] = $entry;

    $newly_decided = [];
    if (!in_array($key, $prev_decided, true)) {
        $prev_decided[] = $key;
        $newly_decided[] = $key;
    }

    $all['answers'] = $merged;
    $all['decided'] = array_values(array_unique($prev_decided));
    // Self-healing prune, same as the form handler: ghost decided keys
    // (and any resolved record they carry) leave storage on this save.
    $live_decided = easy_mgmt_queue_live_decided_keys($all);
    if (!empty($all['resolved']) && is_array($all['resolved'])) {
        foreach ((array) $all['decided'] as $dkey) {
            if (!in_array($dkey, $live_decided, true)) {
                unset($all['resolved'][$dkey]);
            }
        }
    }
    $all['decided'] = $live_decided;
    // A fresh answer brings the question back to plain decided.
    if (isset($all['resolved'][$key])) {
        unset($all['resolved'][$key]);
    }
    $all['submitted_by'] = $user->user_login;
    $all['submitted_at'] = $now;
    update_option('easy_mgmt_queue_responses', $all, false);

    // Notify Brandon about the newly decided question only (same email
    // the form handler sends).
    if (!empty($newly_decided)) {
        $by_key = [];
        foreach (easy_mgmt_queue_questions() as $q) {
            $by_key[$q['key']] = $q;
        }
        $lines = ['EASY Management Queue — new decisions', '', 'Decided by: ' . $user->user_login . ' (' . $user->display_name . ')', 'Decided at: ' . $all['submitted_at'] . ' (site time)', ''];
        foreach ($newly_decided as $k) {
            $q = isset($by_key[$k]) ? $by_key[$k] : null;
            $label = $q ? ((!empty($q['num']) ? $q['num'] . '. ' : '') . $q['label']) : $k;
            $a = $merged[$k];
            if (isset($a['text'])) {
                $lines[] = $label . ': ' . $a['text'];
            } elseif ($a['choice'] === '__other') {
                $lines[] = $label . ': ' . (isset($a['other']) ? $a['other'] : '(write-in selected; no text entered)');
            } else {
                $lines[] = $label . ': ' . $a['choice'];
            }
        }
        $remaining = count(easy_mgmt_queue_questions()) - count(easy_mgmt_queue_live_decided_keys($all));
        $lines[] = '';
        $lines[] = $remaining . ' question(s) still outstanding.';
        $notify_email = easy_mgmt_queue_notify_email();
        if ($notify_email !== '') {
            wp_mail($notify_email, 'Management queue: ' . count($newly_decided) . ' new decision(s) by ' . $user->display_name, implode("\n", $lines));
        }
    }

    return $all;
}

/**
 * POST /easy/v1/management-queue/answers: save one answer (admin).
 * JSON body: { question_id, value } where value is the chosen option
 * for choice questions (or '__other' with an optional "other" write-in
 * text for radio_other questions), or the answer text itself for
 * free-text questions. Response: { question } in the same shape the
 * GET feed returns for a decided question.
 */
function easy_mgmt_queue_rest_save_answer($request) {
    $params = $request->get_json_params();
    if (!is_array($params)) {
        $params = array();
    }
    $key = isset($params['question_id']) ? trim((string) $params['question_id']) : '';
    $question = null;
    foreach (easy_mgmt_queue_questions() as $q) {
        if ($q['key'] === $key) {
            $question = $q;
            break;
        }
    }
    if ($question === null) {
        return new WP_Error('easy_mgmt_queue_no_question', 'That question is not in the queue.', array('status' => 404));
    }

    $entry = easy_mgmt_queue_clean_answer($question, $params);
    if (is_wp_error($entry)) {
        return $entry;
    }

    // Dependency rule, mirroring the form handler: a dependent answer
    // is only kept when the parent question's saved answer matches the
    // required choice.
    if (!empty($question['depends_on'])) {
        [$pkey, $pval] = $question['depends_on'];
        $saved = easy_mgmt_queue_get_responses();
        $pans = isset($saved['answers'][$pkey]) && is_array($saved['answers'][$pkey]) ? $saved['answers'][$pkey] : null;
        $pchoice = (is_array($pans) && isset($pans['choice'])) ? $pans['choice'] : '';
        if ($pchoice !== $pval) {
            return new WP_Error('easy_mgmt_queue_dependency', 'This question only applies once its parent question has been answered the matching way.', array('status' => 400));
        }
    }

    $all = easy_mgmt_queue_save_answer($key, $entry, wp_get_current_user());
    $ans = isset($all['answers'][$key]) && is_array($all['answers'][$key]) ? $all['answers'][$key] : array();

    $item = array(
        'key'     => $question['key'],
        'section' => isset($question['section']) ? $question['section'] : '',
        'label'   => $question['label'],
        'type'    => $question['type'],
    );
    if (!empty($question['options'])) {
        $item['options'] = array_map(function ($opt) {
            return is_array($opt) ? $opt[0] : $opt;
        }, $question['options']);
    }
    $item['decided'] = true;
    $item['answer'] = easy_mgmt_queue_format_answer($question, $ans);
    $item['decided_by'] = isset($ans['decided_by']) ? $ans['decided_by'] : null;
    $item['decided_at'] = isset($ans['decided_at']) ? $ans['decided_at'] : null;
    return array('question' => $item);
}

/** Find one question definition by key, or null when there is none. */
function easy_mgmt_queue_find_question($key) {
    foreach (easy_mgmt_queue_questions() as $q) {
        if ($q['key'] === $key) {
            return $q;
        }
    }
    return null;
}

/** The question_id out of a lifecycle request, or a 404 WP_Error. */
function easy_mgmt_queue_rest_lifecycle_question($request) {
    $params = $request->get_json_params();
    if (!is_array($params)) {
        $params = array();
    }
    $key = isset($params['question_id']) ? trim((string) $params['question_id']) : '';
    $question = $key !== '' ? easy_mgmt_queue_find_question($key) : null;
    if ($question === null) {
        return new WP_Error('easy_mgmt_queue_no_question', 'That question is not in the queue.', array('status' => 404));
    }
    return $question;
}

/**
 * POST /easy/v1/management-queue/undecide: clear one question's
 * answer so it returns to the open list (admin). JSON body:
 * { question_id }. The answer and its decided stamps are removed,
 * along with any resolved record. Response: { question } in the
 * feed's open shape.
 */
function easy_mgmt_queue_rest_undecide($request) {
    $question = easy_mgmt_queue_rest_lifecycle_question($request);
    if (is_wp_error($question)) {
        return $question;
    }
    $key = $question['key'];
    $user = wp_get_current_user();

    $all = easy_mgmt_queue_get_responses();
    if (isset($all['answers'][$key])) {
        unset($all['answers'][$key]);
    }
    $decided = isset($all['decided']) ? (array) $all['decided'] : [];
    $all['decided'] = array_values(array_diff($decided, [$key]));
    if (isset($all['resolved'][$key])) {
        unset($all['resolved'][$key]);
    }
    $all['submitted_by'] = $user->user_login;
    $all['submitted_at'] = current_time('mysql');
    update_option('easy_mgmt_queue_responses', $all, false);

    return array('question' => easy_mgmt_queue_rest_item($question, $all));
}

/**
 * POST /easy/v1/management-queue/resolve: mark one decided question
 * resolved (admin). The decision was acted on; the question leaves
 * the decided list for the archive, with its answer and attribution
 * kept on record. JSON body: { question_id }. Response: { question }
 * in the feed's resolved shape.
 */
function easy_mgmt_queue_rest_resolve($request) {
    $question = easy_mgmt_queue_rest_lifecycle_question($request);
    if (is_wp_error($question)) {
        return $question;
    }
    $key = $question['key'];
    $user = wp_get_current_user();

    $all = easy_mgmt_queue_get_responses();
    $decided = isset($all['decided']) ? (array) $all['decided'] : [];
    if (!in_array($key, $decided, true)) {
        return new WP_Error('easy_mgmt_queue_not_decided', 'Only a decided question can be marked resolved. Answer it first.', array('status' => 400));
    }
    $resolved = easy_mgmt_queue_get_resolved($all);
    if (!isset($resolved[$key])) {
        $resolved[$key] = array(
            'by' => $user->user_login,
            'at' => current_time('mysql'),
        );
        $all['resolved'] = $resolved;
        $all['submitted_by'] = $user->user_login;
        $all['submitted_at'] = $resolved[$key]['at'];
        update_option('easy_mgmt_queue_responses', $all, false);
    }

    return array('question' => easy_mgmt_queue_rest_item($question, $all));
}

/**
 * POST /easy/v1/management-queue/unresolve: move one resolved
 * question back to the decided list (admin). JSON body:
 * { question_id }. Response: { question } in the feed's decided
 * shape.
 */
function easy_mgmt_queue_rest_unresolve($request) {
    $question = easy_mgmt_queue_rest_lifecycle_question($request);
    if (is_wp_error($question)) {
        return $question;
    }
    $key = $question['key'];
    $user = wp_get_current_user();

    $all = easy_mgmt_queue_get_responses();
    $resolved = easy_mgmt_queue_get_resolved($all);
    if (!isset($resolved[$key])) {
        return new WP_Error('easy_mgmt_queue_not_resolved', 'That question is not resolved.', array('status' => 400));
    }
    unset($all['resolved'][$key]);
    $all['submitted_by'] = $user->user_login;
    $all['submitted_at'] = current_time('mysql');
    update_option('easy_mgmt_queue_responses', $all, false);

    return array('question' => easy_mgmt_queue_rest_item($question, $all));
}

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/management-queue', array(
        'methods'             => 'GET',
        'callback'            => 'easy_mgmt_queue_rest_get',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
    register_rest_route('easy/v1', '/management-queue/answers', array(
        'methods'             => 'POST',
        'callback'            => 'easy_mgmt_queue_rest_save_answer',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
    register_rest_route('easy/v1', '/management-queue/questions', array(
        'methods'             => 'POST',
        'callback'            => 'easy_mgmt_queue_rest_add_question',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
    register_rest_route('easy/v1', '/management-queue/undecide', array(
        'methods'             => 'POST',
        'callback'            => 'easy_mgmt_queue_rest_undecide',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
    register_rest_route('easy/v1', '/management-queue/resolve', array(
        'methods'             => 'POST',
        'callback'            => 'easy_mgmt_queue_rest_resolve',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
    register_rest_route('easy/v1', '/management-queue/unresolve', array(
        'methods'             => 'POST',
        'callback'            => 'easy_mgmt_queue_rest_unresolve',
        'permission_callback' => 'easy_mgmt_queue_rest_can_read',
    ));
});
