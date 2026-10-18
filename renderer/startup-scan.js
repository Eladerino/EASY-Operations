// Startup attention scan: populate the badge counts shortly after launch
// so the app never looks falsely "all clear". Runs once, in the
// background, after the config check passes. Permission probes gate each
// badge; failures stay silent (the queue shows its own error when opened).
(function () {
  'use strict';

  function setBadge(kind, n) {
    if (window.EasyApprovalBadges) window.EasyApprovalBadges.set(kind, n);
  }

  async function scanCertApprovals() {
    try {
      const p = await window.easyCert.certApprovals.probe();
      const n = p && p.ok && p.canReview ? p.count || 0 : 0;
      if (p && p.ok && p.canReview) setBadge('certs', n);
    } catch (err) { /* probe failed: badge stays at zero */ }
  }

  async function scanAccountApprovals() {
    try {
      const p = await window.easyCert.approvals.probe();
      const n = p && p.ok && p.canReview ? p.count || 0 : 0;
      if (p && p.ok && p.canReview) setBadge('accounts', n);
    } catch (err) { /* probe failed: badge stays at zero */ }
  }

  async function scanExpiring() {
    try {
      if (window.EasyCertTools && window.EasyCertTools.prime) {
        await window.EasyCertTools.prime();
      }
    } catch (err) { /* prime failed: the tools tab shows its own state */ }
  }

  async function scanClassApprovals() {
    try {
      // Instructors have no class queue (the sub-tab is hidden for them),
      // so there is nothing to count.
      if (window.EasyPerms && !window.EasyPerms.privileged) {
        return;
      }
      if (window.EasyClassApprovals && window.EasyClassApprovals.primeBadge) {
        await window.EasyClassApprovals.primeBadge();
      }
    } catch (err) { /* probe failed: badge stays at zero */ }
  }

  async function run() {
    // The scan fires after an IPC round-trip, which can resolve before
    // DOMContentLoaded — but some globals (e.g. EasyCertTools) are only
    // set in DOMContentLoaded inits. Wait for readiness first.
    if (document.readyState === 'loading') {
      await new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true })
      );
    }
    await Promise.allSettled([scanCertApprovals(), scanAccountApprovals(), scanClassApprovals(), scanExpiring()]);
  }

  window.EasyStartupScan = { run };
})();
