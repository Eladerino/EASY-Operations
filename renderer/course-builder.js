// course-builder.js — Course Builder (gated accounts only).
//
// A course author builds online-module courses chapter by chapter.
// When the site runs EASY Suite's Course Builder module, courses are saved
// to the site as the author works (so every computer sees the same copy)
// and reviews go through the in-app Review inbox. Without it, courses stay
// in this machine's localStorage and reviews travel as files. Approving a
// snapshot produces the final maker-framework content package the module
// player consumes.
//
// Authorship model: the signed-in WordPress username (from getAppInfo)
// is compared against a small editable authors list kept on this machine
// (empty until someone is added; site sync overrides it).
// Authors can always edit. Everyone else gets read-only + the review inbox.
// Editing after "send for review" never locks the author out — it just marks the
// live course as newer than the snapshot under review.
(function () {
  'use strict';

  /* ---------------- helpers ---------------- */

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const deepCopy = (o) => JSON.parse(JSON.stringify(o));
  const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const slug = (s) => String(s || 'course').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';

  function toast(message, type, ms) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 400);
    }, ms || 5000);
  }

  // Reuses the generic #modal from index.html with one-shot listeners.
  function modalShell({ title, bodyHtml, okText, cancelText }) {
    return new Promise((resolve) => {
      $('modalTitle').textContent = title;
      $('modalBody').innerHTML = bodyHtml;
      const ok = $('modalOk');
      const cancel = $('modalCancel');
      ok.textContent = okText || 'OK';
      if (cancelText) {
        cancel.style.display = '';
        cancel.textContent = cancelText;
      } else {
        cancel.style.display = 'none';
      }
      $('modal').classList.remove('hidden');
      const done = (v) => {
        $('modal').classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  function modalPrompt({ title, bodyHtml, placeholder, okText }) {
    return new Promise((resolve) => {
      const taId = 'bModalTa_' + Math.random().toString(36).slice(2, 8);
      modalShell({
        title,
        bodyHtml: bodyHtml + '<textarea id="' + taId + '" class="b-modal-textarea" placeholder="' + esc(placeholder || '') + '"></textarea>',
        okText: okText || 'OK',
        cancelText: 'Cancel',
      }).then((ok) => {
        if (!ok) return resolve(null);
        const ta = document.getElementById(taId);
        resolve(ta ? ta.value.trim() : '');
      });
    });
  }

  function download(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------------- storage ---------------- */

  const LS_COURSES = 'easyBuilder.courses.v1';
  const LS_INBOX = 'easyBuilder.inbox.v1';
  const LS_AUTHORS = 'easyBuilder.authors.v1';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return deepCopy(fallback);
      return JSON.parse(raw);
    } catch (e) {
      return deepCopy(fallback);
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      toast('Could not save locally: ' + (e && e.message), 'error');
    }
  }

  let courses = loadJSON(LS_COURSES, []);
  let inbox = loadJSON(LS_INBOX, []);
  let authors = loadJSON(LS_AUTHORS, []);

  // Every local save also queues an upload to the site (when synced) and a
  // file backup on this computer.
  const persistCourses = () => { saveJSON(LS_COURSES, courses); scheduleBackup(); schedulePush(); paintSync(); };
  const persistInbox = () => saveJSON(LS_INBOX, inbox);
  const persistAuthors = () => saveJSON(LS_AUTHORS, authors);

  /* ---------------- identity & authorship ---------------- */

  let accountUser = null;
  let identityLoaded = false;

  async function loadIdentity() {
    try {
      const info = await window.easyCert.getAppInfo();
      accountUser = info && info.accountUser ? String(info.accountUser) : null;
    } catch (e) {
      accountUser = null;
    }
    identityLoaded = true;
  }

  // Authors can always edit — no locks, no gates. Reviewers get read-only
  // plus the review inbox. Managing the authors list itself requires author
  // rights, like every other mutating action.
  // With site sync the site decides; otherwise the local authors list does.
  const lc = (s) => String(s || '').toLowerCase();
  const isAuthor = () => {
    if (sync.roles && onSite()) return !!sync.roles.isAuthor;
    return identityLoaded && !!accountUser && authors.map(lc).includes(lc(accountUser));
  };
  const isReviewer = () => !(sync.roles && onSite()) || !!sync.roles.isReviewer;

  /* ---------------- site sync ----------------
   * The site holds the shared copy of every course and the review queue;
   * localStorage stays as this computer's cache so editing keeps working
   * when the site can't be reached. If the site has no Course Builder
   * module, the builder works as before (this computer + files).
   *
   * Cached courses carry private fields that never leave this computer:
   *   _rev        the site's save counter this copy is based on (0 = not on the site yet)
   *   _syncedSig  content fingerprint at that save; a different fingerprint
   *               means local edits are still waiting to upload. */

  const LS_SYNC = 'easyBuilder.sync.v1';
  const WORKFLOW_KEYS = ['status', 'reviewVersion', 'approvedVersion', 'liveEditedSinceReview', 'reviewNote'];
  // mode: 'unknown' before the first check, 'local' (no site module: files),
  // 'site' (connected), 'offline' (site has the module but can't be reached).
  const sync = {
    mode: 'unknown', roles: null, error: '', reviews: [],
    pushing: false, again: false, timer: null, pulling: null,
    siteSeen: !!(loadJSON(LS_SYNC, {}) || {}).siteSeen,
  };
  const courseApi = () => (window.easyCert && window.easyCert.courses) || null;
  const onSite = () => sync.mode === 'site' || sync.mode === 'offline';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanCourse(c) {
    const out = {};
    Object.keys(c || {}).forEach((k) => { if (k.charAt(0) !== '_') out[k] = c[k]; });
    return deepCopy(out);
  }
  function contentSig(c) {
    const o = cleanCourse(c);
    WORKFLOW_KEYS.forEach((k) => { delete o[k]; });
    delete o.updatedAt;
    delete o.createdAt;
    return JSON.stringify(o);
  }
  const isDirty = (c) => !c._rev || contentSig(c) !== c._syncedSig;

  function fromSite(entry) {
    const c = normalizeCourse(deepCopy(entry.course));
    c._rev = entry.rev || 0;
    c._syncedSig = contentSig(c);
    c._siteBy = entry.updatedBy || '';
    return c;
  }
  function applyWorkflow(c, siteCourse) {
    if (!c || !siteCourse) return;
    WORKFLOW_KEYS.forEach((k) => { if (k in siteCourse) c[k] = siteCourse[k]; });
  }
  function conflictCopy(local) {
    const copy = cleanCourse(local);
    copy.id = uid('c');
    copy.title = (local.title || 'Untitled course') + ' (edits from this computer)';
    copy.status = 'draft';
    copy.reviewVersion = 0;
    copy.approvedVersion = 0;
    copy.liveEditedSinceReview = false;
    copy.reviewNote = '';
    copy._rev = 0;
    copy._syncedSig = '';
    return copy;
  }

  // The site rejected a save because another computer saved first. Nothing
  // is thrown away: the site's version takes the course's place and this
  // computer's edits become a separate course.
  function keepBoth(local, entry) {
    const idx = courses.indexOf(local);
    if (idx < 0 || !entry || !entry.course) return;
    const site = fromSite(entry);
    if (contentSig(local) === site._syncedSig) { courses[idx] = site; return; }
    const copy = conflictCopy(local);
    courses.splice(idx, 1, site, copy);
    if (ui.courseId === local.id) ui.courseId = copy.id;
    sync.again = true;
    toast('"' + site.title + '" was also changed on another computer. Both versions are kept: the site\'s, and your edits as "' + copy.title + '".', 'info', 12000);
  }

  function mergeFromSite(list) {
    const seen = new Set();
    const fromSiteList = [];
    const localOnly = [];
    list.forEach((entry) => {
      if (!entry || !entry.course || !entry.course.id) return;
      seen.add(entry.course.id);
      const site = fromSite(entry);
      const local = getCourse(site.id);
      if (!local || !isDirty(local) || contentSig(local) === site._syncedSig) { fromSiteList.push(site); return; }
      if (local._rev === site._rev) { applyWorkflow(local, entry.course); fromSiteList.push(local); return; }
      fromSiteList.push(site);
      if (isAuthor()) {
        const copy = conflictCopy(local);
        localOnly.push(copy);
        toast('"' + site.title + '" was changed on another computer while this one had unsaved edits. Your edits are kept as "' + copy.title + '".', 'info', 12000);
      }
    });
    courses.forEach((c) => {
      if (seen.has(c.id)) return;
      if (c._rev && !isDirty(c)) return; // deleted on another computer
      if (c._rev) { c._rev = 0; c._syncedSig = ''; } // deleted elsewhere but edited here: upload again
      localOnly.push(c);
    });
    courses = localOnly.concat(fromSiteList);
  }

  function setReviews(list) {
    sync.reviews = (Array.isArray(list) ? list : []).map((r) => {
      try { r.course = normalizeCourse(r.course); } catch (e) { /* preview guards handle it */ }
      return r;
    });
  }

  async function waitForPush() {
    clearTimeout(sync.timer);
    sync.timer = null;
    for (let i = 0; sync.pushing && i < 150; i++) await sleep(200);
  }

  async function pullFromSite() {
    if (sync.pulling) return sync.pulling;
    sync.pulling = (async () => {
      const api = courseApi();
      if (!api) { sync.mode = 'local'; return; }
      const me = await api.sync('me');
      if (!me.ok) {
        if (me.missing) { sync.mode = 'local'; sync.error = ''; }
        else { sync.mode = me.offline && sync.siteSeen ? 'offline' : 'local'; sync.error = me.error || ''; }
        return;
      }
      sync.roles = me.data || {};
      if (!sync.siteSeen) { sync.siteSeen = true; saveJSON(LS_SYNC, { siteSeen: true }); }
      if (Array.isArray(sync.roles.authors) && sync.roles.authors.length) {
        authors = sync.roles.authors.slice();
        persistAuthors();
      }
      sync.mode = 'site';
      if (!sync.roles.isAuthor && !sync.roles.isReviewer) {
        sync.error = 'Your WordPress account has no Course Builder access on the site.';
        setReviews([]);
        return;
      }
      await waitForPush();
      const [list, reviews] = await Promise.all([api.sync('list'), api.sync('reviews')]);
      if (!list.ok) {
        if (list.offline) sync.mode = 'offline';
        sync.error = list.error || '';
        return;
      }
      sync.error = '';
      mergeFromSite((list.data && list.data.courses) || []);
      if (reviews.ok) setReviews(reviews.data && reviews.data.reviews);
      saveJSON(LS_COURSES, courses);
      schedulePush(0);
    })();
    try { await sync.pulling; } finally { sync.pulling = null; }
  }

  async function refreshReviews() {
    if (!onSite() || !courseApi()) return;
    const r = await courseApi().sync('reviews');
    if (r.ok) setReviews(r.data && r.data.reviews);
  }

  function schedulePush(delay) {
    if (!onSite() || !courseApi() || !isAuthor()) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(pushDirty, delay == null ? 1500 : delay);
  }

  async function pushDirty() {
    sync.timer = null;
    if (sync.pushing) { sync.again = true; return; }
    const dirty = courses.filter(isDirty);
    if (!dirty.length) { paintSync(); return; }
    sync.pushing = true;
    paintSync();
    let rerender = false;
    try {
      for (const c of dirty) {
        const result = await pushOne(c, false);
        if (result === 'conflict') rerender = true;
        if (result === 'offline') break;
      }
    } finally {
      sync.pushing = false;
      saveJSON(LS_COURSES, courses);
      if (sync.again) { sync.again = false; schedulePush(300); }
      if (rerender) render(); else paintSync();
    }
  }

  async function pushOne(c, retried) {
    if (!courses.includes(c)) return 'gone';
    const sig = contentSig(c);
    const r = await courseApi().sync('save', { id: c.id, course: cleanCourse(c), baseRev: c._rev || 0 });
    if (r.ok && r.data) {
      c._rev = r.data.rev;
      c._syncedSig = sig;
      c._siteBy = r.data.updatedBy || '';
      applyWorkflow(c, r.data.course);
      sync.mode = 'site';
      sync.error = '';
      return 'ok';
    }
    if (r.offline) {
      sync.mode = 'offline';
      sync.error = r.error || '';
      clearTimeout(sync.timer);
      sync.timer = setTimeout(pushDirty, 30000);
      return 'offline';
    }
    if (r.status === 409 && r.data && r.data.current) { keepBoth(c, r.data.current); return 'conflict'; }
    if (r.status === 410 && !retried) { c._rev = 0; c._syncedSig = ''; return pushOne(c, true); }
    if (r.missing) { sync.mode = 'local'; sync.error = ''; return 'offline'; }
    if (sync.error !== r.error) toast('Could not save "' + (c.title || 'Untitled course') + '" to the site: ' + r.error, 'error', 9000);
    sync.error = r.error || 'Unknown error.';
    return 'error';
  }

  function syncState() {
    if (!onSite()) return sync.error ? 'warn' : 'local';
    if (sync.mode === 'offline') return 'warn';
    if (sync.pushing || (isAuthor() && courses.some(isDirty) && !sync.error)) return 'busy';
    return sync.error ? 'warn' : 'ok';
  }
  function syncLabel() {
    const st = syncState();
    if (!onSite()) return sync.error ? 'Not syncing with the site: ' + sync.error : 'On this computer only';
    if (sync.mode === 'offline') return 'Can\'t reach the site. Edits are kept on this computer and upload when it\'s back.';
    if (st === 'busy') return 'Saving to the site…';
    if (sync.error) return sync.error;
    return 'Saved to the site';
  }
  function syncChip() {
    return '<span id="bSyncChip" class="b-sync b-sync-' + syncState() + '">' + esc(syncLabel()) + '</span>';
  }
  function paintSync() {
    const el = $('bSyncChip');
    if (el) { el.className = 'b-sync b-sync-' + syncState(); el.textContent = syncLabel(); }
    paintBadge();
  }

  // Timestamped file backups on this computer (main process keeps the
  // newest 20), at most once a minute.
  let backupAt = 0;
  let backupTimer = null;
  function scheduleBackup() {
    const api = courseApi();
    if (!api || !api.backup || backupTimer) return;
    backupTimer = setTimeout(() => {
      backupTimer = null;
      backupAt = Date.now();
      api.backup({ courses: courses.map(cleanCourse), inbox, authors }).catch(() => {});
    }, Math.max(2000, backupAt + 60000 - Date.now()));
  }

  /* ---------------- time estimates ---------------- */

  // Parses "SS", "M:SS" or "H:MM:SS". Returns seconds, or null when the
  // input isn't a recognizable duration (empty counts as 0 = cleared).
  function parseDuration(str) {
    const s = String(str || '').trim();
    if (s === '') return 0;
    let m = s.match(/^(\d+):([0-5]?\d):([0-5]\d)$/);
    if (m) return (parseInt(m[1], 10) * 3600) + (parseInt(m[2], 10) * 60) + parseInt(m[3], 10);
    m = s.match(/^(?:(\d+):)?([0-5]?\d)$/);
    if (!m) return null;
    return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2], 10);
  }
  function fmtDurationInput(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function segSeconds(seg) {
    switch (seg.type) {
      case 'video': return Math.max(0, seg.durationSec || 0);
      case 'text': {
        if (seg.audioSec > 0) return seg.audioSec;
        if (words(seg.narrationScript) > 0) return Math.round(words(seg.narrationScript) / 150 * 60);
        return Math.round(words(seg.body) / 200 * 60);
      }
      case 'photo': return 20;
      case 'interactive': return Math.max(1, seg.estMin || 3) * 60;
      case 'quiz': return (seg.questions || []).length * 60;
      default: return 0;
    }
  }
  function fmtEst(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return 'under a minute';
    const m = Math.round(sec / 60);
    if (m < 60) return '≈ ' + m + ' min';
    return '≈ ' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  const chapterSeconds = (ch) => (ch.segments || []).reduce((a, s) => a + segSeconds(s), 0)
    + ((ch.quizQuestions || []).length * 60);
  const courseSeconds = (c) => (c.chapters || []).reduce((a, ch) => a + chapterSeconds(ch), 0)
    + ((c.finalQuiz && c.finalQuiz.questions ? c.finalQuiz.questions.length : 0) * 60);

  /* ---------------- data factories ---------------- */

  function newQuestion() {
    return { id: uid('q'), q: '', kind: 'mc', options: ['', ''], answer: 0 };
  }
  function newSegment(type) {
    const base = { id: uid('seg'), type, title: '' };
    switch (type) {
      case 'video': return Object.assign(base, { fileName: '', durationSec: 0, transcript: '' });
      case 'text': return Object.assign(base, { body: '', narrationScript: '', audioFileName: '', audioSec: 0 });
      case 'photo': return Object.assign(base, { fileName: '', caption: '', alt: '' });
      case 'interactive': return Object.assign(base, { description: '', estMin: 3 });
      case 'quiz': return Object.assign(base, { questions: [newQuestion()] });
      default: return base;
    }
  }
  function newChapter(title) {
    return { id: uid('ch'), title: title || 'New chapter', status: 'draft', segments: [], quizQuestions: [] };
  }
  function newCourse(title) {
    const now = new Date().toISOString();
    return {
      id: uid('c'), title: title || 'Untitled course', description: '',
      status: 'draft', reviewVersion: 0, approvedVersion: 0,
      liveEditedSinceReview: false, reviewNote: '',
      passMark: 80, maxAttempts: 3, onFail: 'retry',
      chapters: [], finalQuiz: { questions: [] },
      createdAt: now, updatedAt: now,
    };
  }

  /* ---------------- segment definitions & tips ---------------- */

  const SEG_DEFS = {
    video: {
      label: 'Video', delivery: 'evergreen',
      tip: '<strong>Evergreen rule:</strong> keep specific numbers, dates, and regulation figures OUT of the script — say them in a text segment instead, which is cheap to update. Short clips (3–5 min) are cheaper to reshoot than long ones.',
    },
    text: {
      label: 'Text / narration', delivery: 'volatile',
      tip: '<strong>Cheap to update:</strong> this is where specific figures, dates, and rule details belong. If someone records narration, paste the script here too. It doubles as the accessibility transcript.',
    },
    photo: {
      label: 'Photo', delivery: 'volatile',
      tip: '<strong>Real photos only</strong> — shoot EASY\'s own equipment and facility so learners recognize it at their practical. Always write the alt text: it\'s what screen readers announce.',
    },
    interactive: {
      label: 'Interactive exercise', delivery: 'volatile',
      tip: '<strong>Just describe it.</strong> Write what the learner should <em>do</em> (e.g. "drag the hazard labels onto the photo") — we\'ll build it from your description. Set your best guess at how long it takes.',
    },
    quiz: {
      label: 'Quiz', delivery: 'volatile',
      tip: 'Aim for 3–5 questions per chapter. Test <em>understanding</em>, not memorization — "what would you do if…" beats "what does section 4 say?". Mark the correct answer on every question.',
    },
  };
  const DELIVERY_LABEL = { evergreen: 'Evergreen', volatile: 'Volatile' };

  const STATUS_LABEL = { draft: 'Draft', in_review: 'With reviewer', approved: 'Approved' };

  /* ---------------- data normalization ----------------
   * Courses load from localStorage and imported JSON with no schema
   * guarantee. Normalize everything on the way in so a malformed shape
   * (corrupted storage, hand-edited file) degrades gracefully instead of
   * throwing halfway through a render. */

  function normalizeQuestion(q) {
    if (!q || typeof q !== 'object') q = {};
    if (!Array.isArray(q.options) || q.options.length < 2) {
      const keep = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : [];
      while (keep.length < 2) keep.push('');
      q.options = keep.slice(0, 2);
    }
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) q.answer = 0;
    if (typeof q.q !== 'string') q.q = '';
    if (q.kind !== 'tf' && q.kind !== 'mc') q.kind = 'mc';
    return q;
  }

  function normalizeSegment(seg) {
    if (!seg || typeof seg !== 'object') seg = {};
    if (typeof seg.type !== 'string' || !SEG_DEFS[seg.type]) seg.type = 'text';
    if (typeof seg.title !== 'string') seg.title = '';
    if (typeof seg.id !== 'string' || !seg.id) seg.id = uid('seg');
    if (seg.type === 'quiz') {
      if (!Array.isArray(seg.questions)) seg.questions = [];
      seg.questions = seg.questions.map(normalizeQuestion);
    }
    return seg;
  }

  function normalizeChapter(ch) {
    if (!ch || typeof ch !== 'object') ch = {};
    if (!Array.isArray(ch.segments)) ch.segments = [];
    if (!Array.isArray(ch.quizQuestions)) ch.quizQuestions = [];
    if (typeof ch.title !== 'string') ch.title = '';
    if (typeof ch.id !== 'string' || !ch.id) ch.id = uid('ch');
    ch.segments = ch.segments.map(normalizeSegment);
    ch.quizQuestions = ch.quizQuestions.map(normalizeQuestion);
    return ch;
  }

  function normalizeCourse(c) {
    if (!c || typeof c !== 'object') return newCourse('');
    if (!Array.isArray(c.chapters)) c.chapters = [];
    if (!c.finalQuiz || typeof c.finalQuiz !== 'object') c.finalQuiz = { questions: [] };
    if (!Array.isArray(c.finalQuiz.questions)) c.finalQuiz.questions = [];
    if (typeof c.title !== 'string') c.title = '';
    if (typeof c.id !== 'string' || !c.id) c.id = uid('c');
    if (typeof c.passMark !== 'number') c.passMark = 80;
    c.chapters = c.chapters.map(normalizeChapter);
    c.finalQuiz.questions = c.finalQuiz.questions.map(normalizeQuestion);
    return c;
  }

  // Apply to anything already loaded from localStorage, including review
  // snapshots parked in the inbox (their previews render the same way).
  courses = courses.filter((c) => c && typeof c === 'object').map(normalizeCourse);
  if (!Array.isArray(authors)) authors = [];
  inbox.forEach((item) => {
    if (item && item.payload && item.payload.course) {
      try { item.payload.course = normalizeCourse(item.payload.course); } catch (e) { /* leave as-is */ }
    }
  });

  /* ---------------- view state ---------------- */

  const ui = { view: 'library', sub: 'courses', courseId: null, preview: null, showData: false };

  const getCourse = (id) => courses.find((c) => c.id === id);
  // Local writes are debounced so typing doesn't rewrite localStorage on
  // every keystroke; the in-memory model is always current. Pending writes
  // are flushed on window unload (see bottom of file).
  let persistTimer = null;
  function persistCoursesSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; persistCourses(); }, 400);
  }
  function touch(course) {
    course.updatedAt = new Date().toISOString();
    // Authors are never locked out: editing after sending/approval just
    // marks the live course as newer than the frozen snapshot.
    if (course.status === 'in_review' || course.status === 'approved') course.liveEditedSinceReview = true;
    persistCoursesSoon();
    paintSync();
  }
  function statusBadge(course) {
    let cls = 'b-status-' + course.status;
    let label = STATUS_LABEL[course.status] || course.status;
    if (course.status === 'approved' && course.liveEditedSinceReview) {
      label = 'Approved · newer edits since';
    } else if (course.status === 'in_review' && course.liveEditedSinceReview) {
      label = 'With reviewer · you edited since';
    }
    return '<span class="b-status ' + cls + '">' + esc(label) + '</span>';
  }

  /* ---------------- library ---------------- */

  function identityLine() {
    if (!identityLoaded || !accountUser) {
      return '<p class="hint">Not signed in — complete <strong>Setup</strong> (WordPress sign-in) so the builder knows who you are. Until then, courses are read-only.</p>';
    }
    if (isAuthor()) {
      return '<p class="hint">Signed in as <strong>' + esc(accountUser) + '</strong> — you are a course author, so everything here is editable.</p>';
    }
    return '<p class="hint">Signed in as <strong>' + esc(accountUser) + '</strong> — read-only. Course authors: ' + esc(authors.join(', ')) + '. Use the Review inbox for approvals.</p>';
  }

  function renderLibrary() {
    const pending = allInbox().filter((i) => !i.handled).length;
    let html = '<div class="b-lib-head"><h2>Course Builder</h2>';
    html += '<span class="b-time-chip">' + courses.length + ' course' + (courses.length === 1 ? '' : 's') + (onSite() ? '' : ' on this machine') + '</span>';
    html += syncChip();
    if (onSite()) html += '<button type="button" class="btn btn-secondary btn-small" data-act="sync-refresh">Refresh</button>';
    html += '</div>';
    html += identityLine();
    html += '<div class="sub-tabs" role="tablist" aria-label="Course Builder sections">';
    html += '<button type="button" class="sub-tab' + (ui.sub === 'courses' ? ' active' : '') + '" data-bsub="courses" role="tab">My courses</button>';
    html += '<button type="button" class="sub-tab' + (ui.sub === 'inbox' ? ' active' : '') + '" data-bsub="inbox" role="tab">Review inbox';
    html += ' <span class="tab-badge' + (pending ? '' : ' hidden') + '">' + pending + '</span></button>';
    html += '</div>';

    if (ui.sub === 'inbox') {
      html += renderInbox();
    } else {
      html += '<div class="b-lib-head" style="margin-top:14px">';
      html += onSite()
        ? '<span class="b-kv">Courses are saved to <strong>the site</strong> as you work, so they\'re the same on every computer.</span>'
        : '<span class="b-kv">Courses are stored <strong>on this machine only</strong> until sent for review.</span>';
      if (isAuthor()) html += '<button type="button" class="btn btn-primary" data-act="new-course">+ New course</button>';
      html += '</div>';

      if (!courses.length) {
        html += '<div class="card b-empty"><h3>No courses yet</h3>'
          + '<p>Create your first course to begin. Build it chapter by chapter: short video and text segments for the ideas that never change, interactive pieces and quizzes for the details. The estimated learner time updates live as you build.</p>'
          + (isAuthor() ? '<p><button type="button" class="btn btn-primary" data-act="new-course">+ New course</button></p>' : '')
          + '</div>';
      } else {
        html += '<div class="b-course-grid">';
        courses.forEach((c) => {
          const n = c.chapters.length;
          html += '<div class="card b-course-card">';
          html += '<div>' + statusBadge(c) + '</div>';
          html += '<h3>' + esc(c.title) + '</h3>';
          html += '<div class="b-course-meta"><span>' + n + ' chapter' + (n === 1 ? '' : 's') + '</span>'
            + '<span class="b-time-chip">' + esc(fmtEst(courseSeconds(c))) + '</span>'
            + '<span>Updated ' + esc(new Date(c.updatedAt).toLocaleDateString()) + '</span></div>';
          if (c.reviewNote) html += '<div class="b-review-note"><strong>Reviewer note:</strong> ' + esc(c.reviewNote) + '</div>';
          if (c.status === 'in_review') html += '<div class="b-kv">Snapshot v' + c.reviewVersion + ' is with the reviewer.</div>';
          if (c.status === 'approved' && c.approvedVersion) html += '<div class="b-kv">Approved snapshot: v' + c.approvedVersion + '.</div>';
          if (onSite() && !c._rev) html += '<div class="b-kv">' + (isAuthor() ? 'Not on the site yet. It uploads automatically.' : 'Only on this computer.') + '</div>';
          html += '<div class="b-course-actions">';
          html += '<button type="button" class="btn btn-secondary btn-small" data-act="open" data-id="' + c.id + '">' + (isAuthor() ? 'Edit' : 'View') + '</button>';
          html += '<button type="button" class="btn btn-secondary btn-small" data-act="preview" data-id="' + c.id + '">Preview</button>';
          if (isAuthor() && c.status !== 'in_review') html += '<button type="button" class="btn btn-secondary btn-small" data-act="send-review" data-id="' + c.id + '">Send for review</button>';
          if (isAuthor() && c.status === 'in_review') html += '<button type="button" class="btn btn-secondary btn-small" data-act="withdraw" data-id="' + c.id + '">Withdraw</button>';
          html += '<button type="button" class="btn btn-secondary btn-small" data-act="export" data-id="' + c.id + '">Export</button>';
          if (onSite() && c._rev && c.approvedVersion) html += '<button type="button" class="btn btn-secondary btn-small" data-act="download-final" data-id="' + c.id + '">Download approved v' + c.approvedVersion + '</button>';
          if (isAuthor()) html += '<button type="button" class="btn btn-secondary btn-small" data-act="delete" data-id="' + c.id + '" style="color:var(--error)">Delete</button>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      // Authors list — managing it requires author rights (add/remove
      // controls are only rendered for authors).
      const canManageAuthors = isAuthor();
      html += '<div class="card b-authors"><h2>Course authors</h2>'
        + '<p class="hint">Only these WordPress usernames can create and edit courses. Everyone else gets read-only access plus the review inbox.'
        + (onSite() ? ' This list is kept on the site, so it applies on every computer.' : '') + '</p>'
        + '<div id="bAuthorList">'
        + authors.map((a) => '<div class="b-author-row"><span><strong>' + esc(a) + '</strong></span>'
          + (a === accountUser ? '<span class="b-author-you">you</span>' : '')
          + '<span style="flex:1"></span>'
          + (canManageAuthors ? '<button type="button" class="b-icon-btn danger" data-act="author-del" data-u="' + esc(a) + '" title="Remove author">×</button>' : '')
          + '</div>').join('')
        + '</div>'
        + (canManageAuthors
          ? '<div class="lookup-row" style="margin-top:10px"><input type="text" id="bAuthorAdd" placeholder="Add WordPress username…" autocomplete="off" aria-label="Add author username">'
            + '<button type="button" class="btn btn-secondary btn-small" data-act="author-add">Add</button></div>'
          : '')
        + '</div>';
      if (courseApi() && courseApi().openBackups) {
        html += '<p class="hint">This computer also keeps automatic backup files of every course. '
          + '<button type="button" class="btn btn-secondary btn-small" data-act="open-backups">Open backups folder</button></p>';
      }
    }

    $('builderRoot').innerHTML = html;
    wireLibrary();
  }

  function wireLibrary() {
    document.querySelectorAll('#builderRoot [data-bsub]').forEach((b) => {
      b.addEventListener('click', () => { ui.sub = b.getAttribute('data-bsub'); render(); });
    });
    document.querySelectorAll('#builderRoot [data-act]').forEach((b) => {
      b.addEventListener('click', () => handleAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b));
    });
    const addInput = $('bAuthorAdd');
    if (addInput) {
      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addAuthor(addInput.value); }
      });
    }
  }

  // On the site the list is shared (and checked against real accounts);
  // otherwise it only applies on this computer.
  async function saveAuthors(next) {
    if (onSite()) {
      const r = await courseApi().sync('setAuthors', { authors: next });
      if (!r.ok) { toast(r.error || 'Could not update the authors list.', 'error'); return false; }
      authors = (r.data && r.data.authors) || next;
      if (sync.roles) {
        sync.roles.authors = authors.slice();
        sync.roles.isAuthor = authors.map(lc).includes(lc(accountUser));
      }
    } else {
      authors = next;
    }
    persistAuthors();
    return true;
  }

  async function addAuthor(name) {
    if (!requireAuthor()) return;
    name = String(name || '').trim();
    if (!name) return;
    if (authors.map(lc).includes(lc(name))) { toast('Already an author.', 'info'); return; }
    if (!(await saveAuthors(authors.concat([name])))) return;
    toast(name + ' can now edit courses.', 'success');
    render();
  }

  /* ---------------- builder view ---------------- */

  function roAttr() { return isAuthor() ? '' : ' disabled'; }
  function roNote() {
    return isAuthor() ? '' : '<div class="b-tip"><strong>Read-only.</strong> You are signed in as a reviewer — editing is limited to course authors (' + esc(authors.join(', ')) + ').</div>';
  }

  function renderBuilder(course) {
    const author = isAuthor();
    let html = '<div class="b-builder-head">';
    html += '<div class="b-builder-title-row">';
    html += '<button type="button" class="btn btn-secondary btn-small" data-act="back">← Courses</button>';
    html += '<h2>' + (author
      ? '<input type="text" id="bCourseTitle" value="' + esc(course.title) + '" aria-label="Course title" style="font-size:19px;font-weight:700;border:1px solid transparent;border-radius:6px;padding:2px 8px;width:100%;max-width:420px">'
      : esc(course.title)) + '</h2>';
    html += statusBadge(course);
    html += '<span class="b-time-chip" data-timefor="course">' + esc(fmtEst(courseSeconds(course))) + ' learner time</span>';
    html += syncChip();
    html += '</div><div class="b-builder-sub">';
    if (course.status === 'in_review') html += '<span>Snapshot v' + course.reviewVersion + ' is with the reviewer.' + (course.liveEditedSinceReview ? ' You have edited since sending — those edits are not in the snapshot.' : '') + '</span>';
    if (course.status === 'approved' && course.approvedVersion) html += '<span>Approved snapshot: v' + course.approvedVersion + '.' + (course.liveEditedSinceReview ? ' Newer edits exist.' : '') + '</span>';
    html += '</div></div>';

    if (course.reviewNote) html += '<div class="b-review-note" style="margin-bottom:12px"><strong>Reviewer note:</strong> ' + esc(course.reviewNote) + '</div>';
    html += roNote();

    // Course settings
    html += '<div class="card"><h2><span class="step">1</span> Course settings</h2><div class="grid">';
    html += '<div class="field span-2"><label>Short description <span class="optional">(shown to learners)</span></label>'
      + '<textarea id="bCourseDesc" rows="2"' + roAttr() + '>' + esc(course.description) + '</textarea></div>';
    html += '<div class="field"><label>Pass mark (%)</label><input type="number" id="bPassMark" min="1" max="100" value="' + course.passMark + '"' + roAttr() + '>'
      + '<div class="hint">Learners must score this on the final quiz. 80 is the usual bar.</div></div>';
    html += '<div class="field"><label>Quiz attempts allowed</label><input type="number" id="bMaxAttempts" min="1" max="10" value="' + course.maxAttempts + '"' + roAttr() + '></div>';
    html += '<div class="field"><label>If they run out of attempts</label><select id="bOnFail"' + roAttr() + '>'
      + '<option value="retry"' + (course.onFail === 'retry' ? ' selected' : '') + '>Reset the quiz and let them try again</option>'
      + '<option value="contact"' + (course.onFail === 'contact' ? ' selected' : '') + '>Ask them to contact EASY</option></select></div>';
    html += '</div></div>';

    // Chapters
    html += '<div class="card"><h2><span class="step">2</span> Chapters</h2>';
    html += '<div class="b-tip"><strong>How chapters work:</strong> keep each chapter to one idea and roughly 5–10 minutes of learner time. Short video and text segments carry the ideas that never change; quizzes and interactive pieces carry the details.</div>';
    if (!course.chapters.length) {
      html += '<div class="b-chapter-empty">No chapters yet. Add the first one to begin — e.g. "Welcome and why this matters".</div>';
    }
    course.chapters.forEach((ch, ci) => { html += renderChapter(ch, course, ci, author); });
    if (author) html += '<button type="button" class="btn btn-secondary" data-act="chapter-add">+ Add chapter</button>';
    html += '</div>';

    // Final quiz
    html += '<div class="card"><h2><span class="step">3</span> Final quiz</h2>';
    html += '<div class="b-tip">The final quiz gates the certificate path. Learners need <strong>' + course.passMark + '%</strong> with <strong>' + course.maxAttempts + '</strong> attempt(s).</div>';
    html += renderQuestions(course.finalQuiz.questions, 'final', author);
    if (author) html += '<button type="button" class="btn btn-secondary btn-small" data-act="q-add" data-scope="final">+ Add question</button>';
    html += '</div>';

    // Actions
    html += '<div class="card"><h2><span class="step">4</span> Check &amp; send</h2><div class="b-course-actions">';
    html += '<button type="button" class="btn btn-secondary" data-act="preview" data-id="' + course.id + '">Preview as learner</button>';
    html += '<button type="button" class="btn btn-secondary" data-act="checklist" data-id="' + course.id + '">Readiness check</button>';
    if (author && course.status !== 'in_review') html += '<button type="button" class="btn btn-primary" data-act="send-review" data-id="' + course.id + '">Send for review</button>';
    if (author && course.status === 'in_review') html += '<button type="button" class="btn btn-secondary" data-act="withdraw" data-id="' + course.id + '">Withdraw from review</button>';
    html += '<button type="button" class="btn btn-secondary" data-act="export" data-id="' + course.id + '">Export backup</button>';
    html += '</div>';
    html += onSite()
      ? '<p class="hint" style="margin-bottom:0">Sending for review freezes a versioned snapshot and puts it in the reviewers\' Review inbox here in the app. You can keep editing afterwards; new edits won\'t touch the snapshot under review.</p>'
      : '<p class="hint" style="margin-bottom:0">Sending for review freezes a versioned snapshot and downloads a review file. Send that file to a course reviewer. You can keep editing afterwards; new edits won\'t touch the snapshot under review.</p>';
    html += '</div>';

    // Data view
    html += '<details class="card"><summary style="cursor:pointer;font-weight:650">Underlying data (what the module player will read)</summary>'
      + '<p class="hint">This is the maker-framework content block. The final approved package has exactly this shape.</p>'
      + '<pre style="max-height:320px;overflow:auto;background:#f7f9fc;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:11.5px">' + esc(JSON.stringify(cleanCourse(course), null, 2)) + '</pre></details>';

    $('builderRoot').innerHTML = html;
    wireBuilder(course, author);
  }

  function renderChapter(ch, course, ci, author) {
    const dis = author ? '' : ' disabled';
    let html = '<div class="b-chapter" data-ch="' + ch.id + '">';
    html += '<div class="b-chapter-head">';
    html += '<input type="text" class="b-chapter-title" data-cfield="title" value="' + esc(ch.title) + '" aria-label="Chapter title"' + dis + '>';
    html += '<span class="b-time-chip" data-timefor="ch-' + ch.id + '">' + esc(fmtEst(chapterSeconds(ch))) + '</span>';
    if (author) {
      html += '<button type="button" class="b-icon-btn" data-act="chapter-up" data-id="' + ch.id + '" title="Move up">↑</button>';
      html += '<button type="button" class="b-icon-btn" data-act="chapter-down" data-id="' + ch.id + '" title="Move down">↓</button>';
      html += '<button type="button" class="b-icon-btn danger" data-act="chapter-del" data-id="' + ch.id + '" title="Delete chapter">×</button>';
    }
    html += '</div><div class="b-chapter-body">';
    (ch.segments || []).forEach((seg) => { html += renderSegment(seg, ch, author); });
    if (!(ch.segments || []).length && !(ch.quizQuestions || []).length) {
      html += '<div class="b-chapter-empty">Empty chapter — add a segment below, or start with a short welcome video.</div>';
    }
    if (author) {
      html += '<div class="b-add-seg-row"><span class="b-kv">Add:</span> ';
      Object.keys(SEG_DEFS).forEach((t) => {
        html += '<button type="button" class="btn btn-secondary btn-small" data-act="seg-add" data-ch="' + ch.id + '" data-type="' + t + '">+ ' + SEG_DEFS[t].label + '</button>';
      });
      html += '</div>';
    }
    // Chapter quiz
    if ((ch.quizQuestions || []).length || author) {
      html += '<div style="margin-top:12px"><div class="b-kv" style="margin-bottom:6px"><strong>Chapter check</strong> — quick questions before moving on. <span class="b-time-chip" data-timefor="chq-' + ch.id + '">' + esc(fmtEst((ch.quizQuestions || []).length * 60)) + '</span></div>';
      html += renderQuestions(ch.quizQuestions || [], 'chq-' + ch.id, author);
      if (author) html += '<button type="button" class="btn btn-secondary btn-small" data-act="q-add" data-scope="chq" data-ch="' + ch.id + '">+ Add question</button>';
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderSegment(seg, ch, author) {
    const def = SEG_DEFS[seg.type];
    const dis = author ? '' : ' disabled';
    let html = '<div class="b-segment b-segment-' + seg.type + '" data-seg="' + seg.id + '">';
    html += '<div class="b-segment-head">';
    html += '<span class="b-seg-type">' + def.label + '</span>';
    html += '<span class="b-delivery b-delivery-' + def.delivery + '">' + DELIVERY_LABEL[def.delivery] + '</span>';
    html += '<input type="text" class="b-seg-title" data-sfield="title" placeholder="Segment title…" value="' + esc(seg.title) + '"' + dis + '>';
    html += '<span class="b-time-chip" data-timefor="seg-' + seg.id + '">' + esc(fmtEst(segSeconds(seg))) + '</span>';
    if (author) {
      html += '<button type="button" class="b-icon-btn" data-act="seg-up" data-ch="' + ch.id + '" data-id="' + seg.id + '" title="Move up">↑</button>';
      html += '<button type="button" class="b-icon-btn" data-act="seg-down" data-ch="' + ch.id + '" data-id="' + seg.id + '" title="Move down">↓</button>';
      html += '<button type="button" class="b-del-btn" data-act="seg-del" data-ch="' + ch.id + '" data-id="' + seg.id + '" title="Delete this ' + def.label.toLowerCase() + ' block">× Delete</button>';
    }
    html += '</div>';
    html += '<div class="b-tip">' + def.tip + '</div>';

    if (seg.type === 'video') {
      html += '<div class="grid"><div class="field"><label>Video file</label><div class="lookup-row">'
        + '<input type="text" data-sfield="fileName" placeholder="e.g. welcome.mp4" value="' + esc(seg.fileName) + '"' + dis + '>'
        + (author ? '<button type="button" class="btn btn-secondary btn-small" data-act="seg-file" data-ch="' + ch.id + '" data-id="' + seg.id + '" data-f="fileName">Choose…</button>' : '')
        + '</div><div class="hint">For now, just the file name is recorded here.</div></div>'
        + '<div class="field"><label>Duration (m:ss)</label><input type="text" data-sfield="duration" value="' + esc(fmtDurationInput(seg.durationSec)) + '" placeholder="3:30"' + dis + '></div>'
        + '<div class="field span-2"><label>Transcript <span class="optional">(required — captions &amp; accessibility)</span></label>'
        + '<textarea data-sfield="transcript" rows="3" placeholder="Everything said in the video, word for word…"' + dis + '>' + esc(seg.transcript) + '</textarea></div></div>';
    } else if (seg.type === 'text') {
      html += '<div class="field"><label>Lesson text</label><textarea data-sfield="body" rows="4" placeholder="Write the lesson…"' + dis + '>' + esc(seg.body) + '</textarea></div>'
        + '<div class="grid"><div class="field"><label>Narration script <span class="optional">(if someone records voiceover)</span></label>'
        + '<textarea data-sfield="narrationScript" rows="3" placeholder="Spoken version — doubles as the transcript…"' + dis + '>' + esc(seg.narrationScript) + '</textarea></div>'
        + '<div class="field"><label>Audio file <span class="optional">(optional)</span></label><div class="lookup-row">'
        + '<input type="text" data-sfield="audioFileName" placeholder="e.g. narration.mp3" value="' + esc(seg.audioFileName) + '"' + dis + '>'
        + (author ? '<button type="button" class="btn btn-secondary btn-small" data-act="seg-file" data-ch="' + ch.id + '" data-id="' + seg.id + '" data-f="audioFileName">Choose…</button>' : '')
        + '</div><div class="field" style="margin-top:8px"><label>Audio length (m:ss)</label><input type="text" data-sfield="audioDur" value="' + esc(fmtDurationInput(seg.audioSec)) + '" placeholder="2:15"' + dis + '></div></div></div>';
    } else if (seg.type === 'photo') {
      html += '<div class="grid"><div class="field"><label>Photo file</label><div class="lookup-row">'
        + '<input type="text" data-sfield="fileName" placeholder="e.g. harness-closeup.jpg" value="' + esc(seg.fileName) + '"' + dis + '>'
        + (author ? '<button type="button" class="btn btn-secondary btn-small" data-act="seg-file" data-ch="' + ch.id + '" data-id="' + seg.id + '" data-f="fileName">Choose…</button>' : '')
        + '</div><div class="hint">Real photos from EASY\'s facility — learners should recognize the gear at their practical.</div></div>'
        + '<div class="field"><label>Caption <span class="optional">(shown under the photo)</span></label><input type="text" data-sfield="caption" value="' + esc(seg.caption) + '" placeholder="What the learner is looking at…"' + dis + '></div>'
        + '<div class="field span-2"><label>Alt text <span class="optional">(required — read aloud by screen readers)</span></label>'
        + '<input type="text" data-sfield="alt" value="' + esc(seg.alt) + '" placeholder="Describe the photo for someone who can\'t see it…"' + dis + '></div></div>';
    } else if (seg.type === 'interactive') {
      html += '<div class="field"><label>Describe the exercise</label>'
        + '<textarea data-sfield="description" rows="3" placeholder="e.g. Learner drags the 8 hazard pictograms onto the matching product photos…"'+ dis + '>' + esc(seg.description) + '</textarea>'
        + '<div class="hint">Plain words are perfect — describe what the learner should <em>do</em> and we\'ll build it from this.</div></div>'
        + '<div class="field"><label>Your estimate: how long does it take? (minutes)</label><input type="number" data-sfield="estMin" min="1" max="30" value="' + (seg.estMin || 3) + '"' + dis + '></div>';
    } else if (seg.type === 'quiz') {
      html += renderQuestions(seg.questions || [], 'seg-' + seg.id, author);
      if (author) html += '<button type="button" class="btn btn-secondary btn-small" data-act="q-add" data-scope="seg" data-ch="' + ch.id + '" data-id="' + seg.id + '">+ Add question</button>';
    }
    html += '</div>';
    return html;
  }

  function renderQuestions(questions, scope, author) {
    const dis = author ? '' : ' disabled';
    let html = '';
    (questions || []).forEach((q, qi) => {
      html += '<div class="b-quiz-q" data-q="' + q.id + '">';
      html += '<div class="field"><label>Question ' + (qi + 1) + '</label>'
        + '<input type="text" data-qfield="q" value="' + esc(q.q) + '" placeholder="What would you do if…?"' + dis + '></div>';
      html += '<div class="field"><label>Type</label><select data-qfield="kind"' + dis + '>'
        + '<option value="mc"' + (q.kind === 'mc' ? ' selected' : '') + '>Multiple choice</option>'
        + '<option value="tf"' + (q.kind === 'tf' ? ' selected' : '') + '>True / false</option></select></div>';
      if (q.kind === 'mc') {
        html += '<div class="field"><label>Answers <span class="optional">(tick the correct one)</span></label>';
        (q.options || []).forEach((opt, oi) => {
          html += '<div class="b-quiz-opt"><input type="radio" name="ans-' + q.id + '" data-qfield="answer" value="' + oi + '"' + (q.answer === oi ? ' checked' : '') + dis + ' title="Correct answer">'
            + '<input type="text" data-qfield="opt" data-oi="' + oi + '" value="' + esc(opt) + '" placeholder="Answer option…"' + dis + '>'
            + (author && (q.options || []).length > 2 ? '<button type="button" class="b-icon-btn danger" data-act="q-opt-del" data-qscope="' + scope + '" data-qid="' + q.id + '" data-oi="' + oi + '" title="Remove option">×</button>' : '')
            + '</div>';
        });
        if (author) html += '<button type="button" class="btn btn-secondary btn-small" data-act="q-opt-add" data-qscope="' + scope + '" data-qid="' + q.id + '">+ Add option</button>';
        html += '</div>';
      } else {
        html += '<div class="field"><label>Correct answer</label><select data-qfield="tfanswer"' + dis + '>'
          + '<option value="0"' + (q.answer === 0 ? ' selected' : '') + '>True</option>'
          + '<option value="1"' + (q.answer === 1 ? ' selected' : '') + '>False</option></select></div>';
      }
      if (author) html += '<div style="margin-top:6px"><button type="button" class="btn btn-secondary btn-small" data-act="q-del" data-qscope="' + scope + '" data-qid="' + q.id + '" style="color:var(--error)">Remove question</button></div>';
      html += '</div>';
    });
    if (!(questions || []).length) html += '<p class="hint">No questions yet.</p>';
    return html;
  }

  /* ---------------- model lookup ---------------- */

  function findChapter(course, chId) { return (course.chapters || []).find((c) => c.id === chId); }
  function findSegment(ch, segId) { return ((ch && ch.segments) || []).find((s) => s.id === segId); }
  function move(arr, idx, dir) {
    const j = idx + dir;
    if (idx < 0 || j < 0 || idx >= arr.length || j >= arr.length) return false;
    const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    return true;
  }
  function questionList(course, scope, chId, segId) {
    if (scope === 'final') return course.finalQuiz.questions;
    const ch = findChapter(course, chId);
    if (!ch) return [];
    if (scope === 'chq') { ch.quizQuestions = ch.quizQuestions || []; return ch.quizQuestions; }
    if (scope === 'seg') {
      const seg = findSegment(ch, segId);
      if (!seg) return [];
      seg.questions = seg.questions || [];
      return seg.questions;
    }
    return [];
  }

  /* ---------------- hidden file picker ---------------- */

  let fileCb = null;
  function pickFile(accept, cb) {
    let inp = $('bFilePick');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'bFilePick';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        const cb2 = fileCb;
        fileCb = null;
        inp.value = '';
        if (cb2) cb2(f || null);
      });
    }
    fileCb = cb;
    inp.accept = accept || '';
    inp.click();
  }

  /* ---------------- live time refresh (no full re-render while typing) ---------------- */

  function refreshTimes(course) {
    document.querySelectorAll('#builderRoot [data-timefor]').forEach((el) => {
      const key = el.getAttribute('data-timefor');
      if (key === 'course') { el.textContent = fmtEst(courseSeconds(course)) + ' learner time'; return; }
      if (key.startsWith('chq-')) {
        const ch = findChapter(course, key.slice(4));
        if (ch) el.textContent = fmtEst((ch.quizQuestions || []).length * 60);
        return;
      }
      if (key.startsWith('ch-')) {
        const ch = findChapter(course, key.slice(3));
        if (ch) el.textContent = fmtEst(chapterSeconds(ch));
        return;
      }
      if (key.startsWith('seg-')) {
        for (const ch of course.chapters) {
          const seg = findSegment(ch, key.slice(4));
          if (seg) { el.textContent = fmtEst(segSeconds(seg)); break; }
        }
      }
    });
  }

  /* ---------------- builder wiring ---------------- */

  // Returns 'invalid' when a duration field can't be parsed, so the caller
  // can explain instead of silently resetting to 0:00.
  function setSegField(course, chId, segId, field, value) {
    const ch = findChapter(course, chId);
    const seg = ch && findSegment(ch, segId);
    if (!seg) return;
    if (field === 'duration' || field === 'audioDur') {
      const secs = parseDuration(value);
      if (secs === null) return 'invalid';
      if (field === 'duration') seg.durationSec = secs; else seg.audioSec = secs;
    }
    else if (field === 'estMin') {
      const n = parseInt(value, 10);
      seg.estMin = Math.max(1, Math.min(30, Number.isNaN(n) ? 3 : n));
    }
    else seg[field] = value;
    touch(course);
  }

  function wireBuilder(course, author) {
    const root = $('builderRoot');

    const ct = $('bCourseTitle');
    if (ct) {
      ct.addEventListener('input', () => { course.title = ct.value; });
      ct.addEventListener('change', () => { touch(course); });
    }
    const cd = $('bCourseDesc');
    if (cd) {
      cd.addEventListener('input', () => { course.description = cd.value; });
      cd.addEventListener('change', () => touch(course));
    }
    [['bPassMark', 'passMark', 1, 100, 80], ['bMaxAttempts', 'maxAttempts', 1, 10, 3]].forEach(([id, f, lo, hi, fb]) => {
      const el = $(id);
      if (el) el.addEventListener('change', () => {
        course[f] = Math.max(lo, Math.min(hi, parseInt(el.value, 10) || fb));
        el.value = course[f];
        touch(course);
        render();
      });
    });
    const of = $('bOnFail');
    if (of) of.addEventListener('change', () => { course.onFail = of.value; touch(course); });

    // Chapter titles
    root.querySelectorAll('[data-ch]').forEach((chEl) => {
      const chId = chEl.getAttribute('data-ch');
      const titleEl = chEl.querySelector('[data-cfield="title"]');
      if (titleEl) {
        titleEl.addEventListener('input', () => {
          const ch = findChapter(course, chId);
          if (ch) { ch.title = titleEl.value; }
        });
        titleEl.addEventListener('change', () => touch(course));
      }
      // Segment fields
      chEl.querySelectorAll('[data-seg]').forEach((segEl) => {
        const segId = segEl.getAttribute('data-seg');
        segEl.querySelectorAll('[data-sfield]').forEach((fEl) => {
          const field = fEl.getAttribute('data-sfield');
          const apply = () => setSegField(course, chId, segId, field, fEl.value);
          fEl.addEventListener('input', () => { apply(); refreshTimes(course); });
          // No full render() here: the field already shows what was typed and
          // refreshTimes() updates the time chips — re-rendering would yank
          // the scroll position back to the top on every blur.
          fEl.addEventListener('change', () => {
            if (apply() === 'invalid') {
              toast('Could not understand that duration — use M:SS (e.g. 4:30) or H:MM:SS.', 'error');
              const seg = findSegment(findChapter(course, chId), segId);
              if (seg) fEl.value = fmtDurationInput(field === 'audioDur' ? seg.audioSec : seg.durationSec);
            }
            persistCourses(); refreshTimes(course);
          });
        });
      });
      // Question fields
      chEl.querySelectorAll('[data-q]').forEach((qEl) => {
        wireQuestion(course, qEl, root);
      });
    });
    // Final quiz questions live outside chapters
    root.querySelectorAll('.card [data-q]').forEach((qEl) => {
      if (qEl.closest('[data-ch]')) return; // already wired above
      wireQuestion(course, qEl, root);
    });

    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => handleAction(b.getAttribute('data-act'), b.getAttribute('data-id') || ui.courseId, b));
    });
  }

  function wireQuestion(course, qEl, root) {
    const qid = qEl.getAttribute('data-q');
    const findQ = () => {
      for (const ch of course.chapters || []) {
        let q = (ch.quizQuestions || []).find((x) => x.id === qid);
        if (q) return q;
        for (const seg of ch.segments || []) {
          q = (seg.questions || []).find((x) => x.id === qid);
          if (q) return q;
        }
      }
      return (course.finalQuiz.questions || []).find((x) => x.id === qid);
    };
    qEl.querySelectorAll('[data-qfield]').forEach((fEl) => {
      const field = fEl.getAttribute('data-qfield');
      const apply = () => {
        const q = findQ();
        if (!q) return;
        if (field === 'q') q.q = fEl.value;
        else if (field === 'kind') {
          q.kind = fEl.value;
          if (q.kind === 'tf') { q.options = ['True', 'False']; q.answer = 0; }
          else { q.options = ['', '']; q.answer = 0; }
        }
        else if (field === 'opt') q.options[parseInt(fEl.getAttribute('data-oi'), 10)] = fEl.value;
        else if (field === 'answer' && fEl.checked) q.answer = parseInt(fEl.value, 10);
        else if (field === 'tfanswer') q.answer = parseInt(fEl.value, 10);
        touch(course);
      };
      const evt = (fEl.type === 'radio' || fEl.tagName === 'SELECT') ? 'change' : 'input';
      fEl.addEventListener(evt, () => {
        apply();
        if (field === 'kind') render(); // re-render to swap mc/tf editors
        else refreshTimes(course);
      });
      if (evt === 'input') fEl.addEventListener('change', () => persistCourses());
    });
  }

  /* ---------------- actions ---------------- */

  function currentCourse() { return getCourse(ui.courseId); }

  function findQParent(course, qid) {
    const fq = course.finalQuiz.questions || [];
    let i = fq.findIndex((q) => q.id === qid);
    if (i >= 0) return { list: fq, index: i };
    for (const ch of course.chapters || []) {
      const cq = ch.quizQuestions || [];
      i = cq.findIndex((q) => q.id === qid);
      if (i >= 0) return { list: cq, index: i };
      for (const seg of ch.segments || []) {
        const sq = seg.questions || [];
        i = sq.findIndex((q) => q.id === qid);
        if (i >= 0) return { list: sq, index: i, question: sq[i] };
      }
    }
    return null;
  }

  function requireAuthor() {
    if (isAuthor()) return true;
    toast('Only course authors can do that. Authors: ' + authors.join(', '), 'error');
    return false;
  }

  async function handleAction(act, id, el) {
    const course = currentCourse();
    switch (act) {
      case 'back': ui.view = 'library'; ui.courseId = null; render(); break;

      case 'new-course': {
        if (!requireAuthor()) break;
        const name = await modalPrompt({
          title: 'New course',
          bodyHtml: '<p>Name the course — you can change it later.</p>',
          placeholder: 'e.g. WHMIS 2015 — Online Theory',
          okText: 'Create course',
        });
        if (name === null) break;
        const c = newCourse(name || 'Untitled course');
        courses.unshift(c);
        persistCourses();
        ui.view = 'builder'; ui.courseId = c.id;
        toast('Course created. Add chapters to begin.', 'success');
        render();
        break;
      }

      case 'open': ui.view = 'builder'; ui.courseId = id; render(); break;

      case 'preview':
        ui.returnTo = ui.view === 'preview' ? (ui.returnTo || 'library') : ui.view;
        ui.view = 'preview';
        ui.preview = { kind: 'course', id };
        render();
        break;

      case 'delete': {
        if (!requireAuthor()) break;
        const c = getCourse(id);
        if (!c) break;
        const fromSiteToo = onSite() && !!c._rev;
        const yes = await modalShell({
          title: 'Delete course?',
          bodyHtml: '<p><strong>' + esc(c.title) + '</strong> and all its chapters will be deleted '
            + (fromSiteToo ? 'from the site and from every computer, along with its reviews.' : 'from this machine.')
            + ' Export a backup first if you might want it back.</p>',
          okText: 'Delete', cancelText: 'Keep it',
        });
        if (yes) {
          if (fromSiteToo) {
            await waitForPush();
            const r = await courseApi().sync('delete', { id: c.id });
            if (!r.ok && r.status !== 404) { toast('Could not delete it from the site: ' + r.error, 'error'); schedulePush(); break; }
            await refreshReviews();
          }
          courses = courses.filter((x) => x.id !== id);
          persistCourses();
          if (ui.courseId === id) { ui.view = 'library'; ui.courseId = null; }
          toast('Course deleted.', 'info');
          render();
        }
        break;
      }

      case 'chapter-add': {
        if (!requireAuthor() || !course) break;
        course.chapters.push(newChapter('Chapter ' + (course.chapters.length + 1)));
        touch(course); render();
        break;
      }
      case 'chapter-up': case 'chapter-down': {
        if (!requireAuthor() || !course) break;
        const i = course.chapters.findIndex((c) => c.id === id);
        if (move(course.chapters, i, act === 'chapter-up' ? -1 : 1)) { touch(course); render(); }
        break;
      }
      case 'chapter-del': {
        if (!requireAuthor() || !course) break;
        const ch = findChapter(course, id);
        const yes = await modalShell({
          title: 'Delete chapter?',
          bodyHtml: '<p><strong>' + esc(ch ? ch.title : '') + '</strong> and all its segments will be deleted.</p>',
          okText: 'Delete', cancelText: 'Keep it',
        });
        if (yes) {
          course.chapters = course.chapters.filter((c) => c.id !== id);
          touch(course); render();
        }
        break;
      }

      case 'seg-add': {
        if (!requireAuthor() || !course) break;
        const ch = findChapter(course, el.getAttribute('data-ch'));
        if (!ch) break;
        ch.segments.push(newSegment(el.getAttribute('data-type')));
        touch(course); render();
        break;
      }
      case 'seg-up': case 'seg-down': {
        if (!requireAuthor() || !course) break;
        const ch = findChapter(course, el.getAttribute('data-ch'));
        if (!ch) break;
        const i = ch.segments.findIndex((s) => s.id === id);
        if (move(ch.segments, i, act === 'seg-up' ? -1 : 1)) { touch(course); render(); }
        break;
      }
      case 'seg-del': {
        if (!requireAuthor() || !course) break;
        const ch = findChapter(course, el.getAttribute('data-ch'));
        if (!ch) break;
        const seg = ch.segments.find((s) => s.id === id);
        const label = seg ? (SEG_DEFS[seg.type] ? SEG_DEFS[seg.type].label : 'block') : 'block';
        const yes = await modalShell({
          title: 'Delete ' + label.toLowerCase() + '?',
          bodyHtml: '<p>' + (seg && seg.title ? '<strong>' + esc(seg.title) + '</strong><br>' : '') + 'This ' + label.toLowerCase() + ' block and its content will be removed.</p>',
          okText: 'Delete', cancelText: 'Keep it',
        });
        if (yes) {
          ch.segments = ch.segments.filter((s) => s.id !== id);
          touch(course); render();
        }
        break;
      }
      case 'seg-file': {
        if (!requireAuthor() || !course) break;
        const chId = el.getAttribute('data-ch');
        const field = el.getAttribute('data-f');
        pickFile('', (f) => {
          if (!f) return;
          setSegField(course, chId, id, field, f.name);
          persistCourses();
          toast('Recorded file name: ' + f.name, 'success');
          render();
        });
        break;
      }

      case 'q-add': {
        if (!requireAuthor() || !course) break;
        const list = questionList(course, el.getAttribute('data-scope'), el.getAttribute('data-ch'), id);
        list.push(newQuestion());
        touch(course); render();
        break;
      }
      case 'q-del': {
        if (!requireAuthor() || !course) break;
        const p = findQParent(course, el.getAttribute('data-qid'));
        if (p) {
          const yes = await modalShell({
            title: 'Delete question?',
            bodyHtml: '<p>' + (p.list[p.index].q ? '<strong>' + esc(p.list[p.index].q) + '</strong><br>' : '') + 'This question will be removed.</p>',
            okText: 'Delete', cancelText: 'Keep it',
          });
          if (yes) { p.list.splice(p.index, 1); touch(course); render(); }
        }
        break;
      }
      case 'q-opt-add': {
        if (!requireAuthor() || !course) break;
        const p = findQParent(course, el.getAttribute('data-qid'));
        if (p) { p.list[p.index].options.push(''); touch(course); render(); }
        break;
      }
      case 'q-opt-del': {
        if (!requireAuthor() || !course) break;
        const p = findQParent(course, el.getAttribute('data-qid'));
        if (p) {
          const q = p.list[p.index];
          const oi = parseInt(el.getAttribute('data-oi'), 10);
          if (Number.isNaN(oi) || oi < 0 || oi >= q.options.length) break;
          q.options.splice(oi, 1);
          // Keep the answer key pointing at the same option: options after
          // the deletion shift down one, and deleting the correct option
          // itself falls back to the first option.
          if (oi < q.answer) q.answer--;
          else if (oi === q.answer) q.answer = 0;
          touch(course); render();
        }
        break;
      }

      case 'checklist': {
        const c = getCourse(id) || course;
        if (c) await showChecklist(c);
        break;
      }

      case 'send-review': {
        if (!requireAuthor()) break;
        const c = getCourse(id) || course;
        if (c) await showChecklist(c);
        break;
      }

      case 'withdraw': {
        if (!requireAuthor()) break;
        const c = getCourse(id) || course;
        if (!c) break;
        const viaSite = onSite() && !!c._rev;
        const yes = await modalShell({
          title: 'Withdraw from review?',
          bodyHtml: viaSite
            ? '<p>The version with the reviewer comes out of the Review inbox and this course goes back to <strong>' + (c.approvedVersion ? 'Approved (v' + c.approvedVersion + ')' : 'Draft') + '</strong>.</p>'
            : '<p>The snapshot already sent stays with the reviewer, but this course goes back to <strong>Draft</strong> on your machine.</p>',
          okText: 'Withdraw', cancelText: 'Keep it under review',
        });
        if (!yes) break;
        if (viaSite) {
          const r = await courseApi().sync('withdraw', { id: c.id });
          if (!r.ok) { toast('Could not withdraw it: ' + r.error, 'error'); break; }
          applyWorkflow(c, r.data && r.data.course);
          await refreshReviews();
        } else {
          c.status = 'draft';
        }
        persistCourses();
        toast(c.status === 'approved' ? 'Withdrawn. The approved v' + c.approvedVersion + ' still stands.' : 'Back to draft.', 'info');
        render();
        break;
      }

      case 'export': {
        const c = getCourse(id) || course;
        if (!c) break;
        download(slug(c.title) + '.draft.json', {
          package: 'easy-course-backup', format: 1, kind: 'backup',
          exportedAt: new Date().toISOString(), exportedBy: accountUser,
          course: cleanCourse(c),
        });
        toast('Backup downloaded.', 'success');
        break;
      }

      case 'download-final': {
        const c = getCourse(id);
        if (!c) break;
        const r = await courseApi().sync('final', { id: c.id });
        if (!r.ok || !r.data) { toast('Could not get the approved version: ' + (r.error || 'no data'), 'error'); break; }
        download(slug(c.title) + '-v' + r.data.version + '.final.json', r.data);
        toast('Approved v' + r.data.version + ' downloaded.', 'success');
        break;
      }

      case 'sync-refresh':
        await pullFromSite();
        render();
        break;

      case 'open-backups':
        if (courseApi() && courseApi().openBackups) await courseApi().openBackups();
        break;

      case 'author-add': {
        const inp = $('bAuthorAdd');
        addAuthor(inp ? inp.value : '');
        break;
      }
      case 'author-del': {
        if (!requireAuthor()) break;
        const u = el.getAttribute('data-u');
        const yes = await modalShell({
          title: 'Remove author?',
          bodyHtml: '<p><strong>' + esc(u) + '</strong> will lose editing rights' + (onSite() ? '.' : ' on this machine.') + '</p>',
          okText: 'Remove', cancelText: 'Keep',
        });
        if (yes) {
          const next = authors.filter((a) => a !== u);
          if (!next.length) { toast('Keep at least one course author.', 'error'); break; }
          if (await saveAuthors(next)) render();
        }
        break;
      }

      case 'inbox-import':
        pickFile('.json,application/json', (f) => {
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try { importPackage(JSON.parse(r.result)); }
            catch (e) { toast('Could not read that file as a course package.', 'error'); }
          };
          r.readAsText(f);
        });
        break;

      case 'inbox-preview': {
        const item = allInbox().find((x) => x.id === id);
        if (!item) break;
        ui.returnTo = ui.view;
        ui.view = 'preview';
        ui.preview = { kind: 'snapshot', id };
        render();
        break;
      }

      case 'inbox-approve': {
        const item = allInbox().find((x) => x.id === id);
        if (item) await approveSnapshot(item);
        break;
      }

      case 'inbox-sendback': {
        const item = allInbox().find((x) => x.id === id);
        if (item) await sendBack(item);
        break;
      }

      case 'inbox-remove': {
        inbox = inbox.filter((x) => x.id !== id);
        persistInbox(); render();
        break;
      }

      default: break;
    }
  }

  /* ---------------- learner preview ---------------- */

  function previewCourseData() {
    if (!ui.preview) return null;
    if (ui.preview.kind === 'course') {
      const c = getCourse(ui.preview.id);
      return c ? { course: c, label: 'Live course', frozen: false } : null;
    }
    const item = allInbox().find((x) => x.id === ui.preview.id);
    if (!item || !item.payload || !item.payload.course) return null;
    return { course: item.payload.course, label: 'Review snapshot v' + item.version, frozen: true };
  }

  // Learner-facing mode tags and chips, mirroring the module player:
  // TELL = instructor context/narration, SHOW = photography, DO = practice.
  const PV_MODE = {
    video: 'TELL · Instructor video',
    text: 'TELL · Updateable narration',
    photo: 'SHOW · Original EASY photography',
    interactive: 'DO · Interactive practice',
    quiz: 'DO · Knowledge check',
  };
  const PV_CHIP = {
    video: '<span class="b-chip b-chip-evergreen">Evergreen</span>',
    text: '<span class="b-chip b-chip-updateable">Volatile</span>',
    photo: '<span class="b-chip b-chip-photo">Real photo needed</span>',
    interactive: '<span class="b-chip b-chip-interactive">Interactive</span>',
    quiz: '',
  };

  function previewSegment(seg) {
    const title = seg.title || (SEG_DEFS[seg.type] || {}).label || seg.type;
    let body = '';
    if (seg.type === 'video') {
      body = '<div class="b-pv-video"><span class="b-pv-play"></span>'
        + '<div><strong>Instructor video placeholder</strong>'
        + '<span>' + esc(seg.fileName || 'video file to be added')
        + (seg.durationSec ? ' · ' + fmtEst(seg.durationSec).replace(/^≈ /, '') : '')
        + ' · Captions on</span></div></div>'
        + (seg.transcript
          ? '<details class="b-pv-transcript"><summary>Read transcript</summary><p>' + esc(seg.transcript).replace(/\n/g, '<br>') + '</p></details>'
          : '<p class="hint">No transcript yet.</p>');
    } else if (seg.type === 'text') {
      body = seg.body
        ? '<p>' + esc(seg.body).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>'
        : '<p class="hint">Text coming soon.</p>';
      if (seg.narrationScript) body += '<p class="b-kv">🎙 Narrated version available (' + esc(seg.audioFileName || 'audio to be added') + ').</p>';
    } else if (seg.type === 'photo') {
      body = '<div class="b-pv-photo"><div><strong>📷 ' + esc(seg.fileName || 'Awaiting real photography') + '</strong>'
        + (seg.caption ? '<span>' + esc(seg.caption) + '</span>' : '')
        + '<span class="b-pv-noai">No AI-generated image will be used.</span></div></div>';
    } else if (seg.type === 'interactive') {
      body = '<div class="b-pv-interactive">'
        + (seg.description ? '<p>' + esc(seg.description) + '</p>' : '<p class="hint">Exercise description coming soon.</p>')
        + '<p class="b-kv">' + (seg.estMin ? 'About ' + seg.estMin + ' min. ' : '') + 'Built from the author\'s description.</p></div>';
    } else if (seg.type === 'quiz') {
      const n = (seg.questions || []).length;
      body = '<p><strong>Quiz</strong> — ' + n + ' question' + (n === 1 ? '' : 's') + '.</p>';
    }
    return '<article class="b-pv-lesson"><div class="b-pv-lesson-head"><div><h3>' + esc(title) + '</h3>'
      + '<p>' + (PV_MODE[seg.type] || '') + '</p></div>'
      + (PV_CHIP[seg.type] || '') + '</div>'
      + '<div class="b-pv-lesson-body">' + body + '</div></article>';
  }

  function renderPreviewView() {
    const data = previewCourseData();
    if (!data) { ui.view = ui.returnTo || 'library'; ui.preview = null; return render(); }
    const c = data.course;
    const chapters = c.chapters || [];
    const backTarget = (ui.returnTo && ui.returnTo !== 'preview') ? ui.returnTo : 'library';
    let html = '<button type="button" class="btn btn-secondary btn-small" data-pback style="margin-bottom:12px">← Back to '
      + (backTarget === 'builder' ? 'builder' : 'library') + '</button>';
    html += '<div class="b-preview-frame">';
    html += '<div class="b-preview-bar"><div class="b-pv-brand"><img src="icon.png" alt="EASY Safety Training"><div><h3>EASY Safety Training</h3>'
      + '<p>Effective &amp; Affordable Safety for You</p></div></div><span class="b-pv-preview-tag">Preview</span></div>';
    html += '<div class="b-preview-layout">';

    // Chapter rail, like the module player
    html += '<aside class="b-pv-side"><h4>' + esc(c.title || 'Untitled course') + '</h4>'
      + '<p class="b-pv-side-sub">Online module · ' + esc(data.label) + '<br>' + esc(fmtEst(courseSeconds(c))) + ' estimated · Pass mark ' + (c.passMark || 80) + '%</p>'
      + '<div>';
    chapters.forEach((ch, i) => {
      const num = String(i + 1).padStart(2, '0');
      const has = (ch.segments || []).length || (ch.quizQuestions || []).length;
      html += '<button type="button" class="b-pv-chap' + (i === 0 ? ' active' : '') + '" data-pvch="' + i + '">'
        + '<span class="b-pv-num">' + num + '</span>'
        + '<span class="b-pv-chap-title">' + esc(ch.title || 'Untitled') + '</span>'
        + '<span class="b-pv-open">' + (has ? 'Open' : 'Awaiting content') + '</span></button>';
    });
    html += '</div><p class="b-pv-rail-note">TELL · SHOW · DO — each chapter blends durable instructor video, quickly revisable text, and short practice.</p></aside>';

    html += '<div class="b-pv-main"><div class="b-pv-content">';
    html += '<div class="b-pv-notice">Preview — this is how the course will look and feel inside the learner module. The finished module is built from the approved content package.</div>';

    if (!chapters.length) {
      html += '<div class="b-pv-await"><div><strong>Content not supplied</strong><p>This course has no chapters yet.</p></div></div>';
    }
    chapters.forEach((ch, i) => {
      const num = String(i + 1).padStart(2, '0');
      html += '<section class="b-pv-chapter" id="pvch-' + i + '">';
      html += '<header class="b-pv-chapter-head"><div><p class="b-eyebrow">Chapter ' + num + '</p>';
      html += '<h1 class="b-preview-chapter-title">' + esc(ch.title || 'Untitled') + '</h1></div></header>';
      html += '<h2 class="b-pv-section-label">Lesson sequence</h2>';
      const has = (ch.segments || []).length || (ch.quizQuestions || []).length;
      if (!has) html += '<div class="b-pv-await"><div><strong>Content not supplied</strong><p>This chapter is still being written.</p></div></div>';
      (ch.segments || []).forEach((seg) => { html += previewSegment(seg); });
      if ((ch.quizQuestions || []).length) {
        html += '<div class="b-pv-quiz"><h3>Chapter knowledge check</h3>'
          + '<p>' + ch.quizQuestions.length + ' question' + (ch.quizQuestions.length === 1 ? '' : 's') + ' before moving on.</p></div>';
      }
      html += '</section>';
    });

    const fq = (c.finalQuiz && c.finalQuiz.questions) || [];
    if (fq.length) {
      html += '<section class="b-pv-chapter"><h2 class="b-pv-section-label">Final step</h2>';
      html += '<div class="b-pv-quiz"><h3>Final quiz</h3>'
        + '<p>' + fq.length + ' questions · pass mark <strong>' + (c.passMark || 80) + '%</strong> · ' + (c.maxAttempts || 3) + ' attempt(s).</p></div></section>';
    }

    html += '<section><h2 class="b-pv-section-label">Delivery and maintenance plan</h2>'
      + '<div class="b-pv-legend-grid">'
      + '<div class="b-pv-legend-item"><strong><span class="b-chip b-chip-evergreen">Evergreen</span></strong><span>Durable instructor guidance and demonstrations.</span></div>'
      + '<div class="b-pv-legend-item"><strong><span class="b-chip b-chip-updateable">Volatile</span></strong><span>Specific text and narration that can be revised quickly.</span></div>'
      + '<div class="b-pv-legend-item"><strong><span class="b-chip b-chip-interactive">Interactive</span></strong><span>Keyboard-operable learner practice.</span></div>'
      + '<div class="b-pv-legend-item"><strong><span class="b-chip b-chip-photo">Real photo needed</span></strong><span>Reserved for authentic EASY photography; no generated stand-ins.</span></div>'
      + '</div></section>';

    if (data.frozen) html += '<p class="hint" style="margin-top:16px">Frozen review snapshot — the author may have made newer edits since.</p>';
    html += '<div class="b-pv-footer"><strong>Safety isn\'t expensive… it\'s priceless</strong><span>EASY Safety Training · easysafety.ca</span></div>';
    html += '</div></div></div></div>';

    $('builderRoot').innerHTML = html;
    document.querySelector('[data-pback]').addEventListener('click', () => {
      ui.view = backTarget;
      ui.preview = null;
      render();
    });
    document.querySelectorAll('[data-pvch]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-pvch]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const sec = document.getElementById('pvch-' + b.getAttribute('data-pvch'));
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------------- readiness checklist ---------------- */

  function validAnswer(q) {
    if (q.kind === 'tf') return q.answer === 0 || q.answer === 1;
    return q.options && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length
      && !!q.options[q.answer] && !!q.options[q.answer].trim();
  }

  function readiness(course) {
    const items = [];
    const need = (ok, label, warn) => items.push({ ok: !!ok, label, warn: !!warn });
    need(course.chapters.length > 0, 'At least one chapter');
    course.chapters.forEach((ch, i) => {
      const nm = 'Chapter ' + (i + 1) + ' ("' + (ch.title || 'untitled') + '")';
      need((ch.segments || []).length > 0 || (ch.quizQuestions || []).length > 0, nm + ' has content');
      (ch.segments || []).forEach((s) => {
        const snm = SEG_DEFS[s.type].label + ' "' + (s.title || 'untitled') + '"';
        if (s.type === 'video') need(s.transcript && s.transcript.trim(), snm + ' has a transcript', true);
        if (s.type === 'video') need(s.fileName && s.fileName.trim(), snm + ' has a video file', true);
        if (s.type === 'photo') need(s.alt && s.alt.trim(), snm + ' has alt text', true);
        if (s.type === 'photo') need(s.fileName && s.fileName.trim(), snm + ' has a photo file', true);
        if (s.type === 'interactive') need(s.description && s.description.trim(), snm + ' has a description');
        if (s.type === 'quiz') (s.questions || []).forEach((q, qi) => {
          need(q.q && q.q.trim(), snm + ' — question ' + (qi + 1) + ' has text');
          need(validAnswer(q), snm + ' — question ' + (qi + 1) + ' has a marked answer');
        });
      });
      (ch.quizQuestions || []).forEach((q, qi) => {
        need(q.q && q.q.trim(), nm + ' check — question ' + (qi + 1) + ' has text');
        need(validAnswer(q), nm + ' check — question ' + (qi + 1) + ' has a marked answer');
      });
    });
    need((course.finalQuiz.questions || []).length > 0, 'Final quiz has at least one question', true);
    (course.finalQuiz.questions || []).forEach((q, qi) => {
      need(q.q && q.q.trim(), 'Final quiz — question ' + (qi + 1) + ' has text');
      need(validAnswer(q), 'Final quiz — question ' + (qi + 1) + ' has a marked answer');
    });
    need(course.passMark >= 1 && course.passMark <= 100, 'Pass mark is set (' + course.passMark + '%)');
    return items;
  }

  async function showChecklist(course) {
    const items = readiness(course);
    const hard = items.filter((i) => !i.ok && !i.warn);
    const warns = items.filter((i) => !i.ok && i.warn);
    let body = '<ul class="b-check-list">' + items.map((i) =>
      '<li class="' + (i.ok ? 'b-check-ok' : 'b-check-warn') + '"><span>' + (i.ok ? '✓' : '!') + '</span><span>' + esc(i.label) + '</span></li>'
    ).join('') + '</ul>';
    if (hard.length) body += '<p><strong>' + hard.length + ' item' + (hard.length === 1 ? '' : 's') + ' need' + (hard.length === 1 ? 's' : '') + ' fixing before sending.</strong></p>';
    else if (warns.length) body += '<p>Good to send — ' + warns.length + ' suggestion' + (warns.length === 1 ? '' : 's') + ' you may still want to address.</p>';
    else body += '<p>All checks pass. Ready when you are.</p>';
    const go = await modalShell({
      title: 'Readiness check',
      bodyHtml: body,
      okText: hard.length ? 'Back to editing' : 'Send for review',
      cancelText: hard.length ? null : 'Keep editing',
    });
    // The checklist gates sending. doSendReview then sends to the site, or
    // (without site sync) confirms the review file downloaded before
    // marking anything sent.
    if (go && !hard.length) doSendReview(course);
  }

  /* ---------------- review transport ---------------- */

  function snapshotOf(course) {
    return {
      title: course.title, description: course.description,
      passMark: course.passMark, maxAttempts: course.maxAttempts, onFail: course.onFail,
      chapters: deepCopy(course.chapters), finalQuiz: deepCopy(course.finalQuiz),
    };
  }

  async function doSendReview(course) {
    if (onSite()) return sendReviewToSite(course);
    const version = course.reviewVersion + 1;
    const now = new Date().toISOString();
    const filename = slug(course.title) + '-v' + version + '.review.json';
    download(filename, {
      package: 'easy-course-review', format: 1, kind: 'review',
      courseId: course.id, version, submittedBy: accountUser, submittedAt: now,
      course: snapshotOf(course),
    });
    // The browser gives no reliable "download succeeded" signal, so confirm
    // with the author before marking anything sent — a failed download must not
    // bump the version or flip the status.
    const saved = await modalShell({
      title: 'Did the file download?',
      bodyHtml: '<p>The review file <strong>' + esc(filename) + '</strong> should have downloaded just now. '
        + 'Please confirm it saved before we mark v' + version + ' as sent — if the download failed, you can retry without losing anything.</p>',
      okText: 'Yes, file downloaded',
      cancelText: 'Download failed — retry',
    });
    if (!saved) return;
    course.reviewVersion = version;
    course.status = 'in_review';
    course.liveEditedSinceReview = false;
    course.reviewNote = '';
    course.updatedAt = now;
    persistCourses();
    toast('Snapshot v' + version + ' downloaded. Send the file to a course reviewer.', 'success', 8000);
    render();
  }

  async function sendReviewToSite(course) {
    if (sync.mode === 'offline') {
      toast('Can\'t reach the site right now, so this can\'t be sent yet. Your edits are safe on this computer.', 'error', 8000);
      return;
    }
    await waitForPush();
    const sig = contentSig(course);
    const r = await courseApi().sync('submit', { id: course.id, course: cleanCourse(course), baseRev: course._rev || 0 });
    if (!r.ok) {
      if (r.status === 409 && r.data && r.data.current) {
        keepBoth(course, r.data.current);
        saveJSON(LS_COURSES, courses);
        toast('Nothing was sent, because this course changed on another computer. Check both versions, then send again.', 'error', 10000);
        render();
      } else {
        toast('Could not send it for review: ' + (r.error || 'unknown error'), 'error', 8000);
      }
      return;
    }
    course._rev = r.data.rev;
    course._syncedSig = sig;
    applyWorkflow(course, r.data.course);
    saveJSON(LS_COURSES, courses);
    await refreshReviews();
    toast('Sent v' + course.reviewVersion + ' for review. It is in the reviewers\' inbox now.', 'success', 8000);
    render();
  }

  async function approveOnSite(item) {
    const c = item.payload && item.payload.course;
    const yes = await modalShell({
      title: 'Approve this version?',
      bodyHtml: '<p>Approving marks <strong>v' + item.version + ' of "' + esc((c && c.title) || 'untitled') + '"</strong> as final. '
        + 'The approved version is stored on the site as the content package the module player is built from, and the author sees it as approved.</p>',
      okText: 'Approve', cancelText: 'Not yet',
    });
    if (!yes) return;
    const r = await courseApi().sync('approve', { reviewId: item.reviewId });
    if (!r.ok) toast('Could not approve it: ' + r.error, 'error');
    else {
      applyWorkflow(getCourse(item.courseId), r.data && r.data.course);
      saveJSON(LS_COURSES, courses);
      toast('Approved v' + item.version + '.', 'success', 6000);
    }
    await refreshReviews();
    render();
  }

  async function sendBackOnSite(item) {
    const c = item.payload && item.payload.course;
    const note = await modalPrompt({
      title: 'Send back with a note',
      bodyHtml: '<p>Tell the author what needs fixing in v' + item.version + ' of "' + esc((c && c.title) || 'untitled') + '". They\'ll see the note on the course.</p>',
      placeholder: 'e.g. Chapter 2\'s quiz needs an answer marked on question 3…',
      okText: 'Send back',
    });
    if (note === null) return;
    if (!note) { toast('A short note helps the author know what to fix.', 'error'); return; }
    const r = await courseApi().sync('sendBack', { reviewId: item.reviewId, note });
    if (!r.ok) toast('Could not send it back: ' + r.error, 'error');
    else {
      applyWorkflow(getCourse(item.courseId), r.data && r.data.course);
      saveJSON(LS_COURSES, courses);
      toast('Sent back with your note.', 'success', 6000);
    }
    await refreshReviews();
    render();
  }

  async function approveSnapshot(item) {
    if (item.site) return approveOnSite(item);
    const c = item.payload && item.payload.course;
    const yes = await modalShell({
      title: 'Approve this snapshot?',
      bodyHtml: '<p>Approving freezes <strong>v' + item.version + ' of "' + esc((c && c.title) || 'untitled') + '"</strong> as final. The download is the <strong>maker-framework content package</strong> — the exact content block the module player is built from.</p>',
      okText: 'Approve & download final', cancelText: 'Not yet',
    });
    if (!yes) return;
    const now = new Date().toISOString();
    download(slug((c && c.title) || 'course') + '-v' + item.version + '.final.json', {
      package: 'easy-course-final', format: 1, kind: 'final',
      courseId: item.courseId, version: item.version,
      approvedBy: accountUser, approvedAt: now,
      course: deepCopy(c),
    });
    item.handled = true;
    item.result = 'approved';
    persistInbox();
    const local = getCourse(item.courseId);
    if (local) {
      local.status = 'approved';
      local.approvedVersion = item.version;
      local.updatedAt = now;
      persistCourses();
    }
    toast('Approved. The final package is what the module gets built from.', 'success', 8000);
    render();
  }

  async function sendBack(item) {
    if (item.site) return sendBackOnSite(item);
    const c = item.payload && item.payload.course;
    const note = await modalPrompt({
      title: 'Send back with a note',
      bodyHtml: '<p>Tell the author what needs fixing in v' + item.version + ' of "' + esc((c && c.title) || 'untitled') + '".</p>',
      placeholder: 'e.g. Chapter 2\'s quiz needs an answer marked on question 3…',
      okText: 'Download changes file',
    });
    if (note === null) return;
    if (!note) { toast('A short note helps the author know what to fix.', 'error'); return; }
    const now = new Date().toISOString();
    download(slug((c && c.title) || 'course') + '-v' + item.version + '.changes.json', {
      package: 'easy-course-changes', format: 1, kind: 'changes',
      courseId: item.courseId, version: item.version,
      note, sentBy: accountUser, sentAt: now,
      course: deepCopy(c),
    });
    item.handled = true;
    item.result = 'sent back';
    persistInbox();
    toast('Changes file downloaded — send it back to the author.', 'success', 8000);
    render();
  }

  function importPackage(obj) {
    if (!obj || typeof obj.package !== 'string') { toast('That file is not a course package.', 'error'); return; }
    if (obj.format !== 1) { toast('Unsupported package format — this builder reads format 1.', 'error'); return; }
    const kind = obj.kind;
    const hasCourse = obj.course && typeof obj.course === 'object';
    // Reviews and change-requests are keyed by (courseId, version, kind) so
    // importing the same file twice can't create duplicate inbox entries.
    const alreadyInInbox = (k) => inbox.some((i) => i.kind === k && i.courseId === obj.courseId && i.version === obj.version);
    if (kind === 'review') {
      if (!obj.courseId || typeof obj.version !== 'number' || !hasCourse) {
        toast('That review package is missing required fields (courseId, version, course).', 'error'); return;
      }
      if (alreadyInInbox('review')) { toast('That review package is already in the inbox.', 'info'); return; }
      try { obj.course = normalizeCourse(obj.course); } catch (e) { /* keep as-is; preview guards handle it */ }
      inbox.unshift({
        id: uid('in'), kind: 'review', courseId: obj.courseId, version: obj.version,
        from: obj.submittedBy, at: obj.submittedAt, note: '', payload: obj, handled: false,
      });
      persistInbox();
      toast('Review package added to the inbox.', 'success');
    } else if (kind === 'changes') {
      if (!obj.courseId || typeof obj.version !== 'number') {
        toast('That changes package is missing required fields (courseId, version).', 'error'); return;
      }
      if (alreadyInInbox('changes')) { toast('That changes package is already in the inbox.', 'info'); return; }
      const c = getCourse(obj.courseId);
      if (c) {
        c.status = 'draft';
        c.reviewNote = obj.note || '';
        c.liveEditedSinceReview = false;
        persistCourses();
        toast('Reviewer note applied to "' + c.title + '".', 'success');
      } else {
        inbox.unshift({
          id: uid('in'), kind: 'changes', courseId: obj.courseId, version: obj.version,
          from: obj.sentBy, at: obj.sentAt, note: obj.note, payload: obj, handled: false,
        });
        persistInbox();
        toast('Changes package parked in the inbox (no matching course here).', 'info');
      }
    } else if (kind === 'backup' || kind === 'final') {
      if (!hasCourse) { toast('That package has no course data to import.', 'error'); return; }
      const c = normalizeCourse(cleanCourse(obj.course));
      const now = new Date().toISOString();
      c.id = uid('c');
      c.reviewNote = '';
      c.reviewVersion = 0;
      c.liveEditedSinceReview = false;
      c.createdAt = now;
      c.updatedAt = now;
      if (kind === 'final') { c.status = 'approved'; c.approvedVersion = obj.version || 0; }
      else { c.status = 'draft'; c.approvedVersion = 0; }
      courses.unshift(c);
      persistCourses();
      toast('Course imported into your library.', 'success');
    } else {
      toast('Unknown package kind: ' + kind, 'error');
      return;
    }
    render();
  }

  /* ---------------- review inbox ---------------- */

  // Site reviews in the same shape as file-imported inbox items.
  const REVIEW_RESULT = { approved: 'approved', sent_back: 'sent back', withdrawn: 'withdrawn' };
  function siteInboxItems() {
    return sync.reviews.map((r) => ({
      id: 'site_' + r.id, reviewId: r.id, site: true, kind: 'review',
      courseId: r.courseId, version: r.version, from: r.by, at: r.at,
      note: r.state === 'sent_back' ? r.note : '',
      handled: r.state !== 'pending', result: REVIEW_RESULT[r.state] || r.state,
      decidedBy: r.decidedBy || '', payload: { course: r.course },
    }));
  }
  const allInbox = () => (onSite() ? siteInboxItems() : []).concat(inbox);

  function renderInbox() {
    let html = '<div class="b-lib-head" style="margin-top:14px"><span class="b-kv">'
      + (onSite()
        ? 'Courses sent for review show up here on their own. You can still import a review file from someone working without the site.'
        : 'Import a review snapshot file to review it here. Approving downloads the <strong>final maker-framework package</strong> — the content block the module player is built from.')
      + '</span><span><button type="button" class="btn btn-secondary btn-small" data-act="inbox-import">Import ' + (onSite() ? 'a review file' : 'package') + '…</button></span></div>';
    const items = allInbox(); // newest first within site reviews and within imported files
    if (!items.length) {
      html += '<div class="card b-empty"><h3>Inbox is empty</h3>'
        + (onSite()
          ? '<p>When an author sends a course for review, it appears here. Preview it as the learner would see it, then approve it or send it back with a note.</p></div>'
          : '<p>When an author sends a course for review, its snapshot file lands here once you import it. Preview it as the learner would see it, then approve it or send it back with a note.</p></div>');
    } else {
      items.forEach((item) => {
        const c = item.payload && item.payload.course;
        html += '<div class="card b-inbox-item"' + (item.handled ? ' style="opacity:.65"' : '') + '>';
        html += '<div class="b-inbox-head"><h3>' + esc((c && c.title) || 'Untitled') + '</h3>';
        html += '<span class="b-status ' + (item.kind === 'review' ? 'b-status-in_review' : 'b-status-changes') + '">'
          + (item.kind === 'review' ? 'Review requested' : 'Changes requested') + '</span>';
        if (item.handled) html += '<span class="b-status b-status-draft">' + esc(item.result || 'handled') + (item.decidedBy ? ' by ' + esc(item.decidedBy) : '') + '</span>';
        html += '<span class="b-time-chip">v' + item.version + '</span></div>';
        html += '<div class="b-course-meta" style="margin:8px 0"><span>From ' + esc(item.from || 'unknown') + '</span>'
          + '<span>' + esc(item.at ? new Date(item.at).toLocaleString() : '') + '</span></div>';
        if (item.note) html += '<div class="b-review-note"><strong>Note:</strong> ' + esc(item.note) + '</div>';
        html += '<div class="b-course-actions">';
        html += '<button type="button" class="btn btn-secondary btn-small" data-act="inbox-preview" data-id="' + item.id + '">Preview snapshot</button>';
        if (!item.handled && item.kind === 'review' && (!item.site || isReviewer())) {
          html += '<button type="button" class="btn btn-primary btn-small" data-act="inbox-approve" data-id="' + item.id + '">Approve</button>';
          html += '<button type="button" class="btn btn-secondary btn-small" data-act="inbox-sendback" data-id="' + item.id + '">Send back with note</button>';
        }
        if (!item.site) html += '<button type="button" class="btn btn-secondary btn-small" data-act="inbox-remove" data-id="' + item.id + '">Remove</button>';
        html += '</div></div>';
      });
    }
    return html;
  }

  /* ---------------- render root ---------------- */

  function paintBadge() {
    const n = allInbox().filter((i) => !i.handled && (!i.site || isReviewer())).length;
    const el = $('tabCourseBuilderBadge');
    if (el) { el.textContent = n; el.classList.toggle('hidden', !n); }
  }

  function render() {
    if (ui.view === 'builder') {
      const c = getCourse(ui.courseId);
      if (!c) { ui.view = 'library'; ui.courseId = null; return render(); }
      renderBuilder(c);
    } else if (ui.view === 'preview') {
      renderPreviewView();
    } else {
      ui.view = 'library';
      renderLibrary();
    }
    paintBadge();
  }

  async function show() {
    if (!identityLoaded) await loadIdentity();
    if (ui.view === 'builder' && !getCourse(ui.courseId)) { ui.view = 'library'; ui.courseId = null; }
    render();
    // Then bring in the site's copy. If the course open in the builder was
    // left as it was, only the sync chip updates, so typing isn't interrupted.
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; saveJSON(LS_COURSES, courses); }
    const open = ui.view === 'builder' ? getCourse(ui.courseId) : null;
    await pullFromSite();
    if (open && ui.view === 'builder' && getCourse(ui.courseId) === open) paintSync();
    else render();
  }

  // Flush any debounced localStorage write if the window closes mid-typing.
  window.addEventListener('beforeunload', () => {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; saveJSON(LS_COURSES, courses); }
  });

  window.EasyCourseBuilder = { show };
})();
