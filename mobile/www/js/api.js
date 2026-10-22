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
//                   POST /wp-json/easy/v1/management-queue/answers
//                   POST /wp-json/easy/v1/management-queue/undecide (2.2.32)
//                   POST /wp-json/easy/v1/management-queue/resolve (2.2.32)
//                   POST /wp-json/easy/v1/management-queue/unresolve (2.2.32)
//   Site health     GET  /wp-json/easy/v1/site-health
//   App config      GET  /wp-json/easy/v1/app-config (Suite version)
//   Course builder  GET  /wp-json/easy/v1/course-builder/me (review count)
//   Schedule write  POST /wp-json/tribe/events/v1/events (create)
//                   PUT  /wp-json/tribe/events/v1/events/<id> (update)
//                   DELETE /wp-json/tribe/events/v1/events/<id> (trash)
//                   GET  /wp-json/tribe/events/v1/venues|organizers|categories
//                   POST /wp-json/tribe/events/v1/venues|organizers (create)
//   Cert search     GET  /wp-json/easy/v1/cert-search?q=<text> (Suite 2.2.28)
//   Cert PDF        GET  /wp-json/easy/v1/cert-pdf/<number> (Suite 2.2.31)
//   Calendar links  GET  /wp-json/easy/v1/instructor-feeds (Suite 2.2.28)
//   Site activity   GET  /wp-json/easy/v1/activity (Suite 2.2.36)
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

  /* ---------------- schedule: full events and writing ---------------- */
  // The Schedule tab edits classes through the same TEC REST contract
  // the desktop app uses (see main.js schedule handlers and
  // renderer/schedule.js): wall-clock "YYYY-MM-DD HH:MM:SS" strings the
  // site reads in its own timezone, venue as a bare number, organizer
  // as a one-item array, blank optional fields omitted entirely.

  // Everything normalizeEvent returns, plus what the editor needs:
  // venue and organizer ids, the description, category ids, end stamp.
  function normalizeEventFull(raw) {
    const base = normalizeEvent(raw || {});
    const venueObj = firstRef(raw && raw.venue);
    const orgObj = firstRef(raw && raw.organizer);
    const endStamp = String((raw && raw.end_date) || (raw && raw.start_date) || '');
    return {
      ...base,
      endStamp,
      venueId: venueObj ? venueObj.id : null,
      organizerId: orgObj ? orgObj.id : null,
      description: (raw && raw.description) || '',
      categoryIds: Array.isArray(raw && raw.categories)
        ? raw.categories.map((c) => c && c.id).filter(Boolean)
        : [],
    };
  }

  async function fetchEventsPageFull(start, end, page) {
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
    return { items: items.map(normalizeEventFull), totalPages };
  }

  async function eventsInRangeFull(start, end) {
    return cached('eventsFull:' + start + ':' + end, 90000, async () => {
      const first = await fetchEventsPageFull(start, end, 1);
      const events = [...first.items];
      if (first.totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: first.totalPages - 1 }, (_, i) => fetchEventsPageFull(start, end, i + 2))
        );
        for (const page of rest) events.push(...page.items);
      }
      return events;
    });
  }

  // One event, read fresh from the server. Used to verify a publish:
  // the answer comes from a re-read, not from the save response alone.
  async function eventById(id) {
    const r = await request('/tribe/events/v1/events/' + id);
    return normalizeEventFull(r.json || {});
  }

  // Write-access probe, same trick as the desktop: WordPress runs the
  // permission check before validating the body, so an empty POST from
  // a capable account answers 400 (missing title and dates) and creates
  // nothing, while 401 or 403 means the account cannot write events.
  async function probeEventWrite() {
    const r = await rawRequest(WP + '/tribe/events/v1/events', { method: 'POST', body: {} });
    if (r.status === 400) return true;
    if (r.status === 401 || r.status === 403) return false;
    throw apiError(r);
  }

  function unwrapList(json, key) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json[key])) return json[key];
    return [];
  }

  async function fetchAllPages(path, key) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const r = await request(path + sep + 'per_page=50&page=' + page);
      items.push(...unwrapList(r.json, key));
      totalPages =
        parseInt(r.headers.get('x-wp-totalpages') || '', 10) ||
        parseInt((r.json && r.json.total_pages) || '', 10) ||
        1;
      page += 1;
    } while (page <= totalPages);
    return items;
  }

  function normalizeVenue(v) {
    const raw = v || {};
    return {
      id: raw.id,
      name: decodeEntities(raw.venue || raw.name || '') || '(unnamed location)',
      address: raw.address || '',
      city: raw.city || '',
      province: raw.province || '',
      zip: raw.zip || '',
      phone: raw.phone || '',
    };
  }

  function normalizeOrganizer(o) {
    const raw = o || {};
    return {
      id: raw.id,
      name: decodeEntities(raw.organizer || raw.name || '') || '(unnamed instructor)',
      email: raw.email || '',
      phone: raw.phone || '',
    };
  }

  function normalizeCategory(c) {
    const raw = c || {};
    return {
      id: raw.id,
      name: decodeEntities(raw.name || ''),
      slug: raw.slug || '',
      parent: raw.parent || 0,
    };
  }

  async function venuesList() {
    return cached('venuesList', 300000, async () =>
      (await fetchAllPages('/tribe/events/v1/venues', 'venues')).map(normalizeVenue)
    );
  }

  async function organizersList() {
    return cached('organizersList', 300000, async () =>
      (await fetchAllPages('/tribe/events/v1/organizers', 'organizers')).map(normalizeOrganizer)
    );
  }

  // hide_empty=0 matters: the endpoint hides categories with no events
  // by default, which would make a brand new course unpickable. The
  // string "0", not false: in PHP the string "false" is truthy.
  async function categoriesList() {
    return cached('categoriesList', 300000, async () =>
      (await fetchAllPages('/tribe/events/v1/categories?hide_empty=0', 'categories')).map(
        normalizeCategory
      )
    );
  }

  // Plain-language write errors, mirroring the desktop's wording.
  function friendlyWriteError(r, action) {
    const msg = (r.json && r.json.message) || '';
    if (r.status === 401) {
      return (
        'WordPress rejected the sign-in while trying to ' +
        action +
        '. Sign out and sign in again with a fresh application password.'
      );
    }
    if (r.status === 403) {
      return 'This WordPress account is not allowed to ' + action + '.';
    }
    if (r.status === 400 && msg) return 'WordPress refused to ' + action + ': ' + msg;
    return 'Could not ' + action + ' (HTTP ' + r.status + ').' + (msg ? ' ' + msg : '');
  }

  async function tribeWrite(method, path, body, action) {
    const r = await rawRequest(WP + path, { method, body });
    if (r.status === 200 || r.status === 201 || r.status === 204) return r;
    throw new Error(friendlyWriteError(r, action));
  }

  async function createVenue(fields) {
    const r = await tribeWrite('POST', '/tribe/events/v1/venues', fields, 'create the location');
    invalidateCache();
    return normalizeVenue(r.json || {});
  }

  async function createOrganizer(fields) {
    const r = await tribeWrite('POST', '/tribe/events/v1/organizers', fields, 'create the instructor');
    invalidateCache();
    return normalizeOrganizer(r.json || {});
  }

  async function createEvent(payload) {
    const r = await tribeWrite('POST', '/tribe/events/v1/events', payload, 'schedule the class');
    return normalizeEventFull(r.json || {});
  }

  async function updateEvent(id, payload) {
    const r = await tribeWrite('PUT', '/tribe/events/v1/events/' + id, payload, 'update the class');
    return normalizeEventFull(r.json || {});
  }

  // DELETE moves the event to the trash on the website; it does not
  // permanently delete it. The Schedule screen says so before asking.
  async function deleteEvent(id) {
    await tribeWrite('DELETE', '/tribe/events/v1/events/' + id, undefined, 'delete the class');
    invalidateCache();
    return true;
  }

  // The one payload builder for create and edit, with the desktop's
  // field rules:
  //   - dates are wall-clock strings; all day means 00:00:00 to
  //     23:59:59, and blank times default to 09:00 and 17:00
  //   - a blank description is omitted (this TEC version rejects empty
  //     strings for some fields); the same for a blank cost
  //   - venue is a bare number, never an array (an array falls into
  //     TEC's create-new-venue path and fails); organizer is a
  //     one-item array, which is what its handler loops over
  //   - seats sent as an integer when set; when the class had seats
  //     and the field was cleared (opts.hadSeats), an empty string
  //     unsets them; when it never had seats, the field stays absent
  //   - categories are sent only when the course picker was touched
  //     (input.categoryIds an array with items); untouched means the
  //     field is absent and the site keeps whatever the class has
  function buildEventPayload(input, opts = {}) {
    const data = input || {};
    const startTime = data.allDay ? '00:00:00' : (data.startTime || '09:00') + ':00';
    const endTime = data.allDay ? '23:59:59' : (data.endTime || '17:00') + ':00';
    const payload = {
      title: String(data.title || '').trim(),
      start_date: data.startDate + ' ' + startTime,
      end_date: (data.endDate || data.startDate) + ' ' + endTime,
      all_day: Boolean(data.allDay),
      status: data.status === 'publish' ? 'publish' : 'draft',
    };
    const desc = String(data.description || '').trim();
    if (desc) payload.description = desc;
    if (data.venueId) payload.venue = Number(data.venueId);
    if (data.organizerId) payload.organizer = [Number(data.organizerId)];
    const cost = String(data.cost === null || data.cost === undefined ? '' : data.cost).trim();
    if (cost) payload.cost = cost;
    const seatsRaw = String(data.seats === null || data.seats === undefined ? '' : data.seats).trim();
    if (seatsRaw !== '') {
      payload.easy_seats = Math.max(0, parseInt(seatsRaw, 10) || 0);
    } else if (opts.hadSeats) {
      payload.easy_seats = '';
    }
    if (Array.isArray(data.categoryIds) && data.categoryIds.length) {
      payload.categories = data.categoryIds.slice();
    }
    return payload;
  }

  // Save (create or update) with status verification in both
  // directions. The saved event is re-read from the server and the
  // save only counts when the re-read shows the intended status;
  // WordPress can answer 200 while silently keeping a draft when the
  // account lacks publish rights (and, symmetrically, a class that
  // was meant to go back to draft must not be reported as a draft
  // while it is still live). This app never reports either as
  // success. If the re-read itself fails (a network hiccup), the
  // save response's own status is the fallback evidence.
  async function saveEvent(idOrNull, payload) {
    const saved = idOrNull ? await updateEvent(idOrNull, payload) : await createEvent(payload);
    const wanted =
      payload && (payload.status === 'publish' || payload.status === 'draft')
        ? payload.status
        : null;
    if (wanted) {
      let confirmed = !!(saved && saved.status === wanted);
      if (saved && saved.id) {
        try {
          const fresh = await eventById(saved.id);
          if (fresh && fresh.status) confirmed = fresh.status === wanted;
        } catch (e) {
          // Keep the save response's status as the evidence.
        }
      }
      if (!confirmed) {
        invalidateCache();
        if (wanted === 'publish') {
          throw new Error(
            'WordPress kept the class as a draft. This account cannot publish classes ' +
              '(it needs the publish_tribe_events capability). The class itself was saved as a draft.'
          );
        }
        throw new Error(
          idOrNull
            ? 'WordPress did not move the class back to draft. It may still be live on the site. The edits themselves were saved.'
            : 'WordPress published the class instead of saving it as a draft. Check the class on the website.'
        );
      }
    }
    invalidateCache();
    return saved;
  }

  // The site's timezone string (e.g. "America/St_Johns"), so the
  // Schedule screen can say which clock class times run on.
  async function siteTimezone() {
    return cached('siteTimezone', 3600000, async () => {
      const r = await request('/');
      return (r.json && r.json.timezone_string) || null;
    });
  }

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
      return r.json || { open: [], decided: [], resolved: [], counts: { open: 0, decided: 0, resolved: 0, total: 0 } };
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

  // Send the queued new-question notification digests now (Suite
  // 2.2.38). Returns the summary: { sent, questions_cleared, recipients,
  // pending_notifications }.
  async function notifyQueue() {
    const r = await request('/easy/v1/management-queue/notify', {
      method: 'POST',
      body: {},
    });
    invalidateCache();
    return r.json;
  }

  // Save one answer. The Suite route applies the same validation as
  // the website queue form: a choice must be one of the question's
  // defined options (or '__other' with the write-in text in `other`
  // for radio_other questions); value is the answer text itself for
  // free-text questions. Returns { question } in the feed's shape.
  async function answerQuestion(questionId, value, other) {
    const body = { question_id: questionId, value };
    if (other !== undefined) body.other = other;
    const r = await request('/easy/v1/management-queue/answers', {
      method: 'POST',
      body,
    });
    invalidateCache();
    return r.json;
  }

  /* ---------------- queue lifecycle (Suite 2.2.32) ---------------- */

  // Plain-language text for a failed queue lifecycle call. A site
  // still on Suite 2.2.31 or older answers rest_no_route for these
  // routes (they do not exist there); anything else is the site's own
  // message.
  function queueLifecycleErrorText(err) {
    if (err && err.code === 'rest_no_route') {
      return 'This needs EASY Suite 2.2.32 or newer on the site. Once the site is updated, this will work.';
    }
    return (err && err.message) || 'The site did not answer.';
  }

  // Clear one question's answer so it returns to the open list.
  // Returns { question } in the feed's open shape.
  async function undecideQuestion(questionId) {
    const r = await request('/easy/v1/management-queue/undecide', {
      method: 'POST',
      body: { question_id: questionId },
    });
    invalidateCache();
    return r.json;
  }

  // Mark one decided question resolved: it leaves Decided for the
  // archive, answer on record. Returns { question } in the feed's
  // resolved shape.
  async function resolveQuestion(questionId) {
    const r = await request('/easy/v1/management-queue/resolve', {
      method: 'POST',
      body: { question_id: questionId },
    });
    invalidateCache();
    return r.json;
  }

  // Move one resolved question back to Decided. Returns { question }
  // in the feed's decided shape.
  async function unresolveQuestion(questionId) {
    const r = await request('/easy/v1/management-queue/unresolve', {
      method: 'POST',
      body: { question_id: questionId },
    });
    invalidateCache();
    return r.json;
  }

  /* ---------------- site health ---------------- */

  // The Suite Overview health rows plus expiry email and digest run
  // times, for the Alerts screen.
  async function siteHealth() {
    return cached('siteHealth', 120000, async () => {
      const r = await request('/easy/v1/site-health');
      return r.json || {};
    });
  }

  /* ---------------- instructor calendar links (Suite 2.2.28) ------- */

  // Pure shaping for one feed row, kept separate so it can be tested
  // without the network.
  function shapeFeed(f) {
    const raw = f || {};
    return {
      id: raw.id,
      name: String(raw.name || ''),
      url: String(raw.url || ''),
    };
  }

  // Each instructor's tokened calendar subscription link, read from
  // the site. Read only on purpose: resetting a link stays in EASY
  // Suite (wp-admin, Calendar feeds), never in this app. A site still
  // on Suite 2.2.27 answers 404 and the Schedule screen says so.
  async function instructorFeeds() {
    const r = await request('/easy/v1/instructor-feeds');
    const body = r.json || {};
    const feeds = (Array.isArray(body.feeds) ? body.feeds : [])
      .map(shapeFeed)
      .filter((f) => f.url);
    return { available: body.available !== false, feeds };
  }

  /* ---------------- certificate search (Suite 2.2.28) -------------- */

  // Pure shaping for one search result row.
  function shapeCertRow(row) {
    const raw = row || {};
    return {
      id: raw.id,
      title: String(raw.title || ''),
      status: String(raw.status || ''),
      student: String(raw.student || raw.student_name || '') || '(no name)',
      course: String(raw.course || raw.course_title || raw.course_category || ''),
      number: String(raw.certificate_number || ''),
      completion: String(raw.completion_date || ''),
      expiry: String(raw.expiry_date || ''),
    };
  }

  // Search published and draft certificates by student name (matched
  // against certificate titles on the server) or by certificate
  // number (matched against the number field on the server). The
  // route is gated by the same Suite permission as the cert queue.
  async function certSearch(query) {
    const r = await request('/easy/v1/cert-search?q=' + encodeURIComponent(query));
    const rows = Array.isArray(r.json) ? r.json : Array.isArray(r.json && r.json.results) ? r.json.results : [];
    return rows.map(shapeCertRow);
  }

  /* ---------------- certificate PDF (Suite 2.2.31) ---------------- */

  // Request path for one certificate's PDF, kept separate so it can
  // be tested without the network. The number is a lookup key on the
  // server, never part of a file path anywhere.
  function certPdfPath(number) {
    return '/easy/v1/cert-pdf/' + encodeURIComponent(String(number || ''));
  }

  // Plain-language text for a failed certPdf() call. A site still on
  // Suite 2.2.28 or older answers rest_no_route (the route does not
  // exist there); a 404 from the route itself means the certificate
  // has no PDF on file, which is normal for certificates that have
  // not been through the desktop app's PDF step.
  function certPdfErrorText(err) {
    if (err && err.code === 'rest_no_route') {
      return 'Certificate PDFs need EASY Suite 2.2.31 or newer on the site. Once the site is updated, this will work.';
    }
    if (err && err.status === 404) {
      return 'No PDF on file for this certificate yet.';
    }
    return (err && err.message) || 'Could not fetch the certificate PDF.';
  }

  // Fetch one certificate's PDF with the saved sign-in and resolve
  // with the file as base64, ready for Capacitor Filesystem. Since
  // Suite 2.2.31 the site sends the PDF as base64 inside the normal
  // JSON response, the same envelope as every other route. Throws
  // an Error carrying .status and .code on any non-200; use
  // certPdfErrorText() to word it for the screen.
  async function certPdf(number) {
    const r = await request(certPdfPath(number));
    const b64 = r.json && r.json.pdf_base64;
    if (typeof b64 !== 'string' || b64 === '') {
      throw new Error('The site sent an empty certificate PDF.');
    }
    return b64;
  }

  /* ---------------- site activity (Suite 2.2.36) ---------------- */

  // Request path for one page of the site activity feed, kept
  // separate so it can be tested without the network. kind is one of
  // the Activity screen's filter keys; anything unrecognised asks
  // for every kind, the same way the site treats it.
  function activityFeedPath(page, kind) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const kinds = ['class', 'cert', 'account', 'queue'];
    const k = kinds.indexOf(kind) >= 0 ? kind : 'all';
    return '/easy/v1/activity?page=' + p + '&per_page=50&kind=' + k;
  }

  // True when the failure means this site cannot serve the activity
  // feed to this app at all: the route does not exist there yet (a
  // Suite older than 2.2.36 answers rest_no_route, seen as a 404),
  // or the signed-in account may not read it (403, the feed is
  // admins only). The Activity screen shows a calm needs-newer note
  // for this instead of a raw error.
  function activityNeedsNewerSuite(err) {
    if (!err) return false;
    if (err.code === 'rest_no_route') return true;
    return err.status === 404 || err.status === 403;
  }

  // Plain-language text for a failed activityFeed() call.
  function activityErrorText(err) {
    if (activityNeedsNewerSuite(err)) {
      return 'Site activity needs EASY Suite 2.2.36 or newer on the site.';
    }
    return (err && err.message) || 'Could not load site activity.';
  }

  // One page of the site-wide activity feed (Suite 2.2.36): what the
  // team did across the website, the desktop app, and this app,
  // newest first. Resolves { items, page, perPage, total }; each item
  // carries kind, title, action, summary, actor, and a millisecond
  // `at`. Deliberately not cached: the Activity screen fetches fresh
  // on entry, and paging must never replay a stale first page.
  // Throws an Error carrying .status and .code on any non-200; use
  // activityErrorText() to word it for the screen.
  async function activityFeed(page, kind) {
    const r = await request(activityFeedPath(page, kind));
    const body = r.json || {};
    return {
      items: Array.isArray(body.items) ? body.items : [],
      page: typeof body.page === 'number' ? body.page : Math.max(1, parseInt(page, 10) || 1),
      perPage: typeof body.per_page === 'number' ? body.per_page : 50,
      total: typeof body.total === 'number' ? body.total : 0,
    };
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
    eventsInRangeFull,
    eventById,
    probeEventWrite,
    venuesList,
    organizersList,
    categoriesList,
    createVenue,
    createOrganizer,
    createEvent,
    updateEvent,
    deleteEvent,
    buildEventPayload,
    normalizeEventFull,
    saveEvent,
    siteTimezone,
    instructorFeeds,
    shapeFeed,
    certSearch,
    shapeCertRow,
    certPdf,
    certPdfPath,
    certPdfErrorText,
    activityFeed,
    activityFeedPath,
    activityErrorText,
    activityNeedsNewerSuite,
    saleState,
    roster,
    expiringCerts,
    mgmtQueue,
    addQuestion,
    notifyQueue,
    answerQuestion,
    undecideQuestion,
    resolveQuestion,
    unresolveQuestion,
    queueLifecycleErrorText,
    siteHealth,
    appConfig,
    courseBuilderMe,
  };
})();
