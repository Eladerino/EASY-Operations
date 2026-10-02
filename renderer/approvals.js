// approvals.js — Pending UltimateMember approvals tab.
//
// Lists site accounts with account_status = awaiting_admin_review via the
// EASY Approvals Bridge snippet, and lets a privileged account approve or
// reject them. The tab is probe-gated like the Schedule tab: accounts
// without the promote_users capability get an explanatory banner instead
// of the queue. All API traffic goes through the main process via
// window.easyCert.approvals; this file never sees WordPress credentials.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.approvals;

  let initialized = false;
  let canReview = false;

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
  // listeners (now painted above the other modals via z-index).
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
    const el = $('approvError');
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  /* ---------------- queue ---------------- */

  function renderList(users) {
    const list = $('approvList');
    list.innerHTML = '';
    $('approvEmpty').classList.toggle('hidden', users.length > 0);
    if (window.EasyApprovalBadges) window.EasyApprovalBadges.set('accounts', users.length);
    for (const u of users) {
      const li = document.createElement('li');
      li.className = 'approv-row';

      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = u.name || '(no name)';
      const meta = document.createElement('div');
      meta.className = 'hint';
      const registered = String(u.registered || '').slice(0, 10);
      meta.textContent = [u.email, registered && `signed up ${registered}`].filter(Boolean).join(' · ');
      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'btn btn-primary btn-small';
      approveBtn.textContent = 'Approve';
      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'btn btn-secondary btn-small';
      rejectBtn.textContent = 'Reject';
      approveBtn.addEventListener('click', () => decide(u, 'approve'));
      rejectBtn.addEventListener('click', () => decide(u, 'reject'));
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);

      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function decide(user, action) {
    const label = action === 'approve' ? 'Approve' : 'Reject';
    const detail = action === 'approve'
      ? `${user.name || user.email} will be able to log in to the site.`
      : `${user.name || user.email} will be blocked from logging in.`;
    const yes = await confirmDialog(`${label} this account?`, detail, label);
    if (!yes) return;
    try {
      const res = await api()[action](user.id);
      if (!res.ok) throw new Error(res.error || `${label} failed.`);
      toast(`Account ${action === 'approve' ? 'approved' : 'rejected'}.`, 'success');
      await loadQueue();
    } catch (err) {
      toast(`Could not ${action} the account: ${err.message}`, 'error', 8000);
    }
  }

  async function loadQueue() {
    showError('');
    $('approvLoading').classList.remove('hidden');
    try {
      const res = await api().list();
      if (!res.ok) throw new Error(res.error || 'Could not load the queue.');
      renderList(res.users || []);
    } catch (err) {
      showError(err.message);
    } finally {
      $('approvLoading').classList.add('hidden');
    }
  }

  /* ---------------- entry ---------------- */

  async function show() {
    if (!initialized) {
      initialized = true;
      try {
        const probe = await api().probe();
        if (!probe.ok) {
          showError(probe.error || 'Could not check approval permissions.');
          return;
        }
        if (!probe.canReview) {
          const banner = $('approvPermBanner');
          banner.textContent = probe.missing
            ? 'The approvals snippet is not installed on the site yet. Ask an admin to install the EASY Approvals Bridge plugin, then reopen this tab.'
            : 'This WordPress account cannot review new accounts. An admin needs to grant it user-management rights (promote_users).';
          banner.classList.remove('hidden');
          return;
        }
        canReview = true;
      } catch (err) {
        showError(`Could not check approval permissions: ${err.message}`);
        return;
      }
    }
    if (canReview) await loadQueue();
  }

  $('tabApprovals').addEventListener('click', () => window.EasyViews.showView('approvals'));
  $('approvRefresh').addEventListener('click', () => { if (canReview) loadQueue(); });

  window.EasyApprovals = { show };
})();
