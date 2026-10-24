// test/course-schema.test.js — Course Builder drafts from older app versions
// still open, keep their content and come out in the current format.
// Every file in test/fixtures/course-drafts/ is checked; add one whenever
// the format changes (see renderer/course-schema.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../renderer/course-schema.js');

const DIR = path.join(__dirname, 'fixtures', 'course-drafts');
const FIXTURES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const copy = (o) => JSON.parse(JSON.stringify(o));

// The course objects inside a fixture, whatever wrapper it came in.
function coursesIn(fx) {
  if (Array.isArray(fx.data)) return fx.data;
  return [fx.data.course];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// What the builder's render and edit code relies on.
function assertUsable(c, label) {
  assert.equal(c.schemaVersion, S.SCHEMA_VERSION, label + ': schemaVersion');
  assert.match(c.id, /^[a-z0-9_-]{1,64}$/, label + ': course id');
  for (const k of ['title', 'description', 'reviewNote', 'createdAt', 'updatedAt']) assert.equal(typeof c[k], 'string', label + ': ' + k);
  assert.ok(!Number.isNaN(Date.parse(c.updatedAt)), label + ': updatedAt is a date');
  assert.ok(['draft', 'in_review', 'approved'].includes(c.status), label + ': status');
  assert.ok(c.passMark >= 1 && c.passMark <= 100, label + ': passMark');
  assert.ok(c.maxAttempts >= 1 && c.maxAttempts <= 10, label + ': maxAttempts');
  assert.ok(['retry', 'contact'].includes(c.onFail), label + ': onFail');
  assert.ok(Array.isArray(c.chapters), label + ': chapters');
  assert.ok(Array.isArray(c.finalQuiz.questions), label + ': final quiz');
  const ids = new Set();
  const seeId = (id, what) => {
    assert.match(id, SAFE_ID, label + ': ' + what + ' id is safe');
    assert.ok(!ids.has(id), label + ': ' + what + ' id ' + id + ' is unique');
    ids.add(id);
  };
  const checkQ = (q) => {
    seeId(q.id, 'question');
    assert.equal(typeof q.q, 'string');
    assert.ok(Array.isArray(q.options) && q.options.length >= 2);
    q.options.forEach((o) => assert.equal(typeof o, 'string'));
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    if (q.kind === 'tf') assert.deepEqual(q.options, ['True', 'False']);
  };
  c.chapters.forEach((ch) => {
    seeId(ch.id, 'chapter');
    assert.equal(typeof ch.title, 'string');
    ch.segments.forEach((seg) => {
      seeId(seg.id, 'segment');
      assert.ok(S.SEGMENT_TYPES.includes(seg.type));
      const blank = S.newSegment(seg.type);
      Object.keys(blank).forEach((k) => assert.equal(typeof seg[k], typeof blank[k], label + ': ' + seg.type + '.' + k));
      if (seg.type === 'quiz') seg.questions.forEach(checkQ);
    });
    ch.quizQuestions.forEach(checkQ);
  });
  c.finalQuiz.questions.forEach(checkQ);
}

// Every piece of text an author wrote (titles, lesson text, questions,
// answers, file names) must survive an upgrade, wherever a future
// migration moves it.
function authoredText(c) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (v.length >= 3 && !/^(id|_|createdAt|updatedAt|status|kind|type|onFail|passMark|maxAttempts|estMin)/.test(key || '')) out.push(v);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    // True/false questions always show True and False, whatever options say.
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (!(v.kind === 'tf' && k === 'options')) walk(v[k], k); });
  };
  walk(c, '');
  return out;
}

for (const name of FIXTURES) {
  const fx = load(name);
  if (fx.newer) {
    test(name + ': a course from a newer app is left untouched', () => {
      for (const original of coursesIn(fx)) {
        assert.ok(S.isNewerThanApp(original));
        const out = S.upgradeCourse(copy(original));
        assert.deepEqual(out, original);
      }
    });
    continue;
  }

  test(name + ': upgrades to a usable current-format course', () => {
    coursesIn(fx).forEach((original, i) => {
      if (!original || typeof original !== 'object') return;
      assert.ok(!S.isNewerThanApp(original));
      assertUsable(S.upgradeCourse(copy(original)), name + '[' + i + ']');
    });
  });

  test(name + ': keeps everything the author wrote', () => {
    coursesIn(fx).forEach((original) => {
      if (!original || typeof original !== 'object') return;
      const after = JSON.stringify(S.upgradeCourse(copy(original)));
      for (const text of authoredText(original)) {
        assert.ok(after.includes(JSON.stringify(text).slice(1, -1)), 'lost: ' + text);
      }
    });
  });

  test(name + ': upgrading twice changes nothing', () => {
    coursesIn(fx).forEach((original) => {
      if (!original || typeof original !== 'object') return;
      const once = S.upgradeCourse(copy(original));
      assert.deepEqual(S.upgradeCourse(copy(once)), once);
    });
  });
}

