// roster.js - per-class student roster (manual enrollment).
//
// Pam enrolls phone/walk-in students onto a class from the Schedule tab.
// The roster is stored by EASY Suite as event meta and synced through
// window.easyCert.schedule; this file never sees WordPress credentials.
// Every add/edit/delete PUTs the full roster array and re-renders from
// the server's sanitized copy, which is the source of truth.
// The PUT carries the revision from the last load; if someone else
// changed the list meanwhile (e.g. an online seat sale), the server
// rejects the save and this file reloads the fresh copy instead of
// silently overwriting it.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => window.easyCert.schedule;

  /* ---------------- toast (local copy; schedule.js owns its own) ---------------- */

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

  /* ---------------- state ---------------- */

  let eventId = null;
  let currentTitle = '';
  let currentDate = '';
  let roster = []; // the server's copy; re-rendered after every save
  let rosterRevision = null; // revision from the last load/save; sent back on save
  let editingIndex = -1; // -1 means the form is adding, not editing
  let loadToken = 0; // guards against stale loads painting the wrong class

  const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const PAYMENT_LABELS = { paid: 'Paid', unpaid: 'Unpaid', po: 'PO', comp: 'Comp' };

  // "2026-10-19" -> "Oct 19, 2026" for the modal subheading.
  function fmtHeaderDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return '';
    return `${MONTHS_SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }

  function rosterError(message) {
    const el = $('rosterModalError');
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  function setBusy(busy) {
    $('rosterFormSave').disabled = busy;
    $('rosterFormCancel').disabled = busy;
    $('rosterAdd').disabled = busy;
    $('rosterClose').disabled = busy;
  }

  /* ---------------- open / close ---------------- */

  function open({ id, title, date } = {}) {
    if (!id) return;
    // Load token: if a previous load() is still in flight when a new class
    // is opened, the stale response is ignored instead of painting the
    // wrong class's students (and risking a save onto the wrong class).
    const token = ++loadToken;
    eventId = id;
    currentTitle = title || '';
    currentDate = date || '';
    roster = [];
    rosterRevision = null;
    editingIndex = -1;
    $('rosterModalTitle').textContent = 'Students';
    const when = fmtHeaderDate(date);
    $('rosterModalSub').textContent = when ? `${title}, ${when}` : String(title || '');
    rosterError(null);
    hideForm();
    render();
    $('rosterModal').classList.remove('hidden');
    load(token);
    // The check-in panel at the top of this modal loads alongside
    // the roster for the same class (checkin.js).
    if (window.EasyCheckinPanel) window.EasyCheckinPanel.load(id, title);
  }

  function close() {
    $('rosterModal').classList.add('hidden');
    if (window.EasyCheckinPanel) window.EasyCheckinPanel.reset();
    eventId = null;
  }

  /* ---------------- loading ---------------- */

  async function load(token) {
    rosterError(null);
    setBusy(true);
    $('rosterCount').textContent = 'Loading students…';
    try {
      const res = await api().getRoster(eventId);
      // A newer open() superseded this load; drop the stale response.
      if (token !== loadToken) return;
      if (!res.ok) throw new Error(res.error || 'Could not load the student list.');
      roster = Array.isArray(res.roster) ? res.roster : [];
      rosterRevision = res.revision !== undefined ? res.revision : null;
    } catch (err) {
      if (token !== loadToken) return;
      rosterError(err.message);
      roster = [];
    } finally {
      if (token !== loadToken) return;
      setBusy(false);
      render();
    }
  }

  /* ---------------- rendering ---------------- */

  function render() {
    const box = $('rosterChips');
    box.innerHTML = '';
    const n = roster.length;
    $('rosterCount').textContent =
      n === 0 ? '' : `${n} student${n === 1 ? '' : 's'}`;
    $('rosterEmpty').classList.toggle('hidden', n !== 0);
    roster.forEach((student, i) => box.appendChild(studentChip(student, i)));
    // The check-in panel's who-checked-in list renders from this same
    // copy, so an edit or approval here is reflected there at once.
    if (window.EasyCheckinPanel) window.EasyCheckinPanel.renderAttendees(roster);
  }

  /* ---------------- check-in list actions (checkin.js buttons) ---------------- */

  function findById(id) {
    return roster.findIndex((r) => r && r.id === id);
  }

  function editRecord(id) {
    const index = findById(id);
    if (index >= 0) editStudent(index);
  }

  async function approveCheckin(id) {
    const index = findById(id);
    if (index < 0) return;
    const student = roster[index];
    if (!student || student.checkin_status !== 'needs_review') return;
    const next = roster.slice();
    next[index] = { ...student, checkin_status: 'checked_in' };
    await saveRoster(next, `Check-in approved for ${String(student.name || 'the student')}.`);
  }

  // The certificate pipeline: open the New certificate form filled
  // in from the checked-in record (the name exactly as confirmed at
  // check-in) and this class, so nothing gets retyped. The form's
  // own validation still applies before anything is posted, and the
  // draft lands in Approvals like any other.
  function createCert(id) {
    const index = findById(id);
    if (index < 0) return;
    const student = roster[index];
    if (!student) return;
    if (!window.EasyCertEdit || typeof window.EasyCertEdit.prefillNew !== 'function') {
      rosterError('The certificate form is not available. Try reloading the app.');
      return;
    }
    let phone = String(student.phone || '').replace(/\D/g, '');
    if (phone.length === 11 && phone.startsWith('1')) phone = phone.slice(1);
    const acf = {
      student_name: String(student.name || ''),
      student_email: String(student.email || ''),
      student_phone: phone.length === 10 ? phone : '',
      company: String(student.employer || ''),
      course_title: currentTitle,
      completion_date: currentDate,
    };
    close();
    window.EasyCertEdit.prefillNew(acf);
  }

  function studentChip(student, index) {
    const name = String((student && student.name) || '').trim() || '(no name)';

    const chip = document.createElement('div');
    chip.className = 'roster-chip';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'roster-chip-name';
    nameBtn.textContent = name;
    const details = [
      student.employer ? `Employer: ${student.employer}` : '',
      student.phone ? `Phone: ${student.phone}` : '',
      student.email ? `Email: ${student.email}` : '',
      student.payment && PAYMENT_LABELS[student.payment]
        ? `Payment: ${PAYMENT_LABELS[student.payment]}` : '',
    ].filter(Boolean).join('\n');
    if (details) nameBtn.title = details;
    nameBtn.addEventListener('click', () => editStudent(index));
    chip.appendChild(nameBtn);

    // Check-in state rides on the record: mark it on the chip so the
    // list itself shows who is in and who still needs a review.
    if (student.checkin_status === 'checked_in' || student.checkin_status === 'manual') {
      const mark = document.createElement('span');
      mark.className = 'roster-chip-status';
      mark.textContent = '✓';
      mark.title = 'Checked in';
      chip.appendChild(mark);
    } else if (student.checkin_status === 'needs_review') {
      const mark = document.createElement('span');
      mark.className = 'roster-chip-status roster-chip-review';
      mark.textContent = '!';
      mark.title = 'Check-in needs review';
      chip.appendChild(mark);
    }

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'roster-chip-x';
    xBtn.textContent = '×';
    xBtn.title = 'Remove student';
    xBtn.setAttribute('aria-label', `Remove ${name}`);
    xBtn.addEventListener('click', (e) => removeStudent(index, e.currentTarget));
    chip.appendChild(xBtn);

    return chip;
  }

  /* ---------------- add / edit form ---------------- */

  function showForm(student) {
    $('rosterName').value = student ? String(student.name || '') : '';
    $('rosterEmployer').value = student ? String(student.employer || '') : '';
    $('rosterPhone').value = student ? String(student.phone || '') : '';
    $('rosterEmail').value = student ? String(student.email || '') : '';
    $('rosterPayment').value = student && PAYMENT_LABELS[student.payment] ? student.payment : '';
    $('rosterNotes').value = student ? String(student.notes || '') : '';
    $('rosterFormSave').textContent = student ? 'Save changes' : 'Add student';
    rosterError(null);
    $('rosterFormWrap').classList.remove('hidden');
    $('rosterAdd').classList.add('hidden');
    setTimeout(() => $('rosterName').focus(), 50);
  }

  function hideForm() {
    editingIndex = -1;
    $('rosterFormWrap').classList.add('hidden');
    $('rosterAdd').classList.remove('hidden');
  }

  function editStudent(index) {
    editingIndex = index;
    showForm(roster[index]);
  }

  async function saveForm() {
    rosterError(null);
    const name = $('rosterName').value.trim();
    if (!name) {
      rosterError("Enter the student's full name.");
      $('rosterName').focus();
      return;
    }
    const email = $('rosterEmail').value.trim();
    // Catch typos before the round-trip: the server silently drops invalid
    // addresses, which is confusing when the saved row differs from typing.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rosterError('That email address does not look right. Check it and try again.');
      $('rosterEmail').focus();
      return;
    }

    // On edit, the record goes back COMPLETE: start from the loaded
    // record and override only the form's fields. The server
    // sanitizes what it is sent, so any field left out is erased -
    // and a roster record carries far more than this form shows
    // (check-in status and stamps, emergency contact, waiver and
    // signature references, attendance days). Carrying the loaded
    // record through is what keeps an edit from wiping a student's
    // check-in when all that was meant was a name fix.
    const base = editingIndex >= 0 ? roster[editingIndex] : null;
    const record = {
      ...(base || {}),
      name,
      employer: $('rosterEmployer').value.trim(),
      phone: $('rosterPhone').value.trim(),
      email,
      payment: $('rosterPayment').value,
      notes: $('rosterNotes').value.trim(),
      source: (base && base.source) || 'manual',
    };

    const next = roster.slice();
    if (editingIndex >= 0) {
      next[editingIndex] = record;
    } else {
      next.push(record);
    }
    await saveRoster(next, editingIndex >= 0 ? 'Student updated.' : 'Student added.');
  }

  /* ---------------- delete ---------------- */

  async function removeStudent(index, btn) {
    const student = roster[index];
    if (!student) return;
    const name = String(student.name || '').trim() || 'this student';
    // Online buyers manage themselves through their order: the server
    // rejects removing checkout records anyway, so say so up front in
    // plain language instead of offering a confirm that cannot work.
    if (student.source === 'checkout') {
      rosterError('This student paid online. Cancel or refund their order on the website to remove them.');
      return;
    }
    const confirm = window.EasySchedule && window.EasySchedule.confirm;
    if (typeof confirm !== 'function') return; // fail closed: never delete without a confirm
    if (btn) btn.disabled = true;
    try {
      const yes = await confirm(
        'Remove student?',
        `"${name}" will be taken off this class.`,
        'Remove'
      );
      if (!yes) return;
      const next = roster.filter((_, i) => i !== index);
      await saveRoster(next, 'Student removed.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------------- save (full roster PUT) ---------------- */

  async function saveRoster(next, successMessage) {
    rosterError(null);
    setBusy(true);
    try {
      const res = await api().saveRoster(eventId, next, rosterRevision);
      if (!res.ok) {
        if (res.conflict) {
          // Someone else changed the list since it was loaded (e.g. an
          // online seat sale). Show the fresh copy; nothing was overwritten.
          // The in-progress entry is kept in the form so it is not lost:
          // it becomes a plain add onto the fresh list, and the user can
          // check the reloaded list before saving it again.
          roster = Array.isArray(res.roster) ? res.roster : [];
          rosterRevision = res.revision !== undefined ? res.revision : null;
          editingIndex = -1;
          $('rosterFormSave').textContent = 'Add student';
          render();
          rosterError(res.error || 'The student list changed. It has been reloaded and your entry was kept — please check the list, then save it again.');
          return;
        }
        throw new Error(res.error || 'Could not save the student list.');
      }
      roster = Array.isArray(res.roster) ? res.roster : [];
      rosterRevision = res.revision !== undefined ? res.revision : rosterRevision;
      hideForm();
      render();
      toast(successMessage, 'success');
    } catch (err) {
      rosterError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- wiring ---------------- */

  $('rosterAdd').addEventListener('click', () => {
    editingIndex = -1;
    showForm(null);
  });
  $('rosterFormCancel').addEventListener('click', hideForm);
  $('rosterFormSave').addEventListener('click', saveForm);
  $('rosterClose').addEventListener('click', close);

  window.EasyRoster = { open, close, editRecord, approveCheckin, createCert };

})();
