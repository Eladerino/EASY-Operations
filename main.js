// main.js — EASY Operations (main process)
//
// Responsibilities:
//   - create the app window
//   - hold the WordPress credentials (loaded from config.json, never in the renderer)
//   - generate the certificate PDF from the template
//   - upload the PDF + create the cert post via the WP REST API
//   - silently print ID cards on the NISCA PR5350

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const printer = require('pdf-to-printer');
const { fillCertificatePdf } = require('./pdfgen');
const shared = require('./shared');

// Standard Squirrel.Windows startup handling (install / update / uninstall).
if (require('electron-squirrel-startup')) app.quit();

// Self-updates via GitHub Releases (public repo Eladerino/EASY-Operations).
// Only runs in the packaged app; in dev it would just be noise.
//
// Policy:
// - An update found DURING operation just notifies — office staff can
//   finish what they're doing and restart later.
// - An update still uninstalled at the NEXT launch is mandatory: the app
//   shows a blocking "Restart to update" prompt before the main window
//   opens, so staff can never run more than one session behind.
const PENDING_UPDATE_FILE = () => path.join(app.getPath('userData'), 'pending-update.json');
let gateCheckInFlight = false;

function readPendingUpdate() {
  try {
    const data = JSON.parse(fs.readFileSync(PENDING_UPDATE_FILE(), 'utf8'));
    return data && data.version ? data : null;
  } catch {
    return null;
  }
}

function writePendingUpdate(version) {
  try {
    fs.writeFileSync(PENDING_UPDATE_FILE(), JSON.stringify({ version }), 'utf8');
  } catch (err) {
    console.error('[updater] could not record pending update:', err && err.message);
  }
}

function clearPendingUpdate() {
  try { fs.unlinkSync(PENDING_UPDATE_FILE()); } catch { /* already gone */ }
}

// Minimal semver compare: true when a is strictly newer than b.
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Settles when the update check resolves: 'downloaded' | 'none' | 'error'.
// Never rejects; times out so a dead network can't brick the launch.
function checkForUpdatesSettled(timeoutMs) {
  const { autoUpdater } = require('electron');
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => finish('error'), timeoutMs || 30000);
    autoUpdater.once('update-downloaded', () => { clearTimeout(timer); finish('downloaded'); });
    autoUpdater.once('update-not-available', () => { clearTimeout(timer); finish('none'); });
    autoUpdater.once('error', () => { clearTimeout(timer); finish('error'); });
    try {
      autoUpdater.checkForUpdates();
    } catch {
      clearTimeout(timer);
      finish('error');
    }
  });
}

// Startup gate: if a previous session downloaded an update that never got
// installed, re-verify it against the feed and force the restart before the
// main window opens. Returns true when the app is about to quit for the
// install (caller must not create the main window).
async function maybeGateForPendingUpdate() {
  if (!app.isPackaged) return false;
  const pending = readPendingUpdate();
  if (!pending || !isNewerVersion(pending.version, app.getVersion())) {
    if (pending) clearPendingUpdate();
    return false;
  }
  gateCheckInFlight = true;
  try {
    const result = await checkForUpdatesSettled(30000);
    if (result === 'downloaded') {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Update ready',
        message: `EASY Operations ${pending.version} has been downloaded.`,
        detail: 'Please restart to apply the update before continuing.',
        buttons: ['Restart to update'],
        noLink: true,
      });
      // No way forward except the restart — that is the point of the gate.
      require('electron').autoUpdater.quitAndInstall();
      return true;
    }
    // Definitive "nothing pending" clears a stale flag; a network failure
    // keeps the flag so the next launch tries again. Either way the app
    // opens — an unreachable feed must never brick the launch.
    if (result === 'none') clearPendingUpdate();
    return false;
  } finally {
    gateCheckInFlight = false;
  }
}

// Background updater: update-electron-app checks on launch and every
// hour. Downloading is silent; a downloaded update notifies gently and
// records itself so the next launch can enforce it (see
// maybeGateForPendingUpdate).
function initUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron');
    require('update-electron-app').updateElectronApp({ notifyUser: false, updateInterval: '1 hour' });
    autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
      const version = String(releaseName || '').trim() || 'new version';
      writePendingUpdate(version);
      if (gateCheckInFlight) return; // the gate is handling this one
      dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `EASY Operations ${version} is ready to install.`,
        detail: 'Restart now to apply it, or later — it will be required the next time you open the app.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) {
          clearPendingUpdate();
          autoUpdater.quitAndInstall();
        }
      }).catch(() => { /* dialog dismissed */ });
    });
  } catch (err) {
    console.error('[updater] failed to start:', err && err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function configPaths() {
  return {
    userPath: path.join(app.getPath('userData'), 'config.json'),
    devPath: path.join(__dirname, 'config.json'),
    examplePath: path.join(__dirname, 'config.example.json'),
  };
}

function loadConfig() {
  const { userPath, devPath, examplePath } = configPaths();

  let cfgPath = null;
  if (fs.existsSync(userPath)) cfgPath = userPath;
  else if (!app.isPackaged && fs.existsSync(devPath)) cfgPath = devPath;

  // First run: seed a template config so the user just has to fill it in.
  if (!cfgPath) {
    try {
      fs.mkdirSync(path.dirname(userPath), { recursive: true });
      if (fs.existsSync(examplePath)) fs.copyFileSync(examplePath, userPath);
    } catch (err) {
      console.error('Could not seed config.json:', err);
    }
    return {
      ok: false,
      path: userPath,
      error: 'No config.json found. A template has been created — fill in your WordPress credentials and restart the app.',
    };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    return { ok: false, path: cfgPath, error: `config.json is not valid JSON: ${err.message}` };
  }

  const missing = [];
  if (!raw.wpBaseUrl) missing.push('wpBaseUrl');
  const hasInstructorAuth = raw.wpUser && raw.wpUser.user && (raw.wpUser.appPassword || raw.wpUser.appPasswordEnc);
  const hasLegacyAuth =
    raw.mediaAuth && raw.mediaAuth.user && raw.mediaAuth.appPassword &&
    raw.postAuth && raw.postAuth.user && raw.postAuth.appPassword;
  if (!hasInstructorAuth && !hasLegacyAuth) {
    missing.push('wpUser.user / wpUser.appPassword (or the legacy mediaAuth/postAuth)');
  }
  if (missing.length) {
    return { ok: false, path: cfgPath, error: `config.json is missing: ${missing.join(', ')}` };
  }

  return { ok: true, path: cfgPath, ...raw };
}

let cachedConfig = null;
function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

function basicAuth({ user, appPassword }) {
  const clean = String(appPassword).replace(/\s+/g, '');
  return 'Basic ' + Buffer.from(`${user}:${clean}`, 'utf8').toString('base64');
}

// Application passwords are encrypted with the OS keychain (safeStorage)
// when available. A plaintext wpUser.appPassword is still read as a
// fallback for configs written before encryption, and migrated on launch.
function encryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
}
function encryptPassword(plain) {
  if (!encryptionAvailable()) return null;
  try { return safeStorage.encryptString(String(plain)).toString('base64'); }
  catch (e) { return null; }
}
function decryptPassword(enc) {
  if (!enc || !encryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(String(enc), 'base64')); }
  catch (e) { return ''; }
}
function wpAppPassword(wpUser) {
  return decryptPassword(wpUser.appPasswordEnc) || wpUser.appPassword || '';
}
// Config writes go through a temp file + rename so a crash mid-write can
// never leave a half-written config.json behind.
function writeConfigAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
}

// Migrate a plaintext stored password to OS-keychain encryption, once.
function maybeMigratePasswordEncryption(config) {
  if (!config.ok || !config.wpUser || !config.wpUser.appPassword || config.wpUser.appPasswordEnc) return;
  if (!encryptionAvailable()) return;
  const enc = encryptPassword(config.wpUser.appPassword);
  if (!enc) return;
  try {
    const raw = JSON.parse(fs.readFileSync(config.path, 'utf8'));
    raw.wpUser.appPasswordEnc = enc;
    delete raw.wpUser.appPassword;
    writeConfigAtomic(config.path, raw);
    cachedConfig = null;
  } catch (e) { /* keep the plaintext config rather than breaking sign-in */ }
}

