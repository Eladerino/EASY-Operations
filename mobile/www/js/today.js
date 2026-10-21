// today.js: the Today screen: classes on today (tap a class for its
// roster), counts that need action, and the latest activity from this
// app (the local history). "View all" opens the Activity screen: the
// whole trail, grouped by day, with kind filters. The Activity screen
// has two sources: This phone (the local trail) and Site (the
// site-wide feed from EASY Suite, what the whole team did).
//
// The last good class list is saved on the device. Opening Today paints
// it straight away with a "Last updated" line, then refreshes in the
// background. If the refresh fails, the saved copy stays on screen with
// a note saying so, instead of an empty screen.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);
  let loaded = false;
  let todaysCache = [];

  /* ---------------- classes ---------------- */

  function renderClasses(todays) {
    const box = $('todayClasses');
    box.innerHTML = '';
    if (!todays.length) {
      box.appendChild(U.el('p', 'hint', 'No classes scheduled today.'));
      return;
    }
    for (const ev of todays) box.appendChild(classCard(ev));
    fillSeats(todays);
  }

  function classCard(ev) {
    const card = U.el('div', 'card card-clickable');
    card.appendChild(U.el('div', 'card-title', ev.title));
    const meta = [
      ev.organizerName ? 'Instructor: ' + ev.organizerName : '',
      ev.allDay ? 'All day' : ev.startTime + ' to ' + ev.endTime,
      ev.venueName || '',
    ]
      .filter(Boolean)
      .join(' · ');
    card.appendChild(U.el('div', 'card-meta', meta));
    const seats = U.el('div', 'card-meta strong-line');
    seats.id = 'seats-' + ev.id;
    if (ev.seats !== '') seats.textContent = 'Capacity ' + ev.seats + ' seats';
    card.appendChild(seats);
    card.appendChild(U.el('div', 'card-meta', 'Tap to see who is on the roster.'));
    card.addEventListener('click', () => openRoster(ev));
    return card;
  }

  // Seat state for the whole day at once, not one class at a time.
  async function fillSeats(todays) {
    await Promise.all(
      todays.map(async (ev) => {
        const node = document.getElementById('seats-' + ev.id);
        if (!node) return;
        try {
          const st = await window.EasyApi.saleState(ev.id);
          if (st && st.capacity !== null && st.capacity !== undefined) {
            let text = (st.sold || 0) + ' of ' + st.capacity + ' seats filled';
            if (st.linked && st.stock !== null && st.stock !== undefined) {
              text += ' (' + st.stock + ' left online)';
            }
            node.textContent = text;
            return;
          }
        } catch (e) {
          // Sale state is best-effort on this screen; the capacity text
          // from the event itself is already in place.
        }
        if (ev.seats !== '') node.textContent = 'Capacity ' + ev.seats + ' seats';
      })
    );
  }

  async function loadClasses() {
    const box = $('todayClasses');
    const note = $('todayClassesNote');
    const saved = await window.EasyStore.getLastGood('today_classes');
    if (saved && Array.isArray(saved.data)) {
      todaysCache = saved.data;
      renderClasses(todaysCache);
      note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(saved.at)) + ' Refreshing...';
    } else {
      box.innerHTML = '';
      box.appendChild(U.el('p', 'hint', 'Loading...'));
    }
    const today = U.todayYmd();
    try {
      const events = await window.EasyApi.eventsInRange(today, U.addDays(today, 1));
      const todays = events
        .filter((ev) => ev.status === 'publish')
        .filter((ev) => ev.startDate <= today && today <= ev.endDate)
        .sort((a, b) => (a.startStamp < b.startStamp ? -1 : 1));
      todaysCache = todays;
      await window.EasyStore.setLastGood('today_classes', todays);
      renderClasses(todays);
      note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(Date.now()));
    } catch (e) {
      if (saved && Array.isArray(saved.data)) {
        note.textContent =
          'Could not refresh, showing the last good copy from ' + U.endPeriod(U.fmtClock(saved.at));
      } else {
        box.innerHTML = '';
        box.appendChild(U.el('p', 'error-text', 'Could not load today\'s classes: ' + e.message));
        note.textContent = '';
      }
    }
  }

  /* ---------------- roster subview (read only) ---------------- */

  function closeRoster() {
    $('rosterView').classList.add('hidden');
    $('todayMain').classList.remove('hidden');
  }

  async function openRoster(ev) {
    $('todayMain').classList.add('hidden');
    const view = $('rosterView');
    view.classList.remove('hidden');
    $('rosterTitle').textContent = ev.title;
    const box = $('rosterList');
    box.innerHTML = '';
    box.appendChild(U.el('p', 'hint', 'Loading the roster...'));
    if (window.EasyUi) window.EasyUi.openSubview(closeRoster);
    try {
      const roster = await window.EasyApi.roster(ev.id);
      box.innerHTML = '';
      const unpaid = roster.filter((r) => r.payment && r.payment !== 'paid').length;
      box.appendChild(
        U.el(
          'p',
          'hint',
          roster.length + (roster.length === 1 ? ' person' : ' people') + ' on the roster' +
            (unpaid ? ', ' + unpaid + ' not marked paid' : '') + '. Read only here.'
        )
      );
      if (!roster.length) {
        box.appendChild(U.el('p', 'hint', 'Nobody is on the roster yet.'));
      }
      for (const r of roster) {
        const card = U.el('div', 'card');
        card.appendChild(U.el('div', 'card-title', r.name || '(no name)'));
        const meta = [
          r.payment ? 'Payment: ' + r.payment : '',
          r.source ? 'Source: ' + (r.source === 'checkout' ? 'online booking' : r.source) : '',
          r.employer || '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (meta) card.appendChild(U.el('div', 'card-meta', meta));
        const contact = [r.email || '', r.phone || ''].filter(Boolean).join(' · ');
        if (contact) card.appendChild(U.el('div', 'card-meta', contact));
        if (r.notes) card.appendChild(U.el('div', 'card-meta', r.notes));
        const actions = U.el('div', 'card-actions');
        if (r.phone) {
          const call = U.el('a', 'btn btn-small btn-secondary', 'Call');
          call.href = 'tel:' + String(r.phone).replace(/[^\d+]/g, '');
          actions.appendChild(call);
        }
        if (r.email) {
          const mail = U.el('a', 'btn btn-small btn-secondary', 'Email');
          mail.href = 'mailto:' + r.email;
          actions.appendChild(mail);
        }
        if (actions.childNodes.length) card.appendChild(actions);
        box.appendChild(card);
      }
    } catch (e) {
      box.innerHTML = '';
      box.appendChild(U.el('p', 'error-text', 'Could not load the roster: ' + e.message));
    }
  }

  /* ---------------- counts ---------------- */

  async function loadCounts() {
    const set = (id, value) => {
      const node = $(id);
      if (node) node.textContent = value;
    };
    const today = U.todayYmd();

    window.EasyApi.draftCertCount()
      .then((n) => set('countCerts', String(n)))
      .catch(() => set('countCerts', 'n/a'));
    window.EasyApi.pendingUsers()
      .then((list) => set('countAccounts', String(list.length)))
      .catch(() => set('countAccounts', 'n/a'));
    window.EasyApi.eventsInRange(today, U.addMonths(today, 12))
      .then((events) => {
        set('countClasses', String(events.filter((ev) => window.EasyApi.isWaitingClass(ev)).length));
      })
      .catch(() => set('countClasses', 'n/a'));
    window.EasyApi.mgmtQueue()
      .then((q) => {
        const open = (q.counts && q.counts.open) || 0;
        set('countQueue', String(open));
      })
      .catch(() => set('countQueue', 'n/a'));
    // Course reviews: a real count only when Brandon is a reviewer and
    // the site answers. Anything else is n/a, never a broken screen.
    window.EasyApi.courseBuilderMe()
      .then((me) => {
        if (me && me.isReviewer && typeof me.pendingReviews === 'number') {
          set('countReviews', String(me.pendingReviews));
        } else {
          set('countReviews', 'n/a');
        }
      })
      .catch(() => set('countReviews', 'n/a'));
    // Suite version line: also the "is the site even answering" check.
    window.EasyApi.appConfig()
      .then((cfg) => {
        const node = $('suiteLine');
        if (!node) return;
        node.textContent = cfg && cfg.version
          ? 'Site reachable, EASY Suite ' + cfg.version
          : 'Site reachable';
        node.classList.remove('error-text');
      })
      .catch(() => {
        const node = $('suiteLine');
        if (!node) return;
        node.textContent = 'Site did not answer just now.';
        node.classList.add('error-text');
      });
  }

  async function loadRecent() {
    const box = $('todayRecent');
    box.innerHTML = '';
    const history = await window.EasyStore.getHistory();
    if (!history.length) {
      box.appendChild(U.el('p', 'hint', 'No activity yet from this app.'));
      return;
    }
    for (const entry of history.slice(0, 5)) {
      const row = U.el('div', 'recent-row');
      const label =
        (entry.title || '(untitled)') + ': ' + (entry.action || '') + (entry.undone ? ' (undone)' : '');
      row.appendChild(U.el('span', 'recent-label', label));
      row.appendChild(U.el('span', 'recent-when', U.timeAgo(entry.at)));
      box.appendChild(row);
    }
  }

  /* ---------------- activity screen ---------------- */
  // The full local trail behind Today's Recent activity. Read only:
  // entries are a record of what the app did, never edited here.

  const ACTIVITY_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'class', label: 'Classes' },
    { key: 'cert', label: 'Certificates' },
    { key: 'account', label: 'Accounts' },
    { key: 'queue', label: 'Queue' },
  ];
  let activityFilter = 'all';
  let activitySource = 'phone'; // 'phone' (local trail) or 'site' (feed)

  // Site feed state: shaped entries, newest first, all belonging to
  // the current activityFilter. status: idle (nothing fetched yet),
  // loading, ready, error (a plain failure; Try again is offered),
  // suite (the site cannot serve the feed to this app yet; a calm
  // note shows instead of an error). The local trail is never kept
  // here, so a failed site fetch cannot disturb This phone.
  const siteFeed = {
    entries: [],
    page: 0,
    total: 0,
    status: 'idle',
    errorText: '',
    loadingMore: false,
    moreError: '',
  };

  function dayLabelFor(ts, nowTs) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'Earlier';
    const ymd = U.fmtYmd(d);
    const now = new Date(nowTs);
    if (ymd === U.fmtYmd(now)) return 'Today';
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (ymd === U.fmtYmd(yest)) return 'Yesterday';
    return U.fmtDateLoose(ymd);
  }

  // Pure grouping for the Activity screen: filter by kind, then group
  // consecutive entries under their day label. History is stored
  // newest first and stays that way. Kept separate so it can be
  // tested without the DOM.
  function groupActivity(entries, filter, nowTs) {
    const list = (Array.isArray(entries) ? entries : []).filter(
      (e) => e && (filter === 'all' || (e.kind || '') === filter)
    );
    const groups = [];
    for (const entry of list) {
      const label = dayLabelFor(entry.at, nowTs);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else groups.push({ label, entries: [entry] });
    }
    return groups;
  }

  function activityEmptyText(filter) {
    if (filter === 'class') return 'No class activity yet.';
    if (filter === 'cert') return 'No certificate activity yet.';
    if (filter === 'account') return 'No account activity yet.';
    if (filter === 'queue') return 'No queue activity yet.';
    return 'No activity yet from this app.';
  }

  function siteEmptyText(filter) {
    if (filter === 'class') return 'No class activity on the site yet.';
    if (filter === 'cert') return 'No certificate activity on the site yet.';
    if (filter === 'account') return 'No account activity on the site yet.';
    if (filter === 'queue') return 'No queue activity on the site yet.';
    return 'No site activity yet.';
  }

  /* ---------------- site feed shaping (pure) ---------------- */

  // Identity for one site row, used to de-duplicate appended pages.
  // Table rows and synthesized queue rows live in separate id
  // spaces (queue ids are negative), and the source keeps them
  // apart for good.
  function siteEntryKey(item) {
    const raw = item || {};
    return String(raw.source || 'log') + ':' + String(raw.id);
  }

  // Pure shaping for one site feed row into the entry shape the
  // Activity renderer uses. The feed's action is a bare verb
  // ("published", "edited"); the app's rows read as a sentence, so
  // the summary (when the site sent one) and the actor fold into
  // the action line: "Edited, Price $150 to $175, Seats 10 to 12
  // by Pam Evans". Local entries never carry an actor: everything
  // on This phone is Brandon by definition.
  function shapeSiteEntry(item) {
    const raw = item || {};
    const verb = String(raw.action || '');
    let action = verb ? verb.charAt(0).toUpperCase() + verb.slice(1) : '';
    const summary = String(raw.summary || '').trim();
    if (summary) action = action ? action + ', ' + summary : summary;
    const actor = String(raw.actor || '').trim();
    if (actor) action = action ? action + ' by ' + actor : 'by ' + actor;
    return {
      kind: String(raw.kind || ''),
      title: String(raw.title || ''),
      action,
      at: typeof raw.at === 'number' ? raw.at : 0,
      siteKey: siteEntryKey(raw),
    };
  }

  // Append one fetched page of shaped site entries, skipping any
  // already shown. Pages can overlap when something new lands at
  // the top between fetches; the key check keeps a row from ever
  // appearing twice. Returns a new array; inputs are untouched.
  // Kept separate so it can be tested without the DOM.
  function appendSiteEntries(existing, incoming) {
    const seen = new Set();
    const out = [];
    for (const e of Array.isArray(existing) ? existing : []) {
      if (e && e.siteKey) seen.add(e.siteKey);
      out.push(e);
    }
    for (const e of Array.isArray(incoming) ? incoming : []) {
      if (!e) continue;
      if (e.siteKey) {
        if (seen.has(e.siteKey)) continue;
        seen.add(e.siteKey);
      }
      out.push(e);
    }
    return out;
  }

  function renderActivityChips() {
    const chipsBox = $('activityChips');
    chipsBox.innerHTML = '';
    for (const f of ACTIVITY_FILTERS) {
      const chip = U.el(
        'button',
        'filter-chip' + (activityFilter === f.key ? ' active' : ''),
        f.label
      );
      chip.type = 'button';
      chip.addEventListener('click', () => {
        activityFilter = f.key;
        // In Site mode a chip is a new server query, not a local
        // re-filter: refetch page 1 with the chip as the kind.
        if (activitySource === 'site') loadSiteActivity(true);
        else renderActivity();
      });
      chipsBox.appendChild(chip);
    }
  }

  // One Activity row, shared by both sources so the two lists can
  // never drift apart in shape.
  function activityRow(entry) {
    const row = U.el('div', 'recent-row');
    const label =
      (entry.title || '(untitled)') + ': ' + (entry.action || '') + (entry.undone ? ' (undone)' : '');
    row.appendChild(U.el('span', 'recent-label', label));
    row.appendChild(U.el('span', 'recent-when', U.fmtClock(entry.at)));
    return row;
  }

  function renderActivityGroups(box, groups) {
    for (const group of groups) {
      box.appendChild(U.el('h3', 'section-title activity-day', group.label));
      for (const entry of group.entries) box.appendChild(activityRow(entry));
    }
  }

  async function renderActivity() {
    syncActivitySegment();
    renderActivityChips();
    if (activitySource === 'site') {
      renderActivitySite();
      return;
    }
    const box = $('activityList');
    box.innerHTML = '';
    const history = await window.EasyStore.getHistory();
    const groups = groupActivity(history, activityFilter, Date.now());
    if (!groups.length) {
      box.appendChild(U.el('p', 'hint', activityEmptyText(activityFilter)));
      return;
    }
    renderActivityGroups(box, groups);
  }

  function renderActivitySite() {
    const box = $('activityList');
    box.innerHTML = '';
    if (activityFilter === 'queue') {
      // Queue rows mirror the decisions on record right now;
      // undoing an answer removes its row rather than amending it.
      box.appendChild(U.el('p', 'hint', 'Queue activity reflects current decisions.'));
    }
    if (siteFeed.status === 'loading' || siteFeed.status === 'idle') {
      box.appendChild(U.el('p', 'hint', 'Loading site activity...'));
      return;
    }
    if (siteFeed.status === 'suite') {
      // The site cannot serve the feed yet: a calm note, not an
      // error. Retrying cannot help until the site is updated.
      box.appendChild(U.el('p', 'hint', siteFeed.errorText));
      return;
    }
    if (siteFeed.status === 'error' && !siteFeed.entries.length) {
      box.appendChild(U.el('p', 'error-text', siteFeed.errorText || 'Could not load site activity.'));
      const actions = U.el('div', 'card-actions');
      const retry = U.el('button', 'btn btn-secondary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => loadSiteActivity(true));
      actions.appendChild(retry);
      box.appendChild(actions);
      return;
    }
    const groups = groupActivity(siteFeed.entries, activityFilter, Date.now());
    if (!groups.length) {
      box.appendChild(U.el('p', 'hint', siteEmptyText(activityFilter)));
      return;
    }
    renderActivityGroups(box, groups);
    if (siteFeed.moreError) {
      box.appendChild(U.el('p', 'error-text', siteFeed.moreError));
    }
    if (siteFeed.entries.length < siteFeed.total) {
      const actions = U.el('div', 'card-actions');
      const more = U.el('button', 'btn btn-secondary', siteFeed.loadingMore ? 'Loading...' : 'Show more');
      more.type = 'button';
      if (siteFeed.loadingMore) more.disabled = true;
      more.addEventListener('click', () => loadSiteActivity(false));
      actions.appendChild(more);
      box.appendChild(actions);
      box.appendChild(
        U.el('p', 'hint', 'Showing ' + siteFeed.entries.length + ' of ' + siteFeed.total + '.')
      );
    }
  }

  let siteLoadSeq = 0;

  // Fetch one page of the site feed. firstPage restarts the list
  // (entering Site, tapping a chip, retrying); otherwise the next
  // page appends. A slow earlier fetch never overwrites a newer
  // one: results land only while this is still the latest load.
  async function loadSiteActivity(firstPage) {
    if (!firstPage && (siteFeed.loadingMore || siteFeed.status !== 'ready')) return;
    const seq = ++siteLoadSeq;
    const filter = activityFilter;
    if (firstPage) {
      siteFeed.entries = [];
      siteFeed.page = 0;
      siteFeed.total = 0;
      siteFeed.moreError = '';
      siteFeed.status = 'loading';
    } else {
      siteFeed.loadingMore = true;
      siteFeed.moreError = '';
    }
    renderActivity();
    try {
      const res = await window.EasyApi.activityFeed(firstPage ? 1 : siteFeed.page + 1, filter);
      if (seq !== siteLoadSeq) return;
      const shaped = (res.items || []).map(shapeSiteEntry);
      siteFeed.entries = firstPage ? shaped : appendSiteEntries(siteFeed.entries, shaped);
      siteFeed.page = res.page || (firstPage ? 1 : siteFeed.page + 1);
      siteFeed.total = typeof res.total === 'number' ? res.total : siteFeed.entries.length;
      siteFeed.status = 'ready';
    } catch (e) {
      if (seq !== siteLoadSeq) return;
      if (firstPage) {
        siteFeed.errorText = window.EasyApi.activityErrorText(e);
        siteFeed.status = window.EasyApi.activityNeedsNewerSuite(e) ? 'suite' : 'error';
      } else {
        siteFeed.moreError = window.EasyApi.activityErrorText(e);
      }
    }
    siteFeed.loadingMore = false;
    renderActivity();
  }

  function syncActivitySegment() {
    const phone = $('activitySegPhone');
    const site = $('activitySegSite');
    if (phone) phone.classList.toggle('active', activitySource === 'phone');
    if (site) site.classList.toggle('active', activitySource === 'site');
  }

  function setActivitySource(source) {
    activitySource = source === 'site' ? 'site' : 'phone';
    if (activitySource === 'site') {
      // Pull to refresh stays off inside subviews, so entering
      // Site is the refresh: every tap fetches a fresh first page,
      // even when Site is already the showing source.
      loadSiteActivity(true);
    } else {
      renderActivity();
    }
  }

  function closeActivity() {
    $('activityView').classList.add('hidden');
    $('todayMain').classList.remove('hidden');
  }

  function openActivity() {
    $('todayMain').classList.add('hidden');
    $('activityView').classList.remove('hidden');
    if (window.EasyUi) window.EasyUi.openSubview(closeActivity);
    // Re-entering on Site is a refresh, like tapping the segment.
    if (activitySource === 'site') loadSiteActivity(true);
    else renderActivity();
  }

  async function show() {
    loaded = true;
    await Promise.all([loadClasses(), loadRecent()]);
    loadCounts();
  }

  function init() {
    $('rosterBack').addEventListener('click', () => {
      if (window.EasyUi) window.EasyUi.closeSubview();
      else closeRoster();
    });
    $('activityBack').addEventListener('click', () => {
      if (window.EasyUi) window.EasyUi.closeSubview();
      else closeActivity();
    });
    $('activitySegPhone').addEventListener('click', () => setActivitySource('phone'));
    $('activitySegSite').addEventListener('click', () => setActivitySource('site'));
    $('todayActivityBtn').addEventListener('click', openActivity);
    // Needs Attention boxes tap through to the screen that holds the
    // work. Course reviews has no screen in this app, so its box is
    // display only and gets no listener on purpose.
    const tapThrough = [
      ['boxCerts', 'approvals'],
      ['boxClasses', 'approvals'],
      ['boxAccounts', 'approvals'],
      ['boxQueue', 'queue'],
    ];
    for (const [id, tab] of tapThrough) {
      const box = $(id);
      if (box) box.addEventListener('click', () => window.EasyUi.showTab(tab));
    }
  }

  window.EasyToday = {
    show,
    refresh: show,
    init,
    closeRoster,
    closeActivity,
    groupActivity,
    ACTIVITY_FILTERS,
    shapeSiteEntry,
    appendSiteEntries,
    siteEntryKey,
    wasLoaded: () => loaded,
  };
})();
