// schedule.js — class-scheduling tab.
//
// A month calendar populated from The Events Calendar (legacy v1 REST API).
// Staff drag a course from the palette onto a day (or click a day) to open
// the class editor: title, date(s), times, location, instructor, cost,
// publish/draft. Existing classes can be edited in place or dragged to
// another day to reschedule. All API traffic goes through the main process
// via window.easyCert.schedule; this file never sees WordPress credentials.
//
// Wall-clock dates are passed through untouched as "YYYY-MM-DD HH:MM:SS"
// strings; the site interprets them in its own timezone, so no timezone
// conversion happens here. All date math uses UTC-noon arithmetic to stay
// immune to DST transitions.
(function () {
  'use strict';

  const S = window.EasyCertShared;
  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.schedule;

  // Course Builder access gate: renderer.js sets this true during startup for
  // Allowlisted accounts only. Defaults to false (fail closed)
  // so the tab can never leak to other accounts.
  window.EasyCourseBuilderAllowed = false;

  /* ---------------- small date helpers (wall-clock, DST-safe) ---------------- */

  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtDate(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // "2026-10-15" -> Date at UTC noon (DST-immune day arithmetic)
  function dateToUtcNoon(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }

  function utcNoonToDateStr(dt) {
    return fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function addDays(dateStr, n) {
    const dt = dateToUtcNoon(dateStr);
    dt.setUTCDate(dt.getUTCDate() + n);
    return utcNoonToDateStr(dt);
  }

  // "2026-10-15 09:00:00" -> { date: "2026-10-15", time: "09:00:00" }
  function splitStamp(stamp) {
    const s = String(stamp || '');
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
    if (!m) return { date: s.slice(0, 10), time: '00:00:00' };
    return { date: m[1], time: `${m[2]}:${m[3] || '00'}` };
  }

  function stampToMinutes(stamp) {
    const { time } = splitStamp(stamp);
    const [h, mi] = time.split(':').map(Number);
    return h * 60 + mi;
  }

  function todayStr() {
    const n = new Date();
    return fmtDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  /* ---------------- toast (local copy; renderer.js owns its own) ---------------- */

  function toast(message, type, ms) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast toast-${type || 'info'}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 400);
    }, ms || 5000);
  }

  // Reuses the generic #modal from index.html with its own one-shot
  // listeners (renderer.js's handlers also fire and just hide the modal).
  function schedConfirm(title, body, okText) {
    return new Promise((resolve) => {
      $('modalTitle').textContent = title;
      $('modalBody').textContent = body;
      const ok = $('modalOk');
      const cancel = $('modalCancel');
      ok.textContent = okText || 'OK';
      cancel.style.display = '';
      cancel.textContent = 'Cancel';
      $('modal').classList.remove('hidden');
      const done = (v) => {
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

  /* ---------------- view tabs ---------------- */

  let schedInitialized = false;
  let currentView = 'certs';

  // The footer action bar (Setup / Clear / Post certificate) belongs to
  // the New certificate form only — hidden on every other view and
  // sub-tab.
  function updateFooter() {
    const onForm = currentView === 'certs' &&
      (!window.EasyCertTabs || window.EasyCertTabs.current() === 'new');
    document.body.classList.toggle('cert-form-mode', onForm);
  }

  function showView(name) {
    // Course Builder is gated to allowlisted accounts — everyone else falls back.
    if (name === 'builder' && window.EasyCourseBuilderAllowed !== true) {
      name = 'certs';
    }
    currentView = name;
    const sched = name === 'schedule';
    const appr = name === 'approvals';
    const online = name === 'online';
    const builder = name === 'builder';
    $('certMain').classList.toggle('hidden', name !== 'certs');
    $('scheduleMain').classList.toggle('hidden', !sched);
    $('approvalsMain').classList.toggle('hidden', !appr);
    $('onlineMain').classList.toggle('hidden', !online);
    $('builderMain').classList.toggle('hidden', !builder);
    $('tabCerts').classList.toggle('active', name === 'certs');
    $('tabSchedule').classList.toggle('active', sched);
    $('tabApprovals').classList.toggle('active', appr);
    $('tabOnlineLearning').classList.toggle('active', online);
    $('tabCourseBuilder').classList.toggle('active', builder);
    updateFooter();
    if (sched) {
      if (!schedInitialized) {
        schedInitialized = true;
        initSchedule();
      } else {
        refreshMonth();
      }
    } else if (appr && window.EasyApprovalTabs) {
      window.EasyApprovalTabs.show();
    } else if (online && window.EasyOnlineTabs) {
      window.EasyOnlineTabs.show();
    } else if (builder && window.EasyCourseBuilder) {
      window.EasyCourseBuilder.show();
    } else if (name === 'certs' && window.EasyCertTools) {
      window.EasyCertTools.onCertsTabShown();
    }
  }
  window.EasyViews = { showView, updateFooter };

  $('tabCerts').addEventListener('click', () => showView('certs'));
  $('tabSchedule').addEventListener('click', () => showView('schedule'));
  $('tabCourseBuilder').addEventListener('click', () => showView('builder'));

  /* ---------------- state ---------------- */

  let viewYear = 0;
  let viewMonth = 0; // 0-11
  let readOnly = false; // true when the account cannot publish events
  let monthEvents = []; // normalized events for the visible range
  let monthToken = 0; // guards refreshMonth against stale concurrent fetches
  let venueCache = []; // { id, name }
  let organizerCache = []; // { id, name }
  let categoryCache = []; // raw TEC categories: { id, name, slug, parent }
  let catBySlug = {}; // slug -> { id, name, parent }
  let catByName = {}; // decoded lowercase name -> { id, name, slug, parent }
  let modalCategoryIds = []; // TEC category IDs for the class being edited
  let editingId = null;
  let editingEvent = null; // normalized event being edited (null for new)

  // Reverse maps: course value -> app category key / course label.
  const courseValueToCategory = {};
  const courseValueToLabel = {};
  const courseValueToDescription = {};
  for (const [catKey, courses] of Object.entries(S.titlesByCategory)) {
    for (const course of courses) {
      courseValueToCategory[course.value] = catKey;
      courseValueToLabel[course.value] = course.label;
      if (course.description) courseValueToDescription[course.value] = course.description;
    }
  }

  // Resolve the TEC categories for a course: the parent is the course's
  // category (e.g. "Powered Mobile Equipment"), the child is the specific
  // course (e.g. "Counter Balance Forklift") when the site defines one.
  // Slugs are matched first; when a slug doesn't line up (e.g. WordPress
  // deduplicated it to "skid-steer-2"), fall back to the exact category
  // name, which matches the course label.
  function resolveCourseCategories(courseValue) {
    const ids = [];
    let parent = null;
    let child = null;
    if (courseValue) {
      const catKey = courseValueToCategory[courseValue];
      const label = courseValueToLabel[courseValue] || '';
      parent = (catKey && catBySlug[catKey.toLowerCase()]) ||
        (catKey && catByName[prettifyCategory(catKey).toLowerCase()]) || null;
      child = catBySlug[String(courseValue).toLowerCase()] ||
        (label && catByName[label.toLowerCase()]) || null;
      if (child) ids.push(child.id);
      if (parent && (!child || parent.id !== child.id)) ids.push(parent.id);
    }
    return { ids, parent, child };
  }

  function categoryDisplayNames(ids) {
    const byId = {};
    for (const c of categoryCache) byId[c.id] = c;
    return (ids || [])
      .map((id) => byId[id] && decodeEntities(byId[id].name))
      .filter(Boolean);
  }

  function updateCategoryLine() {
    const line = $('evCatLine');
    const courseValue = $('evCourse').value;
    let names = [];
    if (courseValue) {
      const { parent, child } = resolveCourseCategories(courseValue);
      if (parent) names.push(decodeEntities(parent.name));
      if (child) names.push(decodeEntities(child.name));
      if (!names.length) {
        line.textContent = 'No matching site category, so the class will not be filed under one.';
        line.classList.remove('hidden');
        return;
      }
    } else {
      // Edit mode with no course change: show the event's existing categories.
      names = categoryDisplayNames(modalCategoryIds);
      if (!names.length) {
        line.classList.add('hidden');
        return;
      }
    }
    line.textContent = `Filed under: ${names.join(' › ')}`;
    line.classList.remove('hidden');
  }

  // Match an existing event back to a course in the picker: first by exact
  // title vs course label (the picker fills the title from the course, so
  // the common case matches), then by the event's own categories (a child
  // category whose slug is a known course value). Returns the course value
  // or '' when nothing matches.
  function matchCourseForEvent(event) {
    const title = String((event && event.title) || '').trim().toLowerCase();
    if (title) {
      for (const opt of $('evCourse').options) {
        if (opt.value && opt.textContent.trim().toLowerCase() === title) return opt.value;
      }
    }
    for (const id of (event && event.categoryIds) || []) {
      const cat = categoryCache.find((c) => c && c.id === id);
      const slug = cat && cat.slug ? String(cat.slug).toLowerCase() : '';
      if (slug && courseValueToCategory[slug]) return slug;
    }
    return '';
  }

  // Preset course description (adapted from the site's training-courses
  // outlines). Fills the editor's description box when it is empty — staff
  // can edit or clear it before saving; an existing description is never
  // clobbered. This also repairs old barren events: opening one whose
  // course is recognized fills in the preset on save.
  function prefillDescription(courseValue) {
    const preset = courseValue && courseValueToDescription[courseValue];
    if (!preset) return;
    const box = $('evDesc');
    if (box && !box.value.trim()) box.value = preset;
  }

  /* ---------------- course palette ---------------- */

  function prettifyCategory(key) {
    return key
      .split('-')
      .map((w) => (w === 'ohs' ? 'OH&S' : w === 'nl' ? 'NL' : w[0].toUpperCase() + w.slice(1)))
      .join(' ');
  }

  function buildPalette() {
    const groups = $('paletteGroups');
    groups.innerHTML = '';
    for (const [catKey, courses] of Object.entries(S.titlesByCategory)) {
      const group = document.createElement('div');
      group.className = 'pal-group';
      group.dataset.group = prettifyCategory(catKey);
      const title = document.createElement('p');
      title.className = 'pal-group-title';
      title.textContent = prettifyCategory(catKey);
      group.appendChild(title);
      for (const course of courses) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pal-chip';
        chip.textContent = course.label;
        chip.draggable = true;
        chip.dataset.label = course.label.toLowerCase();
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(
            'text/plain',
            JSON.stringify({ kind: 'course', label: course.label, value: course.value, category: catKey })
          );
          e.dataTransfer.effectAllowed = 'copy';
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
        chip.addEventListener('click', () => {
          toast('Drag the course onto a calendar day — or click a day to schedule from a list.', 'info', 4000);
        });
        group.appendChild(chip);
      }
      groups.appendChild(group);
    }
  }

  $('paletteSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#paletteGroups .pal-group').forEach((group) => {
      let visible = 0;
      group.querySelectorAll('.pal-chip').forEach((chip) => {
        const show = !q || chip.dataset.label.includes(q);
        chip.style.display = show ? '' : 'none';
        if (show) visible += 1;
      });
      group.style.display = visible ? '' : 'none';
    });
  });

  /* ---------------- calendar grid ---------------- */

  // Monday-first 6x7 grid covering viewYear/viewMonth.
  function visibleRange() {
    const first = new Date(viewYear, viewMonth, 1);
    // JS: 0=Sun..6=Sat -> Monday-first offset of the 1st
    const lead = (first.getDay() + 6) % 7;
    const start = addDays(fmtDate(viewYear, viewMonth + 1, 1), -lead);
    const end = addDays(start, 41);
    const days = [];
    for (let i = 0; i < 42; i += 1) days.push(addDays(start, i));
    return { start, end, days };
  }

  // The legacy API is inconsistent: an event's `venue` comes back as a single
  // object while `organizer` comes back as an array. Tolerate both shapes.
  function firstRef(value) {
    if (Array.isArray(value)) return value[0] || null;
    if (value && typeof value === 'object') return value;
    return null;
  }

  // Titles (and venue/organizer names) arrive with HTML entities, e.g.
  // "WPNL &#8211; Fall Protection (Day 2)". Decode them for display; the
  // decoded characters round-trip through WordPress fine on save.
  const entityDecoder = document.createElement('textarea');
  function decodeEntities(str) {
    entityDecoder.innerHTML = String(str || '');
    return entityDecoder.value;
  }

  function normalizeEvent(raw) {
    const start = splitStamp(raw.start_date);
    const end = splitStamp(raw.end_date || raw.start_date);
    const venueObj = firstRef(raw.venue);
    const orgObj = firstRef(raw.organizer);
    return {
      id: raw.id,
      title: decodeEntities(raw.title) || '(untitled)',
      startDate: start.date,
      endDate: end.date,
      startTime: start.time.slice(0, 5),
      endTime: end.time.slice(0, 5),
      startStamp: `${start.date} ${start.time}`,
      endStamp: `${end.date} ${end.time}`,
      allDay: Boolean(raw.all_day),
      status: raw.status || 'publish',
      venueId: venueObj ? venueObj.id : null,
      venueName: venueObj ? decodeEntities(venueObj.venue || venueObj.name) : '',
      organizerId: orgObj ? orgObj.id : null,
      organizerName: orgObj ? decodeEntities(orgObj.organizer || orgObj.name) : '',
      cost: (raw.cost === null || raw.cost === undefined) ? '' : raw.cost,
      seats: (raw.easy_seats === null || raw.easy_seats === undefined) ? '' : raw.easy_seats,
      description: raw.description || '',
      categoryIds: Array.isArray(raw.categories)
        ? raw.categories.map((c) => c && c.id).filter(Boolean)
        : [],
    };
  }

  function renderGrid() {
    const { days } = visibleRange();
    $('schedMonthTitle').textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    const grid = $('schedGrid');
    grid.innerHTML = '';
    const today = todayStr();

    // Index events by day (multi-day classes appear on every day they span).
    const byDay = {};
    for (const ev of monthEvents) {
      for (let d = ev.startDate; d <= ev.endDate; d = addDays(d, 1)) {
        (byDay[d] = byDay[d] || []).push(ev);
      }
    }

    for (const day of days) {
      const cell = document.createElement('div');
      cell.className = 'sched-day';
      cell.dataset.date = day;
      const [, m, d] = day.split('-').map(Number);
      if (m !== viewMonth + 1) cell.classList.add('other-month');
      if (day === today) cell.classList.add('today');

      const num = document.createElement('span');
      num.className = 'sched-day-num';
      num.textContent = String(d);
      cell.appendChild(num);

      const list = document.createElement('div');
      list.className = 'ev-list';
      const evs = (byDay[day] || []).slice().sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return stampToMinutes(a.startStamp) - stampToMinutes(b.startStamp);
      });
      const MAX = 5;
      evs.slice(0, MAX).forEach((ev) => list.appendChild(eventChip(ev, day, evs.length)));
      if (evs.length > MAX) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ev-more';
        more.textContent = `+${evs.length - MAX} more`;
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          const lines = evs
            .map((ev) => `${ev.allDay ? 'All day' : ev.startTime} — ${ev.title}${ev.venueName ? ` @ ${ev.venueName}` : ''}`)
            .join('\n');
          schedConfirm(`${day}: ${evs.length} classes`, lines, 'Close');
        });
        list.appendChild(more);
      }
      cell.appendChild(list);

      // Click an empty day -> schedule from the course list.
      cell.addEventListener('click', () => {
        if (readOnly) {
          toast('Your WordPress account cannot publish events, so scheduling is disabled.', 'error');
          return;
        }
        openEventModal({ date: day });
      });

      // Drag & drop: course from the palette, or an existing class to move.
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        cell.classList.add('drop-target');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-target');
        if (readOnly) {
          toast('Your WordPress account cannot publish events, so scheduling is disabled.', 'error');
          return;
        }
        let data = null;
        try {
          data = JSON.parse(e.dataTransfer.getData('text/plain'));
        } catch {
          return;
        }
        if (!data) return;
        if (data.kind === 'course') {
          openEventModal({ date: day, courseLabel: data.label, courseValue: data.value });
        } else if (data.kind === 'move' && data.id) {
          moveEvent(data.id, data.fromDate, day);
        }
      });

      grid.appendChild(cell);
    }
  }

  function eventChip(ev, day, dayCount) {
    const chip = document.createElement('div');
    chip.className = 'ev-chip';
    if (ev.allDay) chip.classList.add('ev-allday');
    if (ev.status !== 'publish') chip.classList.add('ev-draft');
    if (day > ev.startDate) chip.classList.add('ev-continue');
    // On days with more than one class, show the venue so staff can tell
    // "which room is which" at a glance. Chips ellipsis on overflow.
    const venueTag = dayCount > 1 && ev.venueName ? ` @ ${ev.venueName}` : '';
    chip.textContent = ev.allDay ? ev.title + venueTag : `${ev.startTime} ${ev.title}${venueTag}`;
    chip.title = [
      ev.title,
      ev.allDay ? 'All day' : `${ev.startTime}–${ev.endTime}`,
      ev.venueName ? `@ ${ev.venueName}` : '',
      ev.status !== 'publish' ? `(${ev.status})` : '',
    ].filter(Boolean).join(' ');
    chip.draggable = !readOnly;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventModal({ event: ev });
    });
    chip.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'move', id: ev.id, fromDate: day }));
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    return chip;
  }

  /* ---------------- loading ---------------- */

  async function refreshMonth() {
    if (!schedInitialized) return;
    // Guard against rapid Prev/Next: a slow earlier fetch resolving last
    // must not paint the wrong month's classes under the new month's title.
    const token = ++monthToken;
    const { start, end } = visibleRange();
    $('schedLoading').classList.remove('hidden');
    $('schedError').classList.add('hidden');
    try {
      const res = await api().listEvents(start, end);
      if (token !== monthToken) return;
      if (!res.ok) throw new Error(res.error || 'Could not load classes.');
      monthEvents = res.events.map(normalizeEvent);
      $('schedCount').textContent = `${monthEvents.length} class${monthEvents.length === 1 ? '' : 'es'}`;
    } catch (err) {
      if (token !== monthToken) return;
      $('schedError').textContent = err.message;
      $('schedError').classList.remove('hidden');
      monthEvents = [];
      $('schedCount').textContent = '';
    } finally {
      if (token !== monthToken) return;
      $('schedLoading').classList.add('hidden');
      renderGrid();
    }
  }

  $('schedPrev').addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    refreshMonth();
  });
  $('schedNext').addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    refreshMonth();
  });
  $('schedToday').addEventListener('click', () => {
    const n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    refreshMonth();
  });

  /* ---------------- move an existing class ---------------- */

  function shiftStamp(stamp, deltaDays) {
    const { date, time } = splitStamp(stamp);
    return `${addDays(date, deltaDays)} ${time}`;
  }

  async function moveEvent(id, fromDate, toDate) {
    if (fromDate === toDate) return;
    const found = monthEvents.find((e) => e.id === id);
    if (!found) {
      toast('Could not find that class to move it.', 'error');
      return;
    }
    const delta = Math.round(
      (dateToUtcNoon(toDate) - dateToUtcNoon(fromDate)) / 86400000
    );
    const yes = await schedConfirm(
      'Move class?',
      `"${found.title}" moves from ${fromDate} to ${toDate}. The times stay the same.`,
      'Move it'
    );
    if (!yes) return;
    try {
      const res = await api().updateEvent(id, {
        start_date: shiftStamp(found.startStamp, delta),
        end_date: shiftStamp(found.endStamp, delta),
      });
      if (!res.ok) throw new Error(res.error || 'Move failed.');
      toast(`Moved to ${toDate}.`, 'success');
      refreshMonth();
    } catch (err) {
      toast(`Could not move the class: ${err.message}`, 'error', 8000);
    }
  }

  /* ---------------- class editor modal ---------------- */

  function buildCourseOptions() {
    const sel = $('evCourse');
    sel.innerHTML = '<option value="">Pick a course&hellip;</option>';
    for (const [catKey, courses] of Object.entries(S.titlesByCategory)) {
      const group = document.createElement('optgroup');
      group.label = prettifyCategory(catKey);
      for (const course of courses) {
        const opt = document.createElement('option');
        opt.value = course.value;
        opt.textContent = course.label;
        group.appendChild(opt);
      }
      sel.appendChild(group);
    }
  }

  function fillVenueSelect(venues, selectedId) {
    const sel = $('evVenue');
    sel.innerHTML = '<option value="">No location set</option>';
    venues.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = v.name;
      if (selectedId && String(v.id) === String(selectedId)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function fillOrganizerSelect(organizers, selectedId) {
    const sel = $('evOrganizer');
    sel.innerHTML = '<option value="">No instructor set</option>';
    organizers.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = String(o.id);
      opt.textContent = o.name;
      if (selectedId && String(o.id) === String(selectedId)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function venueDisplayName(raw) {
    return decodeEntities(raw.venue || raw.name) || `Location #${raw.id}`;
  }

  function organizerDisplayName(raw) {
    return decodeEntities(raw.organizer || raw.name) || `Instructor #${raw.id}`;
  }

  async function ensureReferenceData() {
    if (venueCache.length === 0) {
      try {
        const res = await api().listVenues();
        if (res.ok) venueCache = res.venues.map((v) => ({ id: v.id, name: venueDisplayName(v) }));
      } catch (err) {
        console.error('Could not load venues:', err);
      }
    }
    if (organizerCache.length === 0) {
      try {
        const res = await api().listOrganizers();
        if (res.ok) organizerCache = res.organizers.map((o) => ({ id: o.id, name: organizerDisplayName(o) }));
      } catch (err) {
        console.error('Could not load organizers:', err);
      }
    }
    if (categoryCache.length === 0) {
      try {
        const res = await api().listCategories();
        if (res.ok) {
          categoryCache = res.categories;
          catBySlug = {};
          catByName = {};
          for (const c of categoryCache) {
            if (c && c.slug) catBySlug[String(c.slug).toLowerCase()] = c;
            if (c && c.name) catByName[decodeEntities(c.name).toLowerCase()] = c;
          }
        }
      } catch (err) {
        console.error('Could not load categories:', err);
      }
    }
  }

  function resetModal() {
    editingId = null;
    editingEvent = null;
    $('evSaleState').classList.add('hidden');
    $('evSaleState').textContent = '';
    modalCategoryIds = [];
    $('evCatLine').classList.add('hidden');
    $('eventModalTitle').textContent = 'Schedule class';
    $('eventModalError').classList.add('hidden');
    $('evTitle').value = '';
    $('evCourse').value = '';
    $('evDate').value = '';
    $('evEndDate').value = '';
    $('evStartTime').value = '09:00';
    $('evEndTime').value = '17:00';
    $('evAllDay').checked = false;
    $('evAllDay').dispatchEvent(new Event('change'));
    $('evVenue').value = '';
    $('evOrganizer').value = '';
    $('evVenueForm').classList.add('hidden');
    $('evOrgForm').classList.add('hidden');
    ['evVenueName', 'evVenueAddress', 'evVenueCity', 'evVenuePostal', 'evVenuePhone'].forEach((id) => { $(id).value = ''; });
    $('evVenueProvince').value = 'NL';
    ['evOrgName', 'evOrgEmail', 'evOrgPhone'].forEach((id) => { $(id).value = ''; });
    $('evCost').value = '';
    $('evSeats').value = '';
    $('evStatus').value = 'publish';
    $('evDesc').value = '';
    $('evDelete').classList.add('hidden');
    $('evStudents').classList.add('hidden');
  }

  async function openEventModal({ date, courseLabel, courseValue, event } = {}) {
    // Reference data loads at init, but a transient failure there left the
    // editor's dropdowns empty for the whole session. Retry here so opening
    // the editor heals itself (ensureReferenceData skips caches already filled).
    if (!venueCache.length || !organizerCache.length || !categoryCache.length) {
      await ensureReferenceData();
      fillVenueSelect(venueCache, null);
      fillOrganizerSelect(organizerCache, null);
    }
    resetModal();
    if (event) {
      // Edit mode: keep the event's existing categories unless the course changes.
      editingId = event.id;
      editingEvent = event;
      modalCategoryIds = (event.categoryIds || []).slice();
      $('eventModalTitle').textContent = 'Edit class';
      $('evTitle').value = event.title;
      $('evDate').value = event.startDate;
      $('evEndDate').value = event.endDate;
      $('evStartTime').value = event.startTime;
      $('evEndTime').value = event.endTime;
      $('evAllDay').checked = event.allDay;
      $('evAllDay').dispatchEvent(new Event('change'));
      $('evVenue').value = event.venueId ? String(event.venueId) : '';
      $('evOrganizer').value = event.organizerId ? String(event.organizerId) : '';
      $('evCost').value = (event.cost === null || event.cost === undefined) ? '' : event.cost;
      $('evSeats').value = (event.seats === '' || event.seats === null || event.seats === undefined) ? '' : event.seats;
      $('evStatus').value = event.status === 'draft' ? 'draft' : 'publish';
      $('evDesc').value = event.description || '';
      $('evDelete').classList.remove('hidden');
      // The roster manager needs a saved class to attach students to, so
      // the Students button only appears when editing (never for a new
      // class) and never in read-only mode.
      if (!readOnly) $('evStudents').classList.remove('hidden');
      // Show whether this class actually sells seats online, so Cost/Seats
      // are never a silent no-op. New classes have nothing linked yet.
      loadSaleState(event.id);
      // Pre-select the course when the event matches one, so the picker
      // isn't blank on drafts created from a course. Categories are
      // recomputed from the matched course — the "Filed under" line shows
      // what a save will file, which also repairs events that were saved
      // with only the parent category. When nothing matches, the event's
      // existing categories are kept as before.
      const matchedCourse = matchCourseForEvent(event);
      if (matchedCourse) {
        $('evCourse').value = matchedCourse;
        // Merge the course's categories with the event's existing ones so
        // manually-added site categories are never silently dropped.
        const merged = new Set();
        for (const id of (event.categoryIds || [])) merged.add(Number(id));
        for (const id of resolveCourseCategories(matchedCourse).ids) merged.add(Number(id));
        modalCategoryIds = [...merged].filter((id) => id);
      }
      updateCategoryLine();
    } else {
      if (date) {
        $('evDate').value = date;
        $('evEndDate').value = date;
      }
      if (courseLabel) {
        $('evTitle').value = courseLabel;
        if (courseValue) {
          $('evCourse').value = courseValue;
        } else {
          const opt = Array.from($('evCourse').options).find((o) => o.textContent === courseLabel);
          if (opt) $('evCourse').value = opt.value;
        }
        const resolved = resolveCourseCategories($('evCourse').value);
        modalCategoryIds = resolved.ids;
        updateCategoryLine();
      }
    }
    // Prefill the preset course description when the box is empty (new
    // class from a course, or an older event whose description was never
    // filled in). Existing descriptions are left alone.
    prefillDescription($('evCourse').value);
    $('eventModal').classList.remove('hidden');
    setTimeout(() => $('evTitle').focus(), 50);
  }

  function closeEventModal() {
    $('eventModal').classList.add('hidden');
  }

  $('evCourse').addEventListener('change', (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    if (opt && opt.value) {
      $('evTitle').value = opt.textContent;
      modalCategoryIds = resolveCourseCategories(opt.value).ids;
      prefillDescription(opt.value);
    } else {
      modalCategoryIds = [];
    }
    updateCategoryLine();
  });

  $('evDate').addEventListener('change', () => {
    if ($('evDate').value && (!$('evEndDate').value || $('evEndDate').value < $('evDate').value)) {
      $('evEndDate').value = $('evDate').value;
    }
  });

  $('evAllDay').addEventListener('change', (e) => {
    const allDay = e.target.checked;
    $('evStartTime').disabled = allDay;
    $('evEndTime').disabled = allDay;
  });

  $('evNewVenueBtn').addEventListener('click', () => {
    $('evVenueForm').classList.toggle('hidden');
  });

  $('evNewOrgBtn').addEventListener('click', () => {
    $('evOrgForm').classList.toggle('hidden');
  });

  $('evCancel').addEventListener('click', closeEventModal);

  // Opens the student roster manager for the class being edited. The
  // roster module (roster.js) owns the modal; schedule.js just hands it
  // the current class id, title, and date.
  $('evStudents').addEventListener('click', () => {
    if (!editingId || !window.EasyRoster) {
      toast('The student list could not be opened. Try reloading the app.', 'error');
      return;
    }
    window.EasyRoster.open({
      id: editingId,
      title: $('evTitle').value.trim() || '(untitled)',
      date: $('evDate').value,
    });
  });

  $('evDelete').addEventListener('click', async () => {
    if (!editingId) return;
    const yes = await schedConfirm(
      'Delete this class?',
      'The class is moved to the trash on the website (you can restore it from the trash there if you change your mind). This cannot be undone from here. Classes with sold seats cannot be deleted.',
      'Delete'
    );
    if (!yes) return;
    try {
      const res = await api().deleteEvent(editingId);
      if (!res.ok) throw new Error(res.error || 'Delete failed.');
      toast('Class deleted.', 'success');
      closeEventModal();
      refreshMonth();
    } catch (err) {
      toast(`Could not delete the class: ${err.message}`, 'error', 8000);
    }
  });

  function modalError(message) {
    const el = $('eventModalError');
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  $('evSave').addEventListener('click', async () => {
    modalError(null);
    const title = $('evTitle').value.trim();
    const date = $('evDate').value;
    const endDate = $('evEndDate').value || date;
    const allDay = $('evAllDay').checked;

    if (!title) { modalError('Give the class a title.'); $('evTitle').focus(); return; }
    if (!date) { modalError('Pick a date for the class.'); $('evDate').focus(); return; }
    if (endDate < date) { modalError('The end date cannot be before the start date.'); return; }

    const saveBtn = $('evSave');
    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';

    try {
      // New location / instructor first, so the class can reference them.
      let venueId = $('evVenue').value || null;
      if ($('evVenueName').value.trim()) {
        const res = await api().createVenue({
          venue: $('evVenueName').value.trim(),
          address: $('evVenueAddress').value.trim(),
          city: $('evVenueCity').value.trim(),
          province: $('evVenueProvince').value.trim(),
          zip: $('evVenuePostal').value.trim(),
          phone: $('evVenuePhone').value.trim(),
        });
        if (!res.ok) throw new Error(res.error || 'Could not create the location.');
        venueId = res.venue.id;
        venueCache.push({ id: venueId, name: venueDisplayName(res.venue) });
        fillVenueSelect(venueCache, venueId);
      }

      let organizerId = $('evOrganizer').value || null;
      if ($('evOrgName').value.trim()) {
        const res = await api().createOrganizer({
          organizer: $('evOrgName').value.trim(),
          email: $('evOrgEmail').value.trim(),
          phone: $('evOrgPhone').value.trim(),
        });
        if (!res.ok) throw new Error(res.error || 'Could not create the instructor.');
        organizerId = res.organizer.id;
        organizerCache.push({ id: organizerId, name: organizerDisplayName(res.organizer) });
        fillOrganizerSelect(organizerCache, organizerId);
      }

      const payload = {
        title,
        start_date: `${date} ${allDay ? '00:00:00' : `${$('evStartTime').value || '09:00'}:00`}`,
        end_date: `${endDate} ${allDay ? '23:59:59' : `${$('evEndTime').value || '17:00'}:00`}`,
        all_day: allDay,
        status: $('evStatus').value,
      };
      // Omit blank optionals: this TEC version rejects empty strings for
      // some fields (e.g. description) as invalid parameters, while absent
      // fields are perfectly fine.
      const desc = $('evDesc').value.trim();
      if (desc) payload.description = desc;
      // TEC quirk (verified in plugin source): Single_Venue::insert() only links
      // an existing venue for a BARE integer ("venue": 128) or {"id": 128}.
      // An array like [128] falls through to a create-new-venue path and fails
      // with "could not be created". Single_Organizer overrides insert() to loop,
      // so the organizer array IS fine — hence the asymmetry.
      if (venueId) payload.venue = Number(venueId);
      if (organizerId) payload.organizer = [Number(organizerId)];
      const cost = $('evCost').value.trim();
      if (cost) payload.cost = cost;
      const seatsRaw = $('evSeats').value.trim();
      if (seatsRaw !== '') {
        payload.easy_seats = Math.max(0, parseInt(seatsRaw, 10) || 0);
      } else if (editingId && editingEvent && editingEvent.seats !== '' && editingEvent.seats != null) {
        // The class had a capacity and it was cleared: unset it on the site
        // (empty string = delete). A field left empty from the start means
        // "don't touch", so a never-set capacity is never wiped by accident.
        payload.easy_seats = '';
      }
      if (modalCategoryIds.length) payload.categories = modalCategoryIds.slice();

      let res;
      if (editingId) {
        res = await api().updateEvent(editingId, payload);
      } else {
        res = await api().createEvent(payload);
      }
      if (!res.ok) throw new Error(res.error || 'Could not save the class.');

      toast(editingId ? 'Class updated.' : 'Class scheduled.', 'success');
      closeEventModal();
      // Jump the calendar to the class's month so the new/updated class is
      // actually visible instead of silently landing off-screen.
      const [sy, sm] = $('evDate').value.split('-').map(Number);
      if (sy && sm) {
        viewYear = sy;
        viewMonth = sm - 1;
      }
      refreshMonth();
    } catch (err) {
      modalError(err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  });

  /* ---------------- online sale state ---------------- */

  // One line under Cost/Seats: is this class actually sellable online, and
  // at what price? Silent when the site can't answer (offline, old plugin).
  async function loadSaleState(id) {
    const el = $('evSaleState');
    el.classList.add('hidden');
    el.textContent = '';
    if (!id || !api().getSaleState) return;
    try {
      const res = await api().getSaleState(id);
      if (!res.ok || !res.state) return;
      // Don't paint a stale response over a newer modal.
      if (id !== editingId) return;
      const s = res.state;
      let text;
      if (!s.linked) {
        text = 'Not selling online. Create the seat product on the website to sell seats for this class.';
      } else if (s.product_status && s.product_status !== 'publish') {
        text = `Seat sales paused (product is ${s.product_status}).`;
      } else {
        const price = s.price !== null && s.price !== undefined && s.price !== '' ? `$${s.price}` : 'price not set';
        const stock = s.stock !== null && s.stock !== undefined ? `${s.stock} seat${s.stock === 1 ? '' : 's'} left` : 'stock not tracked';
        const sold = s.sold ? ` · ${s.sold} sold` : '';
        text = `Sells online: ${price} · ${stock}${sold}.`;
      }
      el.textContent = text;
      el.classList.remove('hidden');
    } catch (err) {
      // Leave it hidden; the fields still work.
    }
  }

  /* ---------------- init ---------------- */

  async function initSchedule() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();

    buildPalette();
    buildCourseOptions();
    renderGrid();

    // Which site clock are class times on?
    try {
      const info = await api().siteInfo();
      if (info.ok && info.timezone) {
        $('schedTz').textContent = `Class times are in site time (${info.timezone}).`;
      }
    } catch (err) {
      console.error('Could not read site info:', err);
    }

    // Can this account publish events? Probe before enabling the UI.
    try {
      const probe = await api().probe();
      if (!probe.ok) {
        $('schedError').textContent = probe.error || 'Could not check event permissions.';
        $('schedError').classList.remove('hidden');
        readOnly = true;
      } else if (!probe.canWrite) {
        readOnly = true;
        const banner = $('schedPermBanner');
        banner.textContent =
          'This WordPress account can view classes but cannot publish them. ' +
          'An admin needs to grant it event publishing rights (edit_tribe_events / publish_tribe_events) — ' +
          'scheduling is disabled until then.';
        banner.classList.remove('hidden');
      }
    } catch (err) {
      $('schedError').textContent = `Could not check event permissions: ${err.message}`;
      $('schedError').classList.remove('hidden');
      readOnly = true;
    }

    if (!readOnly) {
      // Reference data for the editor; loaded lazily on first use if this fails.
      await ensureReferenceData();
      fillVenueSelect(venueCache, null);
      fillOrganizerSelect(organizerCache, null);
    }

    refreshMonth();
  }

  // Shared with the Classes approval queue (Approvals tab): editing a draft
  // and jumping the calendar to it. Ensures the schedule module is
  // initialized first so the editor's reference data exists.
  async function ensureInit() {
    if (!schedInitialized) {
      schedInitialized = true;
      await initSchedule();
    }
  }

  window.EasySchedule = {
    normalizeEvent,
    confirm: schedConfirm,
    refreshCalendar() { if (schedInitialized) refreshMonth(); },
    async editEvent(ev) {
      await ensureInit();
      openEventModal({ event: ev });
    },
    async gotoDate(dateStr) {
      await ensureInit();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
      if (m) {
        viewYear = parseInt(m[1], 10);
        viewMonth = parseInt(m[2], 10) - 1;
      }
      window.EasyViews.showView('schedule');
      refreshMonth();
    },
  };

})();
