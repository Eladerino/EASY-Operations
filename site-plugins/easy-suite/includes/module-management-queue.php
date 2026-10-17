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
            'key'     => 'has_own_terms',
            'section' => 'Terms of Service — starting point',
            'label'   => 'Existing Terms of Service available for use?',
            'why'     => 'Selection determines the next step. "Yes" opens a text box for pasted text or a location note. "No" means the current working draft is the basis for publication. Items 1 to 9 apply in either case.',
            'type'    => 'radio',
            'options' => [
                ['Yes', ''],
                ['No', ''],
            ],
        ],
        [
            'key'         => 'own_terms_text',
            'section'     => 'Terms of Service — starting point',
            'label'       => 'Terms of Service text or document location',
            'why'         => 'Only applies when the previous answer is "Yes".',
            'type'        => 'textarea',
            'placeholder' => 'Paste Terms of Service text here, or describe the location of the document',
            'depends_on'  => ['has_own_terms', 'Yes'],
        ],
        // ---- Terms of Service: business details ----
        [
            'key'     => 'legal_name',
            'num'     => 1,
            'section' => 'Business details',
            'label'   => 'Legal company name',
            'why'     => 'Current wording in the Terms and the Privacy Policy: "EASY Safety Training and Services." A registry search returned no match under that name, and registration may be under a numbered company. Entry required: the exact legal name for the Terms.',
            'type'    => 'radio_other',
            'options' => [
                ['EASY Safety Training and Services (name as currently written)', '"EASY Safety Training and Services" is correct.'],
            ],
            'other_placeholder' => 'Type the exact legal name (for a numbered company, enter the numbered name exactly as registered)',
        ],
        // ---- Cancellations ----
        [
            'key'     => 'refund_notice',
            'num'     => 2,
            'section' => 'Cancellations, rescheduling, and refunds',
            'label'   => 'Notice period for a full refund',
            'why'     => 'Scenario: cancellation of a single registration or a block booking for a group. Selection sets the minimum notice period for a full refund.',
            'type'    => 'radio_other',
            'options' => [
                ['7 days or more before the course start', ''],
                ['48 hours or more before the course start', ''],
                ['No refunds; credit toward a future course instead', 'Credit toward a future course applies instead.'],
            ],
            'other_placeholder' => 'Type the preferred rule',
        ],
        [
            'key'     => 'reschedule',
            'num'     => 3,
            'section' => 'Cancellations, rescheduling, and refunds',
            'label'   => 'Rescheduling a booking',
            'why'     => 'Applies when a booked date cannot be attended and enrolment continues on a later date.',
            'type'    => 'radio_other',
            'options' => [
                ['Free, with contact before the course start', ''],
                ['One free reschedule, then a fee applies', ''],
                ['No rescheduling; treated as a cancellation', 'Treated as a cancellation; the refund rule above applies.'],
            ],
            'other_placeholder' => 'Type the preferred rule',
        ],
        [
            'key'     => 'no_show',
            'num'     => 4,
            'section' => 'Cancellations, rescheduling, and refunds',
            'label'   => 'No-shows',
            'why'     => 'Applies when a booked participant does not attend, with no advance contact by phone or email.',
            'type'    => 'radio_other',
            'options' => [
                ['No refund', ''],
                ['Credit toward a future course', ''],
            ],
            'other_placeholder' => 'Type the preferred rule',
        ],
        [
            'key'     => 'effective_date',
            'num'     => 5,
            'section' => 'Cancellations, rescheduling, and refunds',
            'label'   => 'Effective date for the Terms',
            'why'     => 'A start date is required at the top of the Terms. Standard practice: the date of publication on the website.',
            'type'    => 'radio_other',
            'options' => [
                ['The day the Terms are published on easysafety.ca', ''],
            ],
            'other_placeholder' => '',
            'other_type'        => 'date',
        ],
        // ---- Privacy Policy ----
        [
            'key'     => 'retention',
            'num'     => 6,
            'section' => 'Privacy Policy — confirmation items',
            'label'   => 'Training record retention period',
            'why'     => 'Current Privacy Policy wording: training and certification records retained for 7 years. Confirmation or correction required.',
            'type'    => 'radio_other',
            'options' => [
                ['7 years (as currently stated)', ''],
            ],
            'other_placeholder' => 'Type the period, e.g. 3 years, or retained permanently',
        ],
        [
            'key'     => 'privacy_contact',
            'num'     => 7,
            'section' => 'Privacy Policy — confirmation items',
            'label'   => 'Privacy contact',
            'why'     => 'Current Privacy Policy wording lists Pam Evans (pam@easysafety.ca) as the contact for privacy questions. Confirmation or correction required.',
            'type'    => 'radio_other',
            'options' => [
                ['Pam Evans, pam@easysafety.ca (as currently stated)', ''],
            ],
            'other_placeholder' => 'Type name and email address',
        ],
        // ---- Additional items ----
        [
            'key'     => 'reply_to',
            'num'     => 8,
            'section' => 'Additional items',
            'label'   => 'Reply address for automated site emails',
            'why'     => 'Automated site emails include certificates and certification expiry reminders. Selection sets the destination for replies to those messages.',
            'type'    => 'radio_other',
            'options' => [
                ['pam@easysafety.ca (recommended)', 'Inbox already in use for bookings and questions.'],
            ],
            'other_placeholder' => 'Type the email address',
            'other_type'        => 'email',
        ],
        [
            'key'     => 'google_profile',
            'num'     => 9,
            'section' => 'Additional items',
            'label'   => 'Google listing address',
            'why'     => 'The Google listing shows the former address. Confirmation requested for an update to 44 Austin Street, St. John’s, NL A1B 4C2.',
            'type'    => 'radio',
            'options' => [
                ['Yes, update the listing', ''],
                ['No, leave the listing unchanged', ''],
            ],
        ],
        // ---- Pricing (for Dad) ----
        [
            'key'     => 'theory_price',
            'num'     => 10,
            'section' => 'Online course pricing — forklift',
            'label'   => 'Online theory price per seat',
            'why'     => 'Canadian online forklift theory courses are listed at $80–$140 per seat, with most clustered near $100 (Danatec $99.98, Safe + Sound $99.99, onlinewhmis.ca $79.95). Budget options at $25–$48 are awareness-level only, not full operator courses.',
            'type'    => 'radio_other',
            'options' => [
                ['$79.95 per seat', 'Matches the lowest credible online anchor.'],
                ['$89.95 per seat', ''],
                ['$99.95 per seat', 'Matches the national cluster point.'],
            ],
            'other_placeholder' => 'Type a different price',
        ],
        [
            'key'     => 'blended_price',
            'num'     => 11,
            'section' => 'Online course pricing — forklift',
            'label'   => 'Blended bundle price (online theory + in-person practical)',
            'why'     => 'The closest market comparison for online theory plus a bookable practical seat is $149 (Worksite Safety blended). Full in-person courses run $165–$325.',
            'type'    => 'radio_other',
            'options' => [
                ['$149 per seat', 'Matches the closest blended comparison.'],
                ['$159 per seat', ''],
                ['$175 per seat', ''],
            ],
            'other_placeholder' => 'Type a different price',
        ],
        [
            'key'     => 'publish_prices',
            'num'     => 12,
            'section' => 'Online course pricing — forklift',
            'label'   => 'Publish prices on easysafety.ca?',
            'why'     => 'No Newfoundland and Labrador competitor publishes online course prices. Publishing is a differentiator; withholding keeps pricing negotiable.',
            'type'    => 'radio',
            'options' => [
                ['Yes, publish the prices', 'Differentiator — no local competitor does this.'],
                ['No, keep prices off the site', ''],
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
    $lines = ['EASY Management Queue — responses submitted', '', 'Submitted by: ' . $user->user_login . ' (' . $user->display_name . ')', 'Submitted at: ' . $all['submitted_at'] . ' (site time)', ''];
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
    $brandon = 'glynnbrandon59@gmail.com';
    wp_mail($brandon, 'Management queue responses submitted', implode("\n", $lines));

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
        <p class="emq-lede">Decisions required for the easysafety.ca Terms of Service and the upcoming online forklift course. Items without a definite answer may be left blank. Selections can be updated and re-submitted at any time.</p>
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
                <div class="emq-section-head"><h3>Photos for LinkedIn and social media</h3></div>
                <div class="emq-q">
                    <p class="emq-why">Photos needed for the LinkedIn page and social media posts:</p>
                    <ul class="emq-list">
                        <li>Team photos, group or individual</li>
                        <li>Training in action: classes and practical exercises</li>
                        <li>The facility: classroom and training areas</li>
                        <li>Training equipment in use</li>
                    </ul>
                    <p class="emq-why" style="margin-bottom:0">Reminder: photos cannot be attached through this form. Email photo files to Brandon separately.</p>
                </div>
            </section>
            <section class="emq-section">
                <div class="emq-section-head"><h3>Facebook and LinkedIn access</h3><span class="emq-goes-where">Information only — no answer required</span></div>
                <div class="emq-q">
                    <p class="emq-why">Request: addition of Brandon Glynn with full access to the Facebook page, for social media cleanup and ongoing management: <a href="https://www.facebook.com/EASYsafetyTRAINING/" target="_blank" rel="noopener">facebook.com/EASYsafetyTRAINING</a></p>
                    <ol class="emq-list">
                        <li>Open the Facebook page.</li>
                        <li>Go to Professional Dashboard.</li>
                        <li>Tap Page Access.</li>
                        <li>Tap Add New.</li>
                        <li>Search for Brandon Glynn.</li>
                        <li>Turn on full control.</li>
                        <li>Tap Give Access.</li>
                    </ol>
                    <p class="emq-why" style="margin-bottom:0">LinkedIn company page: <a href="https://www.linkedin.com/company/easy-safety-training/" target="_blank" rel="noopener">linkedin.com/company/easy-safety-training</a>. After the LinkedIn page has been followed, admin access can be granted from Page settings.</p>
                </div>
            </section>
            <section class="emq-section">
                <div class="emq-section-head"><h3>Email setup</h3><span class="emq-goes-where">Information only — no answer required</span></div>
                <div class="emq-q">
                    <p class="emq-why">Notification emails from the site (certificates, expiry reminders) require a one-time domain setup in GoDaddy. The setup applies the required changes automatically; no manual DNS entry is needed.</p>
                    <ol class="emq-list">
                        <li>Log in to GoDaddy.</li>
                        <li>Use the setup link provided separately by Brandon.</li>
                        <li>Approve the DNS changes proposed (SPF, DKIM, and DMARC records for the easysafety.ca domain).</li>
                        <li>Done — setup is complete.</li>
                    </ol>
                    <p class="emq-why" style="margin-bottom:0">Note: the setup link expires. Prompt completion is required once the link has been received.</p>
                </div>
            </section>
            <div class="emq-finish">
                <p class="emq-why">Note: review of the final Terms of Service by a lawyer is recommended before publication on the website.</p>
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
