// roster.js - per-class student roster (manual enrollment).
//
// Pam enrolls phone/walk-in students onto a class from the Schedule tab.
// The roster is stored by EASY Suite as event meta and synced through
// window.easyCert.schedule; this file never sees WordPress credentials.
// Every add/edit/delete PUTs the full roster array and re-renders from
// the server's sanitized copy, which is the source of truth.
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
  let roster = []; // the server's copy; re-rendered after every save
  let editingIndex = -1; // -1 means the form is adding, not editing

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
    eventId = id;
    roster = [];
    editingIndex = -1;
    $('rosterModalTitle').textContent = 'Students';
    const when = fmtHeaderDate(date);
    $('rosterModalSub').textContent = when ? `${title}, ${when}` : String(title || '');
    rosterError(null);
    hideForm();
    render();
    $('rosterModal').classList.remove('hidden');
    load();
  }

  function close() {
    $('rosterModal').classList.add('hidden');
    eventId = null;
  }

  /* ---------------- loading ---------------- */

  async function load() {
    rosterError(null);
    setBusy(true);
    $('rosterCount').textContent = 'Loading students…';
    try {
      const res = await api().getRoster(eventId);
      if (!res.ok) throw new Error(res.error || 'Could not load the student list.');
      roster = Array.isArray(res.roster) ? res.roster : [];
    } catch (err) {
      rosterError(err.message);
      roster = [];
    } finally {
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

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'roster-chip-x';
    xBtn.textContent = '×';
    xBtn.title = 'Remove student';
    xBtn.setAttribute('aria-label', `Remove ${name}`);
    xBtn.addEventListener('click', () => removeStudent(index));
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

    // On edit, carry the server-managed fields through untouched; new
    // entries are tagged as manual (the server defaults it anyway).
    const base = editingIndex >= 0 ? roster[editingIndex] : null;
    const record = {
      name,
      employer: $('rosterEmployer').value.trim(),
      phone: $('rosterPhone').value.trim(),
      email: $('rosterEmail').value.trim(),
      payment: $('rosterPayment').value,
      notes: $('rosterNotes').value.trim(),
      source: (base && base.source) || 'manual',
    };
    if (base) {
      if (base.added !== undefined) record.added = base.added;
      if (base.added_by !== undefined) record.added_by = base.added_by;
    }

    const next = roster.slice();
    if (editingIndex >= 0) {
      next[editingIndex] = record;
    } else {
      next.push(record);
    }
    await saveRoster(next, editingIndex >= 0 ? 'Student updated.' : 'Student added.');
  }

  /* ---------------- delete ---------------- */

  async function removeStudent(index) {
    const student = roster[index];
    if (!student) return;
    const name = String(student.name || '').trim() || 'this student';
    const confirm = window.EasySchedule && window.EasySchedule.confirm;
    if (typeof confirm !== 'function') return; // fail closed: never delete without a confirm
    const yes = await confirm(
      'Remove student?',
      `"${name}" will be taken off this class.`,
      'Remove'
    );
    if (!yes) return;
    const next = roster.filter((_, i) => i !== index);
    await saveRoster(next, 'Student removed.');
  }

  /* ---------------- save (full roster PUT) ---------------- */

  async function saveRoster(next, successMessage) {
    rosterError(null);
    setBusy(true);
    try {
      const res = await api().saveRoster(eventId, next);
      if (!res.ok) throw new Error(res.error || 'Could not save the student list.');
      roster = Array.isArray(res.roster) ? res.roster : [];
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

  window.EasyRoster = { open, close };

})();
