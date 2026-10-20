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

  async function loadAll() {
    const errors = [];
    const jobs = [
      window.EasyApi.draftCerts()
        .then((r) => {
          state.certs = r.certs;
          state.certTotal = r.total;
          renderCerts();
          const note = $('certsNote');
          if (note) {
            const more = state.certTotal > state.certs.length;
            note.textContent = more
              ? 'Showing the first ' + state.certs.length + ' of ' + state.certTotal + ' drafts. The rest are waiting behind these.'
              : '';
            note.classList.toggle('hidden', !more);
          }
        })
        .catch((e) => errors.push('certificates: ' + e.message)),
      (async () => {
        const today = U.todayYmd();
        const events = await window.EasyApi.eventsInRange(today, U.addMonths(today, 12));
        state.classes = events
          .filter((ev) => window.EasyApi.isWaitingClass(ev))
          .sort((a, b) => (a.startStamp < b.startStamp ? -1 : 1));
        renderClasses();
      })().catch((e) => errors.push('classes: ' + e.message)),
      window.EasyApi.pendingUsers()
        .then((list) => {
          state.accounts = list;
          renderAccounts();
          const note = $('accountsNote');
          if (note) {
            // The site caps this list at 100 and reports no total, so
            // a full page means there may be more behind it.
            const capped = list.length >= 100;
            note.textContent = capped
              ? 'Showing 100 signups, the most the site reports at once. There may be more waiting.'
              : '';
            note.classList.toggle('hidden', !capped);
          }
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
  }

  window.EasyApprovals = { show: loadAll, refresh: loadAll };
})();
