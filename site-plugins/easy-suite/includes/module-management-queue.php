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
    $raw = get_option('easy_mgmt_queue_users', "sglynn");
    $users = [];
    foreach (preg_split('/[\s,]+/', (string) $raw) as $u) {
        $u = strtolower(sanitize_user($u, true));
        if ($u !== '') {
            $users[] = $u;
        }
    }
    return array_unique($users);
}

/** Resend Domain Connect auto-configure link for the GoDaddy email setup. Single-use; expires. */
function easy_mgmt_queue_resend_link() {
    return '***REMOVED***';
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

/** Custom questions added by admins. Stored as a list of question arrays. */
function easy_mgmt_queue_custom_questions() {
    $saved = get_option('easy_mgmt_queue_custom_questions', []);
    if (!is_array($saved)) {
        return [];
    }
    $out = [];
    foreach ($saved as $q) {
        if (!is_array($q) || empty($q['key']) || empty($q['label'])) {
            continue;
        }
        $out[] = $q;
    }
    return $out;
}

/**
 * Question definitions. Each: key, number (for display), section, label,
 * why (context), type (radio|text|date|textarea), options[] for radio
 * (each: value shown, note optional), or placeholder for text/date.
 */
function easy_mgmt_queue_questions() {
    $questions = [
        // ---- Terms of Service: starting point ----
        [
            'key'     => '***REMOVED***',
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio',
            'options' => [
                ***REMOVED***
                ***REMOVED***
            ],
        ],
        [
            'key'         => '***REMOVED***',
            'section'     => '***REMOVED***',
            'label'       => '***REMOVED***',
            'why'         => '***REMOVED***',
            'type'        => 'textarea',
            'placeholder' => '***REMOVED***',
            'depends_on'  => ['***REMOVED***', 'Yes'],
        ],
        // ---- Terms of Service: business details ----
        [
            'key'     => '***REMOVED***',
            'num'     => 1,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED*** (name as currently written)', '***REMOVED***'],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        // ---- Cancellations ----
        [
            'key'     => '***REMOVED***',
            'num'     => 2,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
                ['***REMOVED***', ''],
                ['***REMOVED***', '***REMOVED*** applies instead.'],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            ***REMOVED***
            'num'     => 3,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
                ['***REMOVED***', ''],
                ['***REMOVED***', '***REMOVED***'],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 4,
            'section' => '***REMOVED***',
            ***REMOVED***
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ***REMOVED***
                ['***REMOVED***', ''],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 5,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
            ],
            'other_placeholder' => '',
            'other_type'        => 'date',
        ],
        // ---- Privacy Policy ----
        [
            ***REMOVED***
            'num'     => 6,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 7,
            'section' => '***REMOVED***',
            ***REMOVED***
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        // ---- ***REMOVED*** ----
        [
            'key'     => '***REMOVED***',
            'num'     => 8,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', '***REMOVED***'],
            ],
            'other_placeholder' => '***REMOVED***',
            'other_type'        => 'email',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 9,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio',
            'options' => [
                ['***REMOVED***', ''],
                ['***REMOVED***', ''],
            ],
        ],
        // ---- Pricing (for Dad) ----
        [
            'key'     => '***REMOVED***',
            'num'     => 10,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ***REMOVED***
                ***REMOVED***
                ***REMOVED***
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 11,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ***REMOVED***
                ***REMOVED***
                ***REMOVED***
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            'key'     => '***REMOVED***',
            'num'     => 12,
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio',
            'options' => [
                ['***REMOVED***', '***REMOVED***'],
                ['***REMOVED***', ''],
            ],
        ],
        // ---- Payments ----
        [
            ***REMOVED***
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            ***REMOVED***
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', '***REMOVED***'],
                ['***REMOVED***', '***REMOVED***'],
                ['***REMOVED***', '***REMOVED***'],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        [
            ***REMOVED***
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', ''],
                ***REMOVED***
                ***REMOVED***
                ***REMOVED***
            ],
            'other_placeholder' => '***REMOVED***',
        ],
        // ---- Shop review ----
        [
            'key'     => '***REMOVED***',
            'section' => '***REMOVED***',
            'label'   => '***REMOVED***',
            'why'     => '***REMOVED***',
            'type'    => 'radio_other',
            'options' => [
                ['***REMOVED***', '***REMOVED***'],
            ],
            'other_placeholder' => '***REMOVED***',
        ],
    ];

    // Append admin-added custom questions, numbered after the built-ins.
    $num = 0;
    foreach ($questions as $hq) {
        if (!empty($hq['num']) && $hq['num'] > $num) {
            $num = (int) $hq['num'];
        }
    }
    foreach (easy_mgmt_queue_custom_questions() as $cq) {
        // Only numbered types get a number; textarea/info types do not.
        if ($cq['type'] !== 'textarea') {
            $num++;
            $cq['num'] = $num;
        }
        $questions[] = $cq;
    }
    return $questions;
}

/** Render one question. $saved = previously saved answer array for this key. */
function easy_mgmt_queue_render_question($q, $saved) {
    $key   = $q['key'];
    $saved = is_array($saved) ? $saved : [];
    $sel   = isset($saved['choice']) ? $saved['choice'] : '';
    $other = isset($saved['other']) ? $saved['other'] : '';

    $dep_attr = '';
    if (!empty($q['depends_on'])) {
        $dep_attr = ' data-depends-on="' . esc_attr($q['depends_on'][0]) . '" data-depends-val="' . esc_attr($q['depends_on'][1]) . '"';
        $show = ($sel === $q['depends_on'][1] || ($sel === '' && false));
        // Shown/hidden by JS; initial state set inline.
        $dep_attr .= $sel === $q['depends_on'][1] ? '' : ' style="display:none"';
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
        $val = isset($saved['text']) ? $saved['text'] : '';
        echo '<textarea class="emq-free-input" name="emq[' . esc_attr($key) . '][text]" placeholder="' . esc_attr($q['placeholder']) . '">' . esc_textarea($val) . '</textarea>';
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

    // Merge new answers over previous; newly answered questions become decided
    // and clear from the queue.
    $merged = array_merge($prev_answers, $clean);
    $newly_decided = [];
    foreach ($clean as $key => $ans) {
        if (!in_array($key, $prev_decided, true)) {
            $prev_decided[] = $key;
            $newly_decided[] = $key;
        }
    }

    $all['answers'] = $merged;
    $all['decided'] = array_values(array_unique($prev_decided));
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
        $remaining = count(easy_mgmt_queue_questions()) - count($all['decided']);
        $lines[] = '';
        $lines[] = $remaining . ' question(s) still outstanding.';
        $brandon = '***REMOVED***';
        wp_mail($brandon, 'Management queue: ' . count($newly_decided) . ' new decision(s) by ' . $user->display_name, implode("\n", $lines));
    }

    // Redirect to avoid resubmission.
    wp_safe_redirect(add_query_arg('emq_saved', '1', get_permalink()));
    exit;
}
add_action('template_redirect', 'easy_mgmt_queue_handle_submit');

/** Questions not yet decided, respecting dependency visibility. */
function easy_mgmt_queue_open_questions() {
    $all = easy_mgmt_queue_get_responses();
    $decided = isset($all['decided']) ? (array) $all['decided'] : [];
    $answers = isset($all['answers']) ? $all['answers'] : [];
    $out = [];
    foreach (easy_mgmt_queue_questions() as $q) {
        if (in_array($q['key'], $decided, true)) {
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
    $just_saved = isset($_GET['emq_saved']);
    $open = easy_mgmt_queue_open_questions();
    $total = count(easy_mgmt_queue_questions());
    $done_count = count($decided);

    ob_start();
    ?>
    <div class="emq-wrap">
        <h2>Management queue</h2>
        ***REMOVED***
        <p class="emq-progress"><strong><?php echo (int) $done_count; ?> of <?php echo (int) $total; ?></strong> decided.</p>
        <?php if ($just_saved): ?>
            <div class="emq-notice">Decisions saved. Brandon has been notified.</div>
        <?php endif; ?>
        <?php if (empty($open)): ?>
            <div class="emq-notice">All decisions are in. Thank you.</div>
        <?php else: ?>
        <form method="post" action="">
            <?php wp_nonce_field('emq_submit', 'emq_nonce'); ?>
            <?php
            $last_section = null;
            foreach ($open as $q) {
                if ($q['section'] !== $last_section) {
                    if ($last_section !== null) {
                        echo '</section>';
                    }
                    echo '<section class="emq-section"><div class="emq-section-head"><h3>' . esc_html($q['section']) . '</h3></div>';
                    $last_section = $q['section'];
                }
                easy_mgmt_queue_render_question($q, null);
            }
            echo '</section>';
            ?>
            <section class="emq-section">
                
                <div class="emq-q">
                    
                    <ul class="emq-list">
                        
                        
                        
                        
                    </ul>
                    
                </div>
            </section>
            <section class="emq-section">
                
                <div class="emq-q">
                    
                    <ol class="emq-list">
                        
                        
                        
                        
                        
                        
                        
                    </ol>
                    
                </div>
            </section>
            <section class="emq-section">
                
                <div class="emq-q">
                    
                    
                    <ol class="emq-list">
                        
                        
                        
                        
                    </ol>
                    
                    <a class="emq-action-btn" href="<?php echo esc_url(easy_mgmt_queue_resend_link()); ?>" target="_blank" rel="noopener">Complete email setup in GoDaddy</a>
                </div>
            </section>
            <div class="emq-finish">
                ***REMOVED***
                <button type="submit" class="emq-submit">Submit decisions</button>
            </div>
        </form>
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
        .emq-other-input:disabled { opacity: 0.45; }
        .emq-free-input { min-height: 7rem; }
        .emq-list { margin: 0 0 1rem; padding-left: 1.25rem; }
        .emq-list li { margin-bottom: 0.35rem; }
        .emq-q a { color: #14532d; font-weight: 600; }
        .emq-finish { background: #fff; border: 1.5px solid #1e6b3c; border-radius: 12px; padding: 1.2rem; margin-top: 2rem; }
        .emq-submit { font: inherit; font-size: 1.05rem; font-weight: 700; color: #fff; background: #1e6b3c; border: none; border-radius: 10px; padding: 0.9rem 1.4rem; cursor: pointer; margin-top: 0.6rem; }
        .emq-submit:hover { filter: brightness(1.08); }
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
                    var depChecked = depQ ? depQ.querySelector('input[type="radio"]:checked') : null;
                    q.style.display = (depChecked && depChecked.value === depVal) ? '' : 'none';
                }
            }
            radios.forEach(function (r) { r.addEventListener('change', syncAll); });
            if (otherInput) { otherInput.addEventListener('input', function () {}); }
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
                    var depChecked = depQ ? depQ.querySelector('input[type="radio"]:checked') : null;
                    q.style.display = (depChecked && depChecked.value === depVal) ? '' : 'none';
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
    // Add a custom question.
    if (isset($_POST['emq_add_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_add_nonce'])), 'emq_add_question')) {
        $label = isset($_POST['emq_new_label']) ? trim(sanitize_text_field(wp_unslash($_POST['emq_new_label']))) : '';
        if ($label !== '') {
            $section = isset($_POST['emq_new_section']) ? trim(sanitize_text_field(wp_unslash($_POST['emq_new_section']))) : '';
            $why = isset($_POST['emq_new_why']) ? trim(sanitize_textarea_field(wp_unslash($_POST['emq_new_why']))) : '';
            $type = isset($_POST['emq_new_type']) ? sanitize_key(wp_unslash($_POST['emq_new_type'])) : 'radio';
            if (!in_array($type, ['radio', 'radio_other', 'textarea'], true)) {
                $type = 'radio';
            }
            $options = [];
            if ($type !== 'textarea' && isset($_POST['emq_new_options'])) {
                foreach (preg_split('/[\r\n]+/', (string) wp_unslash($_POST['emq_new_options'])) as $line) {
                    $line = trim(sanitize_text_field($line));
                    if ($line !== '') {
                        $options[] = [$line, ''];
                    }
                }
            }
            $key = 'custom_' . substr(md5($label . microtime(true)), 0, 12);
            $q = [
                'key'     => $key,
                'section' => $section !== '' ? $section : 'Additional questions',
                'label'   => $label,
                'why'     => $why,
                'type'    => $type,
                'options' => $options,
                'custom'  => true,
            ];
            if ($type === 'radio_other') {
                $q['other_placeholder'] = 'Type an alternative';
            }
            $all = easy_mgmt_queue_custom_questions();
            // easy_mgmt_queue_custom_questions filters invalid ones; keep raw here.
            $raw = get_option('easy_mgmt_queue_custom_questions', []);
            $raw = is_array($raw) ? $raw : [];
            $raw[] = $q;
            update_option('easy_mgmt_queue_custom_questions', $raw, false);
            add_settings_error('emq_admin', 'emq_added', 'Question added.', 'success');
        }
    }
    // Delete a custom question (and its saved answer, if any).
    if (isset($_POST['emq_del_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['emq_del_nonce'])), 'emq_del_question')) {
        $del_key = isset($_POST['emq_del_key']) ? sanitize_key(wp_unslash($_POST['emq_del_key'])) : '';
        if ($del_key !== '') {
            $raw = get_option('easy_mgmt_queue_custom_questions', []);
            $raw = is_array($raw) ? array_values(array_filter($raw, function ($q) use ($del_key) {
                return !is_array($q) || ($q['key'] ?? '') !== $del_key;
            })) : [];
            update_option('easy_mgmt_queue_custom_questions', $raw, false);
            $resp = easy_mgmt_queue_get_responses();
            if (isset($resp['answers'][$del_key])) {
                unset($resp['answers'][$del_key]);
                update_option('easy_mgmt_queue_responses', $resp, false);
            }
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
            update_option('easy_mgmt_queue_responses', $resp, false);
            add_settings_error('emq_admin', 'emq_reopened', 'Question reopened — it is back in the queue.', 'success');
        }
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
    echo '<p>Private decision page: <a href="' . esc_url(home_url('/management-queue/')) . '" target="_blank" rel="noopener">' . esc_html(home_url('/management-queue/')) . '</a> (Private page, shortcode <code>[easy_management_queue]</code>). Visible only to the usernames in EASY Suite → Settings → Management queue, plus administrators.</p>';

    // --- Submitted responses ---
    echo '<h2>Submitted responses</h2>';
    $decided = isset($responses['decided']) ? (array) $responses['decided'] : [];
    if (empty($answers)) {
        echo '<p><em>No responses submitted yet.</em></p>';
    } else {
        echo '<p>Submitted by <strong>' . esc_html($responses['submitted_by'] ?? '?') . '</strong> at ' . esc_html($responses['submitted_at'] ?? '?') . ' (site time). '
            . count($decided) . ' of ' . count($questions) . ' decided.</p>';
        echo '<table class="widefat striped"><thead><tr><th style="width:35%">Question</th><th>Answer</th><th style="width:12%">Status</th><th style="width:10%"></th></tr></thead><tbody>';
        foreach ($questions as $q) {
            $label = (!empty($q['num']) ? $q['num'] . '. ' : '') . $q['label'];
            $ans = isset($answers[$q['key']]) ? easy_mgmt_queue_format_answer($q, $answers[$q['key']]) : '(skipped)';
            $is_decided = in_array($q['key'], $decided, true);
            echo '<tr><td>' . esc_html($label) . '</td><td>' . esc_html($ans) . '</td>';
            echo '<td>' . ($is_decided ? '<span style="color:#1e6b3c;font-weight:600">Decided</span>' : '<span style="color:#8a6d1a">Open</span>') . '</td>';
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

    // --- Custom questions ---
    echo '<h2>Custom questions</h2>';
    $custom = easy_mgmt_queue_custom_questions();
    if (empty($custom)) {
        echo '***REMOVED***';
    } else {
        echo '<table class="widefat striped"><thead><tr><th>Question</th><th>Section</th><th>Type</th><th></th></tr></thead><tbody>';
        foreach ($custom as $cq) {
            echo '<tr><td>' . esc_html($cq['label']) . '</td><td>' . esc_html($cq['section']) . '</td><td>' . esc_html($cq['type']) . '</td>';
            echo '<td><form method="post" action="" style="margin:0">';
            wp_nonce_field('emq_del_question', 'emq_del_nonce');
            echo '<input type="hidden" name="emq_del_key" value="' . esc_attr($cq['key']) . '">';
            echo '<button type="submit" class="button button-link-delete" onclick="return confirm(\'Delete this question and its saved answer?\')">Delete</button>';
            echo '</form></td></tr>';
        }
        echo '</tbody></table>';
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
    echo '</tbody></table>';
    submit_button('Add question');
    echo '</form></div>';
}
