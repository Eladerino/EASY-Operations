// test/shared.test.js — unit tests for the pure helpers in shared.js.
// Runs with plain node, no dependencies: `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared.js');

test('expiryPlus3Years: normal date adds 3 years', () => {
  assert.equal(S.expiryPlus3Years('2026-10-12'), '2029-10-12');
});

test('expiryPlus3Years: leap-day completion clamps to Feb 28', () => {
  assert.equal(S.expiryPlus3Years('2028-02-29'), '2031-02-28');
  assert.equal(S.expiryPlus3Years('2024-02-29'), '2027-02-28');
});

test('expiryPlus3Years: non-leap Feb dates are unchanged', () => {
  assert.equal(S.expiryPlus3Years('2025-02-28'), '2028-02-28');
});

test('expiryPlus3Years: month ends stay on the same day', () => {
  assert.equal(S.expiryPlus3Years('2026-01-31'), '2029-01-31');
  assert.equal(S.expiryPlus3Years('2026-12-31'), '2029-12-31');
});

test('expiryPlus3Years: result is always a real calendar date', () => {
  for (const d of ['2028-02-29', '2024-02-29', '2026-02-28', '2027-03-31', '2026-10-12']) {
    const [y, m, day] = S.expiryPlus3Years(d).split('-').map(Number);
    const roundTrip = new Date(y, m - 1, day);
    assert.equal(roundTrip.getFullYear(), y, d);
    assert.equal(roundTrip.getMonth(), m - 1, d);
    assert.equal(roundTrip.getDate(), day, d);
  }
});

test('makePdfFilename: slashes in course titles are stripped', () => {
  const name = S.makePdfFilename('Brandon Glynn', 'Lockout/Tagout', '2026-10-10');
  assert.ok(!name.includes('/'), `filename must not contain '/': ${name}`);
  assert.equal(name, 'BrandonGlynn-LockoutTagout-2026-10-10.pdf');
});

test('sanitizeFilename: keeps only safe filename characters', () => {
  assert.equal(S.sanitizeFilename('WHMIS 2015 (online)'), 'WHMIS2015online');
});

test('nextFreeCertificateNumber: free candidate passes through', () => {
  assert.equal(S.nextFreeCertificateNumber('260930COURSE01', []), '260930COURSE01');
});

test('nextFreeCertificateNumber: collision bumps the instance', () => {
  assert.equal(
    S.nextFreeCertificateNumber('260930COURSE01', ['260930COURSE01']),
    '260930COURSE02');
  assert.equal(
    S.nextFreeCertificateNumber('260930COURSE01', ['260930COURSE01', '260930COURSE02']),
    '260930COURSE03');
});

test('nextFreeCertificateNumber: other courses and dates do not collide', () => {
  assert.equal(
    S.nextFreeCertificateNumber('260930COURSE01', ['260930OTHER01', '260929COURSE01']),
    '260930COURSE01');
});

test('nextFreeCertificateNumber: accepts a Set as well as an array', () => {
  assert.equal(
    S.nextFreeCertificateNumber('260930COURSE01', new Set(['260930COURSE01'])),
    '260930COURSE02');
});

test('nextFreeCertificateNumber: exhaustion throws instead of wrapping', () => {
  const taken = [];
  for (let i = 1; i <= 99; i++) taken.push('260930COURSE' + String(i).padStart(2, '0'));
  assert.throws(() => S.nextFreeCertificateNumber('260930COURSE01', taken), /exhausted/);
});

test('nextFreeCertificateNumber: malformed candidate passes through untouched', () => {
  assert.equal(S.nextFreeCertificateNumber('', []), '');
  assert.equal(S.nextFreeCertificateNumber('NO-DIGITS', ['NO-DIGITS']), 'NO-DIGITS');
});

test('parseSignInCallback: approval hands back user and password', () => {
  const url = 'easyops://auth/callback?site_url=https%3A%2F%2Feasysafety.ca&user_login=staff1&password=abcd%20efgh%20ijkl';
  assert.deepEqual(S.parseSignInCallback(url, 'easyops', 'https://easysafety.ca'), { user: 'staff1', appPassword: 'abcd efgh ijkl' });
});

test('parseSignInCallback: decline is reported, not treated as success', () => {
  assert.deepEqual(S.parseSignInCallback('easyops://auth/rejected', 'easyops', 'https://easysafety.ca'), { rejected: true });
  assert.deepEqual(S.parseSignInCallback('easyops://auth/callback?success=false', 'easyops', 'https://easysafety.ca'), { rejected: true });
});

test('parseSignInCallback: wrong site, scheme or missing fields are refused', () => {
  const site = 'https://easysafety.ca';
  assert.equal(S.parseSignInCallback('easyops://auth/callback?site_url=https%3A%2F%2Fevil.example&user_login=a&password=b', 'easyops', site), null);
  assert.equal(S.parseSignInCallback('other://auth/callback?site_url=https%3A%2F%2Feasysafety.ca&user_login=a&password=b', 'easyops', site), null);
  assert.equal(S.parseSignInCallback('easyops://auth/callback?site_url=https%3A%2F%2Feasysafety.ca&user_login=a', 'easyops', site), null);
  assert.equal(S.parseSignInCallback('easyops://auth/callback?user_login=a&password=b', 'easyops', site), null);
  assert.equal(S.parseSignInCallback('not a url', 'easyops', site), null);
});

test('revokeCandidate: only a password this app made through the website sign-in', () => {
  const id = '5c0f7e8a-3b1d-4e6f-9a2c-7d4b8e1f0a63';
  const mine = { uuid: 'u-1', app_id: id, name: 'EASY Operations (PC, 2026-10-24 09:00)' };
  assert.deepEqual(S.revokeCandidate(mine, ' staff1 ', id), { user: 'staff1', uuid: 'u-1' });
  assert.deepEqual(S.revokeCandidate(mine, 'staff1', ['other', id]), { user: 'staff1', uuid: 'u-1' });
  // Made by hand on the profile page (no app_id), or by another app.
  assert.equal(S.revokeCandidate({ uuid: 'u-2', app_id: '' }, 'staff1', id), null);
  assert.equal(S.revokeCandidate({ uuid: 'u-3', app_id: 'someone-else' }, 'staff1', id), null);
  // Nothing usable from the site, or nothing to compare against.
  assert.equal(S.revokeCandidate(null, 'staff1', id), null);
  assert.equal(S.revokeCandidate({ app_id: id }, 'staff1', id), null);
  assert.equal(S.revokeCandidate(mine, '', id), null);
  assert.equal(S.revokeCandidate({ uuid: 'u-4', app_id: '' }, 'staff1', ''), null);
});

test('sameLogin: case and spaces do not matter, empty never matches', () => {
  assert.equal(S.sameLogin('Staff1', ' staff1'), true);
  assert.equal(S.sameLogin('staff1', 'staff2'), false);
  assert.equal(S.sameLogin('', ''), false);
  assert.equal(S.sameLogin(null, undefined), false);
});
