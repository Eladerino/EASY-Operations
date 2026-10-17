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
 * Question definitions. Each: key, number (for display), section, label,
 * why (context), type (radio|text|date|textarea), options[] for radio
 * (each: value shown, note optional), or placeholder for text/date.
 */
function easy_mgmt_queue_questions() {
    return [
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
    ];
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
    $all['answers'] = $clean;
    $all['submitted_by'] = $user->user_login;
    $all['submitted_at'] = current_time('mysql');
    update_option('easy_mgmt_queue_responses', $all, false);

    // Notify Brandon.
    $lines = ['***REMOVED***', '', 'Submitted by: ' . $user->user_login . ' (' . $user->display_name . ')', 'Submitted at: ' . $all['submitted_at'] . ' (site time)', ''];
    $answered = 0;
    foreach (easy_mgmt_queue_questions() as $q) {
        $key = $q['key'];
        $a = isset($clean[$key]) ? $clean[$key] : null;
        $label = (!empty($q['num']) ? $q['num'] . '. ' : '') . $q['label'];
        if ($a === null) {
            $lines[] = $label . ': (skipped)';
            continue;
        }
        $answered++;
        if (isset($a['text'])) {
            $lines[] = $label . ': ' . $a['text'];
        } elseif ($a['choice'] === '__other') {
            $lines[] = $label . ': ' . (isset($a['other']) ? $a['other'] : '(write-in selected; no text entered)');
        } else {
            $lines[] = $label . ': ' . $a['choice'];
        }
    }
    $lines[] = '';
    $lines[] = $answered . ' of ' . count(easy_mgmt_queue_questions()) . ' answered.';
    $to = get_option('admin_email');
    // Brandon's address for queue notifications.
    $brandon = '***REMOVED***';
    wp_mail($brandon, '***REMOVED***', implode("\n", $lines));

    // Redirect to avoid resubmission.
    wp_safe_redirect(add_query_arg('emq_saved', '1', get_permalink()));
    exit;
}
add_action('template_redirect', 'easy_mgmt_queue_handle_submit');

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
    $just_saved = isset($_GET['emq_saved']);

    ob_start();
    ?>
    <div class="emq-wrap">
        <h2>Management queue</h2>
        ***REMOVED***
        <?php if ($just_saved): ?>
            <div class="emq-notice">Responses saved. Brandon has been notified.</div>
        <?php elseif (!empty($saved_all['submitted_at'])): ?>
            <div class="emq-notice emq-notice-info">Last submitted <?php echo esc_html($saved_all['submitted_at']); ?> by <?php echo esc_html($saved_all['submitted_by']); ?>. Answers below can be changed and re-submitted.</div>
        <?php endif; ?>
        <form method="post" action="">
            <?php wp_nonce_field('emq_submit', 'emq_nonce'); ?>
            <?php
            $last_section = null;
            foreach (easy_mgmt_queue_questions() as $q) {
                if ($q['section'] !== $last_section) {
                    if ($last_section !== null) {
                        echo '</section>';
                    }
                    echo '<section class="emq-section"><div class="emq-section-head"><h3>' . esc_html($q['section']) . '</h3></div>';
                    $last_section = $q['section'];
                }
                easy_mgmt_queue_render_question($q, isset($saved[$q['key']]) ? $saved[$q['key']] : null);
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
                ***REMOVED***
                <div class="emq-q">
                    ***REMOVED***
                    <ol class="emq-list">
                        
                        ***REMOVED***
                        ***REMOVED***
                        ***REMOVED***
                    </ol>
                    ***REMOVED***
                </div>
            </section>
            <div class="emq-finish">
                ***REMOVED***
                <button type="submit" class="emq-submit">Save responses</button>
            </div>
        </form>
    </div>
    <style>
        .emq-wrap { max-width: 46rem; margin: 0 auto; }
        .emq-lede { color: #55645a; }
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
