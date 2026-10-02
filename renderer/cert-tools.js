// Certificate tools UI: find & reprint + expiring soon, under the
// Certificates view's sub-tabs. Runs against window.easyCert.certTools
// (see preload.js). This file never sees credentials; the main process
// owns all network access.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.certTools;

  function toast(msg, kind, ms) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast toast-${kind || 'info'}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 400);
    }, ms || 5000);
  }

  function prettyCourse(course) {
    if (window.EasyCertApprovals && window.EasyCertApprovals.prettyCourse) {
      return window.EasyCertApprovals.prettyCourse(course);
    }
    return course || '';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10)
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ---------------- sub-tabs ---------------- */

  let lastSub = 'new';

  function showCertSub(name) {
    lastSub = name || 'new';
    const isNew = lastSub === 'new';
    const isLookup = lastSub === 'lookup';
    const isExpiring = lastSub === 'expiring';
    $('subTabCertNew').classList.toggle('active', isNew);
    $('subTabCertLookup').classList.toggle('active', isLookup);
    $('subTabCertExpiring').classList.toggle('active', isExpiring);
    $('certNewPanel').classList.toggle('hidden', !isNew);
    $('certLookupPanel').classList.toggle('hidden', !isLookup);
    $('certExpiringPanel').classList.toggle('hidden', !isExpiring);
    if (window.EasyViews) window.EasyViews.updateFooter();
    if (isExpiring) showExpiring();
  }

  /* ---------------- find & reprint ---------------- */

  async function runSearch() {
    const q = $('lookupQuery').value.trim();
    const list = $('lookupResults');
    list.innerHTML = '';
    if (!q) return;
    $('lookupLoading').classList.remove('hidden');
    try {
      const res = await api().search(q);
      if (!res.ok) throw new Error(res.error || 'Search failed.');
      renderLookup(res.certs || []);
    } catch (err) {
      toast(`Search failed: ${err.message}`, 'error', 8000);
    } finally {
      $('lookupLoading').classList.add('hidden');
    }
  }

  function renderLookup(certs) {
    const list = $('lookupResults');
    list.innerHTML = '';
    if (!certs.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'No issued certificates matched.';
      list.appendChild(li);
      return;
    }
    for (const c of certs) {
      const li = document.createElement('li');

      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = c.student || '(no name)';
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = [prettyCourse(c.course), c.completionDate && `completed ${c.completionDate}`]
        .filter(Boolean).join(' · ');
      info.appendChild(name);
      info.appendChild(meta);
      if (c.certificateNumber) {
        const no = document.createElement('div');
        no.className = 'cert-no';
        no.textContent = c.certificateNumber;
        info.appendChild(no);
      }

      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-small';
      btn.textContent = 'Reprint';
      btn.addEventListener('click', () => reprintCert(c, btn));
      actions.appendChild(btn);

      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function reprintCert(cert, btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Opening…';
    try {
      const res = await api().reprint(cert.id);
      if (!res.ok) throw new Error(res.error || 'Reprint failed.');
      // The stored PDF opens in a viewer window; print from its toolbar
      // so the system dialog offers an explicit printer choice.
    } catch (err) {
      toast(`Could not open the certificate: ${err.message}`, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* ---------------- expiring soon (grouped by company) ---------------- */

  // The badge is the warning signal: it always reflects the full 90-day
  // warning set. The 30/60/90 buttons only change which slice of that set
  // you're viewing, so they filter the cached results client-side and
  // never touch the badge.
  let expiringCache = [];
  let expiringLoaded = false;
  let expiringDays = 90;

  function setExpiringBadge(count) {
    const badge = $('subTabCertExpiringBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  async function fetchExpiring() {
    const res = await api().expiring(90);
    if (!res.ok) throw new Error(res.error || 'Could not load.');
    expiringCache = res.certs || [];
    setExpiringBadge(expiringCache.length);
    expiringLoaded = true;
    return expiringCache;
  }

  async function loadExpiring() {
    const box = $('expiringResults');
    box.innerHTML = '';
    $('expiringLoading').classList.remove('hidden');
    try {
      await fetchExpiring();
      renderExpiring(filteredExpiring());
    } catch (err) {
      setExpiringBadge(0);
      toast(`Could not load expiring certificates: ${err.message}`, 'error', 8000);
    } finally {
      $('expiringLoading').classList.add('hidden');
    }
  }

  // Render the Expiring sub-tab from cache, fetching first if needed.
  async function showExpiring() {
    if (!expiringLoaded) {
      await loadExpiring();
      return;
    }
    renderExpiring(filteredExpiring());
  }

  // Silent prime for the startup scan: fetch + badge, no DOM churn,
  // no toast on failure.
  async function primeExpiring() {
    try {
      await fetchExpiring();
    } catch {
      /* startup scan stays silent; the badge just stays hidden */
    }
  }

  function filteredExpiring() {
    return expiringCache.filter((c) => (c.daysLeft || 0) <= expiringDays);
  }

  function expiryLabel(daysLeft) {
    if (daysLeft === 0) return 'expires today';
    if (daysLeft === 1) return 'expires tomorrow';
    return `expires in ${daysLeft} days`;
  }

  function contactLine(c) {
    const bits = [];
    if (c.studentEmail) bits.push(c.studentEmail);
    if (c.studentPhone) bits.push(c.studentPhone);
    if (c.companyContact) bits.push(`Company contact: ${c.companyContact}`);
    return bits.join(' · ');
  }

  function renderExpiring(certs) {
    const box = $('expiringResults');
    box.innerHTML = '';
    if (!certs.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = `Nothing expiring in the next ${expiringDays} days.`;
      box.appendChild(p);
      return;
    }

    // Group by company; most urgent company first.
    const groups = new Map();
    for (const c of certs) {
      const key = (c.company || '').trim() || 'No company listed';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => Math.min(...a[1].map((c) => c.daysLeft)) - Math.min(...b[1].map((c) => c.daysLeft))
    );

    for (const [company, members] of ordered) {
      members.sort((a, b) => a.daysLeft - b.daysLeft);
      const soonest = members[0];

      const group = document.createElement('div');
      group.className = 'exp-company';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'exp-company-header';
      const title = document.createElement('strong');
      title.textContent = company;
      const sub = document.createElement('span');
      sub.className = 'hint';
      const n = members.length;
      sub.textContent = `${n} expiring · soonest ${fmtDate(soonest.expiryDate)} (${expiryLabel(soonest.daysLeft)})`;
      const chev = document.createElement('span');
      chev.className = 'exp-chev';
      chev.textContent = '▾';
      header.appendChild(title);
      header.appendChild(sub);
      header.appendChild(chev);

      const body = document.createElement('ul');
      body.className = 'approv-list exp-members';
      for (const c of members) {
        const li = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'approv-info';
        const name = document.createElement('strong');
        name.textContent = c.student || '(no name)';
        const meta = document.createElement('div');
        meta.className = 'hint';
        meta.textContent = [prettyCourse(c.course), `${fmtDate(c.expiryDate)} (${expiryLabel(c.daysLeft)})`]
          .filter(Boolean).join(' · ');
        info.appendChild(name);
        info.appendChild(meta);
        const contact = contactLine(c);
        if (contact) {
          const cl = document.createElement('div');
          cl.className = 'hint';
          cl.textContent = contact;
          info.appendChild(cl);
        }
        li.appendChild(info);
        body.appendChild(li);
      }

      header.addEventListener('click', () => {
        const collapsed = body.classList.toggle('hidden');
        chev.textContent = collapsed ? '▸' : '▾';
      });

      group.appendChild(header);
      group.appendChild(body);
      box.appendChild(group);
    }
  }

  function init() {
    $('subTabCertNew').addEventListener('click', () => showCertSub('new'));
    $('subTabCertLookup').addEventListener('click', () => showCertSub('lookup'));
    $('subTabCertExpiring').addEventListener('click', () => showCertSub('expiring'));

    $('lookupSearch').addEventListener('click', runSearch);
    $('lookupQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });
    document.querySelectorAll('.exp-window').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.exp-window').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        expiringDays = parseInt(b.dataset.days, 10) || 90;
        // View-only filter over the cached 90-day set; the badge stays put.
        renderExpiring(filteredExpiring());
      });
    });
    $('expiringRefresh').addEventListener('click', loadExpiring);

    window.EasyCertTabs = {
      show: (name) => showCertSub(name || lastSub),
      current: () => lastSub,
    };
    // Kept for the main tab controller: no heavy load until the
    // Expiring sub-tab itself is shown.
    window.EasyCertTools = { onCertsTabShown() {}, prime: primeExpiring };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
