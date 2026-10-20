// api.js: WordPress REST client for EASY Manager.
//
// Every route here mirrors the EASY Operations desktop app and the EASY
// Suite plugin, so this app speaks exactly the same contract:
//
//   Sign-in probe   GET  /wp-json/wp/v2/users/me?context=edit
//                        (falls back to plain /users/me only when the
//                        site does not support context=edit)
//   Account queue   GET  /wp-json/easy/v1/pending-users
//                   POST /wp-json/easy/v1/pending-users/<id>/approve
//                   POST /wp-json/easy/v1/pending-users/<id>/reject
//   Cert queue      GET  /wp-json/wp/v2/cert?status=draft...
//                   POST /wp-json/wp/v2/cert/<id>  { status: "publish" }
//   Class queue     GET  /wp-json/tribe/events/v1/events?start_date&end_date
//                   PUT  /wp-json/tribe/events/v1/events/<id> { status }
//   Seat sales      GET  /wp-json/easy/v1/sale-state/<event_id>
//   Class roster    GET  /wp-json/easy/v1/roster/<event_id> (read only)
//   Cert expiry     GET  /wp-json/easy/v1/expiring-certs?days=<n>
//   Mgmt queue      GET  /wp-json/easy/v1/management-queue
//                   POST /wp-json/easy/v1/management-queue/questions
//   App config      GET  /wp-json/easy/v1/app-config (Suite version)
//   Course builder  GET  /wp-json/easy/v1/course-builder/me (review count)
//
// Auth is a WordPress Application Password sent as HTTP Basic over HTTPS.
//
// Read results that several screens share (the class range, pending
// users, the queue feed, expiring certs) are cached in memory for a
// short while, so moving between tabs does not refetch everything.
// Any decision or publish clears the cache, so counts never sit stale
// after Brandon acts.
(function () {
  'use strict';

  const SITE = window.EasyConfig.SITE;
  const WP = SITE + '/wp-json';
  const TIMEOUT_MS = 18000;

  let creds = null; // { username, appPassword }

  function basicAuth(username, password) {
    // btoa needs Latin-1; encode to UTF-8 bytes first.
    const bytes = new TextEncoder().encode(username + ':' + password);
    let raw = '';
    for (const b of bytes) raw += String.fromCharCode(b);
    return 'Basic ' + btoa(raw);
  }

  function authHeader() {
    if (!creds) return null;
    return basicAuth(creds.username, creds.appPassword);
  }

  function setCreds(next) {
    creds = next;
    cache.clear();
  }

  /* ---------------- timeout-aware fetch ---------------- */

  // One fetch with a hard stop. A site that accepts the connection and
  // then stalls used to leave screens hanging until the OS gave up;
  // now it fails in TIMEOUT_MS with wording that says so.
  async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('The site did not answer in time. It may be down, or the connection is weak.');
        err.isTimeout = true;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function rawRequest(url, { method = 'GET', body, headers = {} } = {}) {
    const auth = authHeader();
    const res = await fetchWithTimeout(url, {
      method,
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, headers: res.headers, json };
  }

  // Throws an Error with a plain-language message on any non-2xx.
  async function request(path, opts = {}) {
    const r = await rawRequest(WP + path, opts);
    if (r.status < 200 || r.status >= 300) {
      throw apiError(r);
    }
    return r;
  }

  function apiError(r) {
    const msg = (r.json && r.json.message) || '';
    let text;
    if (r.status === 401) {
      text = 'The saved sign-in no longer works. Sign out and sign in again with a fresh application password.';
    } else if (r.status === 403) {
      text = 'This WordPress account is not allowed to do that.';
    } else if (msg) {
      text = msg;
    } else {
      text = 'WordPress returned an error (HTTP ' + r.status + ').';
    }
    const err = new Error(text);
    err.status = r.status;
    err.code = (r.json && r.json.code) || '';
    return err;
  }

  /* ---------------- short-lived read cache ---------------- */

  const cache = new Map(); // key -> { at, promise }

  function cached(key, ttlMs, fetcher) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const entry = { at: Date.now(), promise: null };
    entry.promise = Promise.resolve()
      .then(fetcher)
      .catch((e) => {
        // Never cache a failure; the next screen should try again.
        if (cache.get(key) === entry) cache.delete(key);
        throw e;
      });
    cache.set(key, entry);
    return entry.promise;
  }

  function invalidateCache() {
    cache.clear();
  }

  /* ---------------- shared predicates ---------------- */

  // The one definition of a class still waiting for a decision, used by
  // Today, Approvals, and Alerts so their counts always agree.
  function isWaitingClass(ev) {
    return !!ev && (ev.status === 'draft' || ev.status === 'pending');
  }

  /* ---------------- sign-in ---------------- */

  // context=edit first (it carries roles and capabilities), plain as a
  // fallback only where context=edit itself is unsupported. A 401 or 403
  // is a real answer from the site, so probing again would only repeat it.
  async function fetchMe(username, appPassword) {
    const auth = basicAuth(username, appPassword);
    let res = await fetchWithTimeout(WP + '/wp/v2/users/me?context=edit', {
      headers: { Authorization: auth },
    });
    if (res.status === 400 || res.status === 404 || res.status === 501) {
      res = await fetchWithTimeout(WP + '/wp/v2/users/me', {
        headers: { Authorization: auth },
      });
    }
    if (res.status !== 200) {
      const err = new Error(
        res.status === 401
          ? 'WordPress did not accept that username and application password.'
          : 'Could not sign in (HTTP ' + res.status + ').'
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* ---------------- account approvals (EASY Suite) ---------------- */

  async function pendingUsers() {
    return cached('pendingUsers', 90000, async () => {
      const r = await request('/easy/v1/pending-users');
      return Array.isArray(r.json) ? r.json : [];
    });
  }

  async function decideUser(id, action) {
    const r = await request('/easy/v1/pending-users/' + id + '/' + action, {
      method: 'POST',
    });
    invalidateCache();
    return r.json;
  }

  /* ---------------- certificate approvals (native WP REST) ---------------- */

  // Mirrors the desktop normalization: the post title is shaped
  // "YYYY-MM-DD - Course Name - Student Name" and ACF carries the rest.
  function normalizeDraftCert(c) {
    const acf = (c && c.acf) || {};
    let course = '';
    let student = '';
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
      company: acf.company || '',
      companyContact: acf.company_contact || '',
      studentEmail: acf.student_email || '',
      hasPdf: Boolean(acf.certificate),
    };
  }

  async function draftCerts() {
    return cached('draftCerts', 90000, async () => {
      const r = await request(
        '/wp/v2/cert?status=draft&per_page=100&orderby=date&order=desc' +
          '&_fields=id,date,title,acf,author'
      );
      const items = Array.isArray(r.json) ? r.json : [];
      const total = parseInt(r.headers.get('x-wp-total') || '0', 10) || items.length;
      return { certs: items.map(normalizeDraftCert), total };
    });
  }

  // Count only, for badges: one row plus the X-WP-Total header.
  async function draftCertCount() {
    return cached('draftCertCount', 90000, async () => {
      const r = await request('/wp/v2/cert?status=draft&per_page=1&_fields=id');
      return parseInt(r.headers.get('x-wp-total') || '0', 10) || 0;
    });
  }

  // Publishing is verified: WordPress can answer 200 while silently
  // keeping the draft when the account lacks publish rights.
  async function setCertStatus(id, status) {
    const r = await request('/wp/v2/cert/' + id, {
      method: 'POST',
      body: { status },
    });
    if (!r.json || r.json.status !== status) {
      throw new Error(
        status === 'publish'
          ? 'WordPress kept the certificate as a draft. This account cannot publish certificates.'
          : 'WordPress did not change the certificate status.'
      );
    }
    invalidateCache();
    return r.json;
  }

  const publishCert = (id) => setCertStatus(id, 'publish');
  const unpublishCert = (id) => setCertStatus(id, 'draft');

  /* ---------------- classes (The Events Calendar REST) ---------------- */

  function decodeEntities(text) {
    if (text === null || text === undefined) return '';
    const el = document.createElement('textarea');
    el.innerHTML = String(text);
    return el.value;
  }

  function firstRef(value) {
    if (Array.isArray(value)) return value.length ? value[0] : null;
    return value || null;
  }

  // Mirrors the desktop schedule normalization.
  function normalizeEvent(raw) {
    const split = (stamp) => {
      const s = String(stamp || '');
      const date = s.slice(0, 10);
      const time = s.length > 11 ? s.slice(11) : '00:00:00';
      return { date, time };
    };
    const start = split(raw.start_date);
    const end = split(raw.end_date || raw.start_date);
    const venueObj = firstRef(raw.venue);
    const orgObj = firstRef(raw.organizer);
    return {
      id: raw.id,
      title: decodeEntities(raw.title) || '(untitled)',
      startDate: start.date,
      endDate: end.date,
      startTime: start.time.slice(0, 5),
      endTime: end.time.slice(0, 5),
      startStamp: start.date + ' ' + start.time,
      allDay: Boolean(raw.all_day),
      status: raw.status || 'publish',
      venueName: venueObj ? decodeEntities(venueObj.venue || venueObj.name || '') : '',
      organizerName: orgObj ? decodeEntities(orgObj.organizer || orgObj.name || '') : '',
      cost: raw.cost === null || raw.cost === undefined ? '' : raw.cost,
      seats: raw.easy_seats === null || raw.easy_seats === undefined ? '' : raw.easy_seats,
    };
  }

  async function fetchEventsPage(start, end, page) {
    const r = await request(
      '/tribe/events/v1/events?start_date=' + encodeURIComponent(start) +
        '&end_date=' + encodeURIComponent(end) +
        '&per_page=50&page=' + page
    );
    const body = r.json || {};
    const items = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
    const totalPages =
      parseInt(r.headers.get('x-wp-totalpages') || '', 10) ||
      parseInt(body.total_pages || '', 10) ||
      1;
    return { items: items.map(normalizeEvent), totalPages };
  }

  async function eventsInRange(start, end) {
    return cached('events:' + start + ':' + end, 90000, async () => {
      // First page on its own (it reports the page count), the rest in
      // parallel, kept in page order.
      const first = await fetchEventsPage(start, end, 1);
      const events = [...first.items];
      if (first.totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: first.totalPages - 1 }, (_, i) => fetchEventsPage(start, end, i + 2))
        );
        for (const page of rest) events.push(...page.items);
      }
      return events;
    });
  }

  // Status flips are verified for draft exactly like publish: a 200
  // that silently kept the old status must not be reported as success.
  async function setEventStatus(id, status) {
    const r = await request('/tribe/events/v1/events/' + id, {
      method: 'PUT',
      body: { status },
    });
    if (!r.json || r.json.status !== status) {
      throw new Error(
        status === 'publish'
          ? 'WordPress kept the class as a draft. This account cannot publish classes.'
          : 'WordPress did not move the class back to draft. It may still be live on the site.'
      );
    }
    invalidateCache();
    return r.json;
  }

  const publishEvent = (id) => setEventStatus(id, 'publish');
  const unpublishEvent = (id) => setEventStatus(id, 'draft');

  /* ---------------- seat sales state ---------------- */

  async function saleState(eventId) {
    const r = await request('/easy/v1/sale-state/' + eventId);
    return r.json || {};
  }

  /* ---------------- class roster (read only) ---------------- */

  async function roster(eventId) {
    const r = await request('/easy/v1/roster/' + eventId);
    const body = r.json || {};
    return Array.isArray(body.roster) ? body.roster : [];
  }

  /* ---------------- expiring certificates ---------------- */

  async function expiringCerts(days) {
    return cached('expiringCerts:' + (days || 30), 120000, async () => {
      const r = await request('/easy/v1/expiring-certs?days=' + (days || 30));
      return Array.isArray(r.json) ? r.json : [];
    });
  }

  /* ---------------- management queue ---------------- */

  async function mgmtQueue() {
    return cached('mgmtQueue', 90000, async () => {
      const r = await request('/easy/v1/management-queue');
      return r.json || { open: [], decided: [], counts: { open: 0, decided: 0, total: 0 } };
    });
  }

  async function addQuestion(payload) {
    const r = await request('/easy/v1/management-queue/questions', {
      method: 'POST',
      body: payload,
    });
    invalidateCache();
    return r.json;
  }

  /* ---------------- site and course builder info ---------------- */

  // Suite version plus a reachability canary for the Today footer.
  async function appConfig() {
    const r = await request('/easy/v1/app-config');
    return r.json || {};
  }

  // Course-builder identity; pendingReviews is a real count only when
  // the caller is a reviewer.
  async function courseBuilderMe() {
    const r = await request('/easy/v1/course-builder/me');
    return r.json || {};
  }

  window.EasyApi = {
    setCreds,
    fetchMe,
    fetchWithTimeout,
    invalidateCache,
    isWaitingClass,
    pendingUsers,
    decideUser,
    draftCerts,
    draftCertCount,
    publishCert,
    unpublishCert,
    eventsInRange,
    publishEvent,
    unpublishEvent,
    saleState,
    roster,
    expiringCerts,
    mgmtQueue,
    addQuestion,
    appConfig,
    courseBuilderMe,
  };
})();
