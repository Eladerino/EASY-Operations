// online-learning.js — Online Learning tab (CONCEPT PREVIEW).
//
// Demo-only tab with hard-coded sample data, for showing and
// discussing the planned online-course admin view (student statuses,
// course inquiries, practical queue) before the real online-learning
// flow exists. Nothing here touches the network or the WordPress site;
// the attention badges are computed from the sample data and update as
// the demo actions are clicked. Clicking into the tab always shows a
// disclaimer first so nobody mistakes this for live data.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------------- sample data ---------------- */

  const students = [
    { name: 'Sarah Pike', course: 'Fall Protection', status: 'In theory', progress: 62, lastActive: 'today', daysInactive: 0 },
    { name: 'Tom Hynes', course: 'Counter Balance Forklift', status: 'Theory complete', progress: 100, lastActive: 'today', daysInactive: 0 },
    { name: 'Aisha Rahman', course: 'Confined Space Rescue', status: 'Stalled', progress: 34, lastActive: '9 days ago', daysInactive: 9 },
    { name: 'Dave Mercer', course: 'MEWP', status: 'In theory', progress: 30, lastActive: 'yesterday', daysInactive: 1 },
    { name: 'Lisa O\u2019Brien', course: 'Emergency First Aid', status: 'Practical booked', progress: 100, lastActive: 'today', daysInactive: 0 },
    { name: 'Mark Squires', course: 'Fall Protection', status: 'Certified', progress: 100, lastActive: '3 days ago', daysInactive: 3 },
    { name: 'Jenna Clarke', course: 'MEWP', status: 'In theory', progress: 81, lastActive: 'today', daysInactive: 0 },
    { name: 'Rob Walsh', course: 'Counter Balance Forklift', status: 'Theory complete', progress: 100, lastActive: 'yesterday', daysInactive: 1 },
  ];

  const inquiries = [
    { id: 1, student: 'Jenna Clarke', course: 'MEWP', when: '2 hours ago', question: 'Does the pre-start inspection checklist differ for electric vs diesel lifts?' },
    { id: 2, student: 'Dave Mercer', course: 'MEWP', when: '5 hours ago', question: 'The module says three points of contact \u2014 does that apply getting off the platform too?' },
    { id: 3, student: 'Aisha Rahman', course: 'Confined Space Rescue', when: 'yesterday', question: 'Stuck on the ventilation calculation in module 4 \u2014 the numbers don\u2019t match mine.' },
  ];

  const toBook = [
    { id: 1, student: 'Tom Hynes', course: 'Counter Balance Forklift' },
    { id: 2, student: 'Rob Walsh', course: 'Counter Balance Forklift' },
  ];
  const awaiting = [
    { id: 3, student: 'Lisa O\u2019Brien', course: 'Emergency First Aid', booked: 'Oct 6, 9:00 AM', location: 'EASY Training Room', instructor: 'M. Doyle' },
  ];

  const STATUS_CLASS = {
    'In theory': 'status-in-theory',
    'Theory complete': 'status-theory-complete',
    'Stalled': 'status-stalled',
    'Practical booked': 'status-practical-booked',
    'Certified': 'status-certified',
  };

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
  // listeners (renderer.js's handlers also fire and just hide the modal).
  function confirmDisclaimer() {
    return new Promise((resolve) => {
      $('modalTitle').textContent = 'Concept preview';
      $('modalBody').textContent = 'The Online Learning tab is a demo with sample data, built to plan the future online-course admin view. Nothing here connects to real students, courses, or bookings yet.';
      const ok = $('modalOk');
      const cancel = $('modalCancel');
      ok.textContent = 'Got it, show me';
      cancel.style.display = '';
      cancel.textContent = 'Not now';
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

  /* ---------------- badges ---------------- */

  function paintBadges() {
    const paint = (id, v) => {
      const el = $(id);
      if (!el) return;
      el.textContent = v;
      el.classList.toggle('hidden', v <= 0);
    };
    paint('subTabOnlineInquiriesBadge', inquiries.length);
    paint('subTabOnlinePracticalsBadge', toBook.length);
    paint('tabOnlineLearningBadge', inquiries.length + toBook.length);
  }

  /* ---------------- metrics ---------------- */

  // Headline numbers for the Students sub-tab, computed from the sample
  // data so they stay truthful as the demo is clicked around.
  function renderMetrics() {
    const active = students.filter((s) => s.status !== 'Certified');
    const courses = new Set(students.map((s) => s.course));
    const avg = Math.round(students.reduce((a, s) => a + s.progress, 0) / students.length);
    const nudge = students.filter((s) => (s.daysInactive || 0) >= 7);
    const theoryDone = students.filter((s) => s.status === 'Theory complete' || s.status === 'Practical booked');
    $('olStatActive').textContent = active.length;
    $('olStatActiveSub').textContent = `Across ${courses.size} courses`;
    $('olStatProgress').textContent = `${avg}%`;
    $('olStatNudge').textContent = nudge.length;
    $('olStatNudgeSub').textContent = nudge.length ? 'No activity in 7+ days' : 'Everyone is active';
    $('olStatTheory').textContent = theoryDone.length;
  }

  /* ---------------- students ---------------- */

  function statusChip(status) {
    const span = document.createElement('span');
    span.className = `status-chip ${STATUS_CLASS[status] || ''}`;
    span.textContent = status;
    return span;
  }

  function renderStudents() {
    const q = $('onlineStudentSearch').value.trim().toLowerCase();
    const f = $('onlineStudentFilter').value;
    const list = $('onlineStudentList');
    list.innerHTML = '';
    let shown = 0;
    for (const s of students) {
      if (f && s.status !== f) continue;
      if (q && !`${s.name} ${s.course}`.toLowerCase().includes(q)) continue;
      shown++;
      const li = document.createElement('li');
      li.className = 'approv-row';
      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = s.name;
      const meta = document.createElement('div');
      meta.className = 'ol-meta';
      meta.textContent = `${s.course} \u00B7 last active ${s.lastActive}`;
      const bar = document.createElement('div');
      bar.className = 'ol-progress';
      const fill = document.createElement('span');
      fill.style.width = `${s.progress}%`;
      bar.appendChild(fill);
      info.appendChild(name);
      info.appendChild(meta);
      info.appendChild(bar);
      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      actions.appendChild(statusChip(s.status));
      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
    $('onlineStudentEmpty').classList.toggle('hidden', shown > 0);
  }

  /* ---------------- inquiries ---------------- */

  let replyTarget = null;

  function openReplyModal(q) {
    replyTarget = q;
    $('replyTo').value = `${q.student} \u2014 ${q.course}`;
    $('replyQuestion').textContent = `\u201C${q.question}\u201D`;
    $('replyBody').value = '';
    $('replyModal').classList.remove('hidden');
    setTimeout(() => $('replyBody').focus(), 50);
  }

  function closeReplyModal() {
    $('replyModal').classList.add('hidden');
    replyTarget = null;
  }

  $('replyCancel').addEventListener('click', closeReplyModal);

  $('replySend').addEventListener('click', () => {
    const q = replyTarget;
    if (!q) return;
    if (!$('replyBody').value.trim()) {
      toast('Write a reply first.', 'error');
      return;
    }
    const i = inquiries.findIndex((x) => x.id === q.id);
    if (i >= 0) inquiries.splice(i, 1);
    closeReplyModal();
    renderInquiries();
    paintBadges();
    toast('Demo: reply sent.', 'success');
  });

  function renderInquiries() {
    const list = $('onlineInquiryList');
    list.innerHTML = '';
    $('onlineInquiryEmpty').classList.toggle('hidden', inquiries.length > 0);
    for (const q of inquiries) {
      const li = document.createElement('li');
      li.className = 'approv-row';
      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = q.student;
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = `${q.course} \u00B7 ${q.when}`;
      const text = document.createElement('p');
      text.className = 'ol-question';
      text.textContent = `\u201C${q.question}\u201D`;
      info.appendChild(name);
      info.appendChild(meta);
      info.appendChild(text);
      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'btn btn-primary btn-small';
      replyBtn.textContent = 'Reply\u2026';
      replyBtn.addEventListener('click', () => openReplyModal(q));
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-secondary btn-small';
      doneBtn.textContent = 'Mark resolved';
      doneBtn.addEventListener('click', () => {
        const i = inquiries.findIndex((x) => x.id === q.id);
        if (i >= 0) inquiries.splice(i, 1);
        renderInquiries();
        paintBadges();
        toast('Demo: inquiry marked as resolved.', 'success');
      });
      actions.appendChild(replyBtn);
      actions.appendChild(doneBtn);
      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  /* ---------------- practicals ---------------- */

  // "2026-10-08" + "09:00" -> "Oct 8, 9:00 AM" (site-local wall clock; demo only).
  function fmtSlot(dateStr, timeStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let timePart = timeStr || '09:00';
    const m = /^(\d{1,2}):(\d{2})/.exec(timePart);
    if (m) {
      let h = parseInt(m[1], 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      timePart = `${h}:${m[2]} ${ampm}`;
    }
    return `${datePart}, ${timePart}`;
  }

  let bookingTarget = null;

  function openBookModal(p) {
    bookingTarget = p;
    $('bookStudentName').value = `${p.student} \u2014 ${p.course}`;
    $('bookDate').value = '';
    $('bookTime').value = '09:00';
    $('bookLocation').value = 'EASY Training Room';
    $('bookInstructor').value = 'M. Doyle';
    $('bookModal').classList.remove('hidden');
  }

  function closeBookModal() {
    $('bookModal').classList.add('hidden');
    bookingTarget = null;
  }

  $('bookCancel').addEventListener('click', closeBookModal);

  $('bookConfirm').addEventListener('click', () => {
    const p = bookingTarget;
    if (!p) return;
    const date = $('bookDate').value;
    if (!date) {
      toast('Pick a date for the practical.', 'error');
      return;
    }
    const i = toBook.findIndex((x) => x.id === p.id);
    if (i >= 0) toBook.splice(i, 1);
    awaiting.push({
      id: p.id,
      student: p.student,
      course: p.course,
      booked: fmtSlot(date, $('bookTime').value),
      location: $('bookLocation').value.trim() || 'TBD',
      instructor: $('bookInstructor').value.trim() || 'TBD',
    });
    closeBookModal();
    renderPracticals();
    paintBadges();
    toast('Demo: practical booked.', 'success');
  });

  function renderPracticals() {
    const bookList = $('onlinePracBookList');
    bookList.innerHTML = '';
    $('onlinePracBookEmpty').classList.toggle('hidden', toBook.length > 0);
    for (const p of toBook) {
      const li = document.createElement('li');
      li.className = 'approv-row';
      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = p.student;
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = p.course;
      info.appendChild(name);
      info.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const bookBtn = document.createElement('button');
      bookBtn.type = 'button';
      bookBtn.className = 'btn btn-primary btn-small';
      bookBtn.textContent = 'Book\u2026';
      bookBtn.addEventListener('click', () => openBookModal(p));
      actions.appendChild(bookBtn);
      li.appendChild(info);
      li.appendChild(actions);
      bookList.appendChild(li);
    }

    const doneList = $('onlinePracDoneList');
    doneList.innerHTML = '';
    $('onlinePracDoneEmpty').classList.toggle('hidden', awaiting.length > 0);
    for (const p of awaiting) {
      const li = document.createElement('li');
      li.className = 'approv-row';
      const info = document.createElement('div');
      info.className = 'approv-info';
      const name = document.createElement('strong');
      name.textContent = p.student;
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = `${p.course} \u00B7 ${p.booked}${p.location ? ` \u00B7 ${p.location}` : ''} \u00B7 instructor: ${p.instructor}`;
      info.appendChild(name);
      info.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'approv-actions';
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-secondary btn-small';
      doneBtn.textContent = 'Mark complete';
      doneBtn.addEventListener('click', () => {
        const i = awaiting.findIndex((x) => x.id === p.id);
        if (i >= 0) awaiting.splice(i, 1);
        renderPracticals();
        paintBadges();
        toast('Demo: practical signed off.', 'success');
      });
      actions.appendChild(doneBtn);
      li.appendChild(info);
      li.appendChild(actions);
      doneList.appendChild(li);
    }
  }

  /* ---------------- sub-tab controller ---------------- */

  let lastSub = 'students';

  function showSub(name) {
    if (name) lastSub = name;
    const s = lastSub === 'students';
    const i = lastSub === 'inquiries';
    const p = lastSub === 'practicals';
    $('subTabOnlineStudents').classList.toggle('active', s);
    $('subTabOnlineInquiries').classList.toggle('active', i);
    $('subTabOnlinePracticals').classList.toggle('active', p);
    $('onlineStudentsPanel').classList.toggle('hidden', !s);
    $('onlineInquiriesPanel').classList.toggle('hidden', !i);
    $('onlinePracticalsPanel').classList.toggle('hidden', !p);
  }

  window.EasyOnlineTabs = { show: showSub, current: () => lastSub };

  /* ---------------- wiring ---------------- */

  $('subTabOnlineStudents').addEventListener('click', () => showSub('students'));
  $('subTabOnlineInquiries').addEventListener('click', () => showSub('inquiries'));
  $('subTabOnlinePracticals').addEventListener('click', () => showSub('practicals'));
  $('onlineStudentSearch').addEventListener('input', renderStudents);
  $('onlineStudentFilter').addEventListener('change', renderStudents);

  // The tab is demo-only: every click in shows the disclaimer first.
  $('tabOnlineLearning').addEventListener('click', async () => {
    const yes = await confirmDisclaimer();
    if (yes) window.EasyViews.showView('online');
  });

  /* ---------------- initial paint ---------------- */

  renderMetrics();
  renderStudents();
  renderInquiries();
  renderPracticals();
  paintBadges();
})();
