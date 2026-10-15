// class-approvals.js — "Classes" queue under the Approvals tab.
//
// Office review inbox for draft/pending class events proposed by instructors.
// Edit reuses the Schedule tab's class editor (via window.EasySchedule);
// Publish flips the event to published; "View on calendar" jumps to the
// class's month for context. Publish rights are enforced by WordPress at
// action time (friendly 403); the probe can only tell "can create" from
// "cannot", same as the Certificates queue.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.schedule;

  let initialized = false;
  let canReview = false;
  let currentDrafts = [];

  // IDs published in the last few minutes: a stale cached list response
  // must not resurrect them in the queue right after a verified publish.
  const recentlyPublished = new Map(); // id -> Date.now()
  const RECENT_WINDOW = 5 * 60 * 1000;

  /* ---------------- toast + confirm (mirror the other queue modules) ---------------- */

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

  function confirmDialog(title, body, okText) {
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
        $('modal').classList.add('hidden');
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

  function showError(message) {
    const el = $('classApprovError');
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  function setBadge(n) {
    if (window.EasyApprovalBadges) window.EasyApprovalBadges.set('classes', n);
  }

  /* ---------------- data ---------------- */

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  // Upcoming drafts across the next 12 months (start=today keeps stale past
  // drafts out of the queue; they're still visible on the calendar).
  async function fetchUpcomingDrafts() {
    const now = new Date();
    const start = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const endD = new Date(Date.UTC(now.getFullYear() + 1, now.getMonth(), now.getDate()));
    const end = fmtDate(endD.getUTCFullYear(), endD.getUTCMonth() + 1, endD.getUTCDate());
    const res = await api().listEvents(start, end);
    if (!res.ok) throw new Error(res.error || 'Could not load classes.');
    const norm = window.EasySchedule && window.EasySchedule.normalizeEvent
      ? window.EasySchedule.normalizeEvent
      : (x) => x;
    const nowTs = Date.now();
    return res.events
      .map(norm)
      .filter((ev) => ev.status !== 'publish')
      .filter((ev) => {
        const t = recentlyPublished.get(ev.id);
        if (!t) return true;
        if (nowTs - t < RECENT_WINDOW) return false;
        recentlyPublished.delete(ev.id);
        return true;
      })
      .sort((a, b) => (a.startStamp < b.startStamp ? -1 : 1));
  }

  function fmtWhen(ev) {
    const when = ev.allDay ? 'All day' : `${ev.startTime}–${ev.endTime}`;
    return ev.startDate === ev.endDate
      ? `${ev.startDate}, ${when}`
      : `${ev.startDate} → ${ev.endDate}, ${when}`;
  }

  /* ---------------- queue ---------------- */

  function renderList(drafts) {
    currentDrafts = drafts;
    const list = $('classApprovList');
    list.innerHTML = '';
    $('classApprovEmpty').classList.toggle('hidden', drafts.length > 0);
    setBadge(drafts.length);
    for (const ev of drafts) {
      const li = document.createElement('li');
      li.className = 'approv-row';

      const info = document.createElement('div');
      info.className = 'approv-info';
      const title = document.createElement('strong');
      title.textContent = ev.title || '(untitled)';
      info.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = [
        fmtWhen(ev),
        ev.venueName ? `@ ${ev.venueName}` : '',
        ev.organizerName || '',
        `(${ev.status})`,
      ].filter(Boolean).join(' · ');
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        if (window.EasySchedule) window.EasySchedule.editEvent(ev);
      });
      const calBtn = document.createElement('button');
      calBtn.type = 'button';
      calBtn.className = 'btn btn-secondary btn-small';
      calBtn.textContent = 'Calendar';
      calBtn.title = 'View on calendar';
      calBtn.addEventListener('click', () => {
        if (window.EasySchedule) window.EasySchedule.gotoDate(ev.startDate);
      });
      const pubBtn = document.createElement('button');
      pubBtn.type = 'button';
      pubBtn.className = 'btn btn-primary btn-small';
      pubBtn.textContent = 'Publish';
      pubBtn.addEventListener('click', () => publishClass(ev));
      actions.appendChild(editBtn);
      actions.appendChild(calBtn);
      actions.appendChild(pubBtn);

      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function loadQueue() {
    showError('');
    $('classApprovLoading').classList.remove('hidden');
    try {
      renderList(await fetchUpcomingDrafts());
    } catch (err) {
      showError(err.message);
    } finally {
      $('classApprovLoading').classList.add('hidden');
    }
  }

  async function publishClass(ev) {
    const yes = await confirmDialog(
      'Publish this class?',
      `"${ev.title}" on ${ev.startDate} will become visible on the site.`,
      'Publish'
    );
    if (!yes) return;
    try {
      const res = await api().updateEvent(ev.id, { status: 'publish' });
      if (!res.ok) throw new Error(res.error || 'Publish failed.');
      // The publish is verified (the main process checks WordPress
      // actually flipped the status), so drop the row immediately instead
      // of waiting on the re-fetch — and a stale cached list can't
      // resurrect it for the next few minutes.
      recentlyPublished.set(ev.id, Date.now());
      renderList(currentDrafts.filter((d) => d.id !== ev.id));
      toast('Class published.', 'success');
      loadQueue(); // background reconcile; never rejects (handled inside)
      if (window.EasySchedule) window.EasySchedule.refreshCalendar();
    } catch (err) {
      toast(`Could not publish the class: ${err.message}`, 'error', 8000);
    }
  }

  // Silent badge prime for when the sub-tab hasn't been opened yet.
  async function primeBadge() {
    try {
      const probe = await api().probe();
      if (!probe.ok || !probe.canWrite) { setBadge(0); return; }
      setBadge((await fetchUpcomingDrafts()).length);
    } catch {
      /* silent: the queue itself will report errors on open */
    }
  }

  /* ---------------- entry ---------------- */

  async function show() {
    // Instructors don't get this queue at all (the sub-tab is hidden at
    // startup); this is a backstop in case it is reached another way.
    if (window.EasyPerms && !window.EasyPerms.privileged) {
      const tab = $('subTabClasses');
      if (tab) tab.classList.add('hidden');
      return;
    }
    if (!initialized) {
      initialized = true;
      try {
        const probe = await api().probe();
        if (!probe.ok) {
          showError(probe.error || 'Could not check class review permissions.');
          return;
        }
        if (!probe.canWrite) {
          const banner = $('classApprovPermBanner');
          banner.textContent =
            'This WordPress account cannot review classes. An admin needs to grant it event publishing rights (edit_tribe_events / publish_tribe_events).';
          banner.classList.remove('hidden');
          return;
        }
        canReview = true;
      } catch (err) {
        showError(`Could not check class review permissions: ${err.message}`);
        return;
      }
    }
    if (canReview) await loadQueue();
  }

  $('classApprovRefresh').addEventListener('click', () => { if (canReview) loadQueue(); });

  window.EasyClassApprovals = { show, primeBadge };
})();
