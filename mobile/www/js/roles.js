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
  // Handpicked-list flags from the Suite's app-config (2.2.53+): the
  // site handpicks people for specific functions, and those grants do
  // not always show up as a capability this file would think to check.
  let flags = {};

  function has(cap) {
    return Boolean(caps && caps[cap]);
  }

  const RULES = {
    // Management queue, site health, site-wide activity log.
    queue: () => has('manage_options'),
    siteHealth: () => has('manage_options'),
    siteActivity: () => has('manage_options'),
    // Account signups (approve/reject): the capability, or the
    // handpicked account approvers list.
    accounts: () => has('promote_users') || Boolean(flags.accountApprover),
    // Publishing certificate drafts: admins, the office proxy posters,
    // and the handpicked certificate publishers.
    publishCerts: () => has('manage_options') || has('publish_posts') || proxyPoster || Boolean(flags.certPublisher),
    // Publishing class drafts.
    classDrafts: () => has('manage_options') || has('publish_tribe_events'),
    // Full class rosters carry student contact details: office, plus
    // the handpicked Schedule editors (the Suite lets them read
    // rosters so they can manage their classes).
    rosters: () => has('manage_options') || proxyPoster || Boolean(flags.scheduleEditor),
    // Practical evaluations for online courses: anyone who signs
    // certificates. The Suite narrows instructors to their own times.
    practicals: () => has('manage_options') || has('edit_posts') || proxyPoster,
    // Listing shop products for review: handpicked accounts only.
    listProduct: () => Boolean(flags.productLister),
    // The Approvals tab, when any of its queues applies.
    approvals: () => RULES.publishCerts() || RULES.accounts() || RULES.classDrafts(),
  };

  function can(key) {
    if (caps === null) return true;
    const rule = RULES[key];
    return rule ? Boolean(rule()) : true;
  }

  function set(nextCaps, nextProxyPoster, nextFlags) {
    caps = nextCaps && typeof nextCaps === 'object' && Object.keys(nextCaps).length ? nextCaps : null;
    proxyPoster = Boolean(nextProxyPoster);
    flags = nextFlags && typeof nextFlags === 'object' ? nextFlags : {};
  }

  function reset() {
    caps = null;
    proxyPoster = false;
    flags = {};
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