// Effective WordPress credentials: the per-instructor login when the setup
// wizard wrote the config, otherwise the legacy shared mediaAuth/postAuth.
function effectiveAuth(config) {
  if (config.wpUser && config.wpUser.user && (config.wpUser.appPassword || config.wpUser.appPasswordEnc)) {
    const creds = { user: config.wpUser.user, appPassword: wpAppPassword(config.wpUser) };
    return { media: creds, post: creds };
  }
  return {
    media: { user: config.mediaAuth.user, appPassword: config.mediaAuth.appPassword },
    post: { user: config.postAuth.user, appPassword: config.postAuth.appPassword },
  };
}

// 'instructor' = signed in as themselves (identity locked in the UI);
// 'office' = the shared/legacy setup where instructor details are typed in.
function configMode(config) {
  if (config.mode === 'instructor' || config.mode === 'office') return config.mode;
  return config.wpUser && config.wpUser.user ? 'instructor' : 'office';
}

// Accounts allowed to post certificates on behalf of other instructors
// (e.g. office staff). The list lives on the site (EASY Suite → Settings)
// and is read from /easy/v1/app-config; PROXY_POSTER_FALLBACK only applies
// when the site is older than EASY Suite 2.1 or can't be reached. Everyone
// else in instructor mode stays locked to their own identity, in the UI and
// at submit time (and the site enforces the same rule).
const PROXY_POSTER_FALLBACK = ['pevans'];
let proxyPosterCache = null; // { user, value }

async function isProxyPoster(config) {
  const u = config && config.ok && config.wpUser && config.wpUser.user;
  if (!u) return false;
  if (proxyPosterCache && proxyPosterCache.user === u) return proxyPosterCache.value;
  let value = PROXY_POSTER_FALLBACK.includes(String(u).trim().toLowerCase());
  try {
    const base = config.wpBaseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/wp-json/easy/v1/app-config`, {
      headers: { Authorization: basicAuth(effectiveAuth(config).post) },
      // Startup waits on this, so a slow site mustn't hold the app up.
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (typeof json.proxyPoster === 'boolean') value = json.proxyPoster;
      proxyPosterCache = { user: u, value };
    }
  } catch (e) { /* offline: use the fallback, and ask again next time */ }
  return value;
}

/* ------------------------------------------------------------------ */
/* Window + app lifecycle                                              */
/* ------------------------------------------------------------------ */

// Deny in-window navigation and popups: the app only ever shows local
// files. Anything external goes through shell.openExternal explicitly.
function lockDownWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!String(url).startsWith('file://')) e.preventDefault();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 940,
    minWidth: 960,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#eef1f6',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  lockDownWindow(win);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    maybeMigratePasswordEncryption(getConfig());
    const config = getConfig();
    if (!config.ok) {
      dialog.showErrorBox('EASY Operations — setup needed', `${config.error}\n\nFile: ${config.path}`);
    }
    // A downloaded-but-uninstalled update from a previous session is
    // mandatory: restart to apply it before the main window opens.
    if (await maybeGateForPendingUpdate()) return;
    createWindow();
    initUpdater();
    maybeShowWhatsNew();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/* ------------------------------------------------------------------ */
/* Silent card printing                                                */
/* ------------------------------------------------------------------ */

let printerCache = null;
let printerCacheAt = 0;

// The printer list rarely changes; cache it briefly instead of
// querying on every single print.
async function getPrinterList() {
  const now = Date.now();
  if (!printerCache || now - printerCacheAt > 60000) {
    printerCache = await printer.getPrinters();
    printerCacheAt = now;
  }
  return printerCache;
}

async function findPrinter(nameContains) {
  const list = await getPrinterList();
  return list.find((p) => p.name.includes(nameContains)) || null;
}

// The exact printer name picked in the setup wizard wins; otherwise fall
// back to the legacy substring match from config.json.
async function resolvePrinterTarget(config) {
  if (config.printerName) {
    const list = await getPrinterList();
    const exact = list.find((p) => p.name === config.printerName);
    if (!exact) {
      throw new Error(
        `The configured card printer "${config.printerName}" was not found. Open Setup to pick it again.`
      );
    }
    return exact;
  }
  return findPrinter(config.printerNameContains || 'Nisca PR5350');
}

function sumatraPath(config) {
  const exe = config.sumatraExe || 'SumatraPDF-3.4.6-32.exe';
  if (app.isPackaged) {
    // Executables cannot run from inside the asar archive; forge's
    // asarUnpack places it alongside as app.asar.unpacked/<exe>.
    return path.join(process.resourcesPath, 'app.asar.unpacked', exe);
  }
  return path.join(__dirname, exe);
}

async function printPdfBuffer(pdfBuffer, config) {
  const tmpName = `easy-cert-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  try {
    await fs.promises.writeFile(tmpPath, pdfBuffer);

    const target = await resolvePrinterTarget(config);
    if (!target) {
      throw new Error(
        `No printer matching "${config.printerNameContains || 'Nisca PR5350'}" was found. Open Setup to pick one.`
      );
    }

    await printer.print(tmpPath, {
      printer: target.name,
      sumatraPdfPath: sumatraPath(config),
      silent: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* What's New — changelog dialog on version change                      */
/* ------------------------------------------------------------------ */

const WHATS_NEW_FILE = () => path.join(app.getPath('userData'), 'whats-new.json');

// Newest first in the object; shown oldest-first in the dialog.
// Keep notes short and plain-language: Pam reads these. Nothing
// business-internal here — instructors see these notes too.
const WHATS_NEW_NOTES = {
  '1.2.6': [
    'The app now checks for updates once an hour instead of every 10 minutes.',
    'Removing a student who paid online now explains itself instead of failing: cancel or refund their order on the website.',
    'If the student list changes while you are adding someone, your entry is kept instead of discarded.',
    'Publishing a certificate now double-checks that WordPress actually published it before saying the student was notified.',
  ],
  '1.2.5': [
    'Fixed: rejecting an account request now follows the website\'s own steps instead of skipping them.',
    'Fixed: a clearer message when the saved login stops working, and the Approvals tab no longer mentions the old bridge plugin.',
  ],
  '1.2.4': [
    'Fixed: the student list can no longer be accidentally overwritten when a seat sells online while it is open. You will see the fresh list and can try again.',
    'Fixed: students who paid online can only be removed by cancelling or refunding the order.',
  ],
  '1.2.3': [
    'New: the class editor shows whether a class is selling seats on the website, with the price, seats left, and seats sold.',
  ],
  '1.2.2': [
    'New: set how many seats a class sells on the website right in the class editor (Seats field).',
  ],
  '1.2.1': [
    'New: a "What\'s New" button in the header shows what changed after each update.',
  ],
  '1.2.0': [
    'New: manage class rosters in the Schedule tab. Open a class, click Students, and add walk-ins or phone bookings with name, employer, phone, email, payment status, and notes.',
    'If a class sells seats on the website, adding students here adjusts the online seat count automatically.',
  ],
  '1.1.1': [
    'Fixed: ID card printing to the card printer was broken in every installed build since 1.0.0. It works now.',
    'The course editor loads reliably again (fixed a display issue).',
  ],
  '1.1.0': [
    'New: Course Builder for putting courses together (chapters, quizzes, pass rules).',
    'Course work now backs up automatically.',
    'Leap-day fix: certificates expiring on Feb 29 in non-leap years no longer break.',
  ],
};

function getWhatsNewSeen() {
  try {
    const raw = fs.readFileSync(WHATS_NEW_FILE(), 'utf8');
    const data = JSON.parse(raw);
    return typeof data.seen === 'string' ? data.seen : '';
  } catch {
    return '';
  }
}

function setWhatsNewSeen(version) {
  try {
    fs.writeFileSync(WHATS_NEW_FILE(), JSON.stringify({ seen: version }), 'utf8');
  } catch {
    /* non-fatal: the dialog just shows again next launch */
  }
}

/** Notes for every version newer than `seen`, oldest first. */
function whatsNewSince(seen) {
  const base = seen || '0.0.0';
  const versions = Object.keys(WHATS_NEW_NOTES).filter((v) => isNewerVersion(v, base));
  versions.sort((a, b) => (isNewerVersion(a, b) ? 1 : -1));
  return versions.map((v) => ({ version: v, notes: WHATS_NEW_NOTES[v] }));
}

function showWhatsNewDialog(entries) {
  const win = BrowserWindow.getAllWindows()[0];
  const detail = entries
    .map((e) => `Version ${e.version}\n` + e.notes.map((n) => `\u2022 ${n}`).join('\n'))
    .join('\n\n');
  dialog.showMessageBox(win, {
    type: 'info',
    title: "What's New — EASY Operations",
    message: "What's new in EASY Operations",
    detail,
    buttons: ['Close'],
    noLink: true,
  });
}

/** After an update, show what changed (once per version). */
function maybeShowWhatsNew() {
  const current = app.getVersion();
  const seen = getWhatsNewSeen();
  if (!seen || isNewerVersion(current, seen)) {
    const entries = whatsNewSince(seen);
    if (entries.length > 0) {
      setTimeout(() => showWhatsNewDialog(entries), 1500);
    }
    setWhatsNewSeen(current);
  }
}

ipcMain.handle('show-whats-new', async () => {
  const entries = whatsNewSince('0.0.0').slice(-3);
  if (entries.length > 0) {
    showWhatsNewDialog(entries);
  }
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Build tag — lets the renderer detect stale/mismatched app files      */
/* ------------------------------------------------------------------ */

const BUILD_TAG = 'ops-20261010c';

// Instructors always connect here; the setup screen shows it read-only.
const SETUP_SITE_URL = 'https://easysafety.ca';

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Certificate preview / print-dialog / save-a-copy                     */
/* ------------------------------------------------------------------ */

// The most recently generated certificate PDF, kept on disk so the
// renderer can preview it and the user can print or save it afterwards.
// Replaced on every submit; removed when the app quits.
let lastPdfPath = null;
let lastPdfName = null;

async function storePreviewPdf(pdfBuffer, filename) {
  if (lastPdfPath) {
    await fs.promises.unlink(lastPdfPath).catch(() => {});
    lastPdfPath = null;
  }
  const tmpName = `easy-cert-preview-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  await fs.promises.writeFile(tmpPath, pdfBuffer);
  lastPdfPath = tmpPath;
  lastPdfName = filename;
  return tmpPath;
}

app.on('before-quit', () => {
  if (lastPdfPath) fs.unlink(lastPdfPath, () => {});
});

// ---- First-time setup ----------------------------------------------------
// Validates a WordPress username + application password without saving
// anything. Used by the setup wizard's "Test connection" button.
ipcMain.handle('test-connection', async (_event, args = {}) => {
  const base = String(args.baseUrl || '').replace(/\/+$/, '');
  const user = String(args.user || '').trim();
  const appPassword = String(args.appPassword || '');
  if (!base || !user || !appPassword) {
    return { ok: false, error: 'Site URL, username and application password are all required.' };
  }
  try {
    // Edit context includes the capabilities field (used as the upload
    // fallback below). Some limited accounts cannot use edit context, so
    // fall back to the plain call instead of failing setup for them.
    let res = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: basicAuth({ user, appPassword }) },
    });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(`${base}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: basicAuth({ user, appPassword }) },
      });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'WordPress rejected those credentials. Double-check the username and application password.' };
      }
      return { ok: false, error: json.message || `WordPress returned HTTP ${res.status}.` };
    }
    // Probe the real upload permission: listing media in edit context
    // requires editing rights. (The capabilities field on users/me can be
    // filtered out of REST responses by security plugins, so it is only a
    // fallback here, never the primary signal.)
    let canUpload = null;
    try {
      // context=edit: the plain media list is public, so without it every
      // account passed this check, upload rights or not.
      const probe = await fetch(`${base}/wp-json/wp/v2/media?per_page=1&context=edit`, {
        headers: { Authorization: basicAuth({ user, appPassword }) },
      });
      if (probe.ok) canUpload = true;
      else if (probe.status === 400 || probe.status === 401 || probe.status === 403) canUpload = false;
    } catch {
      canUpload = null;
    }
    if (canUpload === null) {
      const caps = json.capabilities || {};
      canUpload = caps.upload_files === true;
    }
    return {
      ok: true,
      id: json.id,
      username: json.username,
      name: json.name || json.username,
      email: json.email || '',
      canUpload,
    };
  } catch (err) {
    return { ok: false, error: `Could not reach ${base}: ${err.message}` };
  }
});

