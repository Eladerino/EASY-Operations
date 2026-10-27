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

  // The management questions sit under the Approvals tab, reached by the
  // switch at the top of the page. Alerts has no tab: the bell in the
  // header opens it, and its Back button returns to the page before.
  // currentTab names the page showing, which may be one of these.
  const PARENT = { queue: 'approvals' };
  const lastPage = {};
  let beforeAlerts = 'today';

  function pageAllowed(name) {
    if (name === 'alerts') return true;
    const btn = document.querySelector('.tab-btn[data-tab="' + (PARENT[name] || name) + '"]');
    if (btn && btn.classList.contains('role-hidden')) return false;
    if (!PARENT[name]) return true;
    const seg = document.querySelector('.page-switch [data-page="' + name + '"]');
    return !(seg && seg.closest('.page-switch').classList.contains('role-hidden'));
  }

  function showTab(name) {
    if (!pageAllowed(name)) name = PARENT[name] && pageAllowed(PARENT[name]) ? PARENT[name] : 'today';
    const tab = PARENT[name] || name;
    if (name === 'alerts') {
      if (currentTab !== 'alerts') beforeAlerts = currentTab;
    } else {
      lastPage[tab] = name;
    }
    closeSubview();
    currentTab = name;
    for (const page of document.querySelectorAll('.tab-page')) {
      page.classList.toggle('hidden', page.id !== 'tab-' + name);
    }
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    for (const seg of document.querySelectorAll('.page-switch .seg-btn')) {
      seg.classList.toggle('active', seg.dataset.page === name);
    }
    $('bellBtn').classList.toggle('active', name === 'alerts');
    if (name === 'today') window.EasyToday.show();
    else if (name === 'schedule') window.EasySchedule.show();
    else if (name === 'practicals') window.EasyPracticals.show();
    else if (name === 'approvals') window.EasyApprovals.show();
    else if (name === 'queue') window.EasyQueue.show();
    else if (name === 'alerts') window.EasyAlerts.show();
  }

  // Counts for the tab, switch and bell badges. The Approvals tab carries
  // drafts and signups plus open questions; Practicals carries results
  // still to record; the bell carries what only Alerts shows.
  const counts = { approvals: 0, queue: 0, practicals: 0, alerts: 0 };

  function paintBadge(badge, n) {
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n <= 0);
  }

  function setCount(key, n) {
    counts[key] = Number(n) || 0;
    for (const badge of document.querySelectorAll('.page-switch [data-count="' + key + '"]')) paintBadge(badge, counts[key]);
    paintBadge($('tabPracticalsBadge'), window.EasyRoles.can('practicals') ? counts.practicals : 0);
    paintBadge($('bellBadge'), counts.alerts);
    $('bellBtn').setAttribute('aria-label', counts.alerts > 0 ? 'Alerts, ' + counts.alerts + ' to look at' : 'Alerts');
    paintBadge($('tabApprovalsBadge'), counts.approvals + (window.EasyRoles.can('queue') ? counts.queue : 0));
  }

  function setApprovalsBadge(n) {
    setCount('approvals', n);
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
    if (currentTab === 'practicals') return window.EasyPracticals.show();
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
        if (currentTab === 'alerts') {
          showTab(beforeAlerts);
          return;
        }
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
  // app-config adds the handpicked-list flags (proxy posters, Schedule
  // editors, account approvers, certificate publishers, product
  // listers); if it cannot be reached the capabilities alone decide.
  // "Needs attention" disappears when none of its boxes apply.
  function applyRoles() {
    window.EasyRoles.apply();
    const grid = $('needsAttentionGrid');
    const anyBox = grid && grid.querySelector('[data-role]:not(.role-hidden)');
    if ($('needsAttentionTitle')) $('needsAttentionTitle').classList.toggle('role-hidden', Boolean(grid) && !anyBox);
    if (grid) grid.classList.toggle('role-hidden', !anyBox);
    if (!pageAllowed(currentTab)) showTab('today');
  }

  async function loadRoles(user) {
    const caps = user && user.capabilities;
    window.EasyRoles.set(caps, false, {});
    applyRoles();
    if (caps) {
      try {
        // app-config carries the handpicked-list flags (proxy posters,
        // Schedule editors, account approvers, certificate publishers,
        // product listers). Managers need it too: the product list is
        // list-based, not a capability, so an admin on the list would
        // otherwise never see the List an item screen.
        const cfg = await window.EasyApi.appConfig();
        if (cfg) {
          window.EasyRoles.set(caps, Boolean(cfg.proxyPoster), {
            scheduleEditor: Boolean(cfg.scheduleEditor),
            accountApprover: Boolean(cfg.accountApprover),
            certPublisher: Boolean(cfg.certPublisher),
            productLister: Boolean(cfg.productLister),
          });
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
    // Same throttled check the app runs on entry; the banner shows above
    // the sign-in screen too.
    Promise.resolve(window.EasyUpdater.check(false)).catch(() => {});
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
    $('signedInAs').textContent = user && user.name ? user.name : '';
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
    retirePendingAppPassword(username);
  }

  // Each website sign-in makes a new application password. Signing out
  // removes the one this phone used straight away while it still can
  // (only if the website sign-in made it for EASY Manager). If the site
  // can't be reached at that moment, its id is noted instead and the
  // next sign-in as the same person removes it from their profile once
  // the new one works. Another person's sign-in can't remove it, so it
  // is dropped and left for its owner's profile page. A note left
  // behind is also tried again on the next launch.
  const REVOKE_KEY = 'revokePending';

  async function retireAppPasswordOnSignOut(username) {
    // Sign-out waits at most a few seconds for the site on a slow
    // connection before falling back to the note.
    const record = await Promise.race([
      window.EasyApi.introspectAppPassword(),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    const pending = window.EasyWebSignIn.revokeCandidate(record, username);
    if (!pending) return;
    if (await window.EasyApi.deleteAppPassword(pending.uuid)) {
      await window.EasyStore.remove(REVOKE_KEY);
      return;
    }
    await window.EasyStore.set(REVOKE_KEY, pending);
  }

  async function retirePendingAppPassword(username) {
    try {
      const pending = await window.EasyStore.get(REVOKE_KEY, null);
      if (!pending) return;
      if (!pending.uuid || !window.EasyWebSignIn.sameLogin(pending.username, username)) {
        await window.EasyStore.remove(REVOKE_KEY);
        return;
      }
      if (await window.EasyApi.deleteAppPassword(pending.uuid)) {
        await window.EasyStore.remove(REVOKE_KEY);
      }
    } catch (e) {
      // Best effort: the old password just stays on the profile page.
    }
  }

  async function onWebSignIn() {
    const btn = $('signinWebBtn');
    btn.disabled = true;
    try {
      const label = window.EasyWebSignIn.cleanLabel($('signinDeviceName').value);
      await window.EasyStore.set('deviceName', label);
      await window.EasyWebSignIn.start(label);
    } catch (e) {
      showSignIn(e.message);
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
    const creds = await window.EasyStore.getCreds();
    if (creds) await retireAppPasswordOnSignOut(creds.username);
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
    $('signinDeviceName').value = await window.EasyStore.get('deviceName', '');
    $('signinManualToggle').addEventListener('click', () => toggleManual());
    $('signOutBtn').addEventListener('click', onSignOut);
    $('updateDismiss').addEventListener('click', () => window.EasyUpdater.dismissCurrent());
    // Updates come from public GitHub releases, so checking works signed
    // out too (a sign-in fix can then reach a phone that cannot sign in).
    const checkNow = async () => {
      const pending = await window.EasyUpdater.check(true);
      if (!pending) toast('You are on the latest version (' + window.EasyConfig.APP_VERSION + ').', 'success');
    };
    $('checkUpdatesBtn').addEventListener('click', checkNow);
    $('signinUpdatesBtn').addEventListener('click', checkNow);
    const signinVersion = $('signinVersion');
    if (signinVersion) signinVersion.textContent = 'EASY Manager ' + window.EasyConfig.APP_VERSION;
    // A tab goes back to the page last open under it.
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.addEventListener('click', () => showTab(lastPage[btn.dataset.tab] || btn.dataset.tab));
    }
    for (const seg of document.querySelectorAll('.page-switch .seg-btn')) {
      seg.addEventListener('click', () => showTab(seg.dataset.page));
    }
    $('bellBtn').addEventListener('click', () => showTab(currentTab === 'alerts' ? beforeAlerts : 'alerts'));
    $('alertsClose').addEventListener('click', () => showTab(beforeAlerts));
    setupPullToRefresh();
    window.EasyQueue.init();
    window.EasyToday.init();
    window.EasyAlerts.init();
    window.EasySchedule.init();
    window.EasyPracticals.init();
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
      retirePendingAppPassword(creds.username);
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
    setCount,
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
