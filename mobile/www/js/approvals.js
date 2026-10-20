// approvals.js: the triage inbox: certificate drafts, class drafts, and
// account signups in one place, one card per decision.
//
// Deliberately no "approve all": each card is decided on its own, the same
// rule as the desktop app. Publishing a certificate emails the student, so
// that action asks for confirmation first.
//
// Undo: certificate and class publishes can be flipped back to draft with
// the same status endpoints, so recent decisions of those kinds show an
// Undo button. Account decisions cannot be reversed through the API, so
// they simply never show one.
//
// The last good queues are saved on the device, painted instantly on
// open, and refreshed in the background; a failed refresh keeps the
// saved copy on screen and says so. Counts from queues that loaded
// are also written to the home-screen widget snapshot.
//
// Below the queues, a certificate search looks up any certificate
// (published or draft) by student name or certificate number through
// the Suite's cert-search route. It is read only: results are shown,
// never edited, and an empty result says so plainly.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);

  const state = {
    certs: [],
    certTotal: 0,
    classes: [],
    accounts: [],
  };
  let paintedSavedAt = null;

  function setCounts() {
    const paint = (id, n) => {
      const node = $(id);
      if (!node) return;
      node.textContent = String(n);
      node.classList.toggle('hidden', n <= 0);
    };
    paint('badgeCerts', state.certs.length);
    paint('badgeClasses', state.classes.length);
    paint('badgeAccounts', state.accounts.length);
    if (window.EasyUi) {
      window.EasyUi.setApprovalsBadge(
        state.certs.length + state.classes.length + state.accounts.length
      );
    }
  }

  function listBox(id, items, emptyText) {
    const box = $(id);
    box.innerHTML = '';
    if (!items.length) box.appendChild(U.el('p', 'hint', emptyText));
    return box;
  }

  /* ---------------- certificates ---------------- */

  function renderCerts() {
    const box = listBox('queueCerts', state.certs, 'No certificate drafts waiting.');
    for (const c of state.certs) {
      const card = U.el('div', 'card decision-card');
      card.appendChild(U.el('div', 'card-title', c.student));
      const meta1 = [c.course, c.completionDate ? 'completed ' + String(c.completionDate).slice(0, 10) : '']
        .filter(Boolean)
        .join(' · ');
      if (meta1) card.appendChild(U.el('div', 'card-meta', meta1));
      const meta2 = [
        c.instructor ? 'Instructor ' + c.instructor : '',
        c.date ? 'submitted ' + String(c.date).slice(0, 10) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (meta2) card.appendChild(U.el('div', 'card-meta', meta2));
      const meta3 = [
        c.studentEmail ? 'Emails ' + c.studentEmail : 'No student email',
        c.companyContact
          ? 'employer copy to ' + c.companyContact + (c.company ? ' (' + c.company + ')' : '')
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
      card.appendChild(U.el('div', 'card-meta', meta3));
      if (c.expiryDate) {
        card.appendChild(U.el('div', 'card-meta', 'Expires ' + U.fmtDateLoose(c.expiryDate)));
      }
      if (!c.hasPdf) {
        card.appendChild(U.el('div', 'card-meta warn-line', 'No PDF attached'));
      }
      if (c.certificateNumber) {
        card.appendChild(U.el('div', 'card-meta cert-no', c.certificateNumber));
      }

      const actions = U.el('div', 'card-actions');
      const pub = U.el('button', 'btn btn-primary', 'Publish');
      pub.type = 'button';
      pub.addEventListener('click', () => publishCert(c, pub));
      actions.appendChild(pub);
      card.appendChild(actions);
      box.appendChild(card);
    }
    const note = $('certsNote');
    if (note) {
      const more = state.certTotal > state.certs.length;
      note.textContent = more
        ? 'Showing the first ' + state.certs.length + ' of ' + state.certTotal + ' drafts. The rest are waiting behind these.'
        : '';
      note.classList.toggle('hidden', !more);
    }
    setCounts();
  }

  async function publishCert(cert, btn) {
    const what = cert.course ? cert.course + ' certificate' : 'certificate';
    let body = cert.student + "'s " + what + ' will go live and the student will be notified by email.';
    if (!cert.hasPdf) {
      body += '\n\nNo PDF is attached to this certificate yet. The student will be emailed either way.';
    }
    const yes = await window.EasyUi.confirm('Publish this certificate?', body, 'Publish');
    if (!yes) return;
    btn.disabled = true;
    try {
      await window.EasyApi.publishCert(cert.id);
      state.certs = state.certs.filter((c) => c.id !== cert.id);
      await window.EasyStore.addDecision({
        kind: 'cert',
        id: cert.id,
        title: cert.student + ' (' + (cert.course || 'certificate') + ')',
        action: 'published',
        at: Date.now(),
      });
      renderCerts();
      renderRecent();
      window.EasyUi.toast('Certificate published. The student has been notified.', 'success');
    } catch (e) {
      window.EasyUi.toast('Could not publish the certificate: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- classes ---------------- */

  function renderClasses() {
    const box = listBox('queueClasses', state.classes, 'No class drafts waiting.');
    for (const ev of state.classes) {
      const card = U.el('div', 'card decision-card');
      card.appendChild(U.el('div', 'card-title', ev.title));
      const meta = [
        U.fmtWhen(ev),
        ev.venueName ? 'at ' + ev.venueName : '',
        ev.organizerName || '',
        '(' + ev.status + ')',
      ]
        .filter(Boolean)
        .join(' · ');
      card.appendChild(U.el('div', 'card-meta', meta));

      const actions = U.el('div', 'card-actions');
      const pub = U.el('button', 'btn btn-primary', 'Publish');
      pub.type = 'button';
      pub.addEventListener('click', () => publishClass(ev, pub));
      actions.appendChild(pub);
      card.appendChild(actions);
      box.appendChild(card);
    }
    setCounts();
  }

  async function publishClass(ev, btn) {
    const yes = await window.EasyUi.confirm(
      'Publish this class?',
      '"' + ev.title + '" on ' + ev.startDate + ' will become visible on the site.',
      'Publish'
    );
    if (!yes) return;
    btn.disabled = true;
    try {
      await window.EasyApi.publishEvent(ev.id);
      state.classes = state.classes.filter((d) => d.id !== ev.id);
      await window.EasyStore.addDecision({
        kind: 'class',
        id: ev.id,
        title: ev.title,
        action: 'published',
        at: Date.now(),
      });
      renderClasses();
      renderRecent();
      window.EasyUi.toast('Class published.', 'success');
    } catch (e) {
      window.EasyUi.toast('Could not publish the class: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- accounts ---------------- */

  function renderAccounts() {
    const box = listBox('queueAccounts', state.accounts, 'No account signups waiting.');
    for (const u of state.accounts) {
      const card = U.el('div', 'card decision-card');
      card.appendChild(U.el('div', 'card-title', u.name || '(no name)'));
      const meta = [u.email || '', u.registered ? 'signed up ' + String(u.registered).slice(0, 10) : '']
        .filter(Boolean)
        .join(' · ');
      if (meta) card.appendChild(U.el('div', 'card-meta', meta));

      const actions = U.el('div', 'card-actions');
      const approve = U.el('button', 'btn btn-primary', 'Approve');
      approve.type = 'button';
      approve.addEventListener('click', () => decideAccount(u, 'approve', approve, reject));
      const reject = U.el('button', 'btn btn-danger', 'Reject');
      reject.type = 'button';
      reject.addEventListener('click', () => decideAccount(u, 'reject', approve, reject));
      actions.appendChild(approve);
      actions.appendChild(reject);
      card.appendChild(actions);
      box.appendChild(card);
    }
    const note = $('accountsNote');
    if (note) {
      // The site caps this list at 100 and reports no total, so
      // a full page means there may be more behind it.
      const capped = state.accounts.length >= 100;
      note.textContent = capped
        ? 'Showing 100 signups, the most the site reports at once. There may be more waiting.'
        : '';
      note.classList.toggle('hidden', !capped);
    }
    setCounts();
  }

  async function decideAccount(user, action, approveBtn, rejectBtn) {
    if (action === 'reject') {
      const yes = await window.EasyUi.confirm(
        'Reject this signup?',
        (user.name || user.email) + ' will not get an account. This cannot be undone from the app.',
        'Reject'
      );
      if (!yes) return;
    } else {
      const yes = await window.EasyUi.confirm(
        'Approve this signup?',
        (user.name || user.email) +
          ' will get an account, and the site may email them to let them know. This cannot be undone from the app.',
        'Approve'
      );
      if (!yes) return;
    }
    // Both buttons go dead while the decision is in flight, so a fast
    // second tap cannot send the opposite decision for the same card.
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      await window.EasyApi.decideUser(user.id, action);
      state.accounts = state.accounts.filter((u) => u.id !== user.id);
      await window.EasyStore.addDecision({
        kind: 'account',
        id: user.id,
        title: user.name || user.email || 'Account signup',
        action: action === 'approve' ? 'approved' : 'rejected',
        at: Date.now(),
      });
      renderAccounts();
      renderRecent();
      window.EasyUi.toast(
        action === 'approve' ? 'Account approved.' : 'Account rejected.',
        'success'
      );
    } catch (e) {
      window.EasyUi.toast('Could not save that decision: ' + e.message, 'error', 8000);
    } finally {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  }

  /* ---------------- certificate search ---------------- */

  async function searchCerts(submitEv) {
    if (submitEv) submitEv.preventDefault();
    const input = $('certSearchInput');
    const box = $('certSearchResults');
    const q = input.value.trim();
    box.innerHTML = '';
    if (q.length < 2) {
      box.appendChild(U.el('p', 'hint', 'Type at least 2 characters of a name or certificate number.'));
      return;
    }
    const btn = $('certSearchBtn');
    btn.disabled = true;
    box.appendChild(U.el('p', 'hint', 'Searching...'));
    try {
      const rows = await window.EasyApi.certSearch(q);
      box.innerHTML = '';
      if (!rows.length) {
        box.appendChild(
          U.el('p', 'hint', 'No certificates match "' + q + '". Check the spelling, or try part of the name or number.')
        );
        return;
      }
      for (const row of rows) {
        const card = U.el('div', 'card');
        const head = U.el('div', 'card-head-row');
        head.appendChild(U.el('span', 'card-title', row.student));
        const statusLabel =
          row.status === 'publish'
            ? 'Published'
            : row.status === 'draft'
              ? 'Draft'
              : row.status
                ? row.status.charAt(0).toUpperCase() + row.status.slice(1)
                : '';
        head.appendChild(
          U.el('span', 'chip ' + (row.status === 'publish' ? 'chip-live' : 'chip-draft'), statusLabel)
        );
        card.appendChild(head);
        const meta = [
          row.course || '',
          row.number ? 'No. ' + row.number : '',
          row.expiry ? 'expires ' + U.fmtDateLoose(row.expiry) : '',
          row.completion ? 'completed ' + U.fmtDateLoose(row.completion) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (meta) card.appendChild(U.el('div', 'card-meta', meta));
        box.appendChild(card);
      }
    } catch (e) {
      box.innerHTML = '';
      if (e && e.status === 404) {
        box.appendChild(
          U.el(
            'p',
            'hint',
            'Certificate search needs EASY Suite 2.2.28 or newer on the site. Once the site is updated, search will work here.'
          )
        );
      } else {
        box.appendChild(U.el('p', 'error-text', 'Could not search certificates: ' + e.message));
      }
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- recent decisions + undo ---------------- */

  async function renderRecent() {
    const box = $('approvalsRecent');
    if (!box) return;
    box.innerHTML = '';
    const history = await window.EasyStore.getHistory();
    const recent = history.slice(0, 8);
    if (!recent.length) {
      box.appendChild(U.el('p', 'hint', 'Nothing decided yet from this app.'));
      return;
    }
    for (const entry of recent) {
      const row = U.el('div', 'recent-row');
      const label =
        entry.title + ': ' + entry.action + (entry.undone ? ' (undone)' : '');
      row.appendChild(U.el('span', 'recent-label', label));
      row.appendChild(U.el('span', 'recent-when', U.timeAgo(entry.at)));
      // Undo exists only where the API can truly reverse the decision:
      // a publish flips back to draft. Account decisions have no reverse
      // route, so no button is rendered for them at all.
      if (!entry.undone && (entry.kind === 'cert' || entry.kind === 'class')) {
        const undo = U.el('button', 'btn btn-small btn-secondary', 'Undo');
        undo.type = 'button';
        undo.addEventListener('click', () => undoDecision(entry, undo));
        row.appendChild(undo);
      }
      box.appendChild(row);
    }
  }

  async function undoDecision(entry, btn) {
    let yes;
    if (entry.kind === 'cert') {
      yes = await window.EasyUi.confirm(
        'Move this certificate back to draft?',
        'The student was already emailed that this certificate was ready. ' +
          'Moving it back to draft does not recall that email, and publishing it again later will not email them a second time.',
        'Move to draft'
      );
    } else {
      yes = await window.EasyUi.confirm(
        'Move this class back to draft?',
        '"' + entry.title + '" will stop showing on the site.',
        'Move to draft'
      );
    }
    if (!yes) return;
    btn.disabled = true;
    try {
      if (entry.kind === 'cert') await window.EasyApi.unpublishCert(entry.id);
      else await window.EasyApi.unpublishEvent(entry.id);
      await window.EasyStore.markUndone(entry.uid || entry.at);
      window.EasyUi.toast(
        entry.kind === 'cert'
          ? 'Moved back to drafts. The student email that already went out cannot be recalled.'
          : 'Moved back to drafts.',
        'success',
        7000
      );
      await loadAll();
    } catch (e) {
      window.EasyUi.toast('Could not undo: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- loading ---------------- */

  function applySnapshot(data) {
    state.certs = Array.isArray(data.certs) ? data.certs : [];
    state.certTotal = data.certTotal || state.certs.length;
    state.classes = Array.isArray(data.classes) ? data.classes : [];
    state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    renderCerts();
    renderClasses();
    renderAccounts();
  }

  async function loadAll() {
    const errors = [];
    const ok = { certs: false, classes: false, accounts: false };
    const jobs = [
      window.EasyApi.draftCerts()
        .then((r) => {
          ok.certs = true;
          state.certs = r.certs;
          state.certTotal = r.total;
          renderCerts();
        })
        .catch((e) => errors.push('certificates: ' + e.message)),
      (async () => {
        const today = U.todayYmd();
        const events = await window.EasyApi.eventsInRange(today, U.addMonths(today, 12));
        ok.classes = true;
        state.classes = events
          .filter((ev) => window.EasyApi.isWaitingClass(ev))
          .sort((a, b) => (a.startStamp < b.startStamp ? -1 : 1));
        renderClasses();
      })().catch((e) => errors.push('classes: ' + e.message)),
      window.EasyApi.pendingUsers()
        .then((list) => {
          ok.accounts = true;
          state.accounts = list;
          renderAccounts();
        })
        .catch((e) => errors.push('accounts: ' + e.message)),
    ];
    await Promise.all(jobs);
    renderRecent();
    const errBox = $('approvalsError');
    if (errBox) {
      errBox.textContent = errors.length ? 'Some queues did not load (' + errors.join('; ') + ').' : '';
      errBox.classList.toggle('hidden', !errors.length);
    }
    // Widget snapshot: only queues that actually loaded contribute.
    const widgetFields = {};
    if (ok.certs) widgetFields.certDrafts = state.certs.length;
    if (ok.classes) widgetFields.classDrafts = state.classes.length;
    if (ok.accounts) widgetFields.accountSignups = state.accounts.length;
    if (Object.keys(widgetFields).length) {
      window.EasyStore.updateWidgetCounts(widgetFields).catch(() => {});
    }
    const note = $('approvalsUpdated');
    if (!errors.length) {
      // A fully successful load becomes the new last good copy.
      await window.EasyStore.setLastGood('approvals', {
        certs: state.certs,
        certTotal: state.certTotal,
        classes: state.classes,
        accounts: state.accounts,
      });
      paintedSavedAt = Date.now();
      if (note) note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(Date.now()));
    } else if (note && paintedSavedAt) {
      note.textContent =
        !ok.certs && !ok.classes && !ok.accounts
          ? 'Could not refresh, showing the last good copy from ' + U.endPeriod(U.fmtClock(paintedSavedAt))
          : 'Checked at ' + U.fmtClock(Date.now()) + '; the queues that failed are still showing the last good copy.';
    }
  }

  async function show() {
    const saved = await window.EasyStore.getLastGood('approvals');
    if (saved && saved.data) {
      applySnapshot(saved.data);
      paintedSavedAt = saved.at;
      const note = $('approvalsUpdated');
      if (note) note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(saved.at)) + ' Refreshing...';
      renderRecent();
    }
    await loadAll();
  }

  function init() {
    const form = $('certSearchForm');
    if (form) form.addEventListener('submit', searchCerts);
  }

  window.EasyApprovals = { show, refresh: loadAll, init };
})();
