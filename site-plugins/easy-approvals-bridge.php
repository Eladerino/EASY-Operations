<?php
/**
 * Plugin Name: EASY Approvals Bridge
 * Description: Exposes UltimateMember's pending-approval queue to the EASY Operations desktop app. All endpoints require the promote_users capability.
 * Version: 1.0.0
 * Author: EASY Safety Training
 */

defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
    register_rest_route('easy/v1', '/pending-users', [
        'methods'             => 'GET',
        'callback'            => 'easy_approvals_list_pending',
        'permission_callback' => 'easy_approvals_can_review',
    ]);
    register_rest_route('easy/v1', '/pending-users/(?P<id>\d+)/approve', [
        'methods'             => 'POST',
        'callback'            => 'easy_approvals_approve',
        'permission_callback' => 'easy_approvals_can_review',
        'args'                => [
            'id' => [
                'validate_callback' => function ($param) {
                    return (int) $param > 0;
                },
            ],
        ],
    ]);
    register_rest_route('easy/v1', '/pending-users/(?P<id>\d+)/reject', [
        'methods'             => 'POST',
        'callback'            => 'easy_approvals_reject',
        'permission_callback' => 'easy_approvals_can_review',
        'args'                => [
            'id' => [
                'validate_callback' => function ($param) {
                    return (int) $param > 0;
                },
            ],
        ],
    ]);
});

/**
 * Only accounts that can manage users may see or touch the queue.
 * Instructors and other low-privilege accounts are rejected here.
 */
function easy_approvals_can_review() {
    return current_user_can('promote_users');
}

function easy_approvals_pending_users() {
    return get_users([
        'meta_key'   => 'account_status',
        'meta_value' => 'awaiting_admin_review',
        'number'     => 100,
        'orderby'    => 'user_registered',
        'order'      => 'ASC',
    ]);
}

/**
 * Minimal fields only: id, display name, email, signup date.
 */
function easy_approvals_list_pending() {
    $out = [];
    foreach (easy_approvals_pending_users() as $u) {
        $out[] = [
            'id'         => $u->ID,
            'name'       => $u->display_name,
            'email'      => $u->user_email,
            'registered' => $u->user_registered,
        ];
    }
    return $out;
}

/**
 * Shared guard for approve/reject: target must exist, must currently be
 * awaiting review, and must not be an administrator.
 */
function easy_approvals_target_or_error($id) {
    $id   = (int) $id;
    $user = get_userdata($id);
    if (!$user) {
        return new WP_Error('easy_no_user', 'User not found.', ['status' => 404]);
    }
    if (get_user_meta($id, 'account_status', true) !== 'awaiting_admin_review') {
        return new WP_Error('easy_bad_status', 'That account is not awaiting review.', ['status' => 409]);
    }
    if (user_can($id, 'manage_options')) {
        return new WP_Error('easy_no_admin', 'Administrator accounts cannot be changed here.', ['status' => 403]);
    }
    return $user;
}

function easy_approvals_clear_um_cache($id) {
    delete_option('um_cache_userdata_' . (int) $id);
}

function easy_approvals_approve($request) {
    $user = easy_approvals_target_or_error($request['id']);
    if (is_wp_error($user)) {
        return $user;
    }
    $id = $user->ID;

    // Prefer UltimateMember's own routine so its emails/hooks fire;
    // fall back to a direct meta update if UM is unavailable.
    $done = false;
    if (function_exists('um_fetch_user')) {
        um_fetch_user($id);
        $um_user = UM()->user();
        if (is_object($um_user) && method_exists($um_user, 'approve')) {
            $um_user->approve();
            $done = true;
        }
    }
    if (!$done) {
        update_user_meta($id, 'account_status', 'approved');
    }
    easy_approvals_clear_um_cache($id);
    return ['ok' => true, 'id' => $id, 'status' => 'approved'];
}

function easy_approvals_reject($request) {
    $user = easy_approvals_target_or_error($request['id']);
    if (is_wp_error($user)) {
        return $user;
    }
    $id = $user->ID;
    update_user_meta($id, 'account_status', 'rejected');
    easy_approvals_clear_um_cache($id);
    return ['ok' => true, 'id' => $id, 'status' => 'rejected'];
}
