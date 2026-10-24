// roles.js: what the signed-in account can do, and which screens show.
//
// The same app serves management accounts (everything) and everyday
// staff such as instructors (their classes, their certificates, the
// schedule). Capabilities come from the sign-in probe
// (/wp/v2/users/me?context=edit) plus the Suite's app-config
// (proxyPoster, for office staff who publish on others' behalf). The
// site enforces every permission on its own; this only decides what to
// show, so a screen someone cannot use is hidden instead of failing.
//
// Elements carrying data-role="<key>" are shown only when can(key).
(function () {
  'use strict';

  let caps = null; // null = unknown: show everything, as before roles
  let proxyPoster = false;

  function has(cap) {
    return Boolean(caps && caps[cap]);
  }

  const RULES = {
    // Management queue, site health, site-wide activity log.
    queue: () => has('manage_options'),
    siteHealth: () => has('manage_options'),
    siteActivity: () => has('manage_options'),
    // Account signups (approve/reject).
    accounts: () => has('promote_users'),
    // Publishing certificate drafts: admins and the office proxy posters.
    publishCerts: () => has('manage_options') || has('publish_posts') || proxyPoster,
    // Publishing class drafts.
    classDrafts: () => has('manage_options') || has('publish_tribe_events'),
    // Full class rosters carry student contact details: office only.
    rosters: () => has('manage_options') || proxyPoster,
    // The Approvals tab, when any of its queues applies.
    approvals: () => RULES.publishCerts() || RULES.accounts() || RULES.classDrafts(),
  };

  function can(key) {
    if (caps === null) return true;
    const rule = RULES[key];
    return rule ? Boolean(rule()) : true;
  }

  function set(nextCaps, nextProxyPoster) {
    caps = nextCaps && typeof nextCaps === 'object' && Object.keys(nextCaps).length ? nextCaps : null;
    proxyPoster = Boolean(nextProxyPoster);
  }

  function reset() {
    caps = null;
    proxyPoster = false;
  }

  // True when the account sees the management screens at all.
  function isManager() {
    return can('queue');
  }

  function apply(root) {
    const scope = root || document;
    for (const node of scope.querySelectorAll('[data-role]')) {
      node.classList.toggle('role-hidden', !can(node.dataset.role));
    }
  }

  window.EasyRoles = { can, set, reset, apply, isManager, RULES };
})();
