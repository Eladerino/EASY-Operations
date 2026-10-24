// app.js: bootstrap: sign-in gate, tab navigation, toasts, confirm
// dialog, hardware Back handling, and the self-update banner.
// Screens live in their own files.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentTab = 'today';
  let signedInUser = null;
  // Website sign-in result read from the address at boot (web version).
  let pendingWebCreds = null;
  let pendingWebMessage = '';

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

  /* ---------------- theme ---------------- */
  // System (follow the phone), Light, or Dark. The choice persists in
  // Preferences (with a localStorage mirror the inline script in
  // index.html reads before first paint). Applying it is just the
  // data-theme attribute on <html>; the CSS decides which token set
  // that means, and "system" leaves the media query in charge.

  const THEME_CHOICES = ['system', 'light', 'dark'];

  function applyTheme(choice) {
    document.documentElement.setAttribute('data-theme', choice);
    // Scoped to theme buttons: other segmented controls (the
    // Activity screen's This phone / Site switch) share the seg-btn
    // styling but are not theme choices.
    for (const btn of document.querySelectorAll('.seg-btn[data-theme-choice]')) {
      btn.classList.toggle('active', btn.dataset.themeChoice === choice);
    }
  }

  async function initTheme() {
    let choice = 'system';
    try {
      const saved = await window.EasyStore.getTheme();
      if (THEME_CHOICES.includes(saved)) choice = saved;
    } catch (e) {
      // A store hiccup must never block boot; system stays the default.
    }
    applyTheme(choice);
    for (const btn of document.querySelectorAll('.seg-btn[data-theme-choice]')) {
      btn.addEventListener('click', async () => {
        const next = btn.dataset.themeChoice;
        applyTheme(next);
        try {
          await window.EasyStore.setTheme(next);
        } catch (e) {
          toast('The theme changed for now, but the choice could not be saved.', 'error', 7000);
        }
      });
    }
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
    const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (btn && btn.classList.contains('role-hidden')) name = 'today';
    closeSubview();
    currentTab = name;
    for (const page of document.querySelectorAll('.tab-page')) {
      page.classList.toggle('hidden', page.id !== 'tab-' + name);
    }
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    if (name === 'today') window.EasyToday.show();
    else if (name === 'schedule') window.EasySchedule.show();
    else if (name === 'approvals') window.EasyApprovals.show();
    else if (name === 'queue') window.EasyQueue.show();
    else if (name === 'alerts') window.EasyAlerts.show();
  }

  function setApprovalsBadge(n) {
    const badge = $('tabApprovalsBadge');
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n <= 0);
  }

  /* ---------------- pull to refresh ---------------- */
  // The .pages element is the app's one scroll container. A downward
  // pull that starts with the scroller at the very top expands the
  // indicator at the head of the content; releasing it past the
  // threshold runs the active tab's own refresh, the same paths the
  // old per-page Refresh buttons called (removed in 0.4.2). PTR stays
  // off while a subview is open (roster, class editor, expiring list),
  // while the sign-in screen is showing, and while a refresh it
  // started is still running. The screens keep their last-good and
  // "Last updated" behaviour, so that line stays the feedback after
  // a pull.

  const PTR_THRESHOLD = 70;
  const PTR_MAX = 104;
  const PTR_HOLD = 52;

  function refreshActiveTab() {
    if (currentTab === 'today') return window.EasyToday.refresh();
    if (currentTab === 'schedule') return window.EasySchedule.show();
    if (currentTab === 'approvals') return window.EasyApprovals.refresh();
    if (currentTab === 'queue') return window.EasyQueue.show();
    if (currentTab === 'alerts') return window.EasyAlerts.show();
    return Promise.resolve();
  }

  function setupPullToRefresh() {
    const scroller = document.querySelector('.pages');
    const bar = $('ptrIndicator');
    const spinner = $('ptrSpinner');
    const label = $('ptrLabel');
    if (!scroller || !bar || !spinner || !label) return;

    let startY = null; // touch Y where a candidate pull began
    let pull = 0; // current resisted pull distance, px
    let armed = false; // pull is past the release threshold
    let refreshing = false;

    const ptrAllowed = () =>
      !refreshing &&
      !$('appView').classList.contains('hidden') &&
      subviewClose === null &&
      scroller.scrollTop <= 0;

    function setBar(height, text, spinning) {
      bar.style.height = height + 'px';
      if (text !== null) label.textContent = text;
      spinner.classList.toggle('ptr-spinning', !!spinning);
      spinner.style.transform = spinning
        ? ''
        : 'rotate(' + Math.round(Math.min(180, (height / PTR_THRESHOLD) * 180)) + 'deg)';
    }

    function collapse() {
      bar.classList.remove('ptr-dragging');
      pull = 0;
      armed = false;
      setBar(0, 'Pull to refresh', false);
    }

    function endGesture() {
      startY = null;
      bar.classList.remove('ptr-dragging');
    }

    async function runRefresh() {
      refreshing = true;
      bar.classList.remove('ptr-dragging');
      setBar(PTR_HOLD, 'Refreshing...', true);
      try {
        await refreshActiveTab();
      } catch (e) {
        // Screens report their own failures (last-good notes, error
        // lines, toasts); PTR only has to fold itself away.
      }
      refreshing = false;
      collapse();
    }

    scroller.addEventListener(
      'touchstart',
      (ev) => {
        if (ev.touches.length !== 1 || !ptrAllowed()) {
          startY = null;
          return;
        }
        startY = ev.touches[0].clientY;
        pull = 0;
        armed = false;
      },
      { passive: true }
    );

    scroller.addEventListener(
      'touchmove',
      (ev) => {
        if (startY === null || refreshing) return;
        if (ev.touches.length !== 1 || subviewClose !== null || scroller.scrollTop > 0) {
          // The gesture turned into something else (a second finger,
          // a subview opened, the container scrolled): abandon it.
          if (pull > 0) collapse();
          endGesture();
          return;
        }
        const dy = ev.touches[0].clientY - startY;
        if (dy <= 0) {
          // Finger back at or above the start point: cancel cleanly.
          if (pull > 0) collapse();
          pull = 0;
          armed = false;
          return;
        }
        // A genuine downward pull at the top: take over the gesture
        // so the WebView does not also scroll or rubber-band.
        if (ev.cancelable) ev.preventDefault();
        bar.classList.add('ptr-dragging');
        pull = Math.min(PTR_MAX, dy * 0.55);
        armed = pull >= PTR_THRESHOLD;
        setBar(pull, armed ? 'Release to refresh' : 'Pull to refresh', false);
      },
      { passive: false }
    );

    const finish = () => {
      if (startY === null) return;
      const shouldRefresh = armed && !refreshing;
      pull = 0;
      armed = false;
      endGesture();
      if (shouldRefresh) runRefresh();
      else if (!refreshing) collapse();
    };
    scroller.addEventListener('touchend', finish);
    scroller.addEventListener('touchcancel', finish);
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

  /* ---------------- coming back to the app ---------------- */

  // The activity is singleTask, so Android brings back the same page
  // instead of relaunching it, and the boot-time update check and tab
  // load never run again. When the app returns after a while away,
  // reload the open tab and re-run the (throttled) update check. A
  // subview or dialog in progress is left alone so an edit is never
  // wiped by a reload.
  const RESUME_REFRESH_MS = 5 * 60 * 1000;

  function setupResume() {
    let pausedAt = null;
    const onPause = () => {
      pausedAt = Date.now();
    };
    const onResume = () => {
      const away = pausedAt === null ? 0 : Date.now() - pausedAt;
      pausedAt = null;
      if (away < RESUME_REFRESH_MS) return;
      if ($('appView').classList.contains('hidden')) return;
      window.EasyUpdater.check(false);
      if (isModalOpen() || subviewClose) return;
      Promise.resolve(refreshActiveTab()).catch(() => {});
    };
    const cap = window.Capacitor;
    const App = cap && cap.Plugins && cap.Plugins.App;
    if (App && typeof App.addListener === 'function') {
      App.addListener('pause', onPause);
      App.addListener('resume', onResume);
      return;
    }
    // Web version: the page being hidden and shown again is the same
    // thing as the app going to the background and coming back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onPause();
      else onResume();
    });
  }

  /* ---------------- roles ---------------- */

  // Shows only the screens this account can use (roles.js). The Suite's
  // app-config adds proxyPoster (office staff who post for others); if
  // it cannot be reached the capabilities alone decide. "Needs
  // attention" disappears when none of its boxes apply.
  function applyRoles() {
    window.EasyRoles.apply();
    const grid = $('needsAttentionGrid');
    const anyBox = grid && grid.querySelector('[data-role]:not(.role-hidden)');
    if ($('needsAttentionTitle')) $('needsAttentionTitle').classList.toggle('role-hidden', Boolean(grid) && !anyBox);
    if (grid) grid.classList.toggle('role-hidden', !anyBox);
    const active = document.querySelector('.tab-btn[data-tab="' + currentTab + '"]');
    if (active && active.classList.contains('role-hidden')) showTab('today');
  }

  async function loadRoles(user) {
    const caps = user && user.capabilities;
    window.EasyRoles.set(caps, false);
    applyRoles();
    if (!window.EasyRoles.isManager() && caps) {
      try {
        const cfg = await window.EasyApi.appConfig();
        const proxy = Boolean(cfg && cfg.proxyPoster);
        if (proxy) {
          window.EasyRoles.set(caps, true);
          applyRoles();
          if (currentTab === 'today') window.EasyToday.show();
        }
      } catch (e) {
        // Keep the capability-only view.
      }
    }
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
    loadRoles(user);
    showTab('today');
    // Self-update check on launch (throttled inside the updater).
    window.EasyUpdater.check(false);
  }

  // Checks a username + application password against the site, saves
  // them on this device and opens the app. Throws with a plain message.
  async function completeSignIn(username, appPassword) {
    const user = await window.EasyApi.fetchMe(username, appPassword);
    const creds = { username, appPassword };
    await window.EasyStore.setCreds(creds);
    window.EasyApi.setCreds(creds);
    enterApp(user);
  }

  async function onWebSignIn() {
    const btn = $('signinWebBtn');
    btn.disabled = true;
    try {
      await window.EasyWebSignIn.start();
    } catch (e) {
      showSignIn(e.message);
      if (e.notReady) toggleManual(true);
    } finally {
      // In the Android app the browser opens on top; the button comes
      // back for whenever the person returns without finishing.
      setTimeout(() => {
        btn.disabled = false;
      }, 1500);
    }
  }

  function toggleManual(open) {
    const form = $('signinForm');
    const show = open === undefined ? form.classList.contains('hidden') : open;
    form.classList.toggle('hidden', !show);
    $('signinManualToggle').classList.toggle('hidden', show);
  }

  // The website sign-in came back with a new application password.
  async function finishWebSignIn(creds) {
    if (signedInUser) return;
    showSignIn('');
    const btn = $('signinWebBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      await completeSignIn(creds.user, creds.appPassword);
    } catch (e) {
      showSignIn(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in with easysafety.ca';
    }
  }

  // Web version only: the website sign-in sends the browser back to
  // this page with the result in the address. Returns true when the
  // page is the Android hand-back screen and the app should not start.
  function handleReturnFromWebsite() {
    const result = window.EasyWebSignIn.parseLocation(window.location);
    if (!result) return false;
    // The address carries the password: take it out of the address bar
    // and history straight away.
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      // Older browsers: the hash stays, nothing else breaks.
    }
    if (result.mode === 'android') {
      $('signinView').classList.add('hidden');
      $('appView').classList.add('hidden');
      $('handoffView').classList.remove('hidden');
      if (result.rejected) {
        $('handoffTitle').textContent = 'Sign-in cancelled';
        $('handoffText').textContent = 'Nothing was changed. Go back to EASY Manager to try again.';
      } else if (!result.creds) {
        $('handoffTitle').textContent = 'Something went wrong';
        $('handoffText').textContent = 'The website did not send a sign-in back. Go back to EASY Manager and try again.';
      } else {
        const link = $('handoffLink');
        link.href = window.EasyWebSignIn.androidHandoffLink(result.creds);
        link.classList.remove('hidden');
      }
      return true;
    }
    if (result.rejected) {
      pendingWebMessage = 'Sign-in was cancelled on the website. Nothing was changed.';
    } else if (result.creds) {
      pendingWebCreds = result.creds;
    } else {
      pendingWebMessage = 'The website did not send a sign-in back. Try again.';
    }
    return false;
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
      await completeSignIn(username, appPassword);
      $('signinPass').value = '';
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
    window.EasyRoles.reset();
    signedInUser = null;
    showSignIn('');
  }

  async function boot() {
    const native = window.EasyWebSignIn.isNative();
    document.documentElement.classList.toggle('web-mode', !native);
    if (handleReturnFromWebsite()) return;
    if (!native && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    $('signinForm').addEventListener('submit', onSignInSubmit);
    $('signinWebBtn').addEventListener('click', onWebSignIn);
    $('signinManualToggle').addEventListener('click', () => toggleManual());
    $('signOutBtn').addEventListener('click', onSignOut);
    $('updateDismiss').addEventListener('click', () => window.EasyUpdater.dismissCurrent());
    $('checkUpdatesBtn').addEventListener('click', async () => {
      const pending = await window.EasyUpdater.check(true);
      if (!pending) toast('You are on the latest version (' + window.EasyConfig.APP_VERSION + ').', 'success');
    });
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    }
    setupPullToRefresh();
    window.EasyQueue.init();
    window.EasyToday.init();
    window.EasyAlerts.init();
    window.EasySchedule.init();
    window.EasyApprovals.init();
    setupBackButton();
    setupResume();
    await initTheme();
    window.EasyWebSignIn.listen(finishWebSignIn);

    if (pendingWebCreds) {
      // Back from the website sign-in (web version): a new sign-in
      // replaces whatever was saved before.
      const fresh = pendingWebCreds;
      pendingWebCreds = null;
      await finishWebSignIn(fresh);
      return;
    }
    const creds = await window.EasyStore.getCreds();
    if (!creds) {
      showSignIn(pendingWebMessage || '');
      pendingWebMessage = '';
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
        showSignIn('The saved sign-in no longer works. Sign in again.');
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
