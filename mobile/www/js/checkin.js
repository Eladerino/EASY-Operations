// checkin.js: the class check-in screen for one class: opened from
// a Today card on the day, or from the class editor in Schedule when
// the link is made ahead of time. It shows the state of the class's
// QR sign-in link on the Suite check-in routes, the
// QR itself drawn in the app (bundled qrcode-generator, the same
// library the Suite admin box uses), a full-screen show mode for
// holding the phone up in the classroom, the QR as a shareable PNG,
// and create / replace / close for the link, each confirmed first.
// Check-ins show as counts only here; anyone flagged for review is
// handled in the Suite or the desktop app, never judged on a phone.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  let current = null; // { ev, payload }
  let wakeLock = null;
  // The class roster rides alongside the link state: check-in lives
  // on the roster records themselves, so the checked-in students can
  // be listed and edited here (name spelling above all) through the
  // same roster write the desktop app uses.
  let rosterData = null; // { records, revision }
  let rosterLoadError = '';
  let listOpen = false;
  let editState = null; // { id, values } while one student is edited

  function drawQr(canvas, text, px) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.max(2, Math.floor(px / count));
    const size = cell * count;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
  }

  function errText(e) {
    if (e && e.status === 404) {
      return 'The site does not have check-in links yet. It needs EASY Suite 2.2.51 or newer.';
    }
    return (e && e.message) || 'Something went wrong.';
  }

  function actionBtn(label, cls, fn) {
    const b = U.el('button', 'btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function countsLine(p) {
    return (
      (p.checked_in || 0) + ' of ' + (p.roster_total || 0) + ' on the roster checked in' +
      (p.needs_review ? ', ' + p.needs_review + ' waiting for office review' : '') + '.'
    );
  }

  function render() {
    const body = $('checkinBody');
    body.innerHTML = '';
    renderState(body);
    renderList(body);
  }

  function renderState(body) {
    const p = current && current.payload;
    if (!p) {
      body.appendChild(U.el('p', 'hint', 'Loading the check-in link...'));
      return;
    }
    if (!p.has_link) {
      if (p.waiver_ready === false) {
        body.appendChild(U.el('p', 'error-text',
          'The waiver text for this kind of class is not set on the site yet, so a sign-in link cannot be made.'));
        body.appendChild(U.el('p', 'hint', countsLine(p)));
        return;
      }
      body.appendChild(U.el('p', 'hint',
        'No sign-in link yet for this class. Make one and students can check themselves in from their phones.'));
      body.appendChild(U.el('p', 'hint', countsLine(p)));
      const row = U.el('div', 'card-actions');
      row.appendChild(actionBtn('Create the sign-in link', 'btn-primary', () => act('create')));
      body.appendChild(row);
      return;
    }
    if (p.closed) {
      body.appendChild(U.el('p', 'hint', 'Sign-in is closed for this class.'));
      body.appendChild(U.el('p', 'hint', countsLine(p)));
      const row = U.el('div', 'card-actions');
      row.appendChild(actionBtn('Make a new link', 'btn-primary', () => act('regenerate')));
      body.appendChild(row);
      return;
    }
    body.appendChild(U.el('p', 'hint', 'Sign-in is open until ' + U.endPeriod(U.fmtDateTime(p.expires_at))));
    body.appendChild(U.el('p', 'hint', countsLine(p)));
    const wrap = U.el('div', 'qr-wrap');
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    body.appendChild(wrap);
    try {
      drawQr(canvas, p.qr_url, 520);
    } catch (e) {
      body.appendChild(U.el('p', 'error-text',
        'Could not draw the QR code on this phone. The link below still works typed in.'));
    }
    if (p.code) body.appendChild(U.el('p', 'checkin-code', p.code));
    body.appendChild(U.el('p', 'hint checkin-url', p.qr_url));
    const row = U.el('div', 'card-actions');
    row.appendChild(actionBtn('Show full screen', 'btn-primary', showBig));
    row.appendChild(actionBtn('Share or save the QR image', 'btn-secondary', sharePng));
    body.appendChild(row);
    const row2 = U.el('div', 'card-actions');
    row2.appendChild(actionBtn('Make a new link', 'btn-secondary', () => act('regenerate')));
    row2.appendChild(actionBtn('Close sign-in', 'btn-secondary', () => act('close')));
    body.appendChild(row2);
    body.appendChild(U.el('p', 'hint',
      'Making a new link replaces this one: the old code stops working, so print a fresh sign-in sheet if you already printed one.'));
  }

  /* ---------------- who checked in (expandable, editable) ---------------- */

  const ATTENDED = ['checked_in', 'manual', 'needs_review'];

  function statusLabel(rec) {
    if (rec.checkin_status === 'needs_review') return 'Needs review';
    if (rec.checkin_status === 'manual') return 'Checked in (marked in person)';
    return 'Checked in';
  }

  function renderList(body) {
    if (!current) return;
    const section = U.el('div', 'ci-section');
    if (rosterLoadError) {
      section.appendChild(U.el('p', 'error-text',
        'Could not load the student list: ' + rosterLoadError));
      body.appendChild(section);
      return;
    }
    if (!rosterData) {
      section.appendChild(U.el('p', 'hint', 'Loading the student list...'));
      body.appendChild(section);
      return;
    }
    const attended = rosterData.records
      .filter((r) => ATTENDED.includes(r.checkin_status))
      .sort((a, b) =>
        (a.checkin_status === 'needs_review' ? 0 : 1) -
          (b.checkin_status === 'needs_review' ? 0 : 1) ||
        String(a.name || '').localeCompare(String(b.name || '')));
    section.appendChild(actionBtn(
      (listOpen ? 'Hide' : 'Show') + ' who checked in (' + attended.length + ')',
      'btn-secondary',
      () => { listOpen = !listOpen; render(); }
    ));
    if (listOpen) {
      if (!attended.length) {
        section.appendChild(U.el('p', 'hint', 'Nobody has checked in yet.'));
      }
      for (const rec of attended) section.appendChild(listRow(rec));
    }
    body.appendChild(section);
  }

  function listRow(rec) {
    const wrap = U.el('div', 'ci-item');
    const row = U.el('div', 'ci-row');
    const main = U.el('div', 'ci-main');
    main.appendChild(U.el('p', 'ci-name', rec.name || '(no name)'));
    main.appendChild(U.el('p', 'hint',
      statusLabel(rec) + (rec.employer ? ' · ' + rec.employer : '')));
    row.appendChild(main);
    if (rec.id) {
      row.appendChild(actionBtn(
        rec.checkin_status === 'needs_review' ? 'Review' : 'Edit',
        'btn-small btn-secondary',
        () => startEdit(rec)
      ));
    }
    wrap.appendChild(row);
    if (editState && editState.id === rec.id) wrap.appendChild(editForm(rec));
    return wrap;
  }

  const EDIT_FIELDS = [
    ['name', 'Name (as it should appear on the certificate)', 'text'],
    ['employer', 'Employer', 'text'],
    ['email', 'Email', 'email'],
    ['phone', 'Phone', 'tel'],
    ['emergency_name', 'Emergency contact name', 'text'],
    ['emergency_phone', 'Emergency contact phone', 'tel'],
  ];

  function startEdit(rec) {
    const values = {};
    for (const [key] of EDIT_FIELDS) values[key] = rec[key] || '';
    editState = { id: rec.id, values };
    listOpen = true;
    render();
  }

  function editForm(rec) {
    const form = U.el('div', 'ci-edit');
    for (const [key, label, type] of EDIT_FIELDS) {
      form.appendChild(U.el('label', '', label));
      const input = document.createElement('input');
      input.id = 'ciF-' + key;
      input.type = type;
      input.value = editState.values[key] || '';
      form.appendChild(input);
    }
    const row = U.el('div', 'card-actions');
    if (rec.checkin_status === 'needs_review') {
      row.appendChild(actionBtn('Approve check-in', 'btn-primary', () => saveEdit(true)));
      row.appendChild(actionBtn('Save changes', 'btn-secondary', () => saveEdit(false)));
    } else {
      row.appendChild(actionBtn('Save changes', 'btn-primary', () => saveEdit(false)));
    }
    row.appendChild(actionBtn('Cancel', 'btn-secondary', () => { editState = null; render(); }));
    form.appendChild(row);
    return form;
  }

  async function saveEdit(approve) {
    if (!editState || !rosterData || !current) return;
    const rec = rosterData.records.find((r) => r.id === editState.id);
    if (!rec) { editState = null; render(); return; }
    const values = {};
    for (const [key] of EDIT_FIELDS) {
      const input = $('ciF-' + key);
      values[key] = input ? input.value.trim() : (editState.values[key] || '');
    }
    if (!values.name) {
      window.EasyUi.toast('The name cannot be empty.', 'error');
      return;
    }
    // Keep the draft: if the save bounces (the list changed on the
    // site), the form reopens with this typing still in it.
    editState.values = values;
    // The record goes back complete, every field it arrived with:
    // the server sanitizes what it is sent, so a field left out
    // would be erased (waiver, signature and check-in stamps above
    // all). Only the edited fields, and the status on an approval,
    // change.
    const next = rosterData.records.map((r) =>
      r.id === rec.id
        ? { ...r, ...values, ...(approve ? { checkin_status: 'checked_in' } : {}) }
        : r);
    try {
      const saved = await window.EasyApi.saveRoster(current.ev.id, next, rosterData.revision);
      rosterData = { records: saved.roster, revision: saved.revision };
      editState = null;
      try {
        current.payload = await window.EasyApi.checkin(current.ev.id);
      } catch (e) { /* the counts refresh is a nicety, not the save */ }
      render();
      window.EasyUi.toast(approve ? 'Check-in approved.' : 'Student updated.', 'success');
    } catch (e) {
      if (e && e.status === 409) {
        try {
          const full = await window.EasyApi.rosterFull(current.ev.id);
          rosterData = { records: full.roster, revision: full.revision };
        } catch (e2) { /* the toast below still explains the reload */ }
        render();
        window.EasyUi.toast(
          'The list changed on the site and has been reloaded. Check your edit, then save again.',
          'error', 7000);
        return;
      }
      window.EasyUi.toast(errText(e), 'error', 7000);
    }
  }

  async function act(kind) {
    const ev = current.ev;
    try {
      if (kind === 'create') {
        current.payload = await window.EasyApi.checkinCreate(ev.id);
        window.EasyUi.toast('Sign-in link created.', 'success');
      } else if (kind === 'regenerate') {
        const yes = await window.EasyUi.confirm('Make a new link?',
          'The current code stops working right away. Anyone holding the old sheet will need the new one.',
          'Make new link');
        if (!yes) return;
        current.payload = await window.EasyApi.checkinRegenerate(ev.id);
        window.EasyUi.toast('New sign-in link created.', 'success');
      } else if (kind === 'close') {
        const yes = await window.EasyUi.confirm('Close sign-in?',
          'Students will no longer be able to check in for this class with this code.',
          'Close sign-in');
        if (!yes) return;
        current.payload = await window.EasyApi.checkinClose(ev.id);
        window.EasyUi.toast('Sign-in closed.', 'success');
      }
      render();
    } catch (e) {
      window.EasyUi.toast(errText(e), 'error', 7000);
    }
  }

  async function showBig() {
    const p = current.payload;
    $('qrShowTitle').textContent = current.ev.title;
    $('qrShowCode').textContent = p.code || '';
    $('qrShowUrl').textContent = p.qr_url || '';
    try {
      drawQr($('qrShowCanvas'), p.qr_url, 880);
    } catch (e) {
      // The typed link and short code stay on screen either way.
    }
    $('qrShowView').classList.remove('hidden');
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      // Wake lock is a nicety only; the screen settings still apply.
    }
  }

  function hideBig() {
    $('qrShowView').classList.add('hidden');
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) { /* already released */ }
      wakeLock = null;
    }
  }

  async function sharePng() {
    const p = current.payload;
    try {
      const qrCanvas = document.createElement('canvas');
      drawQr(qrCanvas, p.qr_url, 840);
      const pad = 60;
      const out = document.createElement('canvas');
      out.width = qrCanvas.width + pad * 2;
      out.height = qrCanvas.height + pad * 2;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(qrCanvas, pad, pad);
      const dataUrl = out.toDataURL('image/png');
      const name = 'easy-check-in-' + (p.code || 'qr') + '.png';
      // Browser / webview share sheet where the platform offers one.
      if (navigator.canShare && window.fetch) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Class check-in QR' });
          return;
        }
      }
      // Installed app: save the PNG and open it, so it can be shared
      // or printed from the viewer, the same route certificate PDFs take.
      if (Plugins.Filesystem && Plugins.ApkInstaller && Plugins.ApkInstaller.openFile) {
        const written = await Plugins.Filesystem.writeFile({
          path: name,
          data: dataUrl.split(',')[1],
          directory: 'CACHE',
        });
        const path = ((written && written.uri) || '').replace(/^file:\/\//, '');
        if (!path) throw new Error('The image was made, but its file path was not reported.');
        await Plugins.ApkInstaller.openFile({ path, mimeType: 'image/png' });
        return;
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.click();
    } catch (e) {
      if (e && e.name === 'AbortError') return; // backed out of the share sheet
      window.EasyUi.toast('Could not share the QR image: ' + errText(e), 'error', 7000);
    }
  }

  async function open(ev) {
    current = { ev, payload: null };
    rosterData = null;
    rosterLoadError = '';
    listOpen = false;
    editState = null;
    $('todayMain').classList.add('hidden');
    $('rosterView').classList.add('hidden');
    $('checkinView').classList.remove('hidden');
    $('checkinTitle').textContent = ev.title;
    if (window.EasyUi) window.EasyUi.openSubview(close);
    render();
    try {
      current.payload = await window.EasyApi.checkin(ev.id);
    } catch (e) {
      const body = $('checkinBody');
      body.innerHTML = '';
      body.appendChild(U.el('p', 'error-text', 'Could not load check-in: ' + errText(e)));
      return;
    }
    render();
    try {
      const full = await window.EasyApi.rosterFull(ev.id);
      if (!current || current.ev.id !== ev.id) return; // screen moved on
      rosterData = { records: full.roster, revision: full.revision };
    } catch (e) {
      if (!current || current.ev.id !== ev.id) return;
      rosterLoadError = errText(e);
    }
    render();
  }

  function close() {
    hideBig();
    $('checkinView').classList.add('hidden');
    $('todayMain').classList.remove('hidden');
    current = null;
    rosterData = null;
    editState = null;
  }

  $('checkinBack').addEventListener('click', () => {
    if (window.EasyUi) window.EasyUi.closeSubview();
    else close();
  });
  $('qrShowClose').addEventListener('click', hideBig);

  window.EasyCheckin = { open, close };
})();
