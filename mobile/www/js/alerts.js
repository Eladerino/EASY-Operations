// alerts.js: a simple in-app alerts list, derived from the same counts
// the other screens use. No push notifications in this version: alerts
// are what is true right now, with a note when a count has grown since
// the last time this screen was opened.
//
// Honesty rule: "All clear" is shown only when every source was
// actually checked. A source that fails gets named in a "Could not
// check" row, and a failed check never overwrites the saved snapshot,
// so the growth badges keep a real baseline. The last good list is
// saved on the device and painted first, with a note when a refresh
// could not replace it.
//
// Tapping the expiring-certificates row opens the actual list (the
// data is already on the phone from the count), soonest first.
//
// Below the list, a Site health section shows the Suite Overview
// health rows and the expiry email / digest run times from
// GET /easy/v1/site-health, with the same honesty rule: a failed
// fetch says "Could not check: site health." and shows nothing else.
//
// Counts from sources that loaded are also written to the widget
// snapshot the Android home-screen widget reads.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);
  let expiringList = [];

  const SOURCES = [
    {
      key: 'certs',
      label: 'certificate drafts',
      run: async (counts, items) => {
        const n = await window.EasyApi.draftCertCount();
        counts.certs = n;
        if (n > 0) {
          items.push({
            key: 'certs',
            text: n + (n === 1 ? ' certificate draft' : ' certificate drafts') + ' waiting for review',
            tab: 'approvals',
          });
        }
      },
    },
    {
      key: 'accounts',
      label: 'account signups',
      run: async (counts, items) => {
        const list = await window.EasyApi.pendingUsers();
        counts.accounts = list.length;
        if (list.length > 0) {
          items.push({
            key: 'accounts',
            text: list.length + (list.length === 1 ? ' account signup' : ' account signups') + ' waiting for review',
            tab: 'approvals',
          });
        }
      },
    },
    {
      key: 'classes',
      label: 'class drafts',
      run: async (counts, items) => {
        const today = U.todayYmd();
        const events = await window.EasyApi.eventsInRange(today, U.addMonths(today, 12));
        const n = events.filter((ev) => window.EasyApi.isWaitingClass(ev)).length;
        counts.classes = n;
        if (n > 0) {
          items.push({
            key: 'classes',
            text: n + (n === 1 ? ' class draft' : ' class drafts') + ' waiting for review',
            tab: 'approvals',
          });
        }
      },
    },
    {
      key: 'queue',
      label: 'management queue',
      run: async (counts, items) => {
        const q = await window.EasyApi.mgmtQueue();
        const n = (q.counts && q.counts.open) || 0;
        counts.queue = n;
        if (n > 0) {
          items.push({
            key: 'queue',
            text: n + (n === 1 ? ' question' : ' questions') + ' open in the management queue',
            tab: 'queue',
          });
        }
      },
    },
    {
      key: 'expiring',
      label: 'expiring certificates',
      run: async (counts, items) => {
        const list = await window.EasyApi.expiringCerts(30);
        expiringList = list;
        counts.expiring = list.length;
        if (list.length > 0) {
          items.push({
            key: 'expiring',
            text:
              list.length +
              (list.length === 1 ? ' certificate expires' : ' certificates expire') +
              ' in the next 30 days',
            tab: null,
            action: 'expiring',
          });
        }
      },
    },
  ];

  async function gather() {
    const items = [];
    const counts = {};
    const failed = [];
    await Promise.all(
      SOURCES.map(async (src) => {
        try {
          await src.run(counts, items);
        } catch (e) {
          failed.push(src.label);
        }
      })
    );
    // Keep a stable display order regardless of finish order.
    items.sort((a, b) => SOURCES.findIndex((s) => s.key === a.key) - SOURCES.findIndex((s) => s.key === b.key));
    return { items, counts, failed };
  }

  function renderItems(items, prev, counts, failed) {
    const box = $('alertsList');
    box.innerHTML = '';
    if (failed.length) {
      const row = U.el('div', 'alert-row alert-failed');
      row.appendChild(U.el('span', 'alert-text', 'Could not check: ' + failed.join(', ') + '.'));
      box.appendChild(row);
    }
    if (!items.length && !failed.length) {
      box.appendChild(U.el('p', 'hint', 'All clear. Nothing needs attention right now.'));
    }
    if (!items.length && failed.length) {
      box.appendChild(U.el('p', 'hint', 'Nothing else could be confirmed just now.'));
    }
    for (const item of items) {
      const row = U.el('div', 'alert-row');
      row.appendChild(U.el('span', 'alert-text', item.text));
      if (prev && typeof prev[item.key] === 'number' && typeof counts[item.key] === 'number' && counts[item.key] > prev[item.key]) {
        row.appendChild(
          U.el('span', 'alert-new', '+' + (counts[item.key] - prev[item.key]) + ' since last check')
        );
      }
      if (item.tab) {
        row.classList.add('alert-link');
        row.addEventListener('click', () => window.EasyUi.showTab(item.tab));
      } else if (item.action === 'expiring') {
        row.classList.add('alert-link');
        row.addEventListener('click', openExpiring);
      }
      box.appendChild(row);
    }
  }

  async function show() {
    const note = $('alertsUpdated');
    const saved = await window.EasyStore.getLastGood('alerts');
    if (saved && saved.data && Array.isArray(saved.data.items)) {
      renderItems(saved.data.items, null, saved.data.counts || {}, []);
      note.textContent = 'Last updated ' + U.fmtClock(saved.at) + '. Refreshing...';
    } else {
      const box = $('alertsList');
      box.innerHTML = '';
      box.appendChild(U.el('p', 'hint', 'Checking...'));
    }
    const prev = await window.EasyStore.getAlertsSnapshot();
    const { items, counts, failed } = await gather();
    // Widget snapshot: only sources that actually loaded contribute.
    const widgetFields = {};
    if (typeof counts.certs === 'number') widgetFields.certDrafts = counts.certs;
    if (typeof counts.classes === 'number') widgetFields.classDrafts = counts.classes;
    if (typeof counts.accounts === 'number') widgetFields.accountSignups = counts.accounts;
    if (typeof counts.queue === 'number') widgetFields.queueOpen = counts.queue;
    if (typeof counts.expiring === 'number') widgetFields.expiring30 = counts.expiring;
    if (Object.keys(widgetFields).length) {
      window.EasyStore.updateWidgetCounts(widgetFields).catch(() => {});
    }
    if (failed.length && saved && saved.data && Array.isArray(saved.data.items) && !items.length) {
      // Total failure with a saved copy: keep the saved copy on screen.
      renderItems(saved.data.items, prev, saved.data.counts || {}, failed);
      note.textContent =
        'Could not refresh, showing the last good copy from ' + U.fmtClock(saved.at) + '.';
      await loadHealth();
      return;
    }
    renderItems(items, prev, counts, failed);
    if (!failed.length) {
      // Only a fully successful check becomes the new baseline, merged
      // over the old one so nothing previously known is dropped.
      await window.EasyStore.setAlertsSnapshot({ ...(prev || {}), ...counts });
      await window.EasyStore.setLastGood('alerts', { items, counts });
      note.textContent = 'Last updated ' + U.fmtClock(Date.now()) + '.';
    } else {
      note.textContent =
        'Checked at ' + U.fmtClock(Date.now()) + ', but ' + failed.join(', ') + ' could not be checked.';
    }
    await loadHealth();
  }

  /* ---------------- site health ---------------- */

  function healthRow(label, state, detail) {
    const node = U.el('div', 'alert-row');
    if (state === 'error') node.classList.add('alert-failed');
    const main = U.el('span', 'alert-text');
    main.appendChild(U.el('span', 'health-label', label || ''));
    if (detail) main.appendChild(U.el('span', 'health-detail', detail));
    node.appendChild(main);
    const names = { ok: 'OK', warn: 'Attention', error: 'Problem', off: 'Off' };
    const key = names[state] ? state : 'off';
    node.appendChild(U.el('span', 'health-state health-' + key, names[key]));
    return node;
  }

  function runText(label, pair) {
    const last = pair && pair.last_run ? pair.last_run : 'never';
    const next = pair && pair.next_run ? pair.next_run : 'not scheduled';
    return label + ': last ran ' + last + '; next ' + next + '.';
  }

  async function loadHealth() {
    const box = $('healthBox');
    const note = $('healthUpdated');
    if (!box) return;
    box.innerHTML = '';
    try {
      const h = await window.EasyApi.siteHealth();
      const rows = Array.isArray(h.health) ? h.health : [];
      for (const row of rows) box.appendChild(healthRow(row.label, row.state, row.detail));
      box.appendChild(U.el('p', 'hint', runText('Expiry email check', h.expiry_check)));
      box.appendChild(U.el('p', 'hint', runText('Employer digest', h.employer_digest)));
      note.textContent =
        (h.suite_version ? 'EASY Suite ' + h.suite_version + '. ' : '') +
        (h.server_time ? 'Site time ' + h.server_time + '.' : '');
    } catch (e) {
      const row = U.el('div', 'alert-row alert-failed');
      row.appendChild(U.el('span', 'alert-text', 'Could not check: site health.'));
      box.appendChild(row);
      note.textContent = '';
    }
  }

  /* ---------------- expiring certificates subview ---------------- */

  function closeExpiring() {
    $('expiringView').classList.add('hidden');
    $('alertsMain').classList.remove('hidden');
  }

  function contactLink(label, value) {
    const v = String(value || '').trim();
    if (!v) return null;
    const a = U.el('a', 'btn btn-small btn-secondary', label);
    if (v.includes('@')) a.href = 'mailto:' + v;
    else if (v.replace(/\D/g, '').length >= 7) a.href = 'tel:' + v.replace(/[^\d+]/g, '');
    else return null;
    return a;
  }

  function openExpiring() {
    $('alertsMain').classList.add('hidden');
    const view = $('expiringView');
    view.classList.remove('hidden');
    const box = $('expiringList');
    box.innerHTML = '';
    if (window.EasyUi) window.EasyUi.openSubview(closeExpiring);
    if (!expiringList.length) {
      box.appendChild(U.el('p', 'hint', 'No certificates expire in the next 30 days.'));
      return;
    }
    for (const c of expiringList) {
      const card = U.el('div', 'card');
      card.appendChild(U.el('div', 'card-title', c.student_name || '(no name)'));
      const days = U.daysUntil(c.expiry_date);
      const meta = [
        c.course_title || c.course_category || '',
        'expires ' + U.fmtDateLoose(c.expiry_date) + (days !== null ? ' (' + days + (days === 1 ? ' day' : ' days') + ' left)' : ''),
        c.company || '',
        c.instructor ? 'Instructor ' + c.instructor : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (meta) card.appendChild(U.el('div', 'card-meta', meta));
      const actions = U.el('div', 'card-actions');
      const mail = contactLink('Email student', c.student_email);
      if (mail) actions.appendChild(mail);
      const employer = contactLink('Contact employer', c.company_contact);
      if (employer) actions.appendChild(employer);
      if (actions.childNodes.length) card.appendChild(actions);
      box.appendChild(card);
    }
  }

  function init() {
    $('expiringBack').addEventListener('click', () => {
      if (window.EasyUi) window.EasyUi.closeSubview();
      else closeExpiring();
    });
  }

  window.EasyAlerts = { show, init, closeExpiring };
})();
