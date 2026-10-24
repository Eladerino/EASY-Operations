// websignin.js: "Sign in with easysafety.ca".
//
// WordPress's own Authorize Application page (wp-admin/authorize-
// application.php) lets someone sign in with their normal website login
// and approve the app; WordPress creates the application password itself
// and sends the browser to our success URL with it attached. Nobody has
// to copy a password by hand, and a lost one is replaced by signing in
// again.
//
// Two ways the hand-back arrives:
//
// - Web version (the copy EASY Suite serves, used on iPhone): the
//   success URL is this same page with #connect, so the page reads the
//   password from its own address and clears it right away.
// - Android app: the authorize page opens in the phone's browser, and
//   its success URL is the web version with #connect-android. That page
//   shows one button whose intent:// link opens EASY Manager by package
//   name with the password, which arrives through the App plugin's
//   appUrlOpen (or getLaunchUrl on a cold start). The extra tap is on
//   purpose: browsers block a page from opening an app on its own.
(function () {
  'use strict';

  const ANDROID_APP_ID = '90f14d1c-d7ef-42a4-97c1-a548861ee1ac';
  const WEB_APP_ID = '217fdbc9-45b9-4df9-8926-60093a59ed84';
  const PACKAGE = 'ca.easysafety.opsmobile';
  const SCHEME = 'easymanager';
  // Where EASY Suite serves the web version.
  const WEB_APP_PATH = '/wp-content/plugins/easy-suite/app/';

  function isNative() {
    const cap = window.Capacitor;
    return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  }

  function site() {
    return window.EasyConfig.SITE.replace(/\/+$/, '');
  }

  function webAppUrl() {
    if (isNative()) return site() + WEB_APP_PATH;
    return window.location.origin + window.location.pathname;
  }

  // The name on the person's WordPress profile. WordPress refuses a
  // second password with the same name, so the sign-in time is part of
  // it; it also tells the devices apart when one needs revoking. An
  // optional label from the sign-in screen ("Brandon's Pixel") goes
  // first so the profile page says which phone it is.
  function cleanLabel(label) {
    return String(label || '').replace(/[\s,()]+/g, ' ').trim().slice(0, 40);
  }

  function appName(now, label) {
    const d = now || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const name = cleanLabel(label);
    return 'EASY Manager (' + (name ? name + ', ' : '') + (isNative() ? 'Android' : 'web') + ', ' + stamp + ')';
  }

  function authorizeUrl(label) {
    const back = webAppUrl();
    const params = new URLSearchParams({
      app_name: appName(null, label),
      app_id: isNative() ? ANDROID_APP_ID : WEB_APP_ID,
      success_url: back + (isNative() ? '#connect-android' : '#connect'),
      reject_url: back + (isNative() ? '#connect-android-rejected' : '#connect-rejected'),
    });
    return site() + '/wp-admin/authorize-application.php?' + params.toString();
  }

  function sameSite(value) {
    return String(value || '').replace(/\/+$/, '').toLowerCase() === site().toLowerCase();
  }

  // Reads site_url / user_login / password from a query string. Returns
  // { user, appPassword } only for this site, otherwise null.
  function credsFromQuery(query) {
    const q = new URLSearchParams(String(query || '').replace(/^[?#]/, ''));
    const user = q.get('user_login');
    const appPassword = q.get('password');
    if (!user || !appPassword || !sameSite(q.get('site_url'))) return null;
    return { user, appPassword };
  }

  // Parses this page's address after the authorize page sent it back.
  // WordPress appends the details after the #connect marker (its script
  // path) or, without script, in the normal query before it.
  // Returns { mode: 'web' | 'android', creds } or { mode, rejected }.
  function parseLocation(loc) {
    const hash = String(loc.hash || '');
    const match = /^#(connect-android-rejected|connect-rejected|connect-android|connect)(?:\?(.*))?$/.exec(hash);
    if (!match) return null;
    const marker = match[1];
    const mode = marker.indexOf('android') !== -1 ? 'android' : 'web';
    if (marker.endsWith('rejected')) return { mode, rejected: true };
    const creds = credsFromQuery(match[2] || '') || credsFromQuery(loc.search || '');
    return { mode, creds };
  }

  // Parses easymanager://auth/callback?... as the Android app receives it.
  function parseAppUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch (e) {
      return null;
    }
    if (url.protocol !== SCHEME + ':' || url.hostname !== 'auth') return null;
    if (url.pathname.replace(/\/+$/, '') !== '/callback') return null;
    return credsFromQuery(url.search);
  }

  function androidHandoffLink(creds) {
    const params = new URLSearchParams({
      site_url: site(),
      user_login: creds.user,
      password: creds.appPassword,
    });
    return 'intent://auth/callback?' + params.toString() +
      '#Intent;scheme=' + SCHEME + ';package=' + PACKAGE + ';end';
  }

  // No check that the web version is on the site first: the app runs
  // at https://localhost, and the site's plain files carry no CORS
  // header, so the browser refuses to let the app read them even when
  // they are there (that check blocked every sign-in in 0.5.0). EASY
  // Suite 2.2.44 and newer carry the web version.
  function start(label) {
    // In the Android app this opens the phone's browser (the app only
    // keeps its own pages); in the web version it is a normal page change.
    window.location.href = authorizeUrl(label);
  }

  // Picks out the application password a new sign-in replaces, from
  // WordPress's introspect answer for the old one. Only a password the
  // website sign-in made for EASY Manager (Android or web app_id)
  // qualifies; one made by hand on the profile page may be in use on
  // another device too. Returns { username, uuid } or null.
  function revokeCandidate(introspect, username) {
    if (!introspect || typeof introspect.uuid !== 'string' || !introspect.uuid) return null;
    if (introspect.app_id !== ANDROID_APP_ID && introspect.app_id !== WEB_APP_ID) return null;
    const login = String(username || '').trim();
    if (!login) return null;
    return { username: login, uuid: introspect.uuid };
  }

  // WordPress logins compare without case.
  function sameLogin(a, b) {
    const x = String(a || '').trim().toLowerCase();
    return x !== '' && x === String(b || '').trim().toLowerCase();
  }

  // Android: listen for the hand-back, including the one that launched
  // the app. onCreds receives { user, appPassword }.
  function listen(onCreds) {
    const cap = window.Capacitor;
    const App = cap && cap.Plugins && cap.Plugins.App;
    if (!isNative() || !App) return;
    const handle = (raw) => {
      const creds = raw ? parseAppUrl(raw) : null;
      if (creds) onCreds(creds);
    };
    if (typeof App.addListener === 'function') {
      App.addListener('appUrlOpen', (ev) => handle(ev && ev.url));
    }
    if (typeof App.getLaunchUrl === 'function') {
      App.getLaunchUrl()
        .then((res) => handle(res && res.url))
        .catch(() => {});
    }
  }

  window.EasyWebSignIn = {
    isNative,
    start,
    listen,
    authorizeUrl,
    parseLocation,
    parseAppUrl,
    androidHandoffLink,
    appName,
    cleanLabel,
    revokeCandidate,
    sameLogin,
    WEB_APP_PATH,
  };
})();
