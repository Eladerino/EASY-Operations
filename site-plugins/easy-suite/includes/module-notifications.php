<?php
/**
 * Module: Certificate emails (was EASY Certificate Notifications 2.4.8).
 *
 * Student email on publish, expiry reminders, and the twice-daily employer
 * digest. Sent-email records (_easy_cert_notified_* meta), the digest cutoff
 * and the send-time/threshold settings carry over unchanged. The admin
 * check pages stay under Tools as before.
 */

defined('ABSPATH') || exit;

class Easy_Safety_Cert_Notifications {

    const CRON_HOOK   = 'easy_safety_daily_expiry_check';
    const META_PREFIX = '_easy_cert_notified_'; // + 'new' | '30' | '7' | 'expired'

    /** Plain-text alternative body for the next wp_mail() call (v2.4.3).
     * Set just before wp_mail() and cleared right after, so multipart
     * emails carry a text part for clients that strip HTML. */
    private static $alt_body = null;

    public static function phpmailer_altbody($phpmailer) {
        if (self::$alt_body !== null) {
            $phpmailer->AltBody = self::$alt_body;
        }
    }
    const EMPLOYER_CRON_HOOK = 'easy_safety_employer_digest';
    const EMPLOYER_META      = '_easy_cert_notified_employer';
    const EMPLOYER_SINCE_OPT = 'easy_employer_digest_since';
    // Completion-date safety net (v2.4): the employer digest only covers
    // certs completed within this many days before the activation cutoff.
    const DIGEST_COMPLETION_GRACE_DAYS = 90;
    const TIMEZONE    = 'America/St_Johns';

    const CERT_PORTAL_URL = 'https://easysafety.ca/view-certificates/';
    const LOGO_URL        = 'https://easysafety.ca/wp-content/login-logo.png';
    const CONTACT_EMAIL   = 'pam@easysafety.ca';
    const CONTACT_PHONE   = '(709) 221-7233';
    const FROM_NAME       = 'EASY Safety';
    // When FluentSMTP (or any SMTP) is in use, this MUST match the mailbox
    // it authenticates as — providers reject mail when From and the login
    // don't match. Via plain PHP mail() there is no such check.
    const FROM_EMAIL      = 'pam@easysafety.ca';

    // Import-suppression mode (v2.4, for the legacy-certificate bulk migration).
    // While suppression is engaged, NOTHING is sent on any path: new-cert
    // emails, expiry checks, and the employer digest all silently stand down.
    // Engage it by defining EASY_CERT_SUPPRESS_NOTIFICATIONS as true
    // (wp-config.php or the migration script), by running under WP_IMPORTING,
    // or via the 'easy_cert_notifications_suppressed' filter.
    const SUPPRESS_CONST = 'EASY_CERT_SUPPRESS_NOTIFICATIONS';

    // Last-run tracking (v2.2.1): stamped on every real send run (cron or
    // manual) so the Overview page can show whether the scheduled runs are
    // actually firing. Stored as site-local MySQL datetimes.
    const LAST_EXPIRY_RUN_OPT = 'easy_cert_last_expiry_run';
    const LAST_DIGEST_RUN_OPT = 'easy_cert_last_digest_run';

    public static function notifications_suppressed() {
        if (defined(self::SUPPRESS_CONST) && constant(self::SUPPRESS_CONST)) {
            return true;
        }
        if (defined('WP_IMPORTING') && WP_IMPORTING) {
            return true;
        }
        return (bool) apply_filters('easy_cert_notifications_suppressed', false);
    }

    /**
     * Stamp a bulk-imported certificate as already notified on every path, so
     * post-import cron runs stay silent. Call once per cert created by the
     * legacy migration, while suppression mode is engaged.
     *
     * @param int  $post_id                 Certificate post ID.
     * @param bool $stamp_expiry_thresholds Also stamp the 30/7/expired
     *        markers. Default true: the import stays fully silent. Set false
     *        to let live imported certs receive their legitimate upcoming
     *        expiry reminders on the next daily run instead.
     */
    public static function stamp_imported_cert($post_id, $stamp_expiry_thresholds = true) {
        $now = current_time('mysql');
        update_post_meta($post_id, self::META_PREFIX . 'new', $now);
        update_post_meta($post_id, self::EMPLOYER_META, $now);
        if ($stamp_expiry_thresholds) {
            // Stamp the currently-configured threshold keys so imports stay silent.
            $keys = ['expired'];
            if (function_exists('easy_core_get_notification_thresholds')) {
                foreach (easy_core_get_notification_thresholds() as $t) {
                    $keys[] = (string) (int) $t;
                }
            } else {
                $keys[] = '30'; $keys[] = '7';
            }
            foreach (array_unique($keys) as $key) {
                update_post_meta($post_id, self::META_PREFIX . $key, $now);
            }
        }
    }

    // Map backend course keys to readable labels.
    private static $course_labels = [
        "confined-space-entry" => "Confined Space Entry",
        "fall-protection" => "Fall Protection",
        "fall-protection-recertification" => "Fall Protection Recertification",
        "ohs-committee1" => "OH&S Committee I",
        "ohs-committee2" => "OH&S Committee II",
        "powerline-hazards" => "Powerline Hazards",
        "traffic-control" => "Traffic Control Person",
        "counter-balance-forklift" => "Counter Balance Forklift",
        "skid-steer" => "Skid Steer",
        "telehandler-7" => "Telehandler (Class7)",
        "aerial-work-platform" => "Aerial Work Platform",
        "confined-space-rescue" => "Confined Space Rescue",
        "gas-detection" => "Gas Detection",
        "lockout-tagout" => "Lockout/Tagout",
        "regulatory-awareness" => "Regulatory Awareness",
        "respiratory-protective-equipment" => "Respiratory Protective Equipment",
        "saba-scba" => "SABA/SCBA",
        "emergency-first-aid" => "Emergency First Aid",
        "standard-first-aid" => "Standard First Aid",
        "frame" => "Frame",
        "inspection-awareness" => "Inspection Awareness",
        "swing-stage" => "Swing Stage",
        "system" => "System",
        "tube-clamp" => "Tube & Clamp",
        "arc-flash" => "Arc Flash",
        "drops-prevention" => "DROPS Prevention",
        "hazard-risk-assessment" => "Hazard and Risk Assessment",
        "offshore-fall-protection" => "Offshore Fall Protection",
        "transportation-dangerous-goods" => "Transportation of Dangerous Goods",
        "trenching-excavation" => "Trenching & Excavation",
        "whmis" => "WHMIS",
        "overhead-crane-rigging" => "Overhead Crane Rigging",
        "overhead-crane-rigging-slinging" => "Overhead Crane Rigging & Slinging",
        "rigging-slinging-banksmen" => "Rigging, Slinging & Banksmen"
    ];

