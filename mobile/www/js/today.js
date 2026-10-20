// today.js: the Today screen: classes on today (tap a class for its
// roster), counts that need action, and what was recently decided
// (from the local decision history).
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
      note.textContent = 'Last updated ' + U.fmtClock(saved.at) + '. Refreshing...';
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
      note.textContent = 'Last updated ' + U.fmtClock(Date.now()) + '.';
    } catch (e) {
      if (saved && Array.isArray(saved.data)) {
        note.textContent =
          'Could not refresh, showing the last good copy from ' + U.fmtClock(saved.at) + '.';
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
      .then((q) => set('countQueue', String((q.counts && q.counts.open) || 0)))
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
      box.appendChild(U.el('p', 'hint', 'Nothing decided yet from this app.'));
      return;
    }
    for (const entry of history.slice(0, 5)) {
      const row = U.el('div', 'recent-row');
      const label =
        entry.title + ': ' + entry.action + (entry.undone ? ' (undone)' : '');
      row.appendChild(U.el('span', 'recent-label', label));
      row.appendChild(U.el('span', 'recent-when', U.timeAgo(entry.at)));
      box.appendChild(row);
    }
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
  }

  window.EasyToday = { show, refresh: show, init, closeRoster, wasLoaded: () => loaded };
})();
