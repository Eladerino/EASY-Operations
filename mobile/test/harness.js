// harness.js: Node tests for the EASY Manager app's pure functions.
//
// Loads the app scripts (config, util, api, today, schedule) into a
// vm with a stubbed window/document/fetch, then exercises the
// functions those files expose for testing: the API shapers and
// error wording, the Activity grouping and site feed shaping, and
// the schedule editor's save-summary diff. No DOM rendering is
// tested here; the screens are covered by on-device checks.
//
// Run: node test/harness.js   (from mobile/)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(name);
    console.log('FAIL: ' + name);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name + ' (got ' + a + ', want ' + e + ')', a === e);
}

/* ---------------- browser-ish sandbox ---------------- */

let fetchImpl = null;
const fetchedUrls = [];

function elementStub() {
  return {
    className: '',
    textContent: '',
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(c) { this.children.push(c); },
    setAttribute() {},
  };
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  AbortController,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  document: {
    getElementById: () => null,
    createElement: () => elementStub(),
    querySelectorAll: () => [],
    documentElement: elementStub(),
  },
  fetch: (url, opts) => {
    fetchedUrls.push(url);
    if (!fetchImpl) return Promise.reject(new Error('no fetch stub set'));
    return fetchImpl(url, opts);
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const wwwJs = path.join(__dirname, '..', 'www', 'js');
for (const file of ['config.js', 'util.js', 'api.js', 'today.js', 'schedule.js']) {
  const code = fs.readFileSync(path.join(wwwJs, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

const U = sandbox.EasyUtil;
const Api = sandbox.EasyApi;
const Today = sandbox.EasyToday;
const Sched = sandbox.EasySchedule;

function jsonResponse(status, body) {
  return { status, headers: {}, json: async () => body };
}

/* ---------------- util ---------------- */

eq('addDays crosses a month', U.addDays('2026-10-31', 1), '2026-11-01');
eq('addMonths', U.addMonths('2026-10-21', 2), '2026-12-21');
eq('expiryBand far out', U.expiryBand(45), null);
eq('expiryBand 30 window', U.expiryBand(30), '30');
eq('expiryBand 7 window', U.expiryBand(7), '7');
eq('expiryBand day itself', U.expiryBand(0), '7');
eq('expiryBand expired', U.expiryBand(-1), 'expired');
eq('expiryBand null', U.expiryBand(null), null);
eq('endPeriod adds period', U.endPeriod('Done'), 'Done.');
eq('endPeriod keeps period', U.endPeriod('Done.'), 'Done.');
eq('daysUntil today', U.daysUntil(U.todayYmd()), 0);

/* ---------------- api: existing pure surface ---------------- */

eq('isWaitingClass draft', Api.isWaitingClass({ status: 'draft' }), true);
eq('isWaitingClass pending', Api.isWaitingClass({ status: 'pending' }), true);
eq('isWaitingClass publish', Api.isWaitingClass({ status: 'publish' }), false);
eq('isWaitingClass null', Api.isWaitingClass(null), false);

eq('shapeFeed maps fields', Api.shapeFeed({ id: 3, name: 'Pam', url: 'https://x' }), {
  id: 3,
  name: 'Pam',
  url: 'https://x',
});
eq('shapeFeed defaults', Api.shapeFeed({}), { id: undefined, name: '', url: '' });

eq(
  'shapeCertRow prefers student',
  Api.shapeCertRow({ student: 'Jo', student_name: 'Other', course_title: 'WHMIS' }).student,
  'Jo'
);
eq(
  'shapeCertRow falls back to student_name',
  Api.shapeCertRow({ student_name: 'Sam' }).student,
  'Sam'
);
eq('shapeCertRow no name', Api.shapeCertRow({}).student, '(no name)');
eq(
  'shapeCertRow number',
  Api.shapeCertRow({ certificate_number: '260507X01' }).number,
  '260507X01'
);

eq('certPdfPath encodes', Api.certPdfPath('26 05/07'), '/easy/v1/cert-pdf/26%2005%2F07');
eq(
  'certPdfErrorText no route',
  Api.certPdfErrorText({ code: 'rest_no_route' }),
  'Certificate PDFs need EASY Suite 2.2.31 or newer on the site. Once the site is updated, this will work.'
);
eq(
  'certPdfErrorText 404',
  Api.certPdfErrorText({ status: 404 }),
  'No PDF on file for this certificate yet.'
);
eq('certPdfErrorText passthrough', Api.certPdfErrorText({ message: 'Boom' }), 'Boom');
eq(
  'certPdfErrorText default',
  Api.certPdfErrorText({}),
  'Could not fetch the certificate PDF.'
);
eq(
  'queueLifecycleErrorText no route',
  Api.queueLifecycleErrorText({ code: 'rest_no_route' }),
  'This needs EASY Suite 2.2.32 or newer on the site. Once the site is updated, this will work.'
);
eq('queueLifecycleErrorText passthrough', Api.queueLifecycleErrorText({ message: 'Nah' }), 'Nah');
eq('queueLifecycleErrorText default', Api.queueLifecycleErrorText({}), 'The site did not answer.');

/* ---------------- api: site activity feed ---------------- */

eq(
  'activityFeedPath all',
  Api.activityFeedPath(1, 'all'),
  '/easy/v1/activity?page=1&per_page=50&kind=all'
);
eq(
  'activityFeedPath class page 2',
  Api.activityFeedPath(2, 'class'),
  '/easy/v1/activity?page=2&per_page=50&kind=class'
);
eq(
  'activityFeedPath cert',
  Api.activityFeedPath(1, 'cert'),
  '/easy/v1/activity?page=1&per_page=50&kind=cert'
);
eq(
  'activityFeedPath account',
  Api.activityFeedPath(4, 'account'),
  '/easy/v1/activity?page=4&per_page=50&kind=account'
);
eq(
  'activityFeedPath queue',
  Api.activityFeedPath(1, 'queue'),
  '/easy/v1/activity?page=1&per_page=50&kind=queue'
);
eq(
  'activityFeedPath unknown kind falls back to all',
  Api.activityFeedPath(3, 'bogus'),
  '/easy/v1/activity?page=3&per_page=50&kind=all'
);
eq(
  'activityFeedPath page clamps to 1',
  Api.activityFeedPath(0, 'class'),
  '/easy/v1/activity?page=1&per_page=50&kind=class'
);

eq('activityNeedsNewerSuite rest_no_route', Api.activityNeedsNewerSuite({ code: 'rest_no_route' }), true);
eq('activityNeedsNewerSuite 404', Api.activityNeedsNewerSuite({ status: 404 }), true);
eq('activityNeedsNewerSuite 403', Api.activityNeedsNewerSuite({ status: 403 }), true);
eq('activityNeedsNewerSuite 500', Api.activityNeedsNewerSuite({ status: 500 }), false);
eq('activityNeedsNewerSuite null', Api.activityNeedsNewerSuite(null), false);
eq('activityNeedsNewerSuite empty', Api.activityNeedsNewerSuite({}), false);

eq(
  'activityErrorText no route is the calm suite note',
  Api.activityErrorText({ code: 'rest_no_route' }),
  'Site activity needs EASY Suite 2.2.36 or newer on the site.'
);
eq(
  'activityErrorText 403 is the calm suite note',
  Api.activityErrorText({ status: 403 }),
  'Site activity needs EASY Suite 2.2.36 or newer on the site.'
);
eq(
  'activityErrorText other passes the message through',
  Api.activityErrorText({ status: 500, message: 'Server boom' }),
  'Server boom'
);
eq('activityErrorText default', Api.activityErrorText({}), 'Could not load site activity.');

/* ---------------- today: existing grouping ---------------- */

const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime(); // Oct 21, 2026, noon local
const TODAY_AM = new Date(2026, 9, 21, 9, 0, 0).getTime();
const YEST = new Date(2026, 9, 20, 15, 0, 0).getTime();
const OLD = new Date(2026, 9, 10, 10, 0, 0).getTime();

const hist = [
  { kind: 'class', title: 'A', action: 'Published', at: TODAY_AM },
  { kind: 'cert', title: 'B', action: 'Published', at: TODAY_AM },
  { kind: 'cert', title: 'C', action: 'Published', at: YEST },
  { kind: 'queue', title: 'D', action: 'Question answered', at: OLD },
];

eq(
  'groupActivity filters by kind',
  Today.groupActivity(hist, 'cert', NOW).map((g) => g.entries.map((e) => e.title)),
  [['B'], ['C']]
);
eq(
  'groupActivity day labels',
  Today.groupActivity(hist, 'all', NOW).map((g) => g.label),
  ['Today', 'Yesterday', U.fmtDateLoose('2026-10-10')]
);
eq(
  'groupActivity keeps order within a day',
  Today.groupActivity(hist, 'all', NOW)[0].entries.map((e) => e.title),
  ['A', 'B']
);
eq('groupActivity null input', Today.groupActivity(null, 'all', NOW), []);
eq('groupActivity unknown filter', Today.groupActivity(hist, 'bogus', NOW), []);

/* ---------------- today: site entry shaping ---------------- */

eq(
  'shapeSiteEntry published with actor',
  Today.shapeSiteEntry({
    id: 5, source: 'log', kind: 'class', title: 'Forklift Operator',
    action: 'published', summary: '', actor: 'Pam Evans', at: 123,
  }),
  {
    kind: 'class', title: 'Forklift Operator',
    action: 'Published by Pam Evans', at: 123, siteKey: 'log:5',
  }
);
eq(
  'shapeSiteEntry folds summary and actor',
  Today.shapeSiteEntry({
    id: 6, source: 'log', kind: 'class', title: 'Forklift Operator',
    action: 'edited', summary: 'Price $150 to $175, Seats 10 to 12',
    actor: 'Pam Evans', at: 99,
  }).action,
  'Edited, Price $150 to $175, Seats 10 to 12 by Pam Evans'
);
eq(
  'shapeSiteEntry no actor, no summary',
  Today.shapeSiteEntry({
    id: 7, source: 'log', kind: 'account', title: 'Jamie New',
    action: 'approved', summary: '', actor: '', at: 5,
  }).action,
  'Approved'
);
eq(
  'shapeSiteEntry queue answer with summary',
  Today.shapeSiteEntry({
    id: -2, source: 'queue', kind: 'queue', title: 'Bambora vs Square',
    action: 'answered', summary: 'Answer: Square', actor: 'Colleen Cox-Glynn', at: 7,
  }).action,
  'Answered, Answer: Square by Colleen Cox-Glynn'
);
eq(
  'shapeSiteEntry defaults',
  Today.shapeSiteEntry({ id: 1, source: 'log' }),
  { kind: '', title: '', action: '', at: 0, siteKey: 'log:1' }
);
eq('siteEntryKey queue namespace', Today.siteEntryKey({ source: 'queue', id: -3 }), 'queue:-3');
eq('siteEntryKey default source is log', Today.siteEntryKey({ id: 7 }), 'log:7');
ok(
  'siteEntryKey namespaces never collide',
  Today.siteEntryKey({ source: 'queue', id: -3 }) !== Today.siteEntryKey({ source: 'log', id: -3 })
);

/* ---------------- today: pagination append ---------------- */

const pageA = [
  Today.shapeSiteEntry({ id: 3, source: 'log', kind: 'class', title: 'T3', action: 'edited', at: 30 }),
  Today.shapeSiteEntry({ id: 2, source: 'log', kind: 'class', title: 'T2', action: 'edited', at: 20 }),
];
const pageB = [
  Today.shapeSiteEntry({ id: 1, source: 'log', kind: 'cert', title: 'T1', action: 'published', at: 10 }),
];
const pageOverlap = [
  pageA[1],
  Today.shapeSiteEntry({ id: 1, source: 'log', kind: 'cert', title: 'T1', action: 'published', at: 10 }),
];

eq(
  'appendSiteEntries appends in order',
  Today.appendSiteEntries(pageA, pageB).map((e) => e.title),
  ['T3', 'T2', 'T1']
);
eq(
  'appendSiteEntries drops overlap duplicates',
  Today.appendSiteEntries(pageA, pageOverlap).map((e) => e.title),
  ['T3', 'T2', 'T1']
);
{
  const before = pageA.slice();
  const out = Today.appendSiteEntries(pageA, pageB);
  ok(
    'appendSiteEntries does not mutate inputs',
    pageA.length === 2 && pageB.length === 1 && out !== pageA &&
      JSON.stringify(pageA) === JSON.stringify(before)
  );
}
eq('appendSiteEntries tolerates null', Today.appendSiteEntries(null, null), []);

/* ---------------- chips map to server kinds ---------------- */

for (const f of Today.ACTIVITY_FILTERS) {
  eq(
    'chip ' + f.key + ' maps to server kind ' + f.key,
    Api.activityFeedPath(1, f.key).endsWith('kind=' + f.key),
    true
  );
}

eq(
  'groupActivity groups shaped site entries',
  Today.groupActivity(
    [
      Today.shapeSiteEntry({ id: 1, source: 'log', kind: 'class', title: 'X', action: 'published', actor: 'Pam Evans', at: TODAY_AM }),
      Today.shapeSiteEntry({ id: -1, source: 'queue', kind: 'queue', title: 'Q', action: 'answered', actor: 'Brandon Glynn', at: TODAY_AM }),
    ],
    'all',
    NOW
  ).map((g) => [g.label, g.entries.length]),
  [['Today', 2]]
);

/* ---------------- schedule: diffSaveSummary ---------------- */

function baseEvent(over) {
  return Object.assign(
    {
      status: 'publish', title: 'Forklift Operator',
      startDate: '2026-10-24', endDate: '2026-10-24', allDay: false,
      startTime: '09:00', endTime: '17:00', venueId: 0, venueName: '',
      cost: '150', seats: '10',
    },
    over || {}
  );
}

eq(
  'diff new draft with seats and price',
  Sched.diffSaveSummary(null, { status: 'draft', seats: '12', cost: '150' }),
  'Created as draft · Seats 12 · Price $150'
);
eq(
  'diff new published bare',
  Sched.diffSaveSummary(null, { status: 'publish', seats: '', cost: '' }),
  'Created and published'
);
eq('diff no change', Sched.diffSaveSummary(baseEvent(), baseEvent()), '');
eq(
  'diff price change',
  Sched.diffSaveSummary(baseEvent(), baseEvent({ cost: '175' })),
  'Price $150 → $175'
);
eq(
  'diff seats change',
  Sched.diffSaveSummary(baseEvent(), baseEvent({ seats: '12' })),
  'Seats 10 → 12'
);
eq(
  'diff publish plus price',
  Sched.diffSaveSummary(baseEvent({ status: 'draft' }), baseEvent({ cost: '175' })),
  'Published · Price $150 → $175'
);
eq(
  'diff unpublish',
  Sched.diffSaveSummary(baseEvent(), baseEvent({ status: 'draft' })),
  'Unpublished'
);
eq(
  'diff price format-equal is no change',
  Sched.diffSaveSummary(baseEvent(), baseEvent({ cost: '150.00' })),
  ''
);
eq(
  'diff price set from blank',
  Sched.diffSaveSummary(baseEvent({ cost: '' }), baseEvent()),
  'Price set to $150'
);
eq(
  'diff title change',
  Sched.diffSaveSummary(baseEvent(), baseEvent({ title: 'New Title' })),
  'Title changed to "New Title"'
);

/* ---------------- api: activityFeed over the wire stub ---------------- */

async function main() {
  // Success: shape passes through, URL carries page and chip kind.
  fetchedUrls.length = 0;
  fetchImpl = async () =>
    jsonResponse(200, {
      items: [{ id: 1, kind: 'queue', title: 'Q', action: 'answered', summary: '', actor: 'A', at: 5 }],
      page: 1,
      per_page: 50,
      total: 120,
    });
  const res = await Api.activityFeed(1, 'queue');
  eq('activityFeed success items', res.items.length, 1);
  eq('activityFeed success total', res.total, 120);
  eq('activityFeed success perPage', res.perPage, 50);
  eq(
    'activityFeed request URL',
    fetchedUrls[0],
    'https://easysafety.ca/wp-json/easy/v1/activity?page=1&per_page=50&kind=queue'
  );

  // Empty body: safe defaults, never a crash.
  fetchImpl = async () => jsonResponse(200, {});
  const empty = await Api.activityFeed(2, 'all');
  eq('activityFeed empty body defaults', [empty.items.length, empty.total, empty.page], [0, 0, 2]);

  // Old site: 404 rest_no_route rejects, and the wording helpers
  // classify it as the calm needs-newer state.
  fetchImpl = async () => jsonResponse(404, { code: 'rest_no_route', message: 'No route was found.' });
  let caught = null;
  try {
    await Api.activityFeed(1, 'all');
  } catch (e) {
    caught = e;
  }
  ok('activityFeed old site rejects', !!caught);
  eq('activityFeed old site code', caught && caught.code, 'rest_no_route');
  eq('activityFeed old site needs newer', caught ? Api.activityNeedsNewerSuite(caught) : null, true);
  eq(
    'activityFeed old site calm text',
    caught ? Api.activityErrorText(caught) : null,
    'Site activity needs EASY Suite 2.2.36 or newer on the site.'
  );

  // A real server failure stays a plain error, not the calm note.
  fetchImpl = async () => jsonResponse(500, { message: 'Database hiccup' });
  caught = null;
  try {
    await Api.activityFeed(1, 'class');
  } catch (e) {
    caught = e;
  }
  eq('activityFeed 500 needs newer is false', caught ? Api.activityNeedsNewerSuite(caught) : null, false);
  eq('activityFeed 500 text passthrough', caught ? Api.activityErrorText(caught) : null, 'Database hiccup');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Harness crashed:', e);
  process.exit(1);
});
