// schedule.js: the Schedule tab: a month calendar of classes with
// full create, edit, publish, and delete, mirroring the desktop app's
// Schedule screen and its TEC REST contract (see api.js). A class
// created here is filed exactly the way the desktop files it.
//
// Publishing is verified on the server (api.saveEvent re-reads the
// event), and every publish, unpublish, and delete asks first with a
// confirmation that spells out what will happen on the website.
//
// The tab also holds each instructor's calendar subscription link
// (read from EASY Suite, with a copy button). Resetting a link stays
// in EASY Suite under Calendar feeds; this app never regenerates one.
//
// When the signed-in account cannot write events (checked with the
// same empty-POST probe the desktop uses), the tab stays viewable and
// the editor opens read only.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const state = {
    viewYear: 0,
    viewMonth: 0,
    selectedDay: '',
    monthEvents: [],
    monthKey: '',
    canWrite: null,
    venues: [],
    organizers: [],
    categories: [],
    listsReady: { venues: false, organizers: false, categories: false },
    editing: null,
    editCategories: undefined,
    feedsState: 'idle',
    tzLoaded: false,
  };

  function monthKey() {
    return state.viewYear + '-' + state.viewMonth;
  }

  // Monday-first 6 by 7 grid covering the viewed month, the same
  // range the desktop calendar shows.
  function monthRange() {
    const first = new Date(state.viewYear, state.viewMonth, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = U.addDays(U.fmtYmd(first), -lead);
    const end = U.addDays(start, 41);
    const days = [];
    for (let i = 0; i < 42; i += 1) days.push(U.addDays(start, i));
    return { start, end, days };
  }

  function eventsForDay(ymd) {
    return state.monthEvents
      .filter((ev) => ev.startDate <= ymd && ymd <= ev.endDate)
      .slice()
      .sort((a, b) => (a.startStamp < b.startStamp ? -1 : 1));
  }

  function showError(text) {
    const node = $('schedError');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
  }

  /* ---------------- calendar ---------------- */

  function renderGrid() {
    const title = $('schedMonthTitle');
    if (title) title.textContent = MONTHS[state.viewMonth] + ' ' + state.viewYear;
    const grid = $('schedGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const range = monthRange();
    const today = U.todayYmd();
    for (const ymd of range.days) {
      const cell = U.el('button', 'cal-cell');
      cell.type = 'button';
      const parts = ymd.split('-').map(Number);
      if (parts[1] - 1 !== state.viewMonth) cell.classList.add('cal-other');
      if (ymd === today) cell.classList.add('cal-today');
      if (ymd === state.selectedDay) cell.classList.add('cal-selected');
      cell.appendChild(U.el('span', 'cal-daynum', String(parts[2])));
      const dayEvents = eventsForDay(ymd);
      if (dayEvents.length) {
        const dots = U.el('span', 'cal-dots');
        for (const ev of dayEvents.slice(0, 3)) {
          const dot = U.el('span', 'cal-dot');
          if (ev.status !== 'publish') dot.classList.add('cal-dot-draft');
          dots.appendChild(dot);
        }
        if (dayEvents.length > 3) {
          dots.appendChild(U.el('span', 'cal-more', '+' + (dayEvents.length - 3)));
        }
        cell.appendChild(dots);
      }
      cell.addEventListener('click', () => {
        state.selectedDay = ymd;
        renderGrid();
        renderDayList();
      });
      grid.appendChild(cell);
    }
  }

  function renderDayList() {
    const box = $('schedDayList');
    if (!box) return;
    const label = $('schedDayTitle');
    if (label) label.textContent = state.selectedDay ? U.fmtDateLoose(state.selectedDay) : '';
    box.innerHTML = '';
    const events = state.selectedDay ? eventsForDay(state.selectedDay) : [];
    if (!events.length) {
      box.appendChild(U.el('p', 'hint', 'No classes on this day.'));
      return;
    }
    for (const ev of events) {
      const card = U.el('div', 'card card-clickable');
      const head = U.el('div', 'card-head-row');
      head.appendChild(U.el('span', 'card-title', ev.title));
      if (ev.status !== 'publish') head.appendChild(U.el('span', 'chip chip-draft', 'Draft'));
      card.appendChild(head);
      const meta = [
        ev.allDay ? 'All day' : ev.startTime + ' to ' + ev.endTime,
        ev.venueName ? 'at ' + ev.venueName : '',
        ev.organizerName || '',
        ev.seats !== '' && ev.seats !== null && ev.seats !== undefined ? ev.seats + ' seats' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (meta) card.appendChild(U.el('div', 'card-meta', meta));
      if (ev.startDate !== ev.endDate) {
        card.appendChild(U.el('div', 'card-meta', 'Runs ' + ev.startDate + ' to ' + ev.endDate));
      }
      card.addEventListener('click', () => openEditor(ev));
      box.appendChild(card);
    }
  }

  async function loadMonth() {
    const key = monthKey();
    state.monthKey = key;
    const range = monthRange();
    try {
      const events = await window.EasyApi.eventsInRangeFull(
        range.start,
        U.addDays(range.end, 1)
      );
      if (state.monthKey !== key) return;
      state.monthEvents = events;
      showError('');
      window.EasyStore.setLastGood('schedule', { monthKey: key, events }).catch(() => {});
      renderGrid();
      renderDayList();
    } catch (e) {
      if (state.monthKey !== key) return;
      showError('Could not load classes for this month: ' + e.message);
    }
  }

  function shiftMonth(delta) {
    const d = new Date(state.viewYear, state.viewMonth + delta, 1);
    state.viewYear = d.getFullYear();
    state.viewMonth = d.getMonth();
    const range = monthRange();
    if (state.selectedDay < range.start || state.selectedDay > range.end) {
      state.selectedDay = U.fmtYmd(new Date(state.viewYear, state.viewMonth, 1));
    }
    showError('');
    renderGrid();
    renderDayList();
    loadMonth();
  }

  /* ---------------- permissions and site clock ---------------- */

  function applyWriteAccess() {
    const canWrite = state.canWrite === true;
    $('schedNewBtn').classList.toggle('hidden', !canWrite);
    const banner = $('schedPermBanner');
    banner.classList.toggle('hidden', state.canWrite !== false);
    if (state.canWrite === false) {
      banner.textContent =
        'This account can view the schedule but cannot create or change classes. ' +
        'Publishing classes needs an account with class publishing rights on the website.';
    }
  }

  async function probeOnce() {
    if (state.canWrite !== null) {
      applyWriteAccess();
      return;
    }
    try {
      state.canWrite = await window.EasyApi.probeEventWrite();
    } catch (e) {
      state.canWrite = false;
      showError('Could not check class permissions: ' + e.message);
    }
    applyWriteAccess();
  }

  async function loadTimezone() {
    if (state.tzLoaded) return;
    state.tzLoaded = true;
    try {
      const tz = await window.EasyApi.siteTimezone();
      if (tz) $('schedTz').textContent = 'Class times are site time (' + tz + ').';
    } catch (e) {
      // The line just stays generic; scheduling still works.
    }
  }

  /* ---------------- editor lists ---------------- */

  // Each list is marked ready only when its fetch actually succeeds,
  // so a list that failed (a weak connection, a site hiccup) is
  // retried the next time the editor opens instead of staying empty
  // for the whole session. The desktop editor heals itself the same
  // way when its reference data failed to load at startup.
  async function ensureLists() {
    const jobs = [];
    if (!state.listsReady.venues) {
      jobs.push(
        window.EasyApi.venuesList()
          .then((list) => {
            state.venues = list;
            state.listsReady.venues = true;
          })
          .catch(() => {})
      );
    }
    if (!state.listsReady.organizers) {
      jobs.push(
        window.EasyApi.organizersList()
          .then((list) => {
            state.organizers = list;
            state.listsReady.organizers = true;
          })
          .catch(() => {})
      );
    }
    if (!state.listsReady.categories) {
      jobs.push(
        window.EasyApi.categoriesList()
          .then((list) => {
            state.categories = list;
            state.listsReady.categories = true;
          })
          .catch(() => {})
      );
    }
    await Promise.all(jobs);
  }

  function categoryName(id) {
    const cat = state.categories.find((c) => Number(c.id) === Number(id));
    return cat ? cat.name : '';
  }

  // The course picker is built from the site's own event categories:
  // a specific course (child category) files the class under itself
  // and its parent group, exactly how the desktop files it. A parent
  // group with no courses under it is itself a pickable course.
  function fillCourseSelect(ev) {
    const sel = $('evCourse');
    sel.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Custom title (type it below)';
    sel.appendChild(custom);
    const byId = new Map(state.categories.map((c) => [Number(c.id), c]));
    const childrenOf = new Map();
    for (const c of state.categories) {
      const parent = Number(c.parent) || 0;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(c);
    }
    const parents = (childrenOf.get(0) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const parent of parents) {
      const kids = (childrenOf.get(Number(parent.id)) || [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      if (kids.length) {
        const group = document.createElement('optgroup');
        group.label = parent.name;
        for (const kid of kids) {
          const opt = document.createElement('option');
          opt.value = 'c' + kid.id;
          opt.dataset.ids = JSON.stringify([Number(kid.id), Number(parent.id)]);
          opt.dataset.slug = kid.slug || '';
          opt.textContent = kid.name;
          group.appendChild(opt);
        }
        sel.appendChild(group);
      } else {
        const opt = document.createElement('option');
        opt.value = 'p' + parent.id;
        opt.dataset.ids = JSON.stringify([Number(parent.id)]);
        opt.dataset.slug = parent.slug || '';
        opt.textContent = parent.name;
        sel.appendChild(opt);
      }
    }
    // Categories whose parent is missing from the list still deserve
    // an option rather than vanishing.
    for (const c of state.categories) {
      const parent = Number(c.parent) || 0;
      if (parent && !byId.has(parent)) {
        const opt = document.createElement('option');
        opt.value = 'c' + c.id;
        opt.dataset.ids = JSON.stringify([Number(c.id), parent]);
        opt.dataset.slug = c.slug || '';
        opt.textContent = c.name;
        sel.appendChild(opt);
      }
    }
    // Preselect the course the class is already filed under, when
    // there is one. This only displays the match; the categories are
    // sent on save only if the picker is actually changed.
    if (ev && Array.isArray(ev.categoryIds) && ev.categoryIds.length) {
      const ids = ev.categoryIds.map(Number);
      let fallback = '';
      for (const opt of sel.options) {
        if (!opt.value) continue;
        const optIds = JSON.parse(opt.dataset.ids || '[]');
        if (opt.value.charAt(0) === 'c' && ids.includes(optIds[0])) {
          sel.value = opt.value;
          return;
        }
        if (opt.value.charAt(0) === 'p' && ids.includes(optIds[0])) fallback = opt.value;
      }
      if (fallback) sel.value = fallback;
    }
  }

  function updateCatLine() {
    const line = $('evCatLine');
    const ids = Array.isArray(state.editCategories)
      ? state.editCategories
      : state.editing && Array.isArray(state.editing.categoryIds)
        ? state.editing.categoryIds
        : [];
    const names = ids.map(categoryName).filter(Boolean);
    if (!names.length) {
      line.classList.add('hidden');
      line.textContent = '';
      return;
    }
    line.textContent = 'Filed under: ' + names.join(' › ');
    line.classList.remove('hidden');
  }

  // Preset course descriptions, mirroring the desktop editor: when a
  // course is picked (or the editor opens on a class), the course's
  // preset text goes into the description box, but only when the box
  // is empty. An existing description, and anything typed or edited,
  // is never replaced; clearing the box and picking a course again
  // fills the new course's preset. The course is identified by the
  // picked category's slug (the preset keys are the desktop catalog's
  // course values, which the site slugs match), falling back to the
  // course label, the same identity fallback the desktop uses when
  // it matches a class back to a course by title.
  function presetForSelection() {
    const presets = window.EasyCoursePresets;
    if (!presets) return '';
    const sel = $('evCourse');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return '';
    const bySlug = presets.descriptions[(opt.dataset.slug || '').toLowerCase()];
    if (bySlug) return bySlug;
    const key = presets.byLabel[(opt.textContent || '').trim().toLowerCase()];
    return key ? presets.descriptions[key] || '' : '';
  }

  function prefillDescription(fallbackTitle) {
    const box = $('evDesc');
    if (!box || box.value.trim()) return;
    let text = presetForSelection();
    if (!text && fallbackTitle) {
      // The editor opened on a class whose course the picker did not
      // resolve (no matching site category): the desktop still
      // repairs a barren description by matching the class title to a
      // course, so do the same for the description only. The picker
      // and the class's categories are left exactly as they were.
      const presets = window.EasyCoursePresets;
      if (presets) {
        const key = presets.byLabel[String(fallbackTitle).trim().toLowerCase()];
        if (key) text = presets.descriptions[key] || '';
      }
    }
    if (text) box.value = text;
  }

  function onCourseChange() {
    const sel = $('evCourse');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) {
      state.editCategories = undefined;
      updateCatLine();
      return;
    }
    state.editCategories = JSON.parse(opt.dataset.ids || '[]');
    if (opt.textContent) $('evTitle').value = opt.textContent;
    prefillDescription();
    updateCatLine();
  }

  function fillVenueSelect(selectedId) {
    const sel = $('evVenue');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No location set';
    sel.appendChild(none);
    for (const v of state.venues) {
      const opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = v.name;
      sel.appendChild(opt);
    }
    const add = document.createElement('option');
    add.value = '__new__';
    add.textContent = 'New location...';
    sel.appendChild(add);
    if (selectedId) sel.value = String(selectedId);
  }

  function fillOrganizerSelect(selectedId) {
    const sel = $('evInstructor');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No instructor set';
    sel.appendChild(none);
    for (const o of state.organizers) {
      const opt = document.createElement('option');
      opt.value = String(o.id);
      opt.textContent = o.name;
      sel.appendChild(opt);
    }
    const add = document.createElement('option');
    add.value = '__new__';
    add.textContent = 'New instructor...';
    sel.appendChild(add);
    if (selectedId) sel.value = String(selectedId);
  }

  /* ---------------- editor ---------------- */

  function formError(text) {
    const node = $('evFormError');
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
  }

  function setTimeWraps() {
    const allDay = $('evAllDay').checked;
    $('evStartTimeWrap').classList.toggle('hidden', allDay);
    $('evEndTimeWrap').classList.toggle('hidden', allDay);
  }

  function setStatusRadio(status) {
    for (const radio of document.querySelectorAll('input[name="evStatus"]')) {
      radio.checked = radio.value === status;
    }
  }

  function applyReadOnly() {
    const ro = state.canWrite !== true;
    for (const node of $('evForm').querySelectorAll('input, select, textarea')) {
      node.disabled = ro;
    }
    $('evSaveBtn').classList.toggle('hidden', ro);
    $('evDeleteBtn').classList.toggle('hidden', ro || !state.editing);
    if (ro) $('evEditorTitle').textContent = state.editing ? 'Class details' : 'New class';
  }

  function fillForm(ev) {
    fillCourseSelect(ev);
    state.editCategories = undefined;
    updateCatLine();
    $('evTitle').value = ev ? ev.title : '';
    $('evDesc').value = ev ? ev.description || '' : '';
    $('evStartDate').value = ev ? ev.startDate : state.selectedDay || U.todayYmd();
    $('evEndDate').value = ev ? ev.endDate : state.selectedDay || U.todayYmd();
    $('evStartTime').value = ev && !ev.allDay ? ev.startTime : '09:00';
    $('evEndTime').value = ev && !ev.allDay ? ev.endTime : '17:00';
    $('evAllDay').checked = ev ? Boolean(ev.allDay) : false;
    setTimeWraps();
    fillVenueSelect(ev ? ev.venueId : null);
    fillOrganizerSelect(ev ? ev.organizerId : null);
    $('evNewVenueBox').classList.add('hidden');
    $('evNewOrgBox').classList.add('hidden');
    $('evVenueName').value = '';
    $('evVenueAddress').value = '';
    $('evVenueCity').value = '';
    $('evVenueProvince').value = 'NL';
    $('evVenueZip').value = '';
    $('evVenuePhone').value = '';
    $('evOrgName').value = '';
    $('evOrgEmail').value = '';
    $('evOrgPhone').value = '';
    $('evCost').value = ev ? String(ev.cost || '') : '';
    $('evSeats').value = ev && ev.seats !== '' && ev.seats !== null && ev.seats !== undefined ? String(ev.seats) : '';
    setStatusRadio(ev && ev.status === 'publish' ? 'publish' : 'draft');
    // Same repair the desktop editor does on open: a class whose
    // course is recognized and whose description is empty gets the
    // course's preset text. Anything already written stays.
    prefillDescription(ev ? ev.title : '');
    const saleLine = $('evSaleLine');
    saleLine.classList.add('hidden');
    saleLine.textContent = '';
    if (ev) loadSaleLine(ev.id);
  }

  // One line under the seats field: is this class selling online, and
  // how is it doing? Same wording as the desktop editor.
  async function loadSaleLine(id) {
    const line = $('evSaleLine');
    try {
      const s = await window.EasyApi.saleState(id);
      if (!state.editing || state.editing.id !== id || !s || typeof s !== 'object') return;
      let text;
      if (!s.linked) {
        text = 'Not selling online. Create the seat product on the website to sell seats for this class.';
      } else if (s.product_status && s.product_status !== 'publish') {
        text = 'Seat sales paused (product is ' + s.product_status + ').';
      } else {
        const price =
          s.price !== null && s.price !== undefined && s.price !== ''
            ? '$' + s.price
            : 'price not set';
        const stock =
          s.stock !== null && s.stock !== undefined
            ? s.stock + (s.stock === 1 ? ' seat' : ' seats') + ' left'
            : 'stock not tracked';
        const sold = s.sold ? ' · ' + s.sold + ' sold' : '';
        text = 'Sells online: ' + price + ' · ' + stock + sold + '.';
      }
      line.textContent = text;
      line.classList.remove('hidden');
    } catch (e) {
      // Best effort only; the form still works without it.
    }
  }

  async function openEditor(ev) {
    state.editing = ev || null;
    $('scheduleMain').classList.add('hidden');
    $('classEditorView').classList.remove('hidden');
    if (window.EasyUi) window.EasyUi.openSubview(closeEditor);
    $('evEditorTitle').textContent = ev ? 'Edit class' : 'New class';
    formError(null);
    const saveBtn = $('evSaveBtn');
    saveBtn.disabled = true;
    try {
      await ensureLists();
    } catch (e) {
      // The selects keep their base options; saving still works.
    }
    fillForm(state.editing);
    saveBtn.disabled = false;
    applyReadOnly();
  }

  function closeEditor() {
    $('classEditorView').classList.add('hidden');
    $('scheduleMain').classList.remove('hidden');
    state.editing = null;
  }

  async function onSave(submitEv) {
    submitEv.preventDefault();
    formError(null);
    const title = $('evTitle').value.trim();
    const startDate = $('evStartDate').value;
    const endDate = $('evEndDate').value || startDate;
    const allDay = $('evAllDay').checked;
    if (!title) {
      formError('Give the class a title.');
      return;
    }
    if (!startDate) {
      formError('Pick a start date for the class.');
      return;
    }
    if (endDate < startDate) {
      formError('The end date cannot be before the start date.');
      return;
    }
    const startTime = $('evStartTime').value || '09:00';
    const endTime = $('evEndTime').value || '17:00';
    if (!allDay && startDate === endDate && endTime <= startTime) {
      formError('The end time must be after the start time for a class on one day.');
      return;
    }
    const checked = document.querySelector('input[name="evStatus"]:checked');
    const status = checked && checked.value === 'publish' ? 'publish' : 'draft';
    const wasPublished = !!(state.editing && state.editing.status === 'publish');
    const whenText = startDate === endDate ? 'on ' + startDate : 'starting ' + startDate;
    if (status === 'publish' && !wasPublished) {
      const yes = await window.EasyUi.confirm(
        'Publish this class?',
        '"' + title + '" ' + whenText + ' will go live on the website calendar for anyone ' +
          'to see. If a seat product is linked to it, seats can be sold online. ' +
          'You can move it back to a draft later.',
        'Publish'
      );
      if (!yes) return;
    } else if (status === 'draft' && wasPublished) {
      const yes = await window.EasyUi.confirm(
        'Move this class back to draft?',
        '"' + title + '" will stop showing on the website calendar. The class is not ' +
          'deleted, and you can publish it again later.',
        'Move to draft'
      );
      if (!yes) return;
    }
    const saveBtn = $('evSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      // A brand new location or instructor is created first, so the
      // class can reference it, the same order the desktop saves in.
      let venueId = null;
      const venueVal = $('evVenue').value;
      if (venueVal === '__new__') {
        const name = $('evVenueName').value.trim();
        if (!name) throw new Error('Give the new location a name, or pick an existing location.');
        const created = await window.EasyApi.createVenue({
          venue: name,
          address: $('evVenueAddress').value.trim(),
          city: $('evVenueCity').value.trim(),
          province: $('evVenueProvince').value.trim(),
          zip: $('evVenueZip').value.trim(),
          phone: $('evVenuePhone').value.trim(),
        });
        venueId = created.id;
        state.venues.push(created);
      } else if (venueVal) {
        venueId = Number(venueVal);
      }
      let organizerId = null;
      const orgVal = $('evInstructor').value;
      if (orgVal === '__new__') {
        const name = $('evOrgName').value.trim();
        if (!name) throw new Error('Give the new instructor a name, or pick an existing instructor.');
        const created = await window.EasyApi.createOrganizer({
          organizer: name,
          email: $('evOrgEmail').value.trim(),
          phone: $('evOrgPhone').value.trim(),
        });
        organizerId = created.id;
        state.organizers.push(created);
      } else if (orgVal) {
        organizerId = Number(orgVal);
      }
      const editingId = state.editing ? state.editing.id : null;
      const payload = window.EasyApi.buildEventPayload(
        {
          title,
          description: $('evDesc').value,
          startDate,
          startTime,
          endDate,
          endTime,
          allDay,
          venueId,
          organizerId,
          cost: $('evCost').value,
          seats: $('evSeats').value,
          status,
          categoryIds: state.editCategories,
        },
        {
          hadSeats: !!(
            state.editing &&
            state.editing.seats !== '' &&
            state.editing.seats !== null &&
            state.editing.seats !== undefined
          ),
        }
      );
      const saved = await window.EasyApi.saveEvent(editingId, payload);
      if (status === 'publish') {
        await window.EasyStore.addDecision({
          kind: 'class',
          id: saved.id || editingId,
          title,
          action: 'published',
          at: Date.now(),
        }).catch(() => {});
      }
      window.EasyUi.toast(
        status === 'publish'
          ? 'Class published. It is live on the website.'
          : 'Class saved as a draft.',
        'success'
      );
      const savedDate = saved && saved.startDate ? saved.startDate : startDate;
      closeEditor();
      jumpToDate(savedDate);
    } catch (e) {
      formError(e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save class';
    }
  }

  function jumpToDate(ymd) {
    const parts = String(ymd).split('-').map(Number);
    if (parts.length === 3 && parts[0]) {
      state.viewYear = parts[0];
      state.viewMonth = parts[1] - 1;
    }
    state.selectedDay = ymd;
    renderGrid();
    renderDayList();
    loadMonth();
  }

  async function onDelete() {
    const ev = state.editing;
    if (!ev) return;
    const yes = await window.EasyUi.confirm(
      'Delete this class?',
      '"' + ev.title + '" on ' + ev.startDate + ' will be moved to the trash on the ' +
        'website. It will disappear from the public calendar right away, and the roster ' +
        'and seat setup attached to it go with it. You cannot undo this from the app; ' +
        'an admin can restore it from the trash in wp-admin. ' +
        'Classes with sold seats cannot be deleted.',
      'Delete class'
    );
    if (!yes) return;
    const btn = $('evDeleteBtn');
    btn.disabled = true;
    try {
      await window.EasyApi.deleteEvent(ev.id);
      window.EasyUi.toast('Class deleted.', 'success');
      closeEditor();
      renderGrid();
      renderDayList();
      loadMonth();
    } catch (e) {
      formError('Could not delete the class: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- instructor calendar links ---------------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fall through to the legacy path.
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  async function loadFeeds() {
    if (state.feedsState === 'ok') return;
    const box = $('schedFeeds');
    if (!box) return;
    try {
      const res = await window.EasyApi.instructorFeeds();
      state.feedsState = 'ok';
      box.innerHTML = '';
      if (!res.available) {
        box.appendChild(
          U.el('p', 'hint', 'The calendar feed tool is switched off on the site, so there are no links to show.')
        );
        return;
      }
      if (!res.feeds.length) {
        box.appendChild(U.el('p', 'hint', 'No instructors found on the site yet.'));
        return;
      }
      for (const feed of res.feeds) {
        const row = U.el('div', 'feed-row');
        const main = U.el('div', 'feed-main');
        main.appendChild(U.el('div', 'feed-name', feed.name || '(unnamed instructor)'));
        main.appendChild(U.el('div', 'feed-url', feed.url));
        row.appendChild(main);
        const btn = U.el('button', 'btn btn-small btn-secondary', 'Copy link');
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          const ok = await copyText(feed.url);
          window.EasyUi.toast(
            ok ? 'Calendar link copied for ' + (feed.name || 'the instructor') + '.' : 'Could not copy the link.',
            ok ? 'success' : 'error',
            5000
          );
        });
        row.appendChild(btn);
        box.appendChild(row);
      }
    } catch (e) {
      state.feedsState = 'error';
      box.innerHTML = '';
      if (e && e.status === 404) {
        box.appendChild(
          U.el(
            'p',
            'hint',
            'Calendar links need EASY Suite 2.2.28 or newer on the site. Once the site is updated, the links will appear here.'
          )
        );
      } else {
        box.appendChild(
          U.el('p', 'hint', 'Could not load the calendar links: ' + (e && e.message ? e.message : 'unknown error'))
        );
      }
    }
  }

  /* ---------------- screen entry ---------------- */

  async function show() {
    if (!state.viewYear) {
      const now = new Date();
      state.viewYear = now.getFullYear();
      state.viewMonth = now.getMonth();
      state.selectedDay = U.todayYmd();
    }
    const key = monthKey();
    const saved = await window.EasyStore.getLastGood('schedule');
    if (
      saved &&
      saved.data &&
      saved.data.monthKey === key &&
      Array.isArray(saved.data.events) &&
      state.monthKey !== key
    ) {
      state.monthEvents = saved.data.events;
      state.monthKey = key;
    }
    renderGrid();
    renderDayList();
    loadMonth();
    loadFeeds();
    probeOnce();
    loadTimezone();
  }

  function init() {
    $('schedPrev').addEventListener('click', () => shiftMonth(-1));
    $('schedNext').addEventListener('click', () => shiftMonth(1));
    $('schedNewBtn').addEventListener('click', () => openEditor(null));
    $('evBack').addEventListener('click', () => {
      if (window.EasyUi) window.EasyUi.closeSubview();
      else closeEditor();
    });
    $('evForm').addEventListener('submit', onSave);
    $('evDeleteBtn').addEventListener('click', onDelete);
    $('evCourse').addEventListener('change', onCourseChange);
    $('evAllDay').addEventListener('change', setTimeWraps);
    $('evVenue').addEventListener('change', () => {
      $('evNewVenueBox').classList.toggle('hidden', $('evVenue').value !== '__new__');
    });
    $('evInstructor').addEventListener('change', () => {
      $('evNewOrgBox').classList.toggle('hidden', $('evInstructor').value !== '__new__');
    });
    const feedsToggle = $('feedsToggle');
    if (feedsToggle) {
      feedsToggle.addEventListener('click', () => {
        const body = $('feedsBody');
        const nowHidden = body.classList.toggle('hidden');
        feedsToggle.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
      });
    }
  }

  window.EasySchedule = { show, init, closeEditor };
})();
