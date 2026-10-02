// Startup attention scan: populate the badge counts shortly after launch
// so the app never looks falsely "all clear". Runs once, in the
// background, after the config check passes. Permission probes gate each
// badge; failures are silent in the UI but logged to the console (visible
// in the terminal when launched via npm start) for diagnostics.
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
      console.log(`[startup-scan] certificate approvals badge: ${n} (canReview=${!!(p && p.canReview)})`);
    } catch (err) {
      console.warn('[startup-scan] certificate approvals probe failed:', err && err.message);
    }
  }

  async function scanAccountApprovals() {
    try {
      const p = await window.easyCert.approvals.probe();
      const n = p && p.ok && p.canReview ? p.count || 0 : 0;
      if (p && p.ok && p.canReview) setBadge('accounts', n);
      console.log(`[startup-scan] account approvals badge: ${n} (canReview=${!!(p && p.canReview)})`);
    } catch (err) {
      console.warn('[startup-scan] account approvals probe failed:', err && err.message);
    }
  }

  async function scanExpiring() {
    try {
      if (window.EasyCertTools && window.EasyCertTools.prime) {
        await window.EasyCertTools.prime();
        console.log('[startup-scan] expiring prime done');
      } else {
        console.warn('[startup-scan] EasyCertTools.prime not available');
      }
    } catch (err) {
      console.warn('[startup-scan] expiring prime failed:', err && err.message);
    }
  }

  async function scanClassApprovals() {
    try {
      // Instructors have no class queue (the sub-tab is hidden for them),
      // so there is nothing to count.
      if (window.EasyPerms && !window.EasyPerms.privileged) {
        console.log('[startup-scan] class approvals skipped (not a reviewer)');
        return;
      }
      if (window.EasyClassApprovals && window.EasyClassApprovals.primeBadge) {
        await window.EasyClassApprovals.primeBadge();
        console.log('[startup-scan] class approvals badge primed');
      } else {
        console.warn('[startup-scan] EasyClassApprovals.primeBadge not available');
      }
    } catch (err) {
      console.warn('[startup-scan] class approvals probe failed:', err && err.message);
    }
  }

  async function run() {
    console.log('[startup-scan] starting');
    // The scan fires after an IPC round-trip, which can resolve before
    // DOMContentLoaded — but some globals (e.g. EasyCertTools) are only
    // set in DOMContentLoaded inits. Wait for readiness first.
    if (document.readyState === 'loading') {
      await new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true })
      );
    }
    await Promise.allSettled([scanCertApprovals(), scanAccountApprovals(), scanClassApprovals(), scanExpiring()]);
    console.log('[startup-scan] done');
  }

  window.EasyStartupScan = { run };
})();
