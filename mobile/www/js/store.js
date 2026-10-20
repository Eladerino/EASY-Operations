// store.js: small async key/value layer over Capacitor Preferences.
//
// On device, Preferences lives in the app's private Android storage
// (SharedPreferences). It is private to this app but NOT encrypted; the
// README explains why that is acceptable for this personal sideloaded app.
// In a plain desktop browser (layout preview only) it falls back to
// localStorage so the screens can still be exercised.
(function () {
  'use strict';

  const PREFIX = 'easy_mgr_';

  function nativePrefs() {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Preferences) return cap.Plugins.Preferences;
    return null;
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

  const getCreds = () => get('creds', null);
  const setCreds = (creds) => set('creds', creds);
  const clearCreds = () => remove('creds');

  /* ---------------- decision history (local only) ---------------- */
  // Every approval decision is recorded here so the Today screen can show
  // what was recently decided. Entries: { uid, kind, id, title, action, at }.
  // kind is 'cert' | 'class' | 'account'. Undo is offered only for kinds
  // the API can actually reverse (cert and class status flips).
  // Each entry carries a unique uid so undo marks the right row even
  // when two decisions land in the same millisecond.
  // History writes are serialized through one promise chain, so two
  // decisions finishing at nearly the same moment cannot read the same
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
      const trimmed = list.slice(0, 50);
      await set('history', trimmed);
      return trimmed;
    });
  }

  // Accepts the entry uid; a bare number is treated as a legacy
  // timestamp key from entries saved before uids existed.
  async function markUndone(key) {
    return withHistory(async () => {
      const list = await getHistory();
      const item =
        list.find((e) => e.uid === key) ||
        (typeof key === 'number' ? list.find((e) => e.at === key) : null);
      if (item) {
        item.undone = true;
        await set('history', list);
      }
      return list;
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
    markUndone,
    getAlertsSnapshot,
    setAlertsSnapshot,
    getUpdateCache,
    setUpdateCache,
    getSkippedVersion,
    setSkippedVersion,
    getLastGood,
    setLastGood,
    getFlag,
    setFlag,
  };
})();
