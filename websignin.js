// websignin.js — "Sign in with easysafety.ca".
//
// WordPress's own "Authorize Application" page (wp-admin/authorize-
// application.php) lets someone sign in with their normal website login
// and approve this app; WordPress then creates the application password
// itself and hands it back by sending the page to our success URL. The
// page runs in a separate window with its own throwaway session, and the
// hand-back is caught before it navigates anywhere, so the password never
// leaves this process except to the setup screen that asked for it.
const { BrowserWindow, session, shell } = require('electron');
const os = require('os');
const shared = require('./shared');

const SCHEME = 'easyops';
const APP_ID = '5c0f7e8a-3b1d-4e6f-9a2c-7d4b8e1f0a63';
const CALLBACK = `${SCHEME}://auth/callback`;
const REJECTED = `${SCHEME}://auth/rejected`;
const PARTITION = 'easy-website-sign-in';

// The name shown on the person's WordPress profile: computer plus the
// sign-in time, so a lost laptop can be revoked without touching other
// devices. WordPress refuses a second password with the same name, so
// the time also lets the same computer sign in again later.
function appName(now = new Date()) {
  const host = String(os.hostname() || '').trim().slice(0, 40);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return host ? `EASY Operations (${host}, ${stamp})` : `EASY Operations (${stamp})`;
}

function authorizeUrl(siteUrl) {
  return `${siteUrl}/wp-admin/authorize-application.php?` + new URLSearchParams({
    app_name: appName(),
    app_id: APP_ID,
    success_url: CALLBACK,
    reject_url: REJECTED,
  }).toString();
}

let current = null;

// Resolves { ok: true, user, appPassword }, { ok: false, cancelled: true },
// { ok: false, busy: true } or { ok: false, error }. `startUrl` is only for
// tests; the app always starts at the site's authorize page.
function openWebsiteSignIn({ siteUrl, parent, startUrl }) {
  if (current && !current.isDestroyed()) {
    current.focus();
    return Promise.resolve({ ok: false, busy: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    let win = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      // Close the window outside the navigation event that got us here,
      // then forget the website login so the next sign-in starts fresh
      // (and can be a different person) before answering.
      setImmediate(() => {
        if (win && !win.isDestroyed()) win.destroy();
        if (current === win) current = null;
        session.fromPartition(PARTITION).clearStorageData()
          .catch(() => {})
          .then(() => resolve(result));
      });
    };

    win = current = new BrowserWindow({
      width: 520,
      height: 720,
      parent,
      modal: !!parent,
      autoHideMenuBar: true,
      title: 'Sign in to easysafety.ca',
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // In-memory session: the website login is forgotten when this
        // window closes. Only the application password is kept.
        partition: PARTITION,
      },
    });
    const wc = win.webContents;

    // Catches the hand-back whether WordPress sends it by script
    // (will-navigate) or by an HTTP redirect (will-redirect). Any other
    // page outside the site opens in the normal browser instead.
    const onNavigate = (e, url) => {
      const target = String(url);
      if (target.startsWith(`${SCHEME}:`)) {
        e.preventDefault();
        const parsed = shared.parseSignInCallback(target, SCHEME, siteUrl);
        if (parsed && parsed.rejected) finish({ ok: false, cancelled: true });
        else if (parsed) finish({ ok: true, user: parsed.user, appPassword: parsed.appPassword });
        else finish({ ok: false, error: 'The website sent back an answer the app could not read. Try again, or use an application password instead.' });
        return;
      }
      if (!target.startsWith(siteUrl + '/')) {
        e.preventDefault();
        if (/^https:\/\//i.test(target)) shell.openExternal(target);
      }
    };
    wc.on('will-navigate', onNavigate);
    wc.on('will-redirect', onNavigate);
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 is an aborted load, which is what a caught hand-back looks like.
      if (!isMainFrame || code === -3 || String(url).startsWith(`${SCHEME}:`)) return;
      finish({ ok: false, error: `Could not open the website sign-in (${desc}). Check the internet connection and try again.` });
    });
    win.on('closed', () => finish({ ok: false, cancelled: true }));
    win.loadURL(startUrl || authorizeUrl(siteUrl)).catch(() => {});
  });
}

module.exports = { openWebsiteSignIn, authorizeUrl, SCHEME, APP_ID };