test('well-formed drafts upgrade the same way on every computer', () => {
  // The sync code compares fingerprints of upgraded courses, so two
  // computers upgrading the same site copy must get identical results.
  for (const name of ['v1-site-entry.json', 'v1-local-storage.json', 'v1-backup-file.json']) {
    for (const original of coursesIn(load(name))) {
      assert.deepEqual(S.upgradeCourse(copy(original)), S.upgradeCourse(copy(original)), name);
    }
  }
});

test('sync bookkeeping and unknown fields pass through', () => {
  const [c] = coursesIn(load('v1-local-storage.json'));
  const out = S.upgradeCourse(copy(c));
  assert.equal(out._rev, 14);
  assert.equal(out._siteBy, 'author1');
  const d = S.upgradeCourse(copy(load('v1-damaged.json').data.course));
  assert.deepEqual(d.extraFieldFromSomewhere, { keep: 'me' });
});

test('v1 content is unchanged apart from the version and the 1 -> 2 file fields', () => {
  for (const name of ['v1-site-entry.json', 'v1-local-storage.json', 'v1-backup-file.json']) {
    for (const original of coursesIn(load(name))) {
      const out = S.upgradeCourse(copy(original));
      // Undo exactly what migration 1 does; everything else must match.
      delete out.schemaVersion;
      out.chapters.forEach((ch) => ch.segments.forEach((seg) => {
        if (seg.type === 'video' || seg.type === 'photo') { seg.fileName = seg.file ? seg.file.name : ''; delete seg.file; }
        if (seg.type === 'video') delete seg.url;
        if (seg.type === 'text') { seg.audioFileName = seg.audioFile ? seg.audioFile.name : ''; delete seg.audioFile; }
      }));
      assert.deepEqual(out, original, name);
    }
  }
});

test('migration 1 -> 2: file names become not-yet-uploaded file references', () => {
  const [c] = coursesIn(load('v1-local-storage.json'));
  const segs = S.upgradeCourse(copy(c)).chapters[0].segments;
  assert.deepEqual(segs[0].file, { id: 0, name: 'welcome.mp4', size: 0, type: '' });
  assert.equal(segs[0].url, '');
  assert.ok(!('fileName' in segs[0]));
  assert.deepEqual(segs[1].audioFile, { id: 0, name: 'whmis-intro.mp3', size: 0, type: '' });
  assert.ok(!('audioFileName' in segs[1]));
  assert.deepEqual(segs[2].file, { id: 0, name: 'label-closeup.jpg', size: 0, type: '' });
  const [b] = coursesIn(load('v1-backup-file.json'));
  assert.equal(S.upgradeCourse(copy(b)).chapters[0].segments[0].audioFile, null, 'empty name means no file');
});

test('uploaded file references survive, broken ones are cleared', () => {
  const [c] = coursesIn(load('v2-site-entry.json'));
  const out = S.upgradeCourse(copy(c));
  const segs = out.chapters[0].segments;
  assert.deepEqual(segs[0].file, { id: 812, name: 'tank.mp4', size: 48211234, type: 'video/mp4' });
  assert.equal(segs[0].url, 'https://vimeo.com/123456789');
  assert.deepEqual(segs[1].file, { id: 813, name: 'hatch.jpg', size: 912003, type: 'image/jpeg' });
  assert.equal(segs[2].audioFile, null);
  assert.equal(S.filesIn(out).length, 2);
});

test('damaged draft: repairs are what the builder needs', () => {
  const c = S.upgradeCourse(copy(load('v1-damaged.json').data.course));
  assert.equal(c.passMark, 80);
  assert.equal(c.chapters.length, 2);
  assert.notEqual(c.chapters[0].id, c.chapters[1].id);
  const segs = c.chapters[0].segments;
  assert.equal(segs.length, 4);
  assert.equal(segs[0].id, 'seg_a');
  assert.notEqual(segs[1].id, 'seg_a');
  assert.equal(segs[1].type, 'text');
  assert.equal(segs[1].body, 'Keep this text.');
  assert.match(segs[2].id, SAFE_ID);
  assert.equal(segs[2].estMin, 30);
  assert.equal(segs[0].transcript, '');
  assert.equal(segs[0].file, null);
  const [noId, tf] = c.chapters[0].quizQuestions;
  assert.match(noId.id, SAFE_ID);
  assert.deepEqual(noId.options, ['Only one option', '']);
  assert.equal(noId.answer, 0);
  assert.deepEqual(tf.options, ['True', 'False']);
  assert.equal(tf.answer, 0);
});

test('new courses are stamped with the current version', () => {
  const c = S.newCourse('Test');
  assert.equal(c.schemaVersion, S.SCHEMA_VERSION);
  assertUsable(S.upgradeCourse(c), 'newCourse');
});

