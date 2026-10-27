// checkin.js - class check-in QR panel inside the roster (Students)
// modal: the desktop counterpart of EASY Manager's check-in screen,
// on the same EASY Suite check-in routes, with the same options
// (create / replace / close the link, show the QR big, save it as a
// PNG, copy the link). Brandon asked for this as its own quick option
// in the desktop app (Oct 27), ahead of and alongside the planned
// Print Packages: sometimes one quick QR is the whole job. The QR is
// drawn locally with the bundled qrcode-generator (renderer/qrcode.js,
// the same library the Suite and Manager use); this file never sees
// WordPress credentials, everything goes through
// window.easyCert.schedule.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.schedule;

  /* ---------------- toast (local copy; roster.js owns its own) ---------------- */

  function toast(message, type, ms) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type || 'info'}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 400);
    }, ms || 5000);
  }

  /* ---------------- state ---------------- */

  let eventId = null;
  let classTitle = '';
  let payload = null;
  let loadToken = 0; // a stale load must not paint the wrong class
  let attendeesOpen = true;

  /* ---------------- QR drawing (same as Manager's) ---------------- */

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

  function qrPngDataUrl() {
    const qrCanvas = document.createElement('canvas');
    drawQr(qrCanvas, payload.qr_url, 840);
    const pad = 60;
    const out = document.createElement('canvas');
    out.width = qrCanvas.width + pad * 2;
    out.height = qrCanvas.height + pad * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(qrCanvas, pad, pad);
    return out.toDataURL('image/png');
  }

  /* ---------------- wording ---------------- */

  function countsLine(p) {
    return (
      (p.checked_in || 0) + ' of ' + (p.roster_total || 0) + ' on the roster checked in' +
      (p.needs_review ? ', ' + p.needs_review + ' waiting for office review' : '') + '.'
    );
  }

  function fmtExpiry(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || '');
    return d.toLocaleString('en-CA', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionBtn(label, cls, fn) {
    const b = el('button', 'btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------------- rendering ---------------- */

  function render(message) {
    const body = $('checkinBody');
    if (!body) return;
    body.innerHTML = '';
    if (message) {
      body.appendChild(el('p', 'hint', message));
      return;
    }
    const p = payload;
    if (!p) {
      body.appendChild(el('p', 'hint', 'Loading the check-in link…'));
      return;
    }
    if (!p.has_link) {
      if (p.waiver_ready === false) {
        body.appendChild(el('p', 'error-text',
          'The waiver text for this kind of class is not set on the site yet, so a sign-in link cannot be made.'));
        body.appendChild(el('p', 'hint', countsLine(p)));
        return;
      }
      body.appendChild(el('p', 'hint',
        'No sign-in link yet for this class. Make one and students can check themselves in from their phones.'));
      body.appendChild(el('p', 'hint', countsLine(p)));
      const row = el('div', 'checkin-actions');
      row.appendChild(actionBtn('Create the sign-in link', 'btn-primary', () => act('create')));
      body.appendChild(row);
      return;
    }
    if (p.closed) {
      body.appendChild(el('p', 'hint', 'Sign-in is closed for this class.'));
      body.appendChild(el('p', 'hint', countsLine(p)));
      const row = el('div', 'checkin-actions');
      row.appendChild(actionBtn('Make a new link', 'btn-primary', () => act('regenerate')));
      body.appendChild(row);
      return;
    }
    body.appendChild(el('p', 'hint', 'Sign-in is open until ' + fmtExpiry(p.expires_at) + '.'));
    body.appendChild(el('p', 'hint', countsLine(p)));
    const wrap = el('div', 'checkin-qr-wrap');
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    body.appendChild(wrap);
    try {
      drawQr(canvas, p.qr_url, 260);
    } catch (e) {
      body.appendChild(el('p', 'error-text',
        'Could not draw the QR code here. The link below still works typed in.'));
    }
    if (p.code) body.appendChild(el('p', 'checkin-code', p.code));
    body.appendChild(el('p', 'hint checkin-url', p.qr_url));
    const row = el('div', 'checkin-actions');
    row.appendChild(actionBtn('Show full screen', 'btn-primary', showBig));
    row.appendChild(actionBtn('Save QR image', 'btn-secondary', savePng));
    row.appendChild(actionBtn('Copy link', 'btn-secondary', copyLink));
    body.appendChild(row);
    const row2 = el('div', 'checkin-actions');
    row2.appendChild(actionBtn('Make a new link', 'btn-secondary', () => act('regenerate')));
    row2.appendChild(actionBtn('Close sign-in', 'btn-secondary', () => act('close')));
    body.appendChild(row2);
    body.appendChild(el('p', 'hint',
      'Making a new link replaces this one: the old code stops working, so print a fresh sign-in sheet if you already printed one.'));
  }

  /* ---------------- who checked in (expandable) ---------------- */
  // Rendered from roster.js's copy of the roster (it calls this on
  // every render), so this list and the student chips never disagree.
  // The buttons act through roster.js too: Edit opens its student
  // form, Approve clears a needs-review flag, and Certificate opens
  // the New certificate form prefilled from the record.

  const ATTENDED = ['checked_in', 'manual', 'needs_review'];

  function renderAttendees(records) {
    const box = $('checkinAttendees');
    if (!box) return;
    box.innerHTML = '';
    if (!Array.isArray(records)) return;
    const attended = records
      .filter((r) => r && ATTENDED.includes(r.checkin_status))
      .sort((a, b) =>
        (a.checkin_status === 'needs_review' ? 0 : 1) -
          (b.checkin_status === 'needs_review' ? 0 : 1) ||
        String(a.name || '').localeCompare(String(b.name || '')));
    const reviewCount = attended.filter((r) => r.checkin_status === 'needs_review').length;
    const head = el('div', 'checkin-attendees-head');
    const toggle = actionBtn(
      (attendeesOpen ? 'Hide' : 'Show') + ' who checked in (' + attended.length + ')' +
        (reviewCount ? ' · ' + reviewCount + ' to review' : ''),
      'btn-secondary btn-small',
      () => { attendeesOpen = !attendeesOpen; renderAttendees(records); }
    );
    head.appendChild(toggle);
    box.appendChild(head);
    if (!attendeesOpen) return;
    if (!attended.length) {
      box.appendChild(el('p', 'hint', 'Nobody has checked in yet.'));
      return;
    }
    for (const rec of attended) {
      const row = el('div', 'checkin-attendee-row');
      const main = el('div', 'checkin-attendee-main');
      main.appendChild(el('span', 'checkin-attendee-name', rec.name || '(no name)'));
      main.appendChild(el('span', 'hint',
        (rec.checkin_status === 'needs_review' ? 'Needs review'
          : rec.checkin_status === 'manual' ? 'Checked in (marked in person)' : 'Checked in') +
        (rec.employer ? ' · ' + rec.employer : '')));
      row.appendChild(main);
      if (rec.id && window.EasyRoster) {
        if (rec.checkin_status === 'needs_review') {
          row.appendChild(actionBtn('Approve', 'btn-primary btn-small',
            () => window.EasyRoster.approveCheckin(rec.id)));
        }
        row.appendChild(actionBtn('Edit', 'btn-secondary btn-small',
          () => window.EasyRoster.editRecord(rec.id)));
        if (rec.checkin_status !== 'needs_review') {
          row.appendChild(actionBtn('Certificate', 'btn-secondary btn-small',
            () => window.EasyRoster.createCert(rec.id)));
        }
      }
      box.appendChild(row);
    }
  }

  /* ---------------- actions ---------------- */

  async function act(kind) {
    const id = eventId;
    try {
      if (kind === 'regenerate') {
        const confirm = window.EasySchedule && window.EasySchedule.confirm;
        if (typeof confirm !== 'function') return; // fail closed, same as roster deletes
        const yes = await confirm('Make a new link?',
          'The current code stops working right away. Anyone holding the old sheet will need the new one.',
          'Make new link');
        if (!yes) return;
      }
      if (kind === 'close') {
        const confirm = window.EasySchedule && window.EasySchedule.confirm;
        if (typeof confirm !== 'function') return;
        const yes = await confirm('Close sign-in?',
          'Students will no longer be able to check in for this class with this code.',
          'Close sign-in');
        if (!yes) return;
      }
      const res = await api().checkinAction(id, kind);
      if (!res.ok) throw new Error(res.error || 'Something went wrong.');
      if (eventId !== id) return; // the modal moved on to another class
      payload = res.state || {};
      render();
      toast(
        kind === 'create' ? 'Sign-in link created.'
          : kind === 'regenerate' ? 'New sign-in link created.' : 'Sign-in closed.',
        'success'
      );
    } catch (err) {
      toast(err.message, 'error', 7000);
    }
  }

  async function savePng() {
    if (!payload || !payload.qr_url) return;
    try {
      const res = await window.easyCert.savePngCopy(
        qrPngDataUrl(), 'easy-check-in-' + (payload.code || 'qr') + '.png');
      if (res && res.canceled) return;
      if (!res || !res.ok) throw new Error((res && res.error) || 'Could not save the image.');
      toast('QR image saved.', 'success');
    } catch (err) {
      toast('Could not save the QR image: ' + err.message, 'error', 7000);
    }
  }

  async function copyLink() {
    if (!payload || !payload.qr_url) return;
    try {
      await navigator.clipboard.writeText(payload.qr_url);
      toast('Check-in link copied.', 'success');
    } catch (e) {
      // Clipboard needs window focus in some builds; fall back to a
      // temporary field the user can copy from.
      const ta = document.createElement('textarea');
      ta.value = payload.qr_url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('Check-in link copied.', 'success');
      } catch (e2) {
        toast('Copy this link: ' + payload.qr_url, 'info', 9000);
      }
      ta.remove();
    }
  }

  /* ---------------- full-screen show ---------------- */

  function showBig() {
    if (!payload || !payload.qr_url) return;
    $('checkinQrTitle').textContent = classTitle || 'Class check-in';
    $('checkinQrCode').textContent = payload.code || '';
    $('checkinQrUrl').textContent = payload.qr_url || '';
    try {
      drawQr($('checkinQrCanvas'), payload.qr_url, 560);
    } catch (e) {
      // The typed link and short code stay on screen either way.
    }
    $('checkinQrModal').classList.remove('hidden');
  }

  function hideBig() {
    $('checkinQrModal').classList.add('hidden');
  }

  /* ---------------- open / reset (called by roster.js) ---------------- */

  async function load(id, title) {
    const token = ++loadToken;
    eventId = id;
    classTitle = title || '';
    payload = null;
    render();
    try {
      const res = await api().getCheckin(id);
      if (token !== loadToken) return;
      if (!res.ok) {
        render(res.error || 'Could not load the check-in link.');
        return;
      }
      payload = res.state || {};
      render();
    } catch (err) {
      if (token !== loadToken) return;
      render(err.message);
    }
  }

  function reset() {
    loadToken++;
    eventId = null;
    classTitle = '';
    payload = null;
    const box = $('checkinAttendees');
    if (box) box.innerHTML = '';
    hideBig();
  }

  $('checkinQrClose').addEventListener('click', hideBig);
  $('checkinQrSave').addEventListener('click', savePng);

  window.EasyCheckinPanel = { load, reset, renderAttendees };
})();
