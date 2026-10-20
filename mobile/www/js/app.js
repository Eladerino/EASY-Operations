// app.js: bootstrap: sign-in gate, tab navigation, toasts, confirm
// dialog, hardware Back handling, and the self-update banner.
// Screens live in their own files.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentTab = 'today';
  let signedInUser = null;

  /* ---------------- toast ---------------- */

  function toast(message, type, ms) {
    const box = $('toasts');
    const node = document.createElement('div');
    node.className = 'toast toast-' + (type || 'info');
    node.textContent = message;
    box.appendChild(node);
    setTimeout(() => {
      node.classList.add('toast-out');
      setTimeout(() => node.remove(), 400);
    }, ms || 4500);
  }

  /* ---------------- confirm dialog ---------------- */
  // One dialog at a time. A second confirm() while one is open queues
  // behind it instead of sharing its buttons, so one tap can never
  // resolve two promises. cancelOpenModal() lets the Back button close
  // the dialog as a cancel.

  let modalCancel = null; // function while the dialog is open, else null
  let confirmChain = Promise.resolve();

  function openConfirm(title, body, okText) {
    return new Promise((resolve) => {
      $('modalTitle').textContent = title;
      $('modalBody').textContent = body;
      const ok = $('modalOk');
      const cancel = $('modalCancel');
      ok.textContent = okText || 'OK';
      $('modal').classList.remove('hidden');
      const done = (value) => {
        $('modal').classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        modalCancel = null;
        resolve(value);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      modalCancel = onCancel;
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  function confirm(title, body, okText) {
    const run = () => openConfirm(title, body, okText);
    const p = confirmChain.then(run, run);
    confirmChain = p.then(
      () => {},
      () => {}
    );
    return p;
  }

  const isModalOpen = () => modalCancel !== null;
  function cancelOpenModal() {
    if (modalCancel) modalCancel();
  }

  /* ---------------- subviews (roster, expiring list) ---------------- */
  // A screen can open a subview over its own tab. Back closes the
  // subview before it does anything else.

  let subviewClose = null;

  function openSubview(closeFn) {
    subviewClose = closeFn;
  }
  function closeSubview() {
    if (!subviewClose) return false;
    const fn = subviewClose;
    subviewClose = null;
    fn();
    return true;
  }

  /* ---------------- update banner ---------------- */

  function showUpdateBanner(version, onInstall) {
    $('updateText').textContent = 'EASY Manager ' + version + ' is available.';
    $('updateBanner').classList.remove('hidden');
    $('updateInstall').onclick = () => onInstall();
  }

  function hideUpdateBanner() {
    $('updateBanner').classList.add('hidden');
  }

  /* ---------------- tabs ---------------- */

  function showTab(name) {
    closeSubview();
    currentTab = name;
    for (const page of document.querySelectorAll('.tab-page')) {
      page.classList.toggle('hidden', page.id !== 'tab-' + name);
    }
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    if (name === 'today') window.EasyToday.show();
    else if (name === 'approvals') window.EasyApprovals.show();
    else if (name === 'queue') window.EasyQueue.show();
    else if (name === 'alerts') window.EasyAlerts.show();
  }

  function refreshCurrent() {
    if (currentTab === 'today') window.EasyToday.refresh();
    else if (currentTab === 'approvals') window.EasyApprovals.refresh();
    else if (currentTab === 'queue') window.EasyQueue.show();
    else if (currentTab === 'alerts') window.EasyAlerts.show();
  }

  function setApprovalsBadge(n) {
    const badge = $('tabApprovalsBadge');
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n <= 0);
  }

  /* ---------------- hardware Back ---------------- */

  function setupBackButton() {
    const cap = window.Capacitor;
    const App = cap && cap.Plugins && cap.Plugins.App;
    if (!App || typeof App.addListener !== 'function') return;
    App.addListener('backButton', () => {
      // On the sign-in screen there is nowhere in-app to go back to.
      if (!$('appView').classList.contains('hidden')) {
        if (isModalOpen()) {
          cancelOpenModal();
          return;
        }
        if (closeSubview()) return;
        if (currentTab !== 'today') {
          showTab('today');
          return;
        }
      }
      App.exitApp();
    });
  }

  /* ---------------- capability heads-up ---------------- */

  // Sign-in accepts any account whose application password works, but
  // the queues need real rights. If the probe returned capabilities and
  // key ones are missing, say so once in plain language instead of
  // letting every screen fail quietly. Never blocks entry.
  async function checkCapabilities(user) {
    const caps = user && user.capabilities;
    if (!caps || typeof caps !== 'object') return;
    const missing = [];
    if (!caps.promote_users) missing.push('review account signups');
    if (!caps.manage_options) missing.push('use the management queue');
    if (!caps.edit_posts) missing.push('publish certificates and classes');
    if (!missing.length) return;
    const key = 'caps_warned_' + (user.slug || user.name || 'account');
    if (await window.EasyStore.getFlag(key)) return;
    await window.EasyStore.setFlag(key);
    toast(
      'Heads up: this account cannot ' + missing.join(', ') +
        '. Those parts of the app will not work. Your admin account can do all of it.',
      'error',
      10000
    );
  }

  /* ---------------- sign-in / app views ---------------- */

  function showSignIn(message) {
    $('signinView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    const err = $('signinError');
    err.textContent = message || '';
    err.classList.toggle('hidden', !message);
  }

  function enterApp(user) {
    signedInUser = user;
    $('signinView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('signedInAs').textContent = user && user.name ? 'Signed in as ' + user.name : '';
    showTab('today');
    checkCapabilities(user);
    // Self-update check on launch (throttled inside the updater).
    window.EasyUpdater.check(false);
  }

  async function onSignInSubmit(ev) {
    ev.preventDefault();
    const username = $('signinUser').value.trim();
    const appPassword = $('signinPass').value.trim();
    if (!username || !appPassword) {
      showSignIn('Enter your WordPress username and application password.');
      return;
    }
    const btn = $('signinBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      const user = await window.EasyApi.fetchMe(username, appPassword);
      const creds = { username, appPassword };
      await window.EasyStore.setCreds(creds);
      window.EasyApi.setCreds(creds);
      $('signinPass').value = '';
      enterApp(user);
    } catch (e) {
      showSignIn(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  async function onSignOut() {
    const yes = await confirm('Sign out?', 'The saved sign-in will be removed from this device.', 'Sign out');
    if (!yes) return;
    await window.EasyStore.clearCreds();
    window.EasyApi.setCreds(null);
    signedInUser = null;
    showSignIn('');
  }

  async function boot() {
    $('signinForm').addEventListener('submit', onSignInSubmit);
    $('signOutBtn').addEventListener('click', onSignOut);
    $('updateDismiss').addEventListener('click', () => window.EasyUpdater.dismissCurrent());
    $('checkUpdatesBtn').addEventListener('click', async () => {
      const pending = await window.EasyUpdater.check(true);
      if (!pending) toast('You are on the latest version (' + window.EasyConfig.APP_VERSION + ').', 'success');
    });
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    }
    $('todayRefresh').addEventListener('click', () => window.EasyToday.refresh());
    $('approvalsRefresh').addEventListener('click', () => window.EasyApprovals.refresh());
    $('floatRefresh').addEventListener('click', refreshCurrent);
    window.EasyQueue.init();
    window.EasyToday.init();
    window.EasyAlerts.init();
    setupBackButton();

    const creds = await window.EasyStore.getCreds();
    if (!creds) {
      showSignIn('');
      return;
    }
    window.EasyApi.setCreds(creds);
    try {
      const user = await window.EasyApi.fetchMe(creds.username, creds.appPassword);
      enterApp(user);
    } catch (e) {
      // A network failure should not kick the user out of a saved sign-in;
      // only a clear auth rejection does.
      if (e.status === 401) {
        await window.EasyStore.clearCreds();
        window.EasyApi.setCreds(null);
        showSignIn('The saved sign-in no longer works. Sign in again with a fresh application password.');
      } else {
        enterApp({ name: creds.username });
        toast('Could not reach the site to verify the sign-in. Showing saved session.', 'error', 7000);
      }
    }
  }

  window.EasyUi = {
    toast,
    confirm,
    showTab,
    setApprovalsBadge,
    showUpdateBanner,
    hideUpdateBanner,
    isModalOpen,
    openSubview,
    closeSubview,
    currentTab: () => currentTab,
    user: () => signedInUser,
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