test('a missing or unreadable version counts as 1', () => {
  assert.equal(S.schemaOf({}), 1);
  assert.equal(S.schemaOf({ schemaVersion: '2' }), 1);
  assert.equal(S.schemaOf({ schemaVersion: 0 }), 1);
  assert.equal(S.schemaOf({ schemaVersion: 3 }), 3);
});

test('every version below the current one has a migration', () => {
  for (let v = 1; v < S.SCHEMA_VERSION; v++) {
    assert.equal(typeof S.MIGRATIONS[v], 'function', 'missing MIGRATIONS[' + v + ']');
  }
});

test('migrations run in order from whatever version a course is at', () => {
  const steps = {
    1: (c) => { c.trail = (c.trail || '') + '1'; return c; },
    2: (c) => { c.trail += '2'; c.renamed = c.old; delete c.old; return c; },
  };
  const fromV1 = S.migrateWith({ old: 'x' }, steps, 3);
  assert.deepEqual(fromV1, { trail: '12', renamed: 'x', schemaVersion: 3 });
  const fromV2 = S.migrateWith({ schemaVersion: 2, trail: '1', old: 'y' }, steps, 3);
  assert.deepEqual(fromV2, { schemaVersion: 3, trail: '12', renamed: 'y' });
  const current = S.migrateWith({ schemaVersion: 3, keep: true }, steps, 3);
  assert.deepEqual(current, { schemaVersion: 3, keep: true });
  assert.throws(() => S.migrateWith({}, { 1: (c) => c }, 3), /migration from version 2/);
});

test('lesson text: paragraphs, bullets and bold, with everything else escaped', () => {
  assert.equal(
    S.formatLessonText('Check the **forks** <daily>\n\n- Tires\n- Horn & lights\nThen sign off.'),
    '<p>Check the <strong>forks</strong> &lt;daily&gt;</p><ul><li>Tires</li><li>Horn &amp; lights</li></ul><p>Then sign off.</p>'
  );
  assert.equal(S.formatLessonText('line one\nline two'), '<p>line one<br>line two</p>');
  assert.equal(S.formatLessonText('** not bold **'), '<p>** not bold **</p>');
  assert.equal(S.formatLessonText(''), '');
});

test('question explanations are kept, and courses without them are unchanged', () => {
  const c = S.upgradeCourse({ chapters: [{ quizQuestions: [{ id: 'q_1', q: 'Why?', explain: 'Because.' }, { id: 'q_2', q: 'Old' }] }] });
  assert.equal(c.chapters[0].quizQuestions[0].explain, 'Because.');
  assert.ok(!('explain' in c.chapters[0].quizQuestions[1]));
  assert.equal(S.newQuestion().explain, '');
});

test('duplicating gives new unique ids and the same content', () => {
  const [c] = coursesIn(load('v1-local-storage.json'));
  const course = S.upgradeCourse(copy(c));
  const ch = course.chapters[0];
  const dup = S.copyWithNewIds(ch, 'ch');
  const ids = (x) => JSON.stringify(x).match(/"id":"[^"]+"/g);
  ids(dup).forEach((id) => assert.ok(!ids(ch).includes(id), 'reused ' + id));
  const strip = (x) => JSON.parse(JSON.stringify(x).replace(/"id":"[^"]+"/g, '"id":""'));
  assert.deepEqual(strip(dup), strip(ch));
  course.chapters.push(dup);
  assertUsable(S.upgradeCourse(copy(course)), 'course with duplicate chapter');
  assert.equal(dup.segments[0].file.name, 'welcome.mp4', 'file references are shared');
});

test('what changed: renames, additions, removals, answer changes, reorders', () => {
  const [c] = coursesIn(load('v1-local-storage.json'));
  const before = S.upgradeCourse(copy(c));
  const after = copy(before);
  assert.deepEqual(S.diffCourses(before, after), []);
  after.passMark = 70;
  const ch = after.chapters[0];
  ch.title = 'Welcome';
  ch.segments[1].body = 'New text';
  ch.segments.splice(2, 1); // remove the photo
  ch.segments.reverse();
  ch.quizQuestions[0].answer = 1;
  after.finalQuiz.questions.push({ id: 'q_new', q: 'Who can operate a forklift?', kind: 'mc', options: ['Anyone', 'Trained operators'], answer: 1 });
  after.chapters.push({ id: 'ch_new', title: 'Stability', segments: [], quizQuestions: [] });
  const d = S.diffCourses(before, after);
  const has = (re) => assert.ok(d.some((t) => re.test(t)), 'missing ' + re + ' in ' + JSON.stringify(d, null, 1));
  has(/^Pass mark 80% → 70%\.$/);
  has(/renamed to "Welcome"/);
  has(/text block "What WHMIS covers" changed \(lesson text\)/);
  has(/photo block "Supplier label" removed/);
  has(/blocks reordered/);
  has(/question "A supplier label.*" changed \(correct answer is different\)/);
  has(/^Final quiz: question "Who can operate a forklift\?" added\.$/);
  has(/^Chapter 2 "Stability" added\.$/);
});