    /* Course pages for the "Book Renewal Training" email CTA (v2.4.3).
     * Tier 1: individual course page. Tier 2 ($course_category_urls):
     * category page for courses without their own page. Anything else
     * falls back to the main training-courses page. */
    private static $course_page_urls = [
        "arc-flash" => "https://easysafety.ca/training-courses/additional/arc-flash/",
        "drops-prevention" => "https://easysafety.ca/training-courses/additional/drops-prevention/",
        "transportation-dangerous-goods" => "https://easysafety.ca/training-courses/additional/transportation-of-dangerous-goods/",
        "trenching-excavation" => "https://easysafety.ca/training-courses/additional/trenching-excavation/",
        "whmis" => "https://easysafety.ca/training-courses/additional/whmis/",
        "confined-space-rescue" => "https://easysafety.ca/training-courses/confined-space/confined-space-rescue/",
        "lockout-tagout" => "https://easysafety.ca/training-courses/confined-space/lockout-tagout/",
        "regulatory-awareness" => "https://easysafety.ca/training-courses/confined-space/regulatory-awareness/",
        "respiratory-protective-equipment" => "https://easysafety.ca/training-courses/confined-space/respiratory-protective-equipment/",
        "overhead-crane-rigging" => "https://easysafety.ca/training-courses/crane-rigging-training/overhead-crane-rigging/",
        "overhead-crane-rigging-slinging" => "https://easysafety.ca/training-courses/crane-rigging-training/rigging-and-slinging/",
        "rigging-slinging-banksmen" => "https://easysafety.ca/training-courses/crane-rigging-training/rigging-slinging-banksmen/",
        "aerial-work-platform" => "https://easysafety.ca/training-courses/powered-mobile-equipment/aerial-work-platform/",
        "counter-balance-forklift" => "https://easysafety.ca/training-courses/powered-mobile-equipment/counter-balance-forklift/",
        "frame" => "https://easysafety.ca/training-courses/scaffolding/frame/",
        "inspection-awareness" => "https://easysafety.ca/training-courses/scaffolding/inspection-and-awareness/",
        "swing-stage" => "https://easysafety.ca/training-courses/scaffolding/swing-stage/",
        "system" => "https://easysafety.ca/training-courses/scaffolding/system/",
        "tube-clamp" => "https://easysafety.ca/training-courses/scaffolding/tube-clamp/",
        "confined-space-entry" => "https://easysafety.ca/training-courses/workplace-nl/confined-space-entry/",
        "fall-protection" => "https://easysafety.ca/training-courses/workplace-nl/fall-protection/",
        "fall-protection-recertification" => "https://easysafety.ca/training-courses/workplace-nl/fall-protection-recertification/",
        "ohs-committee1" => "https://easysafety.ca/training-courses/workplace-nl/ohs-committee-representative/",
        "ohs-committee2" => "https://easysafety.ca/training-courses/workplace-nl/ohs-committee-representative/",
        "powerline-hazards" => "https://easysafety.ca/training-courses/workplace-nl/powerline-hazards/",
        "traffic-control" => "https://easysafety.ca/training-courses/workplace-nl/traffic-control-person/",
    ];

    private static $course_category_urls = [
        "skid-steer" => "https://easysafety.ca/training-courses/powered-mobile-equipment/",
        "telehandler-7" => "https://easysafety.ca/training-courses/powered-mobile-equipment/",
        "gas-detection" => "https://easysafety.ca/training-courses/confined-space/",
        "saba-scba" => "https://easysafety.ca/training-courses/confined-space/",
        "emergency-first-aid" => "https://easysafety.ca/training-courses/workplace-nl/",
        "standard-first-aid" => "https://easysafety.ca/training-courses/workplace-nl/",
        "hazard-risk-assessment" => "https://easysafety.ca/training-courses/",
        "offshore-fall-protection" => "https://easysafety.ca/training-courses/",
    ];

    private static function course_page_url($course_value) {
        if (isset(self::$course_page_urls[$course_value])) {
            return self::$course_page_urls[$course_value];
        }
        if (isset(self::$course_category_urls[$course_value])) {
            return self::$course_category_urls[$course_value];
        }
        return 'https://easysafety.ca/training-courses/';
    }

    /** Short "Oct 12" date for email subject lines (v2.4.4). The stored
     * date fields come in "F j, Y" or "Y-m-d" flavors; fall back to raw. */
    private static function short_date($raw) {
        $tz = new DateTimeZone(self::TIMEZONE);
        $dt = DateTimeImmutable::createFromFormat('!F j, Y', trim((string) $raw), $tz);
        if (!$dt) {
            $dt = DateTimeImmutable::createFromFormat('!Y-m-d', trim((string) $raw), $tz);
        }
        return $dt ? $dt->format('M j') : (string) $raw;
    }

    /* ================= setup ================= */

    public static function init() {
        // Activation and deactivation are handled by EASY Suite itself.
        // Never schedule the employer digest without a cutoff: a missing
        // cutoff means "since 2000" and would email employers every
        // historical certificate.
        if (false === get_option(self::EMPLOYER_SINCE_OPT, false)) {
            update_option(self::EMPLOYER_SINCE_OPT, current_time('mysql'));
        }

        if (!function_exists('get_field')) {
            add_action('admin_notices', [__CLASS__, 'acf_missing_notice']);
            return;
        }

        // Plain-text alternative for HTML-stripping clients (v2.4.3).
        add_action('phpmailer_init', [__CLASS__, 'phpmailer_altbody']);

        // New-cert email fires when a cert is PUBLISHED, not when the draft
        // is created. Instructors submit drafts via the app; the office
        // publishes after review, and only then is the student notified.
        add_action('transition_post_status', [__CLASS__, 'maybe_notify_on_publish'], 10, 3);

        // Daily expiry check (driven by the real server cron hitting wp-cron.php).
        // Send time is configurable via EASY Suite → Settings (default 9:00 AM
        // site time). Re-checked on every init so a Settings change takes
        // effect without deactivating/reactivating this plugin.
        self::ensure_daily_schedule();
        add_action(self::CRON_HOOK, [__CLASS__, 'cron_handler']);

        // Employer digest: one batched email per company (twice daily).
        if (!wp_next_scheduled(self::EMPLOYER_CRON_HOOK)) {
            wp_schedule_event(time(), 'twicedaily', self::EMPLOYER_CRON_HOOK);
        }
        add_action(self::EMPLOYER_CRON_HOOK, [__CLASS__, 'employer_cron_handler']);

        // Admin manual check page. Priority 20: the EASY Suite parent menu is
        // registered on admin_menu at priority 10 (includes/admin.php), and
        // submenu pages must be added after it. Otherwise WordPress computes
        // a different page hookname at registration time than at access time
        // and denies the page with "Sorry, you are not allowed to access
        // this page." (Same pattern as the Online courses page.)
        add_action('admin_menu', [__CLASS__, 'add_manual_check_menu'], 20);
        add_action('admin_menu', [__CLASS__, 'add_employer_digest_menu'], 20);

        // Visible safety signal while import-suppression mode is engaged.
        if (self::notifications_suppressed()) {
            add_action('admin_notices', [__CLASS__, 'suppressed_notice']);
        }
    }

