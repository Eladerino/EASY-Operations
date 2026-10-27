// store.js: small async key/value layer over Capacitor Preferences,
// with the sign-in kept in Secure Storage instead (see Credentials).
//
// On device, Preferences lives in the app's private Android storage
// (SharedPreferences). It is private to this app but NOT encrypted,
// which is fine for the app's own data (history, snapshots, choices)
// but not for the saved sign-in; that lives in Secure Storage, which
// is backed by the Android Keystore. In a plain desktop browser
// (layout preview only) everything falls back to localStorage so the
// screens can still be exercised.
(function () {
  'use strict';

  const PREFIX = 'easy_mgr_';

  function nativePrefs() {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Preferences) return cap.Plugins.Preferences;
    return null;
  }

  // The Secure Storage plugin's friendly getItem/setItem/removeItem
  // live in its bundled JS wrapper, which this app does not load; the
  // native bridge exposes only the internal methods underneath them
  // (internalGetItem and friends, keyed by the plugin's own prefixed
  // key). These adapters use whichever shape the loaded plugin has.
  // (0.6.2 called setItem directly and sign-in failed on device with
  // "secure.setItem is not a function".)
  const SECURE_PREFIX = 'capacitor-storage_'; // the plugin's default

  function secureStorage() {
    const cap = window.Capacitor;
    const s = cap && cap.Plugins && cap.Plugins.SecureStorage;
    if (!s) return null;
    if (typeof s.getItem === 'function' || typeof s.internalGetItem === 'function') return s;
    return null;
  }

  async function secureGet(key) {
    const s = secureStorage();
    if (typeof s.getItem === 'function') return s.getItem(key);
    const res = await s.internalGetItem({ prefixedKey: SECURE_PREFIX + key });
    return res && res.data !== undefined ? res.data : null;
  }

  async function secureSet(key, value) {
    const s = secureStorage();
    if (typeof s.setItem === 'function') return s.setItem(key, value);
    return s.internalSetItem({ prefixedKey: SECURE_PREFIX + key, data: value });
  }

  async function secureRemove(key) {
    const s = secureStorage();
    if (typeof s.removeItem === 'function') return s.removeItem(key);
    return s.internalRemoveItem({ prefixedKey: SECURE_PREFIX + key });
  }

  async function get(key, fallback) {
    const prefs = nativePrefs();
    try {
      if (prefs) {
        const res = await prefs.get({ key: PREFIX + key });
        if (res && res.value !== null && res.value !== undefined) {
          return JSON.parse(res.value);
        }
        return fallback;
      }
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  async function set(key, value) {
    const prefs = nativePrefs();
    const raw = JSON.stringify(value === undefined ? null : value);
    if (prefs) {
      await prefs.set({ key: PREFIX + key, value: raw });
    } else {
      window.localStorage.setItem(PREFIX + key, raw);
    }
  }

  async function remove(key) {
    const prefs = nativePrefs();
    if (prefs) {
      await prefs.remove({ key: PREFIX + key });
    } else {
      window.localStorage.removeItem(PREFIX + key);
    }
  }

  /* ---------------- credentials ---------------- */
  // The saved sign-in is the one secret the app holds, so on device
  // it is kept in Secure Storage (Android Keystore-backed encryption),
  // not Preferences. Versions before 0.6.2 kept it in Preferences; the
  // first read after updating moves it across and deletes the plain
  // copy. In a plain browser there is no keystore behind Secure
  // Storage, so the Preferences/localStorage path is used as before.

  async function getCreds() {
    if (!secureStorage()) return get('creds', null);
    try {
      const raw = await secureGet('creds');
      if (raw !== null && raw !== undefined) return JSON.parse(raw);
    } catch (e) {
      // Fall through to the legacy copy rather than signing out.
    }
    const legacy = await get('creds', null);
    if (legacy) {
      try {
        await setCreds(legacy);
        await remove('creds');
      } catch (e) {
        // Migration is best-effort; the legacy copy still works.
      }
    }
    return legacy;
  }

  async function setCreds(creds) {
    if (!secureStorage()) {
      await set('creds', creds);
      return;
    }
    try {
      await secureSet('creds', JSON.stringify(creds === undefined ? null : creds));
      await remove('creds'); // never leave a plain copy behind
    } catch (e) {
      // A sign-in that cannot save is worse than one saved the old
      // way; the migration in getCreds keeps trying on later launches.
      await set('creds', creds);
    }
  }

  async function clearCreds() {
    if (secureStorage()) {
      try {
        await secureRemove('creds');
      } catch (e) {
        // Already gone.
      }
    }
    await remove('creds');
  }

  /* ---------------- activity history (local only) ---------------- */
  // Every action the app completes is recorded here: the Today screen
  // shows the latest few as Recent activity and the Activity screen
  // shows the whole trail. Entries: { uid, kind, id, title, action, at }.
  // kind is 'cert' | 'class' | 'account' | 'queue'. The trail is read
  // only: entries are never edited or undone (an entry saved by an
  // older version may still carry an 'undone' flag; the lists just
  // show it). The newest 200 entries are kept.
  // History writes are serialized through one promise chain, so two
  // actions finishing at nearly the same moment cannot read the same
  // old list and overwrite each other.

  const getHistory = () => get('history', []);

  let historyChain = Promise.resolve();
  function withHistory(fn) {
    const run = historyChain.then(fn, fn);
    historyChain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  function newUid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  async function addDecision(entry) {
    return withHistory(async () => {
      const list = await getHistory();
      const full = { ...entry, uid: entry.uid || newUid() };
      list.unshift(full);
      const trimmed = list.slice(0, 200);
      await set('history', trimmed);
      return trimmed;
    });
  }

  /* ---------------- alerts snapshot ---------------- */
  // Counts captured when the Alerts tab is opened, so the next visit can
  // flag what grew since the last check.

  const getAlertsSnapshot = () => get('alerts_snapshot', null);
  const setAlertsSnapshot = (snap) => set('alerts_snapshot', snap);

  /* ---------------- self-update cache ---------------- */

  const getUpdateCache = () => get('update_cache', null);
  const setUpdateCache = (cache) => set('update_cache', cache);

  // The version Brandon chose to skip; that version is not offered
  // again, but a newer one still is.
  const getSkippedVersion = () => get('update_skipped', null);
  const setSkippedVersion = (v) => set('update_skipped', v);

  /* ---------------- last-good screen payloads ---------------- */
  // Last successful payload per screen, so a screen can paint instantly
  // and stay honest when a refresh fails. Shape: { at, data }.

  const getLastGood = (name) => get('lastgood_' + name, null);
  const setLastGood = (name, data) => set('lastgood_' + name, { at: Date.now(), data });

  /* ---------------- theme choice ---------------- */
  // 'system' | 'light' | 'dark'. Absent means 'system' (follow the
  // phone). setTheme also mirrors the value into localStorage under
  // the same key, because the inline script in index.html can only
  // read localStorage synchronously before first paint; Preferences
  // stays the source of truth and boot re-applies from it.

  const getTheme = () => get('theme', null);

  async function setTheme(value) {
    await set('theme', value);
    try {
      window.localStorage.setItem(PREFIX + 'theme', JSON.stringify(value));
    } catch (e) {
      // Mirror is best-effort; Preferences already holds the choice.
    }
  }

  /* ---------------- widget counts snapshot ---------------- */
  // One small JSON snapshot for the Android home-screen widget, which
  // reads this key straight out of the Capacitor Preferences storage
  // (SharedPreferences file "CapacitorStorage"). Fields merge, so
  // Approvals and Alerts each contribute the counts they loaded, and
  // "at" always stamps the latest write (ISO 8601, UTC).

  async function updateWidgetCounts(fields) {
    const prev = (await get('widget_counts', null)) || {};
    const next = { ...prev, ...fields, at: new Date().toISOString() };
    await set('widget_counts', next);
    return next;
  }

  /* ---------------- one-time warnings ---------------- */

  const getFlag = (name) => get('flag_' + name, null);
  const setFlag = (name, value) => set('flag_' + name, value === undefined ? true : value);

  window.EasyStore = {
    get,
    set,
    remove,
    getCreds,
    setCreds,
    clearCreds,
    getHistory,
    addDecision,
    getAlertsSnapshot,
    setAlertsSnapshot,
    getUpdateCache,
    setUpdateCache,
    getSkippedVersion,
    setSkippedVersion,
    getLastGood,
    setLastGood,
    getTheme,
    setTheme,
    updateWidgetCounts,
    getFlag,
    setFlag,
  };
})();