ipcMain.handle('open-profile', async () => {
  await shell.openExternal(`${SETUP_SITE_URL}/wp-admin/profile.php`);
  return { ok: true };
});

ipcMain.handle('get-printers', async () => {
  try {
    const list = await getPrinterList();
    return { ok: true, printers: list.map((p) => p.name) };
  } catch (err) {
    return { ok: false, error: `Could not list printers: ${err.message}` };
  }
});

// Writes the per-instructor config produced by the setup wizard.
ipcMain.handle('save-setup', async (_event, setup = {}) => {
  try {
    const { userPath } = configPaths();
    const rawBase = String(setup.baseUrl || '').replace(/\/+$/, '');
    if (rawBase.toLowerCase() !== SETUP_SITE_URL) {
      return { ok: false, error: `This app only connects to ${SETUP_SITE_URL}.` };
    }
    const encPassword = encryptPassword(setup.appPassword || '');
    const config = {
      wpBaseUrl: SETUP_SITE_URL,
      mode: 'instructor',
      wpUser: encPassword
        ? { user: String(setup.user || '').trim(), appPasswordEnc: encPassword }
        : { user: String(setup.user || '').trim(), appPassword: String(setup.appPassword || '') },
      instructor: { name: setup.name || '', email: setup.email || '' },
      printerName: setup.printerName || null,
      sumatraExe: 'SumatraPDF-3.4.6-32.exe',
    };
    if (!config.wpBaseUrl || !config.wpUser.user || !(config.wpUser.appPassword || config.wpUser.appPasswordEnc)) {
      return { ok: false, error: 'Site URL, username and application password are required.' };
    }
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    writeConfigAtomic(userPath, config);
    cachedConfig = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not save the setup: ${err.message}` };
  }
});

// Updates only the card-printer choice, leaving the saved sign-in alone —
// changing printers never forces a new application password.
ipcMain.handle('set-printer', async (_event, name) => {
  try {
    const config = getConfig();
    if (!config.ok) return { ok: false, error: 'No saved setup found. Run Setup first.' };
    const raw = JSON.parse(fs.readFileSync(config.path, 'utf8'));
    raw.printerName = name || null;
    writeConfigAtomic(config.path, raw);
    cachedConfig = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not save the printer: ${err.message}` };
  }
});