    public static function suppressed_notice() {
        echo '<div class="notice notice-warning"><p><strong>Easy Safety Certificate Notifications:</strong> '
            . 'notification sending is currently <strong>suppressed</strong> (import mode). No student, expiry, '
            . 'or employer emails will be sent until suppression is lifted.</p></div>';
    }

    /**
     * On activation, stamp the cutoff so the first employer digest run only
     * picks up certs published AFTER this feature existed — never a blast
     * to employers for historical certs.
     */
    public static function activate() {
        if (false === get_option(self::EMPLOYER_SINCE_OPT, false)) {
            update_option(self::EMPLOYER_SINCE_OPT, current_time('mysql'));
        }
        if (!wp_next_scheduled(self::EMPLOYER_CRON_HOOK)) {
            wp_schedule_event(time(), 'twicedaily', self::EMPLOYER_CRON_HOOK);
        }
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON_HOOK);
        wp_clear_scheduled_hook(self::EMPLOYER_CRON_HOOK);
    }

    public static function acf_missing_notice() {
        echo '<div class="notice notice-error"><p><strong>Easy Safety Certificate Notifications</strong> requires the Advanced Custom Fields plugin to be active. No notification emails will be sent until it is.</p></div>';
    }

    /**
     * Keep the daily expiry check pinned to the configured send time.
     * Computes the next 9:00 AM (or configured time) in site time and
     * reschedules only when the stored next-run differs by more than
     * 10 minutes, so minor server-cron lateness doesn't cause churn.
     */
    private static function ensure_daily_schedule() {
        $time = function_exists('easy_core_get_notification_time')
            ? easy_core_get_notification_time()
            : '09:00';
        $parts = explode(':', $time);
        $h = isset($parts[0]) ? (int) $parts[0] : 9;
        $m = isset($parts[1]) ? (int) $parts[1] : 0;

        $tz     = new DateTimeZone(self::TIMEZONE);
        $now    = new DateTimeImmutable('now', $tz);
        $target = $now->setTime($h, $m, 0);
        if ($target->getTimestamp() <= $now->getTimestamp()) {
            $target = $target->modify('+1 day');
        }
        $target_ts = $target->getTimestamp();

        $next = wp_next_scheduled(self::CRON_HOOK);
        if (!$next) {
            wp_schedule_event($target_ts, 'daily', self::CRON_HOOK);
        } elseif ($next > time() && abs($next - $target_ts) > 600) {
            // Reschedule only when the event is in the future but at the
            // wrong time (e.g. the send time changed in Settings). Never
            // clear an overdue event: this runs during plugin load, before
            // wp-cron fires, so clearing here would delete the overdue run
            // before wp-cron ever sees it (v2.2.7 fix — the expiry check
            // could never run).
            wp_clear_scheduled_hook(self::CRON_HOOK);
            wp_schedule_event($target_ts, 'daily', self::CRON_HOOK);
        }
    }

    public static function cron_handler() {
        self::run_expiry_check(true);
    }

    /* ================= new certificate ================= */

    public static function maybe_notify_on_publish($new_status, $old_status, $post) {
        if (self::notifications_suppressed()) return; // import mode: silent
        if (!($post instanceof WP_Post) || $post->post_type !== 'cert') return;
        if ($new_status !== 'publish' || $old_status === 'publish') return;
        if (get_post_meta($post->ID, self::META_PREFIX . 'new', true)) return; // already sent

        if (self::send_cert_email($post->ID, 'new')) {
            update_post_meta($post->ID, self::META_PREFIX . 'new', current_time('mysql'));
        }
    }

    /* ================= expiry check ================= */

    /**
     * Which reminder thresholds are due for a cert with $days_left until expiry.
     * The ranges double as catch-up logic: if a scheduled run is ever missed
     * (server cron hiccup, downtime), the next run still delivers the reminder
     * instead of skipping it silently.
     */
    private static function due_thresholds($days_left) {
        // Thresholds configurable via EASY Suite → Settings (easy_notification_thresholds
        // option, e.g. "30,7"). Falls back to 30/7 when unset.
        $t1 = 30; $t2 = 7;
        if (function_exists('easy_core_get_notification_thresholds')) {
            $cfg = easy_core_get_notification_thresholds();
            if (!empty($cfg[0])) $t1 = (int) $cfg[0];
            if (!empty($cfg[1])) $t2 = (int) $cfg[1];
        } else {
            $raw = get_option('easy_notification_thresholds', '');
            if (is_string($raw) && trim($raw) !== '') {
                $parts = array_values(array_filter(array_map('intval', explode(',', $raw)),
                    function ($n) { return $n > 0 && $n <= 365; }));
                rsort($parts);
                if (!empty($parts[0])) $t1 = $parts[0];
                if (!empty($parts[1])) $t2 = $parts[1];
            }
        }
        // Ensure t1 > t2 so the ranges don't overlap.
        if ($t1 <= $t2) { $tmp = $t1; $t1 = $t2; $t2 = $tmp; }
        $due = [];
        if ($days_left <= $t1 && $days_left > $t2) $due[] = (string) $t1;
        if ($days_left <= $t2 && $days_left >= 0)  $due[] = (string) $t2;
        if ($days_left < 0)                        $due[] = 'expired';
        return $due;
    }

    private static function threshold_label($key) {
        return $key === 'expired' ? 'expired notice' : "{$key}-day notice";
    }

    /**
     * Scan all certs and return per-cert status rows.
     * When $send is true, actually send due, not-yet-sent notices and record
     * sent-markers in post meta so nothing is ever delivered twice.
     *
     * Returns ['rows' => [...], 'sent' => int, 'failed' => int].
     */
    public static function run_expiry_check($send = false) {
        $rows   = [];
        $sent   = 0;
        $failed = 0;
        $tz     = new DateTimeZone(self::TIMEZONE);
        $today  = new DateTimeImmutable('today', $tz);

        // Import mode: degrade to a dry run — build the rows, send nothing,
        // stamp nothing. Covers the daily cron and the manual admin page.
        if ($send && self::notifications_suppressed()) {
            error_log('Easy Cert Notifications: expiry check suppressed (import mode) — dry run only.');
            $send = false;
        }

        // Stamp every real send run (cron or manual) so the Overview page
        // can show whether the scheduled runs are actually firing.
        if ($send) {
            update_option(self::LAST_EXPIRY_RUN_OPT, current_time('mysql'));
        }

        $certs = get_posts([
            'post_type'      => 'cert',
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'meta_query'     => [['key' => 'expiry_date', 'compare' => 'EXISTS']],
            'meta_key'       => 'expiry_date',
            'orderby'        => 'meta_value',
            'order'          => 'ASC',
        ]);

        foreach ($certs as $cert) {
            $post_id      = $cert->ID;
            $student_name = get_field('student_name', $post_id);
            $course_label = self::course_label($post_id, get_field('course_title', $post_id));
            $expiry_raw   = get_field('expiry_date', $post_id);

            $row = [
                'post_id'   => $post_id,
                'student'   => $student_name ? $student_name : '—',
                'course'    => $course_label ? $course_label : '—',
                'expiry'    => null,
                'days_left' => null,
                'notices'   => [], // each: ['key'=>, 'label'=>, 'state'=>, 'at'=>]
            ];

            if (!empty($expiry_raw)) {
                try {
                    $expiry_dt = new DateTimeImmutable($expiry_raw, $tz);
                    $expiry_dt = new DateTimeImmutable($expiry_dt->format('Y-m-d'), $tz);
                    $days_left = (int) $today->diff($expiry_dt)->format('%r%a');

                    $row['expiry']    = $expiry_dt->format('Y-m-d');
                    $row['days_left'] = $days_left;

                    foreach (self::due_thresholds($days_left) as $key) {
                        $marker  = self::META_PREFIX . $key;
                        $sent_at = get_post_meta($post_id, $marker, true);

                        if ($sent_at) {
                            $row['notices'][] = [
                                'key'   => $key,
                                'label' => self::threshold_label($key),
                                'state' => 'sent',
                                'at'    => $sent_at,
                            ];
                            continue;
                        }

                        if ($send) {
                            $ok = self::send_cert_email(
                                $post_id,
                                $key === 'expired' ? 'expired' : 'threshold',
                                $days_left
                            );
                            if ($ok) {
                                $now = current_time('mysql');
                                update_post_meta($post_id, $marker, $now);
                                $row['notices'][] = [
                                    'key'   => $key,
                                    'label' => self::threshold_label($key),
                                    'state' => 'sent',
                                    'at'    => $now,
                                ];
                                $sent++;
                            } else {
                                $row['notices'][] = [
                                    'key'   => $key,
                                    'label' => self::threshold_label($key),
                                    'state' => 'failed',
                                ];
                                $failed++;
                            }
                        } else {
                            $row['notices'][] = [
                                'key'   => $key,
                                'label' => self::threshold_label($key),
                                'state' => 'due',
                            ];
                        }
                    }
                } catch (Exception $e) {
                    // Unparseable expiry date — leave the row with no notices.
                }
            }

            $rows[] = $row;
        }

        return ['rows' => $rows, 'sent' => $sent, 'failed' => $failed];
    }

    /**
     * Readable course label. Forklift class detail (e.g. "Class 1-4-5") is only
     * stored in the post title, so recover it from there when present.
     */
    private static function course_label($post_id, $course_value) {
        $label = self::$course_labels[$course_value] ?? $course_value;
        if ($course_value === 'counter-balance-forklift') {
            $title = get_the_title($post_id);
            if (is_string($title) && preg_match('/\(Class ([\d-]+)\)/', $title, $m)) {
                $label .= ' (Class ' . $m[1] . ')';
            }
        }
        return $label;
    }

    /* ================= admin: manual check ================= */

    public static function add_manual_check_menu() {
        add_submenu_page(
            'easy-suite',
            'Certificate Expiry Check',
            'Cert Expiry Check',
            'manage_options',
            'easy-cert-check',
            [__CLASS__, 'manual_check_page']
        );
    }

    public static function manual_check_page() {
        if (!current_user_can('manage_options')) {
            wp_die('You do not have permission to access this page.');
        }

        // Sending only happens through this explicit, nonce-protected POST.
        // Simply viewing the page is always a dry run.
        $did_send = false;
        if (isset($_POST['easy_cert_send_now'])) {
            check_admin_referer('easy_cert_manual_send');
            $did_send = true;
        }

        $result = self::run_expiry_check($did_send);
        $rows   = $result['rows'];

        echo '<div class="wrap"><h1>Certificate Expiry Check</h1>';
        easy_suite_admin_tabs('easy-cert-check');

        if ($did_send) {
            echo '<div class="notice notice-success"><p>'
                . esc_html("Send complete: {$result['sent']} sent, {$result['failed']} failed.")
                . '</p></div>';
        } else {
            echo '<div class="notice notice-info"><p>Dry run — nothing is sent from this page until you click the button below.</p></div>';
        }

        if (empty($rows)) {
            echo '<p>No certificates found.</p></div>';
            return;
        }

        echo '<table class="widefat striped"><thead><tr>'
            . '<th>Post ID</th><th>Student</th><th>Course</th>'
            . '<th>Expiry Date</th><th>Days Left</th><th>Notifications</th>'
            . '</tr></thead><tbody>';

        foreach ($rows as $row) {
            $notice_html = [];
            foreach ($row['notices'] as $notice) {
                $text = $notice['label'] . ': ';
                if ($notice['state'] === 'sent' && !empty($notice['at'])) {
                    $text .= 'sent ' . date_i18n('M j, Y', strtotime($notice['at']));
                } else {
                    $text .= $notice['state'];
                }
                $notice_html[] = esc_html($text);
            }

            echo '<tr>'
                . '<td>' . esc_html($row['post_id']) . '</td>'
                . '<td>' . esc_html($row['student']) . '</td>'
                . '<td>' . esc_html($row['course']) . '</td>'
                . '<td>' . esc_html($row['expiry'] ?: 'No expiry date') . '</td>'
                . '<td>' . esc_html($row['days_left'] === null ? 'N/A' : (string) $row['days_left']) . '</td>'
                . '<td>' . (!empty($notice_html) ? implode('<br>', $notice_html) : '—') . '</td>'
                . '</tr>';
        }

        echo '</tbody></table>';

        echo '<form method="post" action="" style="margin-top:16px;">';
        wp_nonce_field('easy_cert_manual_send');
        submit_button('Send due notifications now', 'primary', 'easy_cert_send_now', false);
        echo '<p class="description">Sends every notice marked "due" above. Already-sent notices are never duplicated.</p>';
        echo '</form>';

        $now = new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE));
        echo '<p style="margin-top:8px;font-size:13px;color:#666;">Server (local) time: '
            . esc_html($now->format('Y-m-d H:i:s')) . '</p>';
        echo '</div>';
    }

    /* ================= email ================= */

    private static function send_cert_email($post_id, $type = 'new', $days_left = null) {
        $student_name       = get_field('student_name', $post_id);
        $student_email      = get_field('student_email', $post_id);
        $course_value       = get_field('course_title', $post_id);
        $course_label       = self::course_label($post_id, $course_value);
        $expiry_date        = get_field('expiry_date', $post_id);
        $certificate_number = get_field('certificate_number', $post_id);
        $completion_date    = get_field('completion_date', $post_id);
        $instructor_name    = get_field('instructor', $post_id);

        if (empty($student_email) || !is_email($student_email)) {
            error_log("Easy Cert Notifications: skipping cert #{$post_id} — no valid student email.");
            return false;
        }

        // Escape everything interpolated into the HTML.
        $student_name_e       = esc_html($student_name);
        $course_label_e       = esc_html($course_label);
        $expiry_date_e        = esc_html($expiry_date);
        $certificate_number_e = esc_html($certificate_number);
        $completion_date_e    = esc_html($completion_date);
        $instructor_name_e    = esc_html($instructor_name);
        $logo_url_e           = esc_url(self::LOGO_URL);
        $cert_link_e          = esc_url(self::CERT_PORTAL_URL);
        $renew_url_e          = esc_url(self::course_page_url($course_value));
        $contact_email_e      = esc_html(self::CONTACT_EMAIL);
        $contact_phone_e      = esc_html(self::CONTACT_PHONE);

        // Human-friendly countdown: "today", "1 day", "N days".
        if ($days_left === 0) {
            $h1_countdown   = 'today';
            $body_countdown = 'today';
        } elseif ($days_left == 1) {
            $h1_countdown   = 'in 1 day';
            $body_countdown = 'in 1 day';
        } else {
            $h1_countdown   = 'in ' . (int) $days_left . ' days';
            $body_countdown = 'in ' . (int) $days_left . ' days';
        }
        $h1_countdown_e   = esc_html($h1_countdown);
        $body_countdown_e = esc_html($body_countdown);

        $footer = '
    <tr>
      <td style="background:#f0f3f6;text-align:center;padding:15px;font-size:12px;color:#555;">
        EASY Safety Training &middot; St. John\'s, NL<br>
        <a href="https://easysafety.ca/privacy-policy/" style="font-size:11px;color:#12853C;">Privacy Policy</a><br>
        <span style="font-size:11px;color:#777;">You&rsquo;re receiving this because you completed safety training with us.</span>
      </td>
    </tr>';

        switch ($type) {
            case 'new':
                $subject = "Congratulations! Your {$course_label} Certificate is Ready";
                $message = '
<div style="font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:0; background:#f5f7fa; padding:40px 0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your '.$course_label_e.' certificate is ready.</div>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"
         style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;
                box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="padding:30px 40px 10px 40px; text-align:center;">
        <img src="'.$logo_url_e.'" alt="Easy Safety Logo" width="170"
             style="display:block;margin:0 auto 10px auto;">
        <h1 style="margin:0;font-size:24px;color:#12853C;font-weight:700;">
          Your Certificate is Ready!
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px 30px 40px;">
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Dear <strong>'.$student_name_e.'</strong>,
        </p>
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Congratulations on completing <strong>'.$course_label_e.'</strong>!
          We have created your certificate, which you will be able to access online with a valid account at easysafety.ca within 24 hours.
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr>
            <td style="background:#f0f3f6;padding:15px 20px;border-radius:8px;">
              <p style="margin:6px 0;font-size:15px;"><strong>Certificate Number:</strong> '.$certificate_number_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Completion Date:</strong> '.$completion_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Expiry Date:</strong> '.$expiry_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Instructor:</strong> '.$instructor_name_e.'</p>
            </td>
          </tr>
        </table>
        <div style="text-align:center; margin:30px 0;">
          <a href="'.$cert_link_e.'" style="background:#12853C;color:#ffffff;text-decoration:none;
             padding:14px 28px;font-size:16px;font-weight:bold;border-radius:6px;display:inline-block;">
            View My Certificates
          </a>
        </div>
        <p style="font-size:15px; line-height:1.6; color:#444; margin-top:30px;">
          Questions? Contact us at
          <a href="mailto:'.$contact_email_e.'" style="color:#12853C;text-decoration:none;">
            '.$contact_email_e.'
          </a> or call '.$contact_phone_e.'.
        </p>
      </td>
    </tr>'
    . $footer . '
  </table>
</div>';
                $plain = "Dear {$student_name},\n\n"
                    . "Congratulations on completing {$course_label}!\n"
                    . "Your certificate is ready. You can access it online with a valid account at easysafety.ca:\n"
                    . self::CERT_PORTAL_URL . "\n\n"
                    . "Certificate Number: {$certificate_number}\n"
                    . "Completion Date: {$completion_date}\n"
                    . "Expiry Date: {$expiry_date}\n"
                    . "Instructor: {$instructor_name}\n\n"
                    . "Questions? Contact us at " . self::CONTACT_EMAIL . " or call " . self::CONTACT_PHONE . ".\n\n"
                    . "EASY Safety Training · St. John's, NL\n"
                    . "Privacy Policy: https://easysafety.ca/privacy-policy/\n"
                    . "You're receiving this because you completed safety training with us.\n";
                break;

            case 'threshold':
                $subject = "Reminder: Your {$course_label} certificate expires " . self::short_date($expiry_date);
                $message = '
<div style="font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:0; background:#f5f7fa; padding:40px 0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your '.$course_label_e.' certificate expires '.$expiry_date_e.'. Renew today.</div>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"
         style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;
                box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="padding:30px 40px 10px 40px; text-align:center;">
        <img src="'.$logo_url_e.'" alt="Easy Safety Logo" width="170"
             style="display:block;margin:0 auto 10px auto;">
        <h1 style="margin:0;font-size:24px;color:#12853C;font-weight:700;">
          Your certificate expires '.$h1_countdown_e.'
        </h1>
        <p style="margin:8px 0 0 0;font-size:15px;color:#555;">'.$course_label_e.' &middot; expires '.$expiry_date_e.'</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px 30px 40px;">
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Dear <strong>'.$student_name_e.'</strong>,
        </p>
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          This is a friendly reminder that your <strong>'.$course_label_e.'</strong> certificate will expire <strong>'.$body_countdown_e.'</strong> on <strong>'.$expiry_date_e.'</strong>.
          To avoid any lapse in certification, please make arrangements to renew your training before the expiry date.
        </p>
        <p style="font-size:14px; line-height:1.6; color:#666; margin:0 0 16px 0;">
          Already rebooked? You&rsquo;re all set: this notice may have crossed paths with your booking.
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr>
            <td style="background:#f0f3f6;padding:15px 20px;border-radius:8px;">
              <p style="margin:6px 0;font-size:15px;"><strong>Certificate Number:</strong> '.$certificate_number_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Completion Date:</strong> '.$completion_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Expiry Date:</strong> '.$expiry_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Instructor:</strong> '.$instructor_name_e.'</p>
            </td>
          </tr>
        </table>
        <div style="text-align:center; margin:30px 0 10px 0;">
          <a href="'.$renew_url_e.'" style="background:#12853C;color:#ffffff;text-decoration:none;
             padding:14px 28px;font-size:16px;font-weight:bold;border-radius:6px;display:inline-block;">
            Book Renewal Training
          </a>
        </div>
        <p style="text-align:center;font-size:13px;color:#777;margin:0 0 10px 0;">
          or <a href="'.$cert_link_e.'" style="color:#12853C;text-decoration:none;">view your certificates</a>
        </p>
        <p style="font-size:15px; line-height:1.6; color:#444; margin-top:30px;">
          Questions? Contact us at
          <a href="mailto:'.$contact_email_e.'" style="color:#12853C;text-decoration:none;">'.$contact_email_e.'</a> or call '.$contact_phone_e.'.
        </p>
      </td>
    </tr>'
    . $footer . '
  </table>
</div>';
                $plain = "Dear {$student_name},\n\n"
                    . "This is a friendly reminder that your {$course_label} certificate will expire {$body_countdown} on {$expiry_date}.\n"
                    . "To avoid any lapse in certification, please make arrangements to renew your training before the expiry date.\n"
                    . "Already rebooked? You're all set: this notice may have crossed paths with your booking.\n\n"
                    . "Book renewal training: " . self::course_page_url($course_value) . "\n"
                    . "Or view your certificates: " . self::CERT_PORTAL_URL . "\n\n"
                    . "Certificate Number: {$certificate_number}\n"
                    . "Completion Date: {$completion_date}\n"
                    . "Expiry Date: {$expiry_date}\n"
                    . "Instructor: {$instructor_name}\n\n"
                    . "Questions? Contact us at " . self::CONTACT_EMAIL . " or call " . self::CONTACT_PHONE . ".\n\n"
                    . "EASY Safety Training \u{00B7} St. John's, NL\n"
                    . "Privacy Policy: https://easysafety.ca/privacy-policy/\n"
                    . "You're receiving this because you completed safety training with us.\n";
                break;

            case 'expired':
                $subject = "Your {$course_label} certificate expired " . self::short_date($expiry_date);
                $message = '
<div style="font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:0; background:#f5f7fa; padding:40px 0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your '.$course_label_e.' certificate has expired. Renew today.</div>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"
         style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;
                box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="padding:30px 40px 10px 40px; text-align:center;">
        <img src="'.$logo_url_e.'" alt="Easy Safety Logo" width="170"
             style="display:block;margin:0 auto 10px auto;">
        <h1 style="margin:0;font-size:24px;color:#12853C;font-weight:700;">
          Your Certificate Has Expired
        </h1>
        <p style="margin:8px 0 0 0;font-size:15px;color:#555;">'.$course_label_e.' &middot; expired '.$expiry_date_e.'</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px 30px 40px;">
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Dear <strong>'.$student_name_e.'</strong>,
        </p>
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Your <strong>'.$course_label_e.'</strong> certificate expired on <strong>'.$expiry_date_e.'</strong>. Please complete renewal training as soon as possible.
        </p>
        <p style="font-size:14px; line-height:1.6; color:#666; margin:0 0 16px 0;">
          Already rebooked? You&rsquo;re all set: this notice may have crossed paths with your booking.
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr>
            <td style="background:#f0f3f6;padding:15px 20px;border-radius:8px;">
              <p style="margin:6px 0;font-size:15px;"><strong>Certificate Number:</strong> '.$certificate_number_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Completion Date:</strong> '.$completion_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Expiry Date:</strong> '.$expiry_date_e.'</p>
              <p style="margin:6px 0;font-size:15px;"><strong>Instructor:</strong> '.$instructor_name_e.'</p>
            </td>
          </tr>
        </table>
        <div style="text-align:center; margin:30px 0 10px 0;">
          <a href="'.$renew_url_e.'" style="background:#12853C;color:#ffffff;text-decoration:none;
             padding:14px 28px;font-size:16px;font-weight:bold;border-radius:6px;display:inline-block;">
            Book Renewal Training
          </a>
        </div>
        <p style="text-align:center;font-size:13px;color:#777;margin:0 0 10px 0;">
          or <a href="'.$cert_link_e.'" style="color:#12853C;text-decoration:none;">view your certificates</a>
        </p>
        <p style="font-size:15px; line-height:1.6; color:#444; margin-top:30px;">
          Questions? Contact us at
          <a href="mailto:'.$contact_email_e.'" style="color:#12853C;text-decoration:none;">'.$contact_email_e.'</a> or call '.$contact_phone_e.'.
        </p>
      </td>
    </tr>'
    . $footer . '
  </table>
</div>';
                $plain = "Dear {$student_name},\n\n"
                    . "Your {$course_label} certificate expired on {$expiry_date}. Please complete renewal training as soon as possible.\n"
                    . "Already rebooked? You're all set: this notice may have crossed paths with your booking.\n\n"
                    . "Book renewal training: " . self::course_page_url($course_value) . "\n"
                    . "Or view your certificates: " . self::CERT_PORTAL_URL . "\n\n"
                    . "Certificate Number: {$certificate_number}\n"
                    . "Completion Date: {$completion_date}\n"
                    . "Expiry Date: {$expiry_date}\n"
                    . "Instructor: {$instructor_name}\n\n"
                    . "Questions? Contact us at " . self::CONTACT_EMAIL . " or call " . self::CONTACT_PHONE . ".\n\n"
                    . "EASY Safety Training \u{00B7} St. John's, NL\n"
                    . "Privacy Policy: https://easysafety.ca/privacy-policy/\n"
                    . "You're receiving this because you completed safety training with us.\n";
                break;

            default:
                return false;
        }

        $headers = [
            'Content-Type: text/html; charset=UTF-8',
            'From: ' . self::FROM_NAME . ' <' . self::FROM_EMAIL . '>',
            'Reply-To: ' . self::CONTACT_EMAIL,
        ];

        $mailed = false;
        self::$alt_body = $plain ?? null;
        try {
            $mailed = wp_mail($student_email, $subject, $message, $headers);
        } finally {
            self::$alt_body = null;
        }
        if (!$mailed) {
            error_log("Easy Cert Notifications: wp_mail failed for cert #{$post_id} ({$student_email}).");
        }
        return (bool) $mailed;
    }

    /* ================= employer digest ================= */

    public static function employer_cron_handler() {
        self::run_employer_digest(true);
    }

    /**
     * Completion-date safety net for the employer digest (v2.4).
     *
     * The digest only covers certs completed within the grace window
     * before the activation cutoff. This closes the residual bulk-import
     * gap: an import that creates posts with fresh post dates but
     * historical completion dates can't smuggle old certs into employer
     * inboxes. Legitimate late entries (class last month, cert entered
     * today) still flow through.
     *
     * Fail-open by design: a missing or unparseable completion date
     * INCLUDES the cert (and logs a line) so a weird date can never
     * silently eat a real notification.
     */
    private static function completion_within_grace_window($post_id, $since) {
        $raw = get_field('completion_date', $post_id);
        if (empty($raw) || !is_string($raw)) {
            return true;
        }
        $tz = new DateTimeZone(self::TIMEZONE);
        $completed = DateTimeImmutable::createFromFormat('!F j, Y', trim($raw), $tz);
        if (!$completed) {
            $completed = DateTimeImmutable::createFromFormat('!Y-m-d', trim($raw), $tz);
        }
        if (!$completed) {
            error_log("Easy Cert Notifications: digest cert #{$post_id} has unparseable completion date '{$raw}' — including (fail open).");
            return true;
        }
        try {
            $earliest = (new DateTimeImmutable($since, $tz))
                ->sub(new DateInterval('P' . self::DIGEST_COMPLETION_GRACE_DAYS . 'D'));
        } catch (Exception $e) {
            return true;
        }
        if ($completed < $earliest) {
            error_log("Easy Cert Notifications: digest cert #{$post_id} completion date '{$raw}' is older than the grace window — skipped.");
            return false;
        }
        return true;
    }

    /**
     * Batched employer notifications.
     *
     * Finds published certs (newer than the activation cutoff) that have a
     * valid company-contact email and haven't been employer-notified yet,
     * groups them by email address, and sends ONE email per company no matter
     * how many employees were certified. Each sent cert is stamped so it is
     * never included again.
     *
     * When $send is false, only builds the groups (dry run for the admin page).
     *
     * Returns ['groups' => [...], 'sent' => int, 'failed' => int, 'skipped' => int].
     */
    public static function run_employer_digest($send = false) {
        $since = get_option(self::EMPLOYER_SINCE_OPT, '2000-01-01 00:00:00');

        // Import mode: degrade to a dry run — build the groups, send nothing,
        // stamp nothing. Covers the twice-daily cron and the manual page.
        if ($send && self::notifications_suppressed()) {
            error_log('Easy Cert Notifications: employer digest suppressed (import mode) — dry run only.');
            $send = false;
        }

        // Stamp every real send run (cron or manual) so the Overview page
        // can show whether the scheduled runs are actually firing.
        if ($send) {
            update_option(self::LAST_DIGEST_RUN_OPT, current_time('mysql'));
        }

        $q = new WP_Query([
            'post_type'      => 'cert',
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'no_found_rows'  => true,
            'date_query'     => [['after' => $since, 'inclusive' => true]],
            'meta_query'     => [[
                'key'     => self::EMPLOYER_META,
                'compare' => 'NOT EXISTS',
            ]],
        ]);

        $groups  = []; // lowercase email => [post ids]
        $skipped = 0;
        foreach ($q->posts as $post_id) {
            $email = get_field('company_contact', $post_id);
            if (empty($email) || !is_email($email)) {
                $skipped++;
                continue;
            }
            // Completion-date safety net (v2.4): a bulk import that stamps
            // fresh post dates can't smuggle ancient certs into the digest.
            // Legitimate late entries (class last month, cert entered today)
            // still flow through; unparseable dates fail OPEN (see helper).
            if (!self::completion_within_grace_window($post_id, $since)) {
                $skipped++;
                continue;
            }
            $key = strtolower(trim($email));
            $groups[$key][] = (int) $post_id;
        }

        $sent   = 0;
        $failed = 0;
        $summary = [];
        foreach ($groups as $email => $post_ids) {
            $company = get_field('company', $post_ids[0]);
            $summary[] = [
                'email'    => $email,
                'company'  => $company,
                'count'    => count($post_ids),
                'post_ids' => $post_ids,
            ];
            if (!$send) {
                continue;
            }
            if (self::send_employer_email($email, $post_ids)) {
                $sent++;
                foreach ($post_ids as $pid) {
                    update_post_meta($pid, self::EMPLOYER_META, current_time('mysql'));
                }
            } else {
                $failed++;
                error_log("Easy Cert Notifications: employer digest failed for {$email} (" . count($post_ids) . " certs).");
            }
        }

        return ['groups' => $summary, 'sent' => $sent, 'failed' => $failed, 'skipped' => $skipped];
    }

    /**
     * Build and send one employer digest email.
     *
     * Attaches the actual certificate PDFs: a single PDF is attached directly;
     * multiple PDFs are bundled into one zip so a 12-person class doesn't
     * arrive as 12 attachments. Certs without a stored PDF still appear in
     * the summary table.
     */
    private static function send_employer_email($email, $post_ids) {
        $company = '';
        $rows_html = '';
        $rows_text = '';
        $pdf_paths = [];

        foreach ($post_ids as $post_id) {
            $c = get_field('company', $post_id);
            if (empty($company) && !empty($c)) {
                $company = $c;
            }
            $t_name = get_field('student_name', $post_id);
            $t_course = self::course_label($post_id, get_field('course_title', $post_id));
            $t_completed = get_field('completion_date', $post_id);
            $t_expiry = get_field('expiry_date', $post_id);
            $t_cert = get_field('certificate_number', $post_id);
            $rows_text .= "- {$t_name} — {$t_course} (completed {$t_completed}, expires {$t_expiry}, cert #{$t_cert})\n";
            $rows_html .= '<tr>'
                . '<td style="padding:8px 10px;border-bottom:1px solid #e5e9ef;font-size:14px;">' . esc_html(get_field('student_name', $post_id)) . '</td>'
                . '<td style="padding:8px 10px;border-bottom:1px solid #e5e9ef;font-size:14px;">' . esc_html(self::course_label($post_id, get_field('course_title', $post_id))) . '</td>'
                . '<td style="padding:8px 10px;border-bottom:1px solid #e5e9ef;font-size:14px;">' . esc_html(get_field('completion_date', $post_id)) . '</td>'
                . '<td style="padding:8px 10px;border-bottom:1px solid #e5e9ef;font-size:14px;">' . esc_html(get_field('expiry_date', $post_id)) . '</td>'
                . '<td style="padding:8px 10px;border-bottom:1px solid #e5e9ef;font-size:14px;">' . esc_html(get_field('certificate_number', $post_id)) . '</td>'
                . '</tr>';

            // The 'certificate' ACF file field can return an ID, a URL, or a file
            // array depending on the field group's return format, so normalize
            // it to an attachment ID before resolving the file path.
            $cert_val = get_field('certificate', $post_id);
            $att_id = 0;
            if (is_numeric($cert_val)) {
                $att_id = (int) $cert_val;
            } elseif (is_array($cert_val) && !empty($cert_val['id'])) {
                $att_id = (int) $cert_val['id'];
            } elseif (is_string($cert_val) && $cert_val !== '') {
                $att_id = attachment_url_to_postid($cert_val);
            }
            if ($att_id > 0 && get_post_mime_type($att_id) === 'application/pdf') {
                $path = get_attached_file($att_id);
                if ($path && file_exists($path)) {
                    $pdf_paths[$post_id] = $path;
                } else {
                    error_log("Easy Cert Notifications: employer digest cert #{$post_id} attachment #{$att_id} file missing on disk.");
                }
            } elseif ($att_id > 0) {
                error_log("Easy Cert Notifications: employer digest cert #{$post_id} attachment #{$att_id} is not a PDF.");
            } else {
                error_log("Easy Cert Notifications: employer digest cert #{$post_id} has no certificate file stored.");
            }
        }

        // Attachments: one PDF goes on directly; several get zipped together.
        $attachments = [];
        $temp_zip = null;
        if (count($pdf_paths) === 1) {
            $attachments[] = reset($pdf_paths);
        } elseif (count($pdf_paths) > 1) {
            if (class_exists('ZipArchive')) {
                $temp_zip = get_temp_dir() . 'easy-certs-' . date('Ymd-His') . '-' . wp_generate_password(8, false) . '.zip';
                $zip = new ZipArchive();
                if ($zip->open($temp_zip, ZipArchive::CREATE) === true) {
                    foreach ($pdf_paths as $pid => $path) {
                        // Prefix with the post ID so same-named files can't collide.
                        $zip->addFile($path, $pid . '-' . basename($path));
                    }
                    $zip->close();
                    $attachments[] = $temp_zip;
                } else {
                    $attachments = array_values($pdf_paths); // fall back to direct
                }
            } else {
                $attachments = array_values($pdf_paths); // no ZipArchive available
            }
        }

        $greeting_e      = esc_html($company ?: 'there');
        $logo_url_e      = esc_url(self::LOGO_URL);
        $contact_email_e = esc_html(self::CONTACT_EMAIL);
        $contact_phone_e = esc_html(self::CONTACT_PHONE);
        $count           = count($post_ids);
        $cert_word       = ($count === 1) ? 'certificate' : 'certificates';
        $attach_note     = '';
        if (!empty($attachments)) {
            $attach_note = '<p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">'
                . ($count === 1 ? 'A copy of the certificate is' : 'Copies of the certificates are')
                . ' attached to this email.</p>';
        }

        $subject = "Certificate copies for your team — EASY Safety Training";

        $message = '
<div style="font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:0; background:#f5f7fa; padding:40px 0;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"
         style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;
                box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="padding:30px 40px 10px 40px; text-align:center;">
        <img src="'.$logo_url_e.'" alt="Easy Safety Logo" width="170"
             style="display:block;margin:0 auto 10px auto;">
        <h1 style="margin:0;font-size:24px;color:#12853C;font-weight:700;">
          Your Team&rsquo;s Certificates Are Ready
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px 30px 40px;">
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Dear <strong>'.$greeting_e.'</strong>,
        </p>
        <p style="font-size:16px; line-height:1.6; margin:0 0 16px 0;">
          Following recent training with EASY Safety Training, please find below
          a summary of '.$count.' new employee '.$cert_word.'.
        </p>
        <p style="font-size:14px; line-height:1.6; color:#666; margin:0 0 16px 0;">
          If any details below look off, just reply to this email and we&rsquo;ll sort it out.
        </p>'
        . $attach_note . '
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;background:#f0f3f6;font-size:13px;">Employee</th>
              <th style="text-align:left;padding:8px 10px;background:#f0f3f6;font-size:13px;">Course</th>
              <th style="text-align:left;padding:8px 10px;background:#f0f3f6;font-size:13px;">Completed</th>
              <th style="text-align:left;padding:8px 10px;background:#f0f3f6;font-size:13px;">Expires</th>
              <th style="text-align:left;padding:8px 10px;background:#f0f3f6;font-size:13px;">Cert #</th>
            </tr>
          </thead>
          <tbody>'
          . $rows_html . '
          </tbody>
        </table>
        <p style="font-size:15px; line-height:1.6; color:#444; margin-top:30px;">
          Questions? Contact us at
          <a href="mailto:'.$contact_email_e.'" style="color:#12853C;text-decoration:none;">
            '.$contact_email_e.'
          </a> or call '.$contact_phone_e.'.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f0f3f6;text-align:center;padding:15px;font-size:12px;color:#555;">
        EASY Safety Training &middot; St. John\'s, NL<br>
        <a href="https://easysafety.ca/privacy-policy/" style="font-size:11px;color:#12853C;">Privacy Policy</a><br>
        <span style="font-size:11px;color:#777;">You&rsquo;re receiving this because your organization was listed as the employer contact for these certifications.</span>
      </td>
    </tr>
  </table>
</div>';

        $headers = [
            'Content-Type: text/html; charset=UTF-8',
            'From: ' . self::FROM_NAME . ' <' . self::FROM_EMAIL . '>',
            'Reply-To: ' . self::CONTACT_EMAIL,
        ];

        $plain = "Dear " . ($company ?: 'there') . ",\n\n"
            . "Following recent training with EASY Safety Training, please find below\n"
            . "a summary of {$count} new employee {$cert_word}.\n"
            . "If any details below look off, just reply to this email and we'll sort it out.\n\n"
            . $rows_text . "\n"
            . "Questions? Contact us at " . self::CONTACT_EMAIL . " or call " . self::CONTACT_PHONE . ".\n\n"
            . "EASY Safety Training · St. John's, NL\n"
            . "Privacy Policy: https://easysafety.ca/privacy-policy/\n"
            . "You're receiving this because your organization was listed as the employer contact for these certifications.\n";

        $mailed = false;
        self::$alt_body = $plain;
        try {
            $mailed = wp_mail($email, $subject, $message, $headers, $attachments);
        } finally {
            self::$alt_body = null;
        }

        // Always clean up the temp zip.
        if ($temp_zip && file_exists($temp_zip)) {
            unlink($temp_zip);
        }
        if (!$mailed) {
            error_log("Easy Cert Notifications: employer wp_mail failed for {$email}.");
        }
        return (bool) $mailed;
    }

    /* ================= admin: employer digest ================= */

    public static function add_employer_digest_menu() {
        add_submenu_page(
            'easy-suite',
            'Employer Certificate Digest',
            'Employer Digest',
            'manage_options',
            'easy-employer-digest',
            [__CLASS__, 'employer_digest_page']
        );
    }

    public static function employer_digest_page() {
        if (!current_user_can('manage_options')) {
            wp_die('You do not have permission to access this page.');
        }

        // Sending only happens through this explicit, nonce-protected POST.
        // Simply viewing the page is always a dry run.
        $did_send = false;
        if (isset($_POST['easy_employer_send_now'])) {
            check_admin_referer('easy_employer_manual_send');
            $did_send = true;
        }

        $result = self::run_employer_digest($did_send);
        $groups = $result['groups'];

        echo '<div class="wrap"><h1>Employer Certificate Digest</h1>';
        easy_suite_admin_tabs('easy-employer-digest');

        if ($did_send) {
            echo '<div class="notice notice-success"><p>'
                . esc_html("Send complete: {$result['sent']} sent, {$result['failed']} failed, {$result['skipped']} certs skipped (no valid company email, or completion date outside the digest window).")
                . '</p></div>';
        } else {
            echo '<div class="notice notice-info"><p>Dry run — nothing is sent from this page until you click the button below. One email goes out per company, no matter how many employees were certified.</p></div>';
        }

        if (empty($groups)) {
            echo '<p>No pending employer notifications. Certs appear here when they are published with a valid company-contact email and haven&rsquo;t been included in a digest yet.</p></div>';
            return;
        }

        echo '<table class="widefat striped"><thead><tr>'
            . '<th>Company email</th><th>Company</th><th>Certs</th><th>Post IDs</th>'
            . '</tr></thead><tbody>';

        foreach ($groups as $g) {
            echo '<tr>'
                . '<td>' . esc_html($g['email']) . '</td>'
                . '<td>' . esc_html($g['company'] ?: '—') . '</td>'
                . '<td>' . esc_html((string) $g['count']) . '</td>'
                . '<td>' . esc_html(implode(', ', $g['post_ids'])) . '</td>'
                . '</tr>';
        }

        echo '</tbody></table>';

        echo '<form method="post" action="" style="margin-top:16px;">';
        wp_nonce_field('easy_employer_manual_send');
        submit_button('Send employer digests now', 'primary', 'easy_employer_send_now', false);
        echo '<p class="description">Sends one email per company above, with certificate PDFs attached (zipped when more than one). Already-sent digests are never duplicated.</p>';
        echo '</form>';
        echo '</div>';
    }
}

Easy_Safety_Cert_Notifications::init();

