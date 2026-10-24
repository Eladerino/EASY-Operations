// course-schema.js — the Course Builder's course format, no DOM.
//
// Every course carries `schemaVersion`. Anything that reads a course (this
// computer's storage, the site, backup and review files) goes through
// upgradeCourse(), which runs the migrations below in order and then fills
// in anything missing, so a draft saved by any older app version opens in
// this one. Courses with no schemaVersion are version 1 (everything saved
// before versioning existed).
//
// A course saved by a NEWER app is left exactly as it is and marked
// read-only: this app can't know what the newer fields mean, and rewriting
// them would damage the course. The site refuses saves from an app older
// than the course it holds (EASY Suite courses module, `schema` in the
// request body), which also covers app versions from before this file.
//
// Changing the format:
//   1. Bump SCHEMA_VERSION.
//   2. Add MIGRATIONS[old] = (course) => course, turning a version-`old`
//      course into version old + 1. Never edit an existing migration;
//      courses in the wild may be at any version. Keep chapter, segment and
//      question ids as they are: learner progress will refer to them.
//   3. Add a sample course at the old version to test/fixtures/course-drafts/.
//   4. Make sure the live site runs an EASY Suite with the format guard
//      (2.2.43 or later) before releasing the app.
//
// Optional fields can be added without a new version as long as a course
// without them still means the same thing (question `explain` is one).
//
// Lesson text is plain text with three rules, applied by formatLessonText()
// in the preview and to be applied the same way by the module player: a
// blank line starts a paragraph, a line starting with "- " is a bullet, and
// **double stars** make bold.
// Loaded by the renderer via <script> and unit-testable in plain Node.
(function (root) {
  'use strict';

  // Format history:
  //   1  (App 1.1 to 1.2.9) media recorded as file names only:
  //      video/photo fileName, text audioFileName.
  //   2  media are file references { id, name, size, type } uploaded to the
  //      site (id 0 = only the name is known, nothing uploaded): video/photo
  //      `file`, text `audioFile`; video also takes a `url` to a hosted video.
  const SCHEMA_VERSION = 2;

  // A file reference with only a name, as version 1 recorded it.
  const nameOnly = (name) => (typeof name === 'string' && name.trim() ? { id: 0, name: name.trim(), size: 0, type: '' } : null);

  // MIGRATIONS[n] upgrades a version-n course to version n + 1.
  const MIGRATIONS = {
    1: (c) => {
      const each = (ch) => (ch && Array.isArray(ch.segments) ? ch.segments : []).forEach((seg) => {
        if (!seg || typeof seg !== 'object') return;
        if (seg.type === 'video' || seg.type === 'photo') {
          if (!('file' in seg)) seg.file = nameOnly(seg.fileName);
          delete seg.fileName;
          if (seg.type === 'video' && !('url' in seg)) seg.url = '';
        } else if (seg.type === 'text') {
          if (!('audioFile' in seg)) seg.audioFile = nameOnly(seg.audioFileName);
          delete seg.audioFileName;
        }
      });
      (Array.isArray(c.chapters) ? c.chapters : []).forEach(each);
      return c;
    },
  };

  const SEGMENT_TYPES = ['video', 'text', 'photo', 'interactive', 'quiz'];
  const STATUSES = ['draft', 'in_review', 'approved'];
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  // Course ids become the site's post slug, so they follow the site's rule.
  const COURSE_ID_RE = /^[a-z0-9_-]{1,64}$/;

  const uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const clampInt = (v, lo, hi, fallback) => {
    const n = Math.round(num(v, fallback));
    return Math.max(lo, Math.min(hi, n));
  };

  /* ---------------- factories ---------------- */

  function newQuestion() {
    return { id: uid('q'), q: '', kind: 'mc', options: ['', ''], answer: 0, explain: '' };
  }
  function newSegment(type) {
    const base = { id: uid('seg'), type, title: '' };
    switch (type) {
      case 'video': return Object.assign(base, { file: null, url: '', durationSec: 0, transcript: '' });
      case 'text': return Object.assign(base, { body: '', narrationScript: '', audioFile: null, audioSec: 0 });
      case 'photo': return Object.assign(base, { file: null, caption: '', alt: '' });
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
      id: uid('c'), schemaVersion: SCHEMA_VERSION,
      title: title || 'Untitled course', description: '',
      status: 'draft', reviewVersion: 0, approvedVersion: 0,
      liveEditedSinceReview: false, reviewNote: '',
      passMark: 80, maxAttempts: 3, onFail: 'retry',
      chapters: [], finalQuiz: { questions: [] },
      createdAt: now, updatedAt: now,
    };
  }

  /* ---------------- versions ---------------- */

  // The version a course says it is. Missing or unreadable means 1.
  function schemaOf(course) {
    const v = isObj(course) ? course.schemaVersion : undefined;
    return Number.isInteger(v) && v >= 1 ? v : 1;
  }
  const isNewerThanApp = (course) => schemaOf(course) > SCHEMA_VERSION;

  // Runs migrations from the course's version up to `target`. Exposed with
  // the table as a parameter so tests can check the chain itself.
  function migrateWith(course, migrations, target) {
    let v = schemaOf(course);
    while (v < target) {
      const step = migrations[v];
      if (typeof step !== 'function') throw new Error('No Course Builder migration from version ' + v + '.');
      course = step(course) || course;
      v += 1;
      course.schemaVersion = v;
    }
    return course;
  }

  /* ---------------- normalization ----------------
   * After migrating, fill in anything missing or malformed so a damaged
   * shape (corrupted storage, hand-edited file) degrades gracefully instead
   * of throwing halfway through a render. Unknown fields are kept. Ids that
   * are missing, unsafe to put in the page, or used twice in one course get
   * new ones, because edits find their target by id. */

  function freshId(seen, id, prefix, re) {
    if (typeof id === 'string' && (re || ID_RE).test(id) && !seen.has(id)) { seen.add(id); return id; }
    let next = uid(prefix);
    while (seen.has(next)) next = uid(prefix);
    seen.add(next);
    return next;
  }

  function normalizeQuestion(q, seen) {
    if (!isObj(q)) q = {};
    q.id = freshId(seen, q.id, 'q');
    q.q = str(q.q);
    // Why the answer is right, shown to learners after they answer (optional).
    if ('explain' in q) q.explain = str(q.explain);
    if (q.kind !== 'tf' && q.kind !== 'mc') q.kind = 'mc';
    if (q.kind === 'tf') {
      q.options = ['True', 'False'];
      if (q.answer !== 0 && q.answer !== 1) q.answer = 0;
    } else {
      const opts = Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o : (o == null ? '' : String(o)))) : [];
      while (opts.length < 2) opts.push('');
      q.options = opts;
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) q.answer = 0;
    }
    return q;
  }

  // Fields of each segment type that hold a file reference.
  const FILE_FIELDS = { video: ['file'], photo: ['file'], text: ['audioFile'] };

  function normalizeFile(f) {
    if (!isObj(f)) return null;
    const id = Number.isInteger(f.id) && f.id > 0 ? f.id : 0;
    const name = str(f.name).trim();
    if (!id && !name) return null;
    return Object.assign(f, {
      id, name: name || 'file', size: Math.max(0, Math.round(num(f.size, 0))), type: str(f.type),
    });
  }

  function normalizeSegment(seg, seen) {
    if (!isObj(seg)) seg = {};
    if (SEGMENT_TYPES.indexOf(seg.type) < 0) seg.type = 'text';
    seg.id = freshId(seen, seg.id, 'seg');
    seg.title = str(seg.title);
    // Fill each field the segment type should have, with its blank value.
    const blank = newSegment(seg.type);
    const fileFields = FILE_FIELDS[seg.type] || [];
    Object.keys(blank).forEach((k) => {
      if (k === 'id' || k === 'type' || k === 'questions' || fileFields.indexOf(k) >= 0) return;
      if (typeof seg[k] !== typeof blank[k]) seg[k] = blank[k];
    });
    fileFields.forEach((k) => { seg[k] = normalizeFile(seg[k]); });
    if (seg.type === 'video') seg.durationSec = Math.max(0, num(seg.durationSec, 0));
    if (seg.type === 'text') seg.audioSec = Math.max(0, num(seg.audioSec, 0));
    if (seg.type === 'interactive') seg.estMin = clampInt(seg.estMin, 1, 30, 3);
    if (seg.type === 'quiz') {
      seg.questions = (Array.isArray(seg.questions) ? seg.questions : []).map((q) => normalizeQuestion(q, seen));
    }
    return seg;
  }

  function normalizeChapter(ch, seen) {
    if (!isObj(ch)) ch = {};
    ch.id = freshId(seen, ch.id, 'ch');
    ch.title = str(ch.title);
    ch.segments = (Array.isArray(ch.segments) ? ch.segments : []).map((s) => normalizeSegment(s, seen));
    ch.quizQuestions = (Array.isArray(ch.quizQuestions) ? ch.quizQuestions : []).map((q) => normalizeQuestion(q, seen));
    return ch;
  }

  function normalizeCourse(c) {
    if (!isObj(c)) return newCourse('');
    const seen = new Set();
    c.id = freshId(new Set(), c.id, 'c', COURSE_ID_RE);
    c.schemaVersion = schemaOf(c);
    c.title = str(c.title);
    c.description = str(c.description);
    if (STATUSES.indexOf(c.status) < 0) c.status = 'draft';
    c.reviewVersion = Math.max(0, Math.round(num(c.reviewVersion, 0)));
    c.approvedVersion = Math.max(0, Math.round(num(c.approvedVersion, 0)));
    c.liveEditedSinceReview = !!c.liveEditedSinceReview;
    c.reviewNote = str(c.reviewNote);
    c.passMark = clampInt(c.passMark, 1, 100, 80);
    c.maxAttempts = clampInt(c.maxAttempts, 1, 10, 3);
    if (c.onFail !== 'retry' && c.onFail !== 'contact') c.onFail = 'retry';
    const now = new Date().toISOString();
    if (!str(c.createdAt) || Number.isNaN(Date.parse(c.createdAt))) c.createdAt = str(c.updatedAt) && !Number.isNaN(Date.parse(c.updatedAt)) ? c.updatedAt : now;
    if (!str(c.updatedAt) || Number.isNaN(Date.parse(c.updatedAt))) c.updatedAt = c.createdAt;
    c.chapters = (Array.isArray(c.chapters) ? c.chapters : []).map((ch) => normalizeChapter(ch, seen));
    if (!isObj(c.finalQuiz)) c.finalQuiz = { questions: [] };
    c.finalQuiz.questions = (Array.isArray(c.finalQuiz.questions) ? c.finalQuiz.questions : []).map((q) => normalizeQuestion(q, seen));
    return c;
  }

  // The one way in for a course from anywhere. Returns a usable course at
  // the current version, or (when it came from a newer app) the untouched
  // original. Fields starting with "_" are this computer's sync bookkeeping
  // and pass through unchanged.
  function upgradeCourse(course) {
    if (!isObj(course)) return normalizeCourse(null);
    if (isNewerThanApp(course)) return course;
    return normalizeCourse(migrateWith(course, MIGRATIONS, SCHEMA_VERSION));
  }

  // Every file reference in a course, for showing or checking uploads.
  function filesIn(course) {
    const out = [];
    ((course && course.chapters) || []).forEach((ch) => ((ch && ch.segments) || []).forEach((seg) => {
      (FILE_FIELDS[seg && seg.type] || []).forEach((k) => { if (seg[k]) out.push({ seg, field: k, file: seg[k] }); });
    }));
    return out;
  }

  /* ---------------- copies ---------------- */

  // A deep copy of a chapter, segment or question with new ids throughout,
  // for the Duplicate buttons. File references are shared, not copied.
  function copyWithNewIds(item, prefix) {
    const out = JSON.parse(JSON.stringify(item));
    const walk = (o, p) => {
      if (!isObj(o)) return;
      if (typeof o.id === 'string') o.id = uid(p);
      (Array.isArray(o.segments) ? o.segments : []).forEach((x) => walk(x, 'seg'));
      (Array.isArray(o.quizQuestions) ? o.quizQuestions : []).forEach((x) => walk(x, 'q'));
      (Array.isArray(o.questions) ? o.questions : []).forEach((x) => walk(x, 'q'));
    };
    walk(out, prefix);
    return out;
  }

  /* ---------------- lesson text ---------------- */

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Lesson text to safe HTML: paragraphs, "- " bullets, **bold**.
  function formatLessonText(text) {
    const inline = (line) => escHtml(line).replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return '';
      let html = '';
      let list = [];
      let para = [];
      const flushList = () => { if (list.length) { html += '<ul>' + list.map((l) => '<li>' + inline(l) + '</li>').join('') + '</ul>'; list = []; } };
      const flushPara = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
      lines.forEach((l) => {
        const m = l.match(/^\s*[-•]\s+(.*)$/);
        if (m) { flushPara(); list.push(m[1]); } else { flushList(); para.push(l); }
      });
      flushPara(); flushList();
      return html;
    }).join('');
  }

  /* ---------------- what changed ---------------- */

  const FIELD_LABEL = {
    title: 'title', body: 'lesson text', narrationScript: 'narration script', audioFile: 'narration audio',
    audioSec: 'audio length', file: 'file', url: 'video link', durationSec: 'length', transcript: 'transcript',
    caption: 'caption', alt: 'alt text', description: 'description', estMin: 'time estimate', type: 'block type',
  };

  // Plain-language list of differences between two versions of a course
  // (older first), matched by id so renames and moves read as such.
  function diffCourses(before, after) {
    const out = [];
    if (!isObj(before) || !isObj(after)) return out;
    const name = (x, fallback) => '"' + (str(x && x.title).trim() || fallback) + '"';
    const qName = (q) => '"' + (str(q.q).trim() || 'untitled question') + '"';
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    if (str(before.title) !== str(after.title)) out.push('Course renamed from ' + name(before, 'untitled') + ' to ' + name(after, 'untitled') + '.');
    if (str(before.description) !== str(after.description)) out.push('Short description changed.');
    if (before.passMark !== after.passMark) out.push('Pass mark ' + before.passMark + '% → ' + after.passMark + '%.');
    if (before.maxAttempts !== after.maxAttempts) out.push('Quiz attempts ' + before.maxAttempts + ' → ' + after.maxAttempts + '.');
    if (before.onFail !== after.onFail) out.push('What happens after the last attempt changed.');

    function questions(label, a, b) {
      a = Array.isArray(a) ? a : [];
      b = Array.isArray(b) ? b : [];
      const old = new Map(a.map((q) => [q.id, q]));
      const now = new Set(b.map((q) => q.id));
      b.forEach((q) => {
        const was = old.get(q.id);
        if (!was) out.push(label + ': question ' + qName(q) + ' added.');
        else if (!same(was, q)) out.push(label + ': question ' + qName(q) + ' changed' + (was.answer !== q.answer ? ' (correct answer is different)' : '') + '.');
      });
      a.forEach((q) => { if (!now.has(q.id)) out.push(label + ': question ' + qName(q) + ' removed.'); });
      const order = (list) => list.filter((q) => old.has(q.id) && now.has(q.id)).map((q) => q.id).join();
      if (order(a) !== order(b)) out.push(label + ': questions reordered.');
    }

    const bCh = Array.isArray(before.chapters) ? before.chapters : [];
    const aCh = Array.isArray(after.chapters) ? after.chapters : [];
    const oldCh = new Map(bCh.map((c) => [c.id, c]));
    const nowCh = new Set(aCh.map((c) => c.id));
    aCh.forEach((ch, i) => {
      const was = oldCh.get(ch.id);
      const label = 'Chapter ' + (i + 1) + ' ' + name(ch, 'untitled');
      if (!was) { out.push(label + ' added.'); return; }
      if (same(was, ch)) return;
      if (str(was.title) !== str(ch.title)) out.push('Chapter ' + name(was, 'untitled') + ' renamed to ' + name(ch, 'untitled') + '.');
      const oldSeg = new Map((was.segments || []).map((s) => [s.id, s]));
      const nowSeg = new Set((ch.segments || []).map((s) => s.id));
      (ch.segments || []).forEach((seg) => {
        const w = oldSeg.get(seg.id);
        const segLabel = label + ': ' + seg.type + ' block ' + name(seg, 'untitled');
        if (!w) out.push(segLabel + ' added.');
        else if (seg.type === 'quiz') questions(segLabel, w.questions, seg.questions);
        else if (!same(w, seg)) {
          const fields = Object.keys(Object.assign({}, w, seg)).filter((k) => k !== 'id' && !same(w[k], seg[k]));
          out.push(segLabel + ' changed (' + fields.map((k) => FIELD_LABEL[k] || k).join(', ') + ').');
        }
      });
      (was.segments || []).forEach((seg) => { if (!nowSeg.has(seg.id)) out.push(label + ': ' + seg.type + ' block ' + name(seg, 'untitled') + ' removed.'); });
      const order = (list) => list.filter((s) => oldSeg.has(s.id) && nowSeg.has(s.id)).map((s) => s.id).join();
      if (order(was.segments || []) !== order(ch.segments || [])) out.push(label + ': blocks reordered.');
      questions(label + ' check', was.quizQuestions, ch.quizQuestions);
    });
    bCh.forEach((ch) => { if (!nowCh.has(ch.id)) out.push('Chapter ' + name(ch, 'untitled') + ' removed.'); });
    const chOrder = (list) => list.filter((c) => oldCh.has(c.id) && nowCh.has(c.id)).map((c) => c.id).join();
    if (chOrder(bCh) !== chOrder(aCh)) out.push('Chapters reordered.');
    questions('Final quiz', before.finalQuiz && before.finalQuiz.questions, after.finalQuiz && after.finalQuiz.questions);
    return out;
  }

  const api = {
    SCHEMA_VERSION,
    copyWithNewIds,
    formatLessonText,
    diffCourses,
    FILE_FIELDS,
    filesIn,
    MIGRATIONS,
    SEGMENT_TYPES,
    uid,
    newQuestion,
    newSegment,
    newChapter,
    newCourse,
    schemaOf,
    isNewerThanApp,
    migrateWith,
    normalizeCourse,
    upgradeCourse,
  };

  root.EasyCourseSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