// Signs out: deletes the saved login so the setup wizard runs again.
ipcMain.handle('reset-setup', async () => {
  try {
    const { userPath, devPath } = configPaths();
    if (fs.existsSync(userPath)) fs.unlinkSync(userPath);
    if (!app.isPackaged && fs.existsSync(devPath)) fs.unlinkSync(devPath);
    cachedConfig = null;
    printerCache = null;
    proxyPosterCache = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reset the setup: ${err.message}` };
  }
});

ipcMain.handle('get-app-info', async () => {
  const config = getConfig();
  const mode = config.ok ? configMode(config) : null;
  const instructor =
    config.ok && mode === 'instructor' && config.instructor
      ? { name: config.instructor.name || '', email: config.instructor.email || '' }
      : null;
  return {
    version: app.getVersion(),
    buildTag: BUILD_TAG,
    configOk: config.ok,
    configPath: config.path,
    configError: config.ok ? null : config.error,
    mode,
    instructor,
    printerConfigured: config.ok ? Boolean(config.printerName || config.printerNameContains) : false,
    printerName: config.ok ? config.printerName || null : null,
    accountUser: config.ok && config.wpUser ? config.wpUser.user || null : null,
    proxyPosting: config.ok ? await isProxyPoster(config) : false,
  };
});

// Only these ACF fields are ever forwarded to WordPress — anything else in
// the payload is dropped rather than written.
const ALLOWED_ACF_KEYS = new Set([
  'student_name', 'student_email', 'student_phone',
  'course_category', 'course_title', 'completion_date', 'expiry_date',
  'instructor', 'instructor_email', 'company', 'company_contact',
  'certificate_number', 'wpnl', 'certificate',
]);

// Ensure a certificate number isn't already taken. EASY Suite 2.1+ answers
// from every certificate on the site (drafts included); older sites fall
// back to scanning the newest 100 published certs. Fails open (keeps the
// candidate) when no check can run, so a WP hiccup never blocks posting;
// the site still refuses a duplicate at save time.
async function resolveUniqueCertificateNumber(base, auth, candidate, excludePostId) {
  if (candidate) {
    try {
      const q = new URLSearchParams({ candidate: String(candidate), exclude: String(excludePostId || 0) });
      const r = await fetch(`${base}/wp-json/easy/v1/cert-number?${q}`, {
        headers: { Authorization: basicAuth(auth) },
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok && json.number) return String(json.number);
      if (r.status === 409) throw new Error(json.message || 'No free certificate number is left for this course and date.');
    } catch (e) {
      if (/certificate number/i.test(e.message)) throw e;
      /* network error: fall through to the scan */
    }
  }
  let existing = [];
  try {
    const r = await fetch(`${base}/wp-json/wp/v2/cert?per_page=100&orderby=date&order=desc&_fields=id,acf`, {
      headers: { Authorization: basicAuth(auth) },
    });
    const arr = await r.json().catch(() => []);
    for (const c of (Array.isArray(arr) ? arr : [])) {
      if (excludePostId && c.id === excludePostId) continue;
      const num = c.acf && c.acf.certificate_number;
      if (num) existing.push(String(num));
    }
  } catch (e) { return String(candidate || ''); }
  return shared.nextFreeCertificateNumber(candidate, existing);
}

ipcMain.handle('submit-certificate', async (_event, payload) => {
  const config = getConfig();
  if (!config.ok) {
    return { ok: false, error: config.error, configPath: config.path };
  }
  // A malformed payload from the renderer must not throw a raw TypeError
  // out of the handler; the app speaks {ok:false}.
  if (!payload || typeof payload !== 'object' || !payload.pdf || !payload.acf) {
    return { ok: false, error: 'The certificate data was incomplete. Fill in the form and try again.' };
  }

  const auth = effectiveAuth(config);

  const base = config.wpBaseUrl.replace(/\/+$/, '');
  const updateId = parseInt(payload.updateId, 10) || 0;
  let uploadedMediaId = 0;
  let postSucceeded = false;

  try {
    // Instructor mode: stamp the signed-in instructor's identity here in the
    // main process, so the posted record cannot be re-attributed from the UI.
    // Proxy posters (e.g. designated office accounts) are exempt — their form values flow through.
    if (configMode(config) === 'instructor' && config.instructor && !(await isProxyPoster(config))) {
      if (config.instructor.name) {
        payload.pdf.instructorName = config.instructor.name;
        payload.acf.instructor = config.instructor.name;
      }
      if (config.instructor.email) {
        payload.acf.instructor_email = config.instructor.email;
      }
    }

    // 0. Guarantee a unique certificate number before anything is generated:
    // scan recent certs and auto-bump the instance on collision.
    const finalNumber = await resolveUniqueCertificateNumber(
      base, auth.post, payload.acf && payload.acf.certificate_number, updateId);
    if (payload.acf) payload.acf.certificate_number = finalNumber;
    if (payload.pdf) payload.pdf.certificateNumber = finalNumber;

    // On draft updates, note the current PDF so it can be removed once the
    // replacement is live (no orphaned media).
    let oldMediaId = 0;
    if (updateId) {
      try {
        const curRes = await fetch(`${base}/wp-json/wp/v2/cert/${updateId}?_fields=acf`, {
          headers: { Authorization: basicAuth(auth.post) },
        });
        const curJson = await curRes.json().catch(() => ({}));
        oldMediaId = parseInt(curJson.acf && curJson.acf.certificate, 10) || 0;
      } catch (e) { /* best-effort: cleanup just won't happen */ }
    }

    // 1. Generate the certificate PDF from the template.
    const templateBytes = fs.readFileSync(path.join(__dirname, 'EASY_CertTemplate.pdf'));
    const pdfBuffer = await fillCertificatePdf(templateBytes, payload.pdf);
    const previewPath = await storePreviewPdf(pdfBuffer, payload.filename);

    // 2. Upload the PDF to the WordPress media library.
    const pdfFile = new File([pdfBuffer], payload.filename, { type: 'application/pdf' });
    const uploadForm = new FormData();
    uploadForm.append('file', pdfFile, payload.filename);
    // Marker for the server (EASY Core 1.5.0+): route cert PDFs into the
    // private, gatekeeper-served folder instead of public uploads.
    uploadForm.append('easy_cert_pdf', '1');

    const mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: { Authorization: basicAuth(auth.media) },
      body: uploadForm,
    });
    const mediaJson = await mediaRes.json().catch(() => ({}));
    if (!mediaRes.ok || !mediaJson.id) {
      throw new Error(mediaJson.message || 'PDF upload to WordPress failed.');
    }
    uploadedMediaId = mediaJson.id;

    // 3. Create the cert post with its ACF fields — or update an existing
    // draft when the renderer is editing one (fix-before-publish).
    const postForm = new FormData();
    postForm.append('title', payload.title);
    for (const [key, value] of Object.entries(payload.acf || {})) {
      if (!ALLOWED_ACF_KEYS.has(key)) continue;
      postForm.append(`acf[${key}]`, value ?? '');
    }
    postForm.append('acf[certificate]', String(mediaJson.id));

    const postUrl = updateId
      ? `${base}/wp-json/wp/v2/cert/${updateId}`
      : `${base}/wp-json/wp/v2/cert`;
    const postRes = await fetch(postUrl, {
      method: 'POST',
      headers: { Authorization: basicAuth(auth.post) },
      body: postForm,
    });
    const postJson = await postRes.json().catch(() => ({}));
    if (!postRes.ok || !postJson.id) {
      throw new Error(postJson.message || (updateId ? 'Certificate draft update failed.' : 'Certificate post creation failed.'));
    }
    postSucceeded = true;
    if (updateId) {
      // Draft updated: delete the superseded PDF so it doesn't orphan.
      // No card print, no "posted" dialog — the reviewer stays in the
      // approval workflow.
      // (EASY Suite also deletes it server-side when the certificate field
      // changes, so a 404 here just means the site got there first.)
      if (oldMediaId && oldMediaId !== mediaJson.id) {
        try {
          const delRes = await fetch(`${base}/wp-json/wp/v2/media/${oldMediaId}?force=true`, {
            method: 'DELETE',
            headers: { Authorization: basicAuth(auth.media) },
          });
          if (!delRes.ok && delRes.status !== 404) {
            console.warn(`Superseded certificate PDF ${oldMediaId} was not deleted (HTTP ${delRes.status}).`);
          }
        } catch (e) { console.warn('Superseded certificate PDF cleanup failed:', e.message); }
      }
      return { ok: true, updated: true, postId: postJson.id, mediaId: mediaJson.id, pdfPath: previewPath, certificateNumber: finalNumber };
    }

    // 4. Optionally print the physical ID card.
    let print = null;
    if (payload.printCard) {
      print = await printPdfBuffer(pdfBuffer, config);
    }

    return { ok: true, postId: postJson.id, mediaId: mediaJson.id, print, pdfPath: previewPath, certificateNumber: finalNumber };
  } catch (err) {
    // The post failed after a successful upload: delete the orphaned PDF
    // rather than leaving it in the media library.
    if (uploadedMediaId && !postSucceeded) {
      try {
        const delRes = await fetch(`${base}/wp-json/wp/v2/media/${uploadedMediaId}?force=true`, {
          method: 'DELETE',
          headers: { Authorization: basicAuth(auth.media) },
        });
        if (!delRes.ok) {
          console.warn(`Orphaned certificate PDF ${uploadedMediaId} was not deleted (HTTP ${delRes.status}).`);
        }
      } catch (e) { console.warn('Orphaned certificate PDF cleanup failed:', e.message); }
    }
    console.error('submit-certificate failed:', err);
    return { ok: false, error: err.message };
  }
});

// Print an arbitrary PDF file with the normal system print dialog
// (separate from the silent NISCA card path). Used by the post-submit
// flow (latest generated PDF) and by certificate reprint.
async function printPdfFile(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return { ok: false, error: 'No certificate PDF is available to print yet.' };
  }

  const { pathToFileURL } = require('url');
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true },
  });
  lockDownWindow(printWin);

  try {
    await printWin.loadURL(pathToFileURL(pdfPath).href);
    // Give the built-in PDF viewer a moment to render before printing.
    await new Promise((r) => setTimeout(r, 600));

    const printed = await new Promise((resolve) => {
      printWin.webContents.print({ silent: false }, (success, failureReason) => {
        resolve({ success, failureReason });
      });
    });

    if (!printed.success) {
      if (printed.failureReason === 'cancelled') return { ok: true, canceled: true };
      return { ok: false, error: `Printing failed (${printed.failureReason || 'unknown reason'}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
  }
}

// Print the most recently generated certificate with the normal
// system print dialog (separate from the silent NISCA card path).
ipcMain.handle('print-pdf-dialog', async () => {
  return printPdfFile(lastPdfPath);
});

// Save a copy of the most recently generated certificate PDF anywhere.
ipcMain.handle('save-pdf-copy', async () => {
  if (!lastPdfPath || !fs.existsSync(lastPdfPath)) {
    return { ok: false, error: 'No certificate PDF is available to save yet.' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save certificate PDF',
    defaultPath: lastPdfName || 'certificate.pdf',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    await fs.promises.copyFile(lastPdfPath, filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open the most recently generated certificate in the system's default
// PDF viewer (Edge/Adobe on Windows) — guaranteed preview + print path
// even if the in-app preview ever misbehaves.
ipcMain.handle('open-pdf-external', async () => {
  if (!lastPdfPath || !fs.existsSync(lastPdfPath)) {
    return { ok: false, error: 'No certificate PDF is available to open yet.' };
  }
  try {
    await shell.openPath(lastPdfPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ------------------------------------------------------------------ */
/* Course Builder — automatic file backups                              */
/*                                                                     */
/* The builder keeps course content in localStorage, so a             */
/* profile wipe or reinstall would lose it. The renderer sends a       */
/* debounced snapshot after local saves; we write it to                */
/* <userData>/course-builder-backups/ as a timestamped JSON file plus  */
/* a rolling latest.json, keeping the newest 20 snapshots.             */
/* ------------------------------------------------------------------ */

const BUILDER_BACKUP_DIR = () => path.join(app.getPath('userData'), 'course-builder-backups');
const BUILDER_BACKUP_KEEP = 20;

function builderBackupStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

ipcMain.handle('course-builder-backup', async (_event, snapshot) => {
  try {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'Invalid snapshot.' };
    const payload = {
      app: 'EASYOperations-course-builder',
      savedAt: new Date().toISOString(),
      courses: Array.isArray(snapshot.courses) ? snapshot.courses : [],
      inbox: Array.isArray(snapshot.inbox) ? snapshot.inbox : [],
      authors: Array.isArray(snapshot.authors) ? snapshot.authors : [],
    };
    const dir = BUILDER_BACKUP_DIR();
    await fs.promises.mkdir(dir, { recursive: true });
    const body = JSON.stringify(payload, null, 2);
    const file = path.join(dir, `backup-${builderBackupStamp(new Date())}.json`);
    await fs.promises.writeFile(file, body, 'utf8');
    await fs.promises.writeFile(path.join(dir, 'latest.json'), body, 'utf8');
    const entries = (await fs.promises.readdir(dir))
      .filter((n) => /^backup-\d{8}-\d{6}\.json$/.test(n))
      .sort()
      .reverse();
    for (const old of entries.slice(BUILDER_BACKUP_KEEP)) {
      await fs.promises.unlink(path.join(dir, old)).catch(() => {});
    }
    return { ok: true, path: file, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('course-builder-backup-folder', async () => {
  try {
    const dir = BUILDER_BACKUP_DIR();
    await fs.promises.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ------------------------------------------------------------------ */
/* Course Builder — site sync (EASY Suite "courses" module)             */
/*                                                                     */
/* One channel with a fixed set of operations, each mapped to one      */
/* route under /wp-json/easy/v1/course-builder/. Ids are checked here  */
/* so the renderer can't steer requests anywhere else. Results:        */
/*   { ok: true, status, data }                                        */
/*   { ok: false, status, code, error, data, missing }  site answered  */
/*   { ok: false, offline: true, error }                 no answer      */
/* `missing` means the site has no courses module (older EASY Suite or  */
/* switched off), so the builder falls back to passing files around.   */
/* ------------------------------------------------------------------ */

const COURSE_ID_RE = /^[a-z0-9_-]{1,64}$/;

function courseSyncRoute(op, args) {
  const cid = () => {
    const id = String(args.id || '');
    if (!COURSE_ID_RE.test(id)) throw new Error('Invalid course id.');
    return id;
  };
  const sid = () => {
    const id = parseInt(args.reviewId, 10);
    if (!(id > 0)) throw new Error('Invalid review id.');
    return id;
  };
  const content = () => ({
    course: args.course && typeof args.course === 'object' ? args.course : null,
    baseRev: Number.isInteger(args.baseRev) && args.baseRev > 0 ? args.baseRev : 0,
  });
  switch (op) {
    case 'me': return ['GET', '/course-builder/me'];
    case 'list': return ['GET', '/course-builder/courses'];
    case 'save': return ['POST', `/course-builder/courses/${cid()}`, content()];
    case 'delete': return ['DELETE', `/course-builder/courses/${cid()}`];
    case 'submit': return ['POST', `/course-builder/courses/${cid()}/review`, content()];
    case 'withdraw': return ['POST', `/course-builder/courses/${cid()}/withdraw`, {}];
    case 'final': return ['GET', `/course-builder/courses/${cid()}/final`];
    case 'reviews': return ['GET', '/course-builder/reviews'];
    case 'approve': return ['POST', `/course-builder/reviews/${sid()}/approve`, {}];
    case 'sendBack': return ['POST', `/course-builder/reviews/${sid()}/send-back`, { note: String(args.note || '').slice(0, 2000) }];
    case 'setAuthors': {
      const list = Array.isArray(args.authors) ? args.authors.map((a) => String(a).trim()).filter(Boolean).slice(0, 50) : [];
      return ['POST', '/course-builder/authors', { authors: list }];
    }
    default: throw new Error('Unknown Course Builder operation.');
  }
}

ipcMain.handle('course-sync', async (_event, { op, args = {} } = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  let route;
  try {
    route = courseSyncRoute(String(op || ''), args || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const [method, endpoint, body] = route;
  try {
    const r = await easyRequest(config, method, endpoint, { body, timeoutMs: 30000 });
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, data: r.json };
    const code = r.json && r.json.code;
    return {
      ok: false,
      status: r.status,
      code,
      missing: r.status === 404 && code === 'rest_no_route',
      error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.`,
      data: r.json && r.json.data,
    };
  } catch (err) {
    return { ok: false, offline: true, error: `Could not reach the site: ${err.message}` };
  }
});

/* ------------------------------------------------------------------ */
/* Schedule tab — The Events Calendar REST API (legacy v1)              */
/*                                                                     */
/* Uses the stable legacy namespace /wp-json/tribe/events/v1, which    */
/* exists on every TEC install since 4.6 (2017). Dates are sent as     */
/* "YYYY-MM-DD HH:MM:SS" wall-clock strings; the API interprets them   */
/* in the WordPress site's timezone, which is exactly what staff type  */
/* in. No Date/TZ conversion happens in the app, so machine timezone   */
/* never enters the picture.                                           */
/*                                                                     */
/* Write access probe: WordPress runs the permission check before       */
/* validating parameters, so an empty-body POST from a capable account  */
/* returns 400 (missing required title/start_date/end_date) and        */
/* creates nothing. 401/403 means the account cannot publish events.   */
/*                                                                     */
/* Recurrence is NOT supported by the TEC REST API (neither v1):       */
/* recurring classes must be created as individual events.              */
/* ------------------------------------------------------------------ */

function tribeBase(config) {
  return config.wpBaseUrl.replace(/\/+$/, '') + '/wp-json/tribe/events/v1';
}

async function tribeRequest(config, method, endpoint, { query = {}, body } = {}) {
  const url = new URL(tribeBase(config) + endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const auth = effectiveAuth(config);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: basicAuth(auth.post),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, json };
}

// The legacy archives return { events: [...] } / { venues: [...] } envelopes
// (with X-WP-Total* headers); be tolerant of a bare array too.
function unwrapArchive(json, key) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json[key])) return json[key];
  return [];
}

function friendlyWriteError(r, action) {
  const msg = (r.json && r.json.message) || '';
  if (r.status === 401) {
    return `WordPress rejected the login while trying to ${action}. Re-run Setup to sign in again.`;
  }
  if (r.status === 403) {
    return `This WordPress account is not allowed to ${action}. An admin needs to give it permission to manage classes on the website.`;
  }
  if (r.status === 400 && msg) return `WordPress refused to ${action}: ${msg}`;
  return `Could not ${action} (HTTP ${r.status}).${msg ? ` ${msg}` : ''}`;
}

// Do we have event write access? Safe: nothing is created (see note above).
ipcMain.handle('schedule-probe', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await tribeRequest(config, 'POST', '/events', { body: {} });
    if (r.status === 400) return { ok: true, canWrite: true };
    if (r.status === 401 || r.status === 403) {
      return { ok: true, canWrite: false, detail: (r.json && r.json.message) || `HTTP ${r.status}` };
    }
    return { ok: false, error: `Unexpected response while checking event permissions (HTTP ${r.status}).` };
  } catch (err) {
    return { ok: false, error: `Could not reach the events API: ${err.message}` };
  }
});

// All events overlapping [start, end] (dates as "YYYY-MM-DD"). Explicit
// start_date is required because the API excludes past events by default.
ipcMain.handle('schedule-list-events', async (_event, { start, end } = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const events = [];
    let page = 1;
    let totalPages = 1;
    do {
      const r = await tribeRequest(config, 'GET', '/events', {
        query: { start_date: start, end_date: end, per_page: 50, page },
      });
      if (r.status !== 200) {
        return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
      }
      events.push(...unwrapArchive(r.json, 'events'));
      totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '', 10)
        || parseInt((r.json && r.json.total_pages) || '', 10) || 1;
      page += 1;
    } while (page <= totalPages);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: `Could not load classes: ${err.message}` };
  }
});

ipcMain.handle('schedule-list-venues', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const venues = [];
    let page = 1;
    let totalPages = 1;
    do {
      const r = await tribeRequest(config, 'GET', '/venues', { query: { per_page: 50, page } });
      if (r.status !== 200) {
        return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
      }
      venues.push(...unwrapArchive(r.json, 'venues'));
      totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '', 10)
        || parseInt((r.json && r.json.total_pages) || '', 10) || 1;
      page += 1;
    } while (page <= totalPages);
    return { ok: true, venues };
  } catch (err) {
    return { ok: false, error: `Could not load venues: ${err.message}` };
  }
});

ipcMain.handle('schedule-list-organizers', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const organizers = [];
    let page = 1;
    let totalPages = 1;
    do {
      const r = await tribeRequest(config, 'GET', '/organizers', { query: { per_page: 50, page } });
      if (r.status !== 200) {
        return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
      }
      organizers.push(...unwrapArchive(r.json, 'organizers'));
      totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '', 10)
        || parseInt((r.json && r.json.total_pages) || '', 10) || 1;
      page += 1;
    } while (page <= totalPages);
    return { ok: true, organizers };
  } catch (err) {
    return { ok: false, error: `Could not load organizers: ${err.message}` };
  }
});

// TEC event categories (tribe_events_cat), hierarchical: the parent is the
// course category (e.g. "Powered Mobile Equipment"), the child is the specific
// course (e.g. "Counter Balance Forklift"). The endpoint returns a bare array.
ipcMain.handle('schedule-list-categories', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const categories = [];
    let page = 1;
    let totalPages = 1;
    do {
      // hide_empty=0: the endpoint omits terms with no events by default,
      // which makes a child category undiscoverable (and unassignable)
      // until something is filed under it — exactly the Skid Steer case.
      // "0" (not false): in PHP the string "false" is truthy.
      const r = await tribeRequest(config, 'GET', '/categories', { query: { per_page: 100, page, hide_empty: 0 } });
      if (r.status !== 200) {
        return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
      }
      const items = Array.isArray(r.json) ? r.json : unwrapArchive(r.json, 'categories');
      categories.push(...items);
      totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '', 10)
        || parseInt((r.json && r.json.total_pages) || '', 10) || 1;
      page += 1;
    } while (page <= totalPages);
    return { ok: true, categories };
  } catch (err) {
    return { ok: false, error: `Could not load categories: ${err.message}` };
  }
});

ipcMain.handle('schedule-create-venue', async (_event, venue = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await tribeRequest(config, 'POST', '/venues', { body: venue });
    if (r.status === 201 || r.status === 200) return { ok: true, venue: r.json };
    return { ok: false, error: friendlyWriteError(r, 'create the venue') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('schedule-create-organizer', async (_event, organizer = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await tribeRequest(config, 'POST', '/organizers', { body: organizer });
    if (r.status === 201 || r.status === 200) return { ok: true, organizer: r.json };
    return { ok: false, error: friendlyWriteError(r, 'create the instructor') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// payload: { title, description, start_date, end_date, all_day, venue: [ids],
//            organizer: [ids], cost, status } — dates as "YYYY-MM-DD HH:MM:SS".
ipcMain.handle('schedule-create-event', async (_event, payload = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await tribeRequest(config, 'POST', '/events', { body: payload });
    if (r.status === 201 || r.status === 200) return { ok: true, event: r.json };
    return { ok: false, error: friendlyWriteError(r, 'schedule the class') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('schedule-update-event', async (_event, { id, payload } = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  if (!id) return { ok: false, error: 'No event id was provided.' };
  try {
    const r = await tribeRequest(config, 'PUT', `/events/${id}`, { body: payload || {} });
    if (r.status === 200 || r.status === 201) {
      // WordPress can answer 200 while silently leaving the status
      // unchanged when the account lacks publish rights — verify before
      // claiming success, or the app toasts "published" for a draft.
      if (payload && payload.status === 'publish' && r.json && r.json.status && r.json.status !== 'publish') {
        return { ok: false, error: 'WordPress kept the class as a draft. This account cannot publish classes (it needs the publish_tribe_events capability).' };
      }
      return { ok: true, event: r.json };
    }
    return { ok: false, error: friendlyWriteError(r, 'update the class') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// DELETE moves the event to the trash (recoverable in wp-admin), it does
// not permanently delete it.
ipcMain.handle('schedule-delete-event', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  if (!id) return { ok: false, error: 'No event id was provided.' };
  try {
    const r = await tribeRequest(config, 'DELETE', `/events/${id}`);
    if (r.status === 200 || r.status === 204) return { ok: true };
    return { ok: false, error: friendlyWriteError(r, 'delete the class') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Class roster (manual enrollment): stored by EASY Suite as event meta.
//   GET /easy/v1/roster/<id> -> { event_id, roster: [...] }
//   PUT /easy/v1/roster/<id> -> { event_id, roster: [...] } (sanitized copy)
function validRosterEventId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

ipcMain.handle('schedule-get-roster', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const eventId = validRosterEventId(id);
  if (!eventId) return { ok: false, error: 'No class was selected.' };
  try {
    const r = await easyRequest(config, 'GET', `/roster/${eventId}`, { timeoutMs: 30000 });
    if (r.status !== 200) {
      return { ok: false, error: friendlyWriteError(r, 'load the student list') };
    }
    const roster = r.json && Array.isArray(r.json.roster) ? r.json.roster : [];
    const revision = r.json && r.json.revision !== undefined ? r.json.revision : null;
    return { ok: true, roster, revision };
  } catch (err) {
    return { ok: false, error: `Could not load the student list: ${err.message}` };
  }
});

ipcMain.handle('schedule-get-sale-state', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const eventId = validRosterEventId(id);
  if (!eventId) return { ok: false, error: 'No class was selected.' };
  try {
    const r = await easyRequest(config, 'GET', `/sale-state/${eventId}`, { timeoutMs: 30000 });
    if (r.status !== 200) {
      return { ok: false, error: friendlyWriteError(r, 'load the sale status') };
    }
    return { ok: true, state: r.json || {} };
  } catch (err) {
    return { ok: false, error: `Could not load the sale status: ${err.message}` };
  }
});

ipcMain.handle('schedule-save-roster', async (_event, { eventId, roster, revision } = {}) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const id = validRosterEventId(eventId);
  if (!id) return { ok: false, error: 'No class was selected.' };
  if (!Array.isArray(roster)) return { ok: false, error: 'The student list was not valid.' };
  try {
    const r = await easyRequest(config, 'PUT', `/roster/${id}`, { body: { roster, revision }, timeoutMs: 30000 });
    if (r.status === 409) {
      // Someone else changed the list since it was loaded (e.g. an online
      // seat sale). Hand the fresh copy back so the UI can reload it.
      const data = (r.json && r.json.data) || {};
      return {
        ok: false,
        conflict: true,
        roster: Array.isArray(data.roster) ? data.roster : [],
        revision: data.revision !== undefined ? data.revision : null,
        error: (r.json && r.json.message) || 'The student list changed since you opened it.',
      };
    }
    if (r.status !== 200) {
      return { ok: false, error: friendlyWriteError(r, 'save the student list') };
    }
    const saved = r.json && Array.isArray(r.json.roster) ? r.json.roster : [];
    const savedRevision = r.json && r.json.revision !== undefined ? r.json.revision : null;
    return { ok: true, roster: saved, revision: savedRevision };
  } catch (err) {
    return { ok: false, error: `Could not save the student list: ${err.message}` };
  }
});

// Site timezone, shown in the scheduling UI so staff know which clock
// the class times are on.
ipcMain.handle('schedule-site-info', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const base = config.wpBaseUrl.replace(/\/+$/, '');
    const auth = effectiveAuth(config);
    const res = await fetch(`${base}/wp-json/`, {
      headers: { Authorization: basicAuth(auth.post) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `WordPress returned HTTP ${res.status}.` };
    return {
      ok: true,
      timezone: json.timezone_string || null,
      gmtOffset: json.gmt_offset,
      name: json.name,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ------------------------------------------------------------------ */
/* Pending approvals (UltimateMember admin-review queue)               */
/* Served by the EASY Approvals Bridge snippet on the site:            */
/*   GET  /wp-json/easy/v1/pending-users                               */
/*   POST /wp-json/easy/v1/pending-users/<id>/approve                  */
/*   POST /wp-json/easy/v1/pending-users/<id>/reject                   */
/* ------------------------------------------------------------------ */

function easyBase(config) {
  return config.wpBaseUrl.replace(/\/+$/, '') + '/wp-json/easy/v1';
}

async function easyRequest(config, method, endpoint, { body, timeoutMs } = {}) {
  const auth = effectiveAuth(config);
  const res = await fetch(easyBase(config) + endpoint, {
    method,
    headers: {
      Authorization: basicAuth(auth.post),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Probe: can this account review pending users? Distinguishes
// "no permission" (401/403) from "snippet not installed" (404).
ipcMain.handle('approvals-probe', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await easyRequest(config, 'GET', '/pending-users');
    if (r.status === 200) return { ok: true, canReview: true, count: Array.isArray(r.json) ? r.json.length : 0 };
    if (r.status === 401 || r.status === 403) {
      return { ok: true, canReview: false, detail: (r.json && r.json.message) || `HTTP ${r.status}` };
    }
    if (r.status === 404) {
      return { ok: true, canReview: false, missing: true };
    }
    return { ok: false, error: `Unexpected response while checking approval permissions (HTTP ${r.status}).` };
  } catch (err) {
    return { ok: false, error: `Could not reach the approvals API: ${err.message}` };
  }
});

ipcMain.handle('approvals-list', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await easyRequest(config, 'GET', '/pending-users');
    if (r.status !== 200) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    return { ok: true, users: Array.isArray(r.json) ? r.json : [] };
  } catch (err) {
    return { ok: false, error: `Could not load pending approvals: ${err.message}` };
  }
});

async function approvalsDecide(id, action) {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const numId = parseInt(id, 10);
  if (!numId) return { ok: false, error: 'Invalid user id.' };
  try {
    const r = await easyRequest(config, 'POST', `/pending-users/${numId}/${action}`);
    if (r.status !== 200 || !(r.json && r.json.ok)) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    return { ok: true, id: numId };
  } catch (err) {
    return { ok: false, error: `Could not ${action} the account: ${err.message}` };
  }
}

ipcMain.handle('approvals-approve', async (_event, id) => approvalsDecide(id, 'approve'));
ipcMain.handle('approvals-reject', async (_event, id) => approvalsDecide(id, 'reject'));

/* ------------------------------------------------------------------ */
/* Certificate approvals (draft cert review queue)                      */
/* Native WordPress REST — no site snippet needed:                     */
/*   GET  /wp-json/wp/v2/cert?status=draft                             */
/*   POST /wp-json/wp/v2/cert/<id>  {status:"publish"}                 */
/* Instructors submit drafts; the office reviews and publishes. The    */
/* student notification email fires on publish (see the notifications */
/* plugin), never on draft creation.                                  */
/* ------------------------------------------------------------------ */

function certBase(config) {
  return config.wpBaseUrl.replace(/\/+$/, '') + '/wp-json/wp/v2/cert';
}

async function certApprovalsRequest(config, path, { method = 'GET', body } = {}) {
  const auth = effectiveAuth(config).post;
  const res = await fetch(certBase(config) + path, {
    method,
    headers: {
      Authorization: basicAuth(auth),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, total: res.headers.get('x-wp-total') };
}

// Probe: can this account review draft certs? Listing drafts requires the
// edit capability for the cert post type; publishing needs publish rights
// (checked again at action time, with a clear error if missing).
ipcMain.handle('cert-approvals-probe', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await certApprovalsRequest(config, '?status=draft&per_page=1');
    if (r.status === 200) {
      return { ok: true, canReview: true, count: parseInt(r.total || '0', 10) || 0 };
    }
    // 401/403 = no permission. 400 is WordPress's way of saying the same
    // thing here: for accounts without edit rights on the cert post type,
    // `status=draft` is rejected as an invalid parameter (rest_invalid_param)
    // rather than a permission error.
    if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: true, canReview: false };
    return { ok: false, error: `Unexpected response while checking certificate review permissions (HTTP ${r.status}).` };
  } catch (err) {
    return { ok: false, error: `Could not reach the certificates API: ${err.message}` };
  }
});

// ACF date picker may return "Y-m-d" or "Ymd" depending on field config;
// normalize both to "Y-m-d" for comparisons.
function toIsoDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function normalizeDraftCert(c) {
  const acf = (c && c.acf) || {};
  // Title shape: "YYYY-MM-DD - Course Name - Student Name".
  let course = '', student = '';
  const title = c && c.title && c.title.rendered ? String(c.title.rendered) : '';
  const parts = title.split(' - ');
  if (parts.length >= 3) {
    student = parts.slice(2).join(' - ').trim();
    course = parts.slice(1, -1).join(' - ').trim();
  }
  return {
    id: c.id,
    date: c.date,
    title,
    student: acf.student_name || student || '(no name)',
    course: course || acf.course_title || '',
    completionDate: acf.completion_date || '',
    expiryDate: acf.expiry_date || '',
    certificateNumber: acf.certificate_number || '',
    instructor: acf.instructor || '',
    instructorEmail: acf.instructor_email || '',
    company: acf.company || '',
    companyContact: acf.company_contact || '',
    studentEmail: acf.student_email || '',
    studentPhone: acf.student_phone || '',
    hasPdf: !!resolvePdfRef(acf),
  };
}

// The ACF file field can come back in several shapes depending on the
// field's return format: a file ID, a numeric string, {id,url,...}, or a
// URL string. Normalize to something we can download.
function resolvePdfRef(acf) {
  const c = acf && acf.certificate;
  if (c === null || c === undefined || c === '' || c === false) return null;
  if (typeof c === 'number' && c > 0) return { kind: 'id', id: c };
  if (typeof c === 'string') {
    const t = c.trim();
    if (/^\d+$/.test(t)) return { kind: 'id', id: parseInt(t, 10) };
    if (/^https?:\/\//i.test(t)) return { kind: 'url', url: t };
    return null;
  }
  if (typeof c === 'object') {
    if (c.id && /^\d+$/.test(String(c.id))) return { kind: 'id', id: parseInt(c.id, 10) };
    if (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) return { kind: 'url', url: c.url };
  }
  return null;
}

ipcMain.handle('cert-approvals-list', async () => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  try {
    const r = await certApprovalsRequest(
      config,
      '?status=draft&per_page=100&orderby=date&order=desc&_fields=id,date,title,acf,author'
    );
    if (r.status !== 200) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    const items = Array.isArray(r.json) ? r.json : [];
    const total = parseInt(r.total || '0', 10) || 0;
    const out = { ok: true, certs: items.map(normalizeDraftCert) };
    // The site caps a page at 100 drafts; say so when there are more, so
    // the queue never looks shorter than it actually is.
    if (total > items.length) {
      out.note = `Showing the first ${items.length} of ${total} drafts.`;
    }
    return out;
  } catch (err) {
    return { ok: false, error: `Could not load draft certificates: ${err.message}` };
  }
});

ipcMain.handle('cert-approvals-publish', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const numId = parseInt(id, 10);
  if (!numId) return { ok: false, error: 'Invalid certificate id.' };
  try {
    const r = await certApprovalsRequest(config, `/${numId}`, {
      method: 'POST',
      body: { status: 'publish' },
    });
    if (r.status === 401 || r.status === 403) {
      return { ok: false, error: 'This WordPress account cannot publish certificates. An admin needs to grant it publishing rights for certificates.' };
    }
    if (r.status !== 200 || !(r.json && r.json.id)) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    if (r.json.status && r.json.status !== 'publish') {
      return { ok: false, error: 'WordPress kept the certificate as a draft. This account cannot publish certificates.' };
    }
    return { ok: true, id: numId };
  } catch (err) {
    return { ok: false, error: `Could not publish the certificate: ${err.message}` };
  }
});

// Preview the PDF attached to a draft cert: download the media file with
// the office credentials (works even if uploads aren't public) and show it
// in a viewer window. The temp file is removed when the window closes.
ipcMain.handle('cert-approvals-preview', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const numId = parseInt(id, 10);
  if (!numId) return { ok: false, error: 'Invalid certificate id.' };
  let tmpPath = null;
  try {
    tmpPath = await downloadCertPdf(config, numId, 'preview');
    await openPdfViewerWindow(tmpPath, 'Certificate preview');
    tmpPath = null; // the viewer owns the temp file now
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not open the preview: ${err.message}` };
  } finally {
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// Open a downloaded PDF in a viewer window with the built-in toolbar
// (print/save). The temp file is removed when the window closes.
// Used for draft preview and for reprint: the viewer's own print button
// brings up the full system dialog with explicit printer choice, which
// avoids the default-printer trap (e.g. the NISCA card printer).
async function openPdfViewerWindow(tmpPath, title) {
  const { pathToFileURL } = require('url');
  const viewer = new BrowserWindow({
    title: title || 'Certificate preview',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  lockDownWindow(viewer);
  viewer.on('closed', () => fs.unlink(tmpPath, () => {}));
  await viewer.loadURL(pathToFileURL(tmpPath).href);
}

/* ------------------------------------------------------------------ */
/* Certificate tools: lookup/reprint, expiring-soon, draft fetch       */
/* ------------------------------------------------------------------ */

// Search published certificates by student name / course / number.
// The WP search covers the post title ("date - course - student").
ipcMain.handle('cert-tools-search', async (_event, query = '') => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const q = String(query || '').trim();
  if (!q) return { ok: true, certs: [] };
  try {
    const r = await certApprovalsRequest(
      config,
      `?status=publish&search=${encodeURIComponent(q)}&per_page=20&orderby=date&order=desc&_fields=id,date,title,acf`
    );
    if (r.status !== 200) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    const items = Array.isArray(r.json) ? r.json : [];
    return { ok: true, certs: items.map(normalizeDraftCert) };
  } catch (err) {
    return { ok: false, error: `Could not search certificates: ${err.message}` };
  }
});

// Download the stored PDF for a certificate (any status) so the caller
// can print or save it. Shared by reprint and draft preview.
async function downloadCertPdf(config, numId, prefix = 'reprint') {
  const auth = effectiveAuth(config).post;
  const base = config.wpBaseUrl.replace(/\/+$/, '');
  const headers = { Authorization: basicAuth(auth) };
  const certRes = await fetch(`${base}/wp-json/wp/v2/cert/${numId}?_fields=acf`, { headers });
  const certJson = await certRes.json().catch(() => ({}));
  if (!certRes.ok) {
    if (certRes.status === 401 || certRes.status === 403) {
      throw new Error('The saved WordPress login no longer works. The application password may have been revoked. Re-run Setup to sign in again.');
    }
    throw new Error('Could not read this certificate.');
  }
  const acf = certJson && certJson.acf;
  const ref = resolvePdfRef(acf);
  if (!ref) throw new Error('No PDF is attached to this certificate yet.');
  // Prefer the authenticated gatekeeper (EASY Core 1.5.0+): cert PDFs are
  // no longer web-accessible at their direct media URLs.
  const certNumber = (acf && acf.certificate_number) || '';
  let sourceUrl = certNumber ? `${base}/cert-pdf/${encodeURIComponent(certNumber)}/` : null;
  if (!sourceUrl) {
    sourceUrl = ref.kind === 'url' ? ref.url : null;
    if (ref.kind === 'id') {
      const mediaRes = await fetch(`${base}/wp-json/wp/v2/media/${ref.id}?_fields=source_url`, { headers });
      const mediaJson = await mediaRes.json().catch(() => ({}));
      sourceUrl = mediaJson && mediaJson.source_url;
      if (!mediaRes.ok || !sourceUrl) throw new Error('Could not locate the certificate PDF.');
    }
  }
  // No redirect following: when the saved login is rejected, the
  // gatekeeper redirects to the WordPress login page, and following it
  // would save that HTML page as the "PDF".
  const dlRes = await fetch(sourceUrl, { headers, redirect: 'manual' });
  if (dlRes.status >= 300 && dlRes.status < 400) {
    throw new Error('WordPress asked to sign in again. The saved application password may have been revoked; run Setup to sign in.');
  }
  if (!dlRes.ok) throw new Error(`Could not download the PDF (HTTP ${dlRes.status}).`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('The site did not return a PDF file for this certificate.');
  }
  const tmpPath = path.join(os.tmpdir(), `easy-cert-${prefix}-${numId}-${Date.now()}.pdf`);
  await fs.promises.writeFile(tmpPath, buf);
  return tmpPath;
}

// Reprint: download the stored PDF and open it in a viewer window.
// The viewer's toolbar print button brings up the full system dialog
// with explicit printer choice (see openPdfViewerWindow).
ipcMain.handle('cert-tools-reprint', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const numId = parseInt(id, 10);
  if (!numId) return { ok: false, error: 'Invalid certificate id.' };
  let tmpPath = null;
  try {
    tmpPath = await downloadCertPdf(config, numId);
    await openPdfViewerWindow(tmpPath, 'Certificate reprint');
    tmpPath = null; // the viewer owns the temp file now
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not open the certificate: ${err.message}` };
  } finally {
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// Certificates expiring within the next `days` days (published only).
// Served by EASY Core 1.5.6+ via /wp-json/easy/v1/expiring-certs — the
// server filters on expiry_date postmeta directly, so no pagination.
ipcMain.handle('cert-tools-expiring', async (_event, days = 90) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const windowDays = Math.min(Math.max(parseInt(days, 10) || 90, 1), 365);
  try {
    const auth = effectiveAuth(config).post;
    const base = config.wpBaseUrl.replace(/\/+$/, '');
    const url = `${base}/wp-json/easy/v1/expiring-certs?days=${windowDays}`;
    const res = await fetch(url, { headers: { Authorization: basicAuth(auth) } });
    if (res.status !== 200) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body && body.message) || `WordPress returned HTTP ${res.status}.` };
    }
    const items = await res.json().catch(() => []);
    const list = Array.isArray(items) ? items : [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = [];
    for (const c of list) {
      const iso = toIsoDate(c.expiry_date);
      if (!iso) continue;
      const exp = new Date(iso + 'T00:00:00');
      if (Number.isNaN(exp.getTime())) continue;
      const daysLeft = Math.round((exp - today) / 86400000);
      // Title shape: "YYYY-MM-DD - Course Name - Student Name" (fallback).
      let course = '', student = '';
      const title = c.title ? String(c.title) : '';
      const parts = title.split(' - ');
      if (parts.length >= 3) {
        student = parts.slice(2).join(' - ').trim();
        course = parts.slice(1, -1).join(' - ').trim();
      }
      out.push({
        id: c.id,
        title,
        student: c.student_name || student || '(no name)',
        course: course || c.course_title || '',
        completionDate: c.completion_date || '',
        expiryDate: c.expiry_date || '',
        certificateNumber: c.certificate_number || '',
        instructor: c.instructor || '',
        instructorEmail: c.instructor_email || '',
        company: c.company || '',
        companyContact: c.company_contact || '',
        studentEmail: c.student_email || '',
        studentPhone: '',
        daysLeft,
      });
    }
    out.sort((a, b) => a.daysLeft - b.daysLeft);
    return { ok: true, certs: out };
  } catch (err) {
    return { ok: false, error: `Could not load expiring certificates: ${err.message}` };
  }
});

// Full draft fetch for the fix-before-publish edit flow.
ipcMain.handle('cert-approvals-get', async (_event, id) => {
  const config = getConfig();
  if (!config.ok) return { ok: false, error: config.error };
  const numId = parseInt(id, 10);
  if (!numId) return { ok: false, error: 'Invalid certificate id.' };
  try {
    const r = await certApprovalsRequest(config, `/${numId}?_fields=id,date,title,acf,status`);
    if (r.status !== 200 || !(r.json && r.json.id)) {
      return { ok: false, error: (r.json && r.json.message) || `WordPress returned HTTP ${r.status}.` };
    }
    const cert = normalizeDraftCert(r.json);
    cert.status = r.json.status;
    cert.rawAcf = (r.json && r.json.acf) || {};
    return { ok: true, cert };
  } catch (err) {
    return { ok: false, error: `Could not load the draft: ${err.message}` };
  }
});
