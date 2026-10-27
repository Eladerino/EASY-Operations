// checkin.js: the class check-in screen for one of today's classes:
// the state of its QR sign-in link on the Suite check-in routes, the
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
  }

  function close() {
    hideBig();
    $('checkinView').classList.add('hidden');
    $('todayMain').classList.remove('hidden');
    current = null;
  }

  $('checkinBack').addEventListener('click', () => {
    if (window.EasyUi) window.EasyUi.closeSubview();
    else close();
  });
  $('qrShowClose').addEventListener('click', hideBig);

  window.EasyCheckin = { open, close };
})();
