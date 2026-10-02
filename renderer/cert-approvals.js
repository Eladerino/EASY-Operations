// cert-approvals.js — Certificate draft review queue + Approvals sub-tabs.
//
// Instructors submit certificate drafts; the office reviews and publishes
// them here. Publishing flips the post to "publish", which is also what
// fires the student notification email (see the notifications plugin).
// No site snippet is needed: this uses the native /wp-json/wp/v2/cert
// endpoints. The tab is probe-gated like the others — accounts without
// certificate edit rights get an explanatory banner instead of the queue.
//
// This file also owns the Approvals sub-tab bar (Certificates | Accounts)
// and the pending-count badges. All API traffic goes through the main
// process via window.easyCert.certApprovals; this file never sees
// WordPress credentials.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.certApprovals;

  let initialized = false;
  let canReview = false;

  /* ---------------- shared badges ---------------- */

  // Both approval queues report here; the top-level Approvals tab shows
  // the combined pending count.
  window.EasyApprovalBadges = {
    counts: { certs: 0, classes: 0, accounts: 0 },
    set(kind, n) {
      this.counts[kind] = Math.max(0, n | 0);
      const paint = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.textContent = v;
        el.classList.toggle('hidden', v <= 0);
      };
      paint('subTabCertsBadge', this.counts.certs);
      paint('subTabClassesBadge', this.counts.classes);
      paint('subTabAccountsBadge', this.counts.accounts);
      paint('tabApprovalsBadge', this.counts.certs + this.counts.classes + this.counts.accounts);
    },
  };

  /* ---------------- sub-tab controller ---------------- */

  let lastSub = 'certs';

  function showSub(name) {
    lastSub = name;
    const certs = name === 'certs';
    const classes = name === 'classes';
    const accounts = name === 'accounts';
    $('subTabCerts').classList.toggle('active', certs);
    $('subTabClasses').classList.toggle('active', classes);
    $('subTabAccounts').classList.toggle('active', accounts);
    $('certApprovPanel').classList.toggle('hidden', !certs);
    $('classApprovPanel').classList.toggle('hidden', !classes);
    $('accountApprovPanel').classList.toggle('hidden', !accounts);
    // Prime the classes badge even when another sub-tab is active, so Pam
    // sees the full pending count on the Approvals tab. Skipped for plain
    // instructor accounts (no queue, no badge needed).
    if (window.EasyClassApprovals && (!window.EasyPerms || window.EasyPerms.privileged)) {
      window.EasyClassApprovals.primeBadge();
    }
    if (certs) {
      window.EasyCertApprovals.show();
    } else if (classes && window.EasyClassApprovals) {
      window.EasyClassApprovals.show();
    } else if (accounts && window.EasyApprovals) {
      window.EasyApprovals.show();
    }
  }

  window.EasyApprovalTabs = { show: (name) => showSub(name || lastSub), current: () => lastSub };

  /* ---------------- toast + confirm (mirror approvals.js) ---------------- */

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
    const el = $('certApprovError');
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  /* ---------------- queue ---------------- */

  function fmtDate(iso) {
    return String(iso || '').slice(0, 10);
  }

  // Course pretty names: look up the shared course catalogue (slug -> label).
  // Old drafts sometimes carry the raw slug in the title; anything already
  // reading as a display name (contains a space) is left alone.
  const slugLabelMap = (() => {
    const map = {};
    try {
      const cats = (window.EasyCertShared && window.EasyCertShared.titlesByCategory) || {};
      for (const list of Object.values(cats)) {
        for (const t of list) {
          if (t && t.value) map[String(t.value).toLowerCase()] = t.label || t.value;
        }
      }
    } catch (e) { /* catalogue unavailable: fall back to humanizing */ }
    return map;
  })();

  function prettyCourse(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';
    if (/\s/.test(str)) return str;
    const key = str.toLowerCase();
    if (slugLabelMap[key]) return slugLabelMap[key];
    return key.split(/[-_]+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  }

  function renderList(certs) {
    const list = $('certApprovList');
    list.innerHTML = '';
    $('certApprovEmpty').classList.toggle('hidden', certs.length > 0);
    window.EasyApprovalBadges.set('certs', certs.length);
    for (const c of certs) {
      const li = document.createElement('li');
      li.className = 'approv-row';

      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = c.student || '(no name)';
      const meta1 = document.createElement('div');
      meta1.className = 'hint';
      meta1.textContent = [prettyCourse(c.course), c.completionDate && `completed ${c.completionDate}`]
        .filter(Boolean).join(' · ');
      const meta2 = document.createElement('div');
      meta2.className = 'hint';
      meta2.textContent = [
        c.instructor && `Instructor ${c.instructor}`,
        c.date && `submitted ${fmtDate(c.date)}`,
      ].filter(Boolean).join(' · ');
      info.appendChild(name);
      info.appendChild(meta1);
      info.appendChild(meta2);
      if (c.certificateNumber) {
        const certNo = document.createElement('div');
        certNo.className = 'cert-no';
        certNo.textContent = c.certificateNumber;
        info.appendChild(certNo);
      }

      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      // Only offer a preview when the draft actually has a PDF attached —
      // old drafts may predate the media attachment and would just error.
      if (c.hasPdf) {
        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'btn btn-secondary btn-small';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', () => previewCert(c, previewBtn));
        actions.appendChild(previewBtn);
      }
      // Publish is a reviewer action: instructors see the queue read-only
      // (their own submissions' status); Pam and office accounts publish.
      const privileged = window.EasyPerms && window.EasyPerms.privileged;
      let publishBtn = null;
      if (privileged) {
        publishBtn = document.createElement('button');
        publishBtn.type = 'button';
        publishBtn.className = 'btn btn-primary btn-small';
        publishBtn.textContent = 'Publish';
        publishBtn.addEventListener('click', () => publishCert(c));
      }

      // Fix before publish: open the draft in the certificate form.
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        if (window.EasyCertEdit) window.EasyCertEdit.openDraft(c.id);
        else toast('Editing is unavailable in this build.', 'error');
      });

      // Order: review, fix, then commit.
      actions.appendChild(editBtn);
      if (publishBtn) actions.appendChild(publishBtn);

      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function publishCert(cert) {
    const courseBit = prettyCourse(cert.course);
    const what = courseBit ? `${courseBit} certificate` : 'certificate';
    const yes = await confirmDialog(
      'Publish this certificate?',
      `${cert.student}'s ${what} will go live and the student will be notified by email.`,
      'Publish'
    );
    if (!yes) return;
    try {
      const res = await api().publish(cert.id);
      if (!res.ok) throw new Error(res.error || 'Publish failed.');
      toast('Certificate published — the student has been notified.', 'success');
      await loadQueue();
    } catch (err) {
      toast(`Could not publish the certificate: ${err.message}`, 'error', 8000);
    }
  }

  async function previewCert(cert, btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Opening…';
    try {
      const res = await api().preview(cert.id);
      if (!res.ok) throw new Error(res.error || 'Preview failed.');
    } catch (err) {
      toast(`Could not open the preview: ${err.message}`, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function loadQueue() {
    showError('');
    $('certApprovLoading').classList.remove('hidden');
    try {
      const res = await api().list();
      if (!res.ok) throw new Error(res.error || 'Could not load the queue.');
      renderList(res.certs || []);
    } catch (err) {
      showError(err.message);
    } finally {
      $('certApprovLoading').classList.add('hidden');
    }
  }

  /* ---------------- entry ---------------- */

  async function show() {
    if (!initialized) {
      initialized = true;
      try {
        const probe = await api().probe();
        if (!probe.ok) {
          showError(probe.error || 'Could not check certificate review permissions.');
          return;
        }
        if (!probe.canReview) {
          $('certApprovPermBanner').textContent =
            'This WordPress account cannot review certificates. An admin needs to grant it permission to edit and publish certificates.';
          $('certApprovPermBanner').classList.remove('hidden');
          return;
        }
        canReview = true;
        if (probe.count) window.EasyApprovalBadges.set('certs', probe.count);
      } catch (err) {
        showError(`Could not check certificate review permissions: ${err.message}`);
        return;
      }
    }
    if (canReview) await loadQueue();
  }

  $('subTabCerts').addEventListener('click', () => showSub('certs'));
  $('subTabClasses').addEventListener('click', () => showSub('classes'));
  $('subTabAccounts').addEventListener('click', () => showSub('accounts'));
  $('certApprovRefresh').addEventListener('click', () => { if (canReview) loadQueue(); });

  window.EasyCertApprovals = { show, prettyCourse };
})();
