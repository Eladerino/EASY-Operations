// updater.js: repo-based self-update for the sideloaded APK.
//
// How it works:
//   1. On launch (throttled to once every 6 hours, ETag-cached) the app
//      asks GitHub for the repo's recent releases. It scans them newest
//      first because this repo's releases are usually desktop app
//      releases; the APK rides along as an asset on some of them, not
//      necessarily the newest one.
//   2. Among every APK asset found, the newest app version wins, even
//      if it is attached to an older release.
//   3. If that version is newer than this app, an update banner appears.
//      Skipping a version remembers the choice: that version is not
//      offered again, a newer one still is.
//   4. Tapping Update downloads the APK (Capacitor Filesystem) and
//      hands it to the Android installer through the small native
//      ApkInstaller plugin (FileProvider + install intent). Android always
//      shows its own install confirmation; there is no silent install.
//
// Android requires the same signing key on every update. See the README
// keystore warning.
(function () {
  'use strict';

  const THROTTLE_MS = 6 * 60 * 60 * 1000;
  let pending = null; // { version, url }

  function parseVersion(v) {
    return String(v || '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  }

  function isNewer(candidate, current) {
    const a = parseVersion(candidate);
    const b = parseVersion(current);
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) return true;
      if (a[i] < b[i]) return false;
    }
    return false;
  }

  // The newest APK version across all scanned releases, wherever its
  // asset happens to be attached.
  function findApk(releases) {
    let best = null;
    for (const release of releases || []) {
      const assets = (release && release.assets) || [];
      for (const asset of assets) {
        const m = window.EasyConfig.APK_ASSET_PATTERN.exec(asset.name || '');
        if (!m) continue;
        const candidate = { version: m[1], url: asset.browser_download_url };
        if (!best || isNewer(candidate.version, best.version)) best = candidate;
      }
    }
    return best;
  }

  // Returns the pending update, or null. A skipped version counts as
  // handled: it does not re-announce.
  async function check(force) {
    const cache = (await window.EasyStore.getUpdateCache()) || {};
    const skipped = await window.EasyStore.getSkippedVersion();
    const now = Date.now();

    const adopt = async (apk) => {
      if (apk && isNewer(apk.version, window.EasyConfig.APP_VERSION)) {
        if (skipped && apk.version === skipped) {
          pending = null;
          return null;
        }
        pending = apk;
        announce();
        return pending;
      }
      pending = null;
      return null;
    };

    if (!force && cache.checkedAt && now - cache.checkedAt < THROTTLE_MS) {
      return adopt(cache.latest || null);
    }

    const headers = { Accept: 'application/vnd.github+json' };
    if (cache.etag) headers['If-None-Match'] = cache.etag;
    let res;
    try {
      const timed = window.EasyApi && window.EasyApi.fetchWithTimeout;
      res = timed
        ? await timed(window.EasyConfig.GITHUB_RELEASES, { headers }, 20000)
        : await fetch(window.EasyConfig.GITHUB_RELEASES, { headers });
    } catch (e) {
      return null; // offline, blocked, or too slow: stay silent, try next launch
    }

    if (res.status === 304) {
      cache.checkedAt = now;
      await window.EasyStore.setUpdateCache(cache);
      return adopt(cache.latest || null);
    }
    if (res.status !== 200) return null;

    const releases = await res.json().catch(() => null);
    const apk = findApk(Array.isArray(releases) ? releases : []);
    const next = {
      etag: res.headers.get('etag') || null,
      checkedAt: now,
      latest: apk,
    };
    await window.EasyStore.setUpdateCache(next);
    return adopt(apk);
  }

  function announce() {
    if (pending && window.EasyUi && window.EasyUi.showUpdateBanner) {
      window.EasyUi.showUpdateBanner(pending.version, install);
    }
  }

  // The banner's Skip button: remember this version and stop offering
  // it. A newer version will still be offered when it appears.
  async function dismissCurrent() {
    if (pending) await window.EasyStore.setSkippedVersion(pending.version);
    pending = null;
    if (window.EasyUi) window.EasyUi.hideUpdateBanner();
  }

  async function install() {
    if (!pending) return;
    const cap = window.Capacitor;
    const Plugins = (cap && cap.Plugins) || {};

    // Preferred path: download into the app cache, then the native
    // installer plugin opens the system install screen for it.
    if (Plugins.Filesystem && Plugins.ApkInstaller) {
      try {
        window.EasyUi.toast('Downloading the update...');
        const fileName = 'easy-manager-' + pending.version + '.apk';
        const got = await Plugins.Filesystem.downloadFile({
          url: pending.url,
          path: fileName,
          directory: 'CACHE',
        });
        const rawPath = (got && got.path) || '';
        const path = rawPath.replace(/^file:\/\//, '');
        if (!path) throw new Error('Download finished without a file path.');
        await Plugins.ApkInstaller.install({ path });
        return;
      } catch (e) {
        if (e && e.message === 'NEEDS_PERMISSION') {
          window.EasyUi.toast(
            'Allow installs from this app in the settings screen that just opened, then tap the update banner again.',
            'error',
            9000
          );
          return;
        }
        // Fall through to the manual instructions below.
      }
    }

    // Fallback: opening the download inside the app goes nowhere useful,
    // so say plainly what to do instead.
    const fileName = 'easy-manager-' + pending.version + '.apk';
    window.EasyUi.toast(
      'The in-app install did not work. Open the EASY-Operations releases page on GitHub ' +
        '(github.com/Eladerino/EASY-Operations/releases), download ' + fileName +
        ' in your browser, and tap the downloaded file to install it.',
      'error',
      12000
    );
  }

  window.EasyUpdater = { check, install, dismissCurrent, getPending: () => pending, isNewer };
})();
