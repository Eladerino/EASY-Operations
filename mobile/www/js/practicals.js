// practicals.js: the hands-on practical for online courses (EASY Suite
// 2.2.45, module-practicals.php).
//
// Instructors post practical times and record results for their own
// times. The office sees every evaluator's times, posts times for any
// evaluator, and books learners who have not picked a time yet. The
// Suite enforces all of it; the screen only follows its answers (the
// GET reply says whether this account is office, and which courses it
// can post times for).
//
// The list has three parts: times that have started and still have a
// learner without a result ("Needs a result"), times still to come,
// and the last 30 days of finished times. Recording a pass makes the
// certificate: a draft for the office to review, or published right
// away when the Suite is set to (the reply's autoPublish says which,
// so the wording before saving is accurate).
//
// The last good reply is saved on the phone and painted first, so the
// screen opens with something even when the site is slow.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);

  const state = {
    data: null, // GET /practicals reply
    waiting: null, // GET /practicals/waiting reply (office)
    loading: false,
    result: null, // { slot, booking } being recorded
    booking: null, // waiting learner being booked
  };

  const RESULT_LABEL = { passed: 'Passed', failed: 'Not passed', no_show: 'No show', cancelled: 'Cancelled' };

  /* ---------------- helpers ---------------- */

  function showError(id, message) {
    const node = $(id);
    node.textContent = message || '';
    node.classList.toggle('hidden', !message);
  }

  function chip(text, kind) {
    return U.el('span', 'chip' + (kind ? ' chip-' + kind : ''), text);
  }

  function button(label, cls, onClick) {
    const b = U.el('button', 'btn btn-small ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function contactLine(learner) {
    const line = U.el('div', 'card-meta');
    const parts = [];
    if (learner.phone) {
      const a = U.el('a', '', learner.phone);
      a.href = 'tel:' + learner.phone.replace(/[^\d+]/g, '');
      parts.push(a);
    }
    if (learner.email) {
      const a = U.el('a', '', learner.email);
      a.href = 'mailto:' + learner.email;
      parts.push(a);
    }
    parts.forEach((p, i) => {
      if (i) line.appendChild(document.createTextNode(' · '));
      line.appendChild(p);
    });
    return parts.length ? line : null;
  }

  // Slots split into the three lists. "Needs a result" holds started
  // times that still have a live booking, wherever they started.
  function splitSlots(slots) {
    const needs = [];
    const upcoming = [];
    const past = [];
    for (const s of slots) {
      const live = s.bookings.some((b) => b.status === 'booked');
      if (s.started && live && s.status === 'open') needs.push(s);
      else if (!s.ended && s.status === 'open') upcoming.push(s);
      else past.push(s);
    }
    past.reverse(); // Newest first.
    return { needs, upcoming, past };
  }

  // Learners in started times still waiting for a result: the badge
  // count on the Practicals tab and the box on Today.
  function resultsToRecord(data) {
    return splitSlots((data && data.slots) || []).needs.reduce(
      (n, s) => n + s.bookings.filter((b) => b.status === 'booked').length,
      0
    );
  }

  /* ---------------- rendering ---------------- */

  function renderBooking(slot, b, card) {
    const row = U.el('div', 'learner-row');
    const head = U.el('div', 'card-head-row');
    const name = U.el('div', 'card-meta strong-line', b.learner.name || 'Learner');
    head.appendChild(name);
    if (b.status !== 'booked') {
      const kind = b.status === 'passed' ? 'pass' : b.status === 'cancelled' ? '' : 'fail';
      head.appendChild(chip(RESULT_LABEL[b.status] || b.status, kind));
    }
    row.appendChild(head);
    if (b.learner.company) row.appendChild(U.el('div', 'card-meta', b.learner.company));
    const contact = contactLine(b.learner);
    if (contact) row.appendChild(contact);
    if (b.status === 'booked' && !b.theoryDone) {
      row.appendChild(U.el('div', 'card-meta warn-line', 'Online part not finished yet (' + b.progress + '%).'));
    }
    if (b.status === 'passed') {
      let certText = 'Certificate ';
      if (b.certStatus === 'publish') certText += 'published.';
      else if (b.certStatus === 'draft' || b.certStatus === 'pending') certText += 'waiting for office review.';
      else certText += 'not found (it may have been deleted).';
      if (b.classes && b.classes.length) certText = 'Classes ' + b.classes.join(', ') + '. ' + certText;
      row.appendChild(U.el('div', 'card-meta', certText));
    }
    if (b.resultNote && b.status !== 'booked') row.appendChild(U.el('div', 'card-meta', 'Note: ' + b.resultNote));
    if (b.status === 'booked') {
      const actions = U.el('div', 'card-actions');
      if (slot.started) {
        actions.appendChild(button('Record result', 'btn-primary', () => openResult(slot, b)));
      }
      actions.appendChild(button('Cancel booking', 'btn-secondary', () => cancelBooking(slot, b)));
      row.appendChild(actions);
    }
    card.appendChild(row);
  }

  function renderSlot(slot) {
    const office = state.data && state.data.office;
    const card = U.el('div', 'card');
    const head = U.el('div', 'card-head-row');
    head.appendChild(U.el('div', 'card-title', slot.when));
    if (slot.status === 'cancelled') head.appendChild(chip('Cancelled'));
    else head.appendChild(chip(slot.taken + ' of ' + slot.capacity + ' booked', slot.taken >= slot.capacity ? 'live' : ''));
    card.appendChild(head);
    card.appendChild(U.el('div', 'card-meta', slot.courseTitle));
    card.appendChild(U.el('div', 'card-meta', slot.location));
    if (office && slot.evaluator) card.appendChild(U.el('div', 'card-meta', 'Evaluator: ' + slot.evaluator.name));
    if (slot.note) card.appendChild(U.el('div', 'card-meta', slot.note));
    if (!slot.bookings.length && slot.status === 'open') {
      card.appendChild(U.el('div', 'card-meta', slot.ended ? 'Nobody booked this time.' : 'Nobody has booked yet.'));
    }
    for (const b of slot.bookings) renderBooking(slot, b, card);
    const canCancel = slot.status === 'open' && !slot.started && slot.bookings.every((b) => b.status === 'booked');
    if (canCancel && (office || slot.mine)) {
      const actions = U.el('div', 'card-actions');
      actions.appendChild(button('Cancel this time', 'btn-danger', () => cancelSlot(slot)));
      card.appendChild(actions);
    }
    return card;
  }

  function fillList(id, slots, emptyText) {
    const box = $(id);
    box.innerHTML = '';
    if (!slots.length) {
      box.appendChild(U.el('p', 'hint', emptyText));
      return;
    }
    for (const s of slots) box.appendChild(renderSlot(s));
  }

  function setBadge(id, n) {
    const badge = $(id);
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n <= 0);
  }

  function renderWaiting() {
    const box = $('prWaiting');
    const office = state.data && state.data.office;
    $('prWaitingBox').classList.toggle('hidden', !office);
    if (!office) return;
    box.innerHTML = '';
    const list = (state.waiting && state.waiting.learners) || [];
    setBadge('prWaitingBadge', list.length);
    if (!state.waiting) {
      box.appendChild(U.el('p', 'hint', 'Loading...'));
      return;
    }
    if (!list.length) {
      box.appendChild(U.el('p', 'hint', 'Nobody is waiting.'));
      return;
    }
    for (const w of list) {
      const card = U.el('div', 'card');
      card.appendChild(U.el('div', 'card-title', w.learner.name || 'Learner'));
      card.appendChild(U.el('div', 'card-meta', w.courseTitle + (w.learner.company ? ' · ' + w.learner.company : '')));
      const contact = contactLine(w.learner);
      if (contact) card.appendChild(contact);
      card.appendChild(
        U.el(
          'div',
          'card-meta',
          w.theoryDone ? 'Online part finished.' : 'Online part ' + w.progress + '% done.'
        )
      );
      const open = (state.waiting.openSlots && state.waiting.openSlots[w.course]) || [];
      const actions = U.el('div', 'card-actions');
      const btn = button('Book a time', 'btn-primary', () => openBook(w));
      if (!open.length) {
        btn.disabled = true;
        card.appendChild(U.el('div', 'card-meta', 'No open times for this course. Post one first.'));
      }
      actions.appendChild(btn);
      card.appendChild(actions);
      box.appendChild(card);
    }
  }

  function render() {
    const data = state.data;
    if (!data) return;
    const office = data.office;
    $('prNewBtn').classList.toggle('hidden', !(data.courses && data.courses.length));
    $('prIntro').textContent = office
      ? 'Every evaluator\'s practical times. A pass ' +
        (data.autoPublish ? 'publishes the certificate right away.' : 'makes a certificate draft for you to review in Approvals.')
      : 'Your practical times. Record each learner\'s result once the time has started; a pass sends the certificate to the office.';
    if (!data.courses || !data.courses.length) {
      $('prIntro').textContent += ' There is no online course with a practical that you can run yet.';
    }
    const parts = splitSlots(data.slots || []);
    $('prNeedsBox').classList.toggle('hidden', !parts.needs.length);
    setBadge('prNeedsBadge', parts.needs.length);
    if (window.EasyUi) window.EasyUi.setCount('practicals', resultsToRecord(data));
    fillList('prNeeds', parts.needs, '');
    fillList('prUpcoming', parts.upcoming, 'No practical times coming up.');
    fillList('prPast', parts.past, 'Nothing in the last 30 days.');
    renderWaiting();
  }

  /* ---------------- loading ---------------- */

  async function load() {
    if (state.loading) return;
    state.loading = true;
    try {
      const data = await window.EasyApi.practicals();
      state.data = data;
      showError('prError', null);
      $('prUpdated').textContent = U.endPeriod('Last updated ' + U.fmtClock(Date.now()));
      render();
      window.EasyStore.setLastGood('practicals', data).catch(() => {});
      if (data.office) {
        try {
          state.waiting = await window.EasyApi.practicalsWaiting();
        } catch (e) {
          state.waiting = { learners: [], openSlots: {} };
          window.EasyUi.toast('Could not load the waiting list: ' + e.message, 'error', 7000);
        }
        renderWaiting();
      }
    } catch (e) {
      const msg = window.EasyApi.practicalsNeedNewerSuite(e)
        ? 'Practicals need EASY Suite 2.2.45 or newer on the website. Update EASY Suite from the Plugins screen.'
        : 'Could not load practicals: ' + e.message + (state.data ? ' Showing the last saved list.' : '');
      showError('prError', msg);
    } finally {
      state.loading = false;
    }
  }

  async function show() {
    if (!state.data) {
      const saved = await window.EasyStore.getLastGood('practicals');
      if (saved && saved.data && Array.isArray(saved.data.slots)) {
        state.data = saved.data;
        render();
      }
    }
    return load();
  }

  /* ---------------- subviews ---------------- */

  function openView(id) {
    $('practicalsMain').classList.add('hidden');
    $(id).classList.remove('hidden');
    window.EasyUi.openSubview(closeViews);
  }

  function closeViews() {
    for (const id of ['prSlotView', 'prResultView', 'prBookView']) $(id).classList.add('hidden');
    $('practicalsMain').classList.remove('hidden');
  }

  function back() {
    window.EasyUi.closeSubview();
  }

  /* ---------------- new time ---------------- */

  function fillEvaluators() {
    const data = state.data;
    const course = (data.courses || []).find((c) => c.id === $('prCourse').value);
    const sel = $('prEvaluator');
    sel.innerHTML = '';
    const list = (course && course.evaluators) || [];
    for (const ev of list) {
      const opt = U.el('option', '', ev.name);
      opt.value = String(ev.id);
      if (data.me && ev.id === data.me.id) opt.selected = true;
      sel.appendChild(opt);
    }
    $('prEvaluatorWrap').classList.toggle('hidden', !data.office || !list.length);
  }

  function openNewSlot() {
    const data = state.data;
    if (!data || !data.courses || !data.courses.length) return;
    const sel = $('prCourse');
    sel.innerHTML = '';
    for (const c of data.courses) {
      const opt = U.el('option', '', c.title);
      opt.value = c.id;
      sel.appendChild(opt);
    }
    fillEvaluators();
    if (!$('prDate').value) $('prDate').value = U.addDays(U.todayYmd(), 7);
    showError('prSlotError', null);
    openView('prSlotView');
  }

  async function saveSlot(e) {
    e.preventDefault();
    const btn = $('prSlotSave');
    const fields = {
      course: $('prCourse').value,
      date: $('prDate').value,
      start: $('prStart').value,
      end: $('prEnd').value,
      location: $('prLocation').value.trim(),
      capacity: parseInt($('prCapacity').value, 10) || 1,
      note: $('prNote').value.trim(),
    };
    if (state.data.office && $('prEvaluator').value) fields.evaluator = parseInt($('prEvaluator').value, 10);
    btn.disabled = true;
    showError('prSlotError', null);
    try {
      const r = await window.EasyApi.createPracticalSlot(fields);
      window.EasyUi.toast('Practical time posted: ' + (r && r.slot ? r.slot.when : fields.date) + '.', 'success');
      $('prNote').value = '';
      back();
      load();
    } catch (err) {
      showError('prSlotError', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- results ---------------- */

  function selectedResult() {
    const checked = document.querySelector('input[name="prResult"]:checked');
    return checked ? checked.value : '';
  }

  function updateResultForm() {
    const { slot, booking } = state.result;
    const result = selectedResult();
    $('prClassesWrap').classList.toggle('hidden', !(slot.forklift && result === 'passed'));
    const name = booking.learner.name || 'The learner';
    let text = '';
    if (result === 'passed') {
      text = state.data.autoPublish
        ? name + '\'s certificate will be published right away with you as the instructor, and they will be emailed.'
        : name + '\'s certificate will go to the office for review, with you as the instructor.';
      if (slot.certCourse) text += ' Course on the certificate: ' + slot.certCourse + '.';
    } else if (result === 'failed') {
      text = name + ' can book another practical. Nothing is sent to them; let them know how it went.';
    } else if (result === 'no_show') {
      text = name + ' can book another practical.';
    }
    $('prResultExplain').textContent = text;
    $('prResultSave').disabled = !result;
  }

  function openResult(slot, booking) {
    state.result = { slot, booking };
    $('prResultWho').textContent = (booking.learner.name || 'Learner') + ', ' + slot.courseTitle;
    $('prResultWhen').textContent = slot.when + ', ' + slot.location;
    const theory = $('prResultTheory');
    const blockPass = !booking.theoryDone && state.data.requireTheory;
    theory.textContent = blockPass
      ? 'The online part is not finished yet (' + booking.progress + '%), so this practical cannot be passed.'
      : '';
    theory.classList.toggle('hidden', !blockPass);
    $('prResPassed').disabled = blockPass;
    for (const input of document.querySelectorAll('input[name="prResult"]')) input.checked = false;
    const classes = $('prClasses');
    classes.innerHTML = '';
    for (const c of state.data.classes || []) {
      const label = U.el('label', 'check-pill');
      const input = U.el('input');
      input.type = 'checkbox';
      input.value = c;
      label.appendChild(input);
      label.appendChild(document.createTextNode('Class ' + c));
      classes.appendChild(label);
    }
    $('prResultNote').value = '';
    showError('prResultError', null);
    updateResultForm();
    openView('prResultView');
  }

  async function saveResult(e) {
    e.preventDefault();
    const { slot, booking } = state.result;
    const result = selectedResult();
    if (!result) return;
    const classes = Array.from($('prClasses').querySelectorAll('input:checked')).map((i) => i.value);
    if (result === 'passed' && slot.forklift && !classes.length) {
      showError('prResultError', 'Pick the forklift classes the learner was evaluated on.');
      return;
    }
    const btn = $('prResultSave');
    btn.disabled = true;
    showError('prResultError', null);
    try {
      const r = await window.EasyApi.practicalResult(booking.id, result, $('prResultNote').value.trim(), classes);
      const name = booking.learner.name || 'The learner';
      let msg = name + ': ' + RESULT_LABEL[result].toLowerCase() + '.';
      if (r && r.cert) {
        msg = r.cert.status === 'publish'
          ? name + ' passed. Certificate ' + r.cert.number + ' is published.'
          : name + ' passed. Certificate ' + r.cert.number + ' is waiting for office review.';
      }
      window.EasyUi.toast(msg, 'success', 6000);
      back();
      load();
    } catch (err) {
      showError('prResultError', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- cancelling ---------------- */

  async function cancelBooking(slot, booking) {
    const name = booking.learner.name || 'this learner';
    const yes = await window.EasyUi.confirm(
      'Cancel this booking?',
      name + '\'s practical on ' + slot.when + ' will be cancelled and they will be emailed. They can book another time.',
      'Cancel booking'
    );
    if (!yes) return;
    try {
      await window.EasyApi.cancelPracticalBooking(booking.id);
      window.EasyUi.toast('Booking cancelled.', 'success');
      load();
    } catch (e) {
      window.EasyUi.toast('Could not cancel the booking: ' + e.message, 'error', 8000);
    }
  }

  async function cancelSlot(slot) {
    const live = slot.bookings.filter((b) => b.status === 'booked').length;
    const body =
      slot.when +
      ' will be removed.' +
      (live ? ' ' + live + (live === 1 ? ' learner is' : ' learners are') + ' booked and will be emailed that it was cancelled.' : '');
    const yes = await window.EasyUi.confirm('Cancel this practical time?', body, 'Cancel time');
    if (!yes) return;
    try {
      await window.EasyApi.cancelPracticalSlot(slot.id, '');
      window.EasyUi.toast('Practical time cancelled.', 'success');
      load();
    } catch (e) {
      window.EasyUi.toast('Could not cancel the time: ' + e.message, 'error', 8000);
    }
  }

  /* ---------------- office booking ---------------- */

  function openBook(w) {
    state.booking = w;
    $('prBookWho').textContent = w.learner.name || 'Learner';
    $('prBookCourse').textContent = w.courseTitle + (w.learner.company ? ' · ' + w.learner.company : '');
    const sel = $('prBookSlot');
    sel.innerHTML = '';
    for (const s of (state.waiting.openSlots && state.waiting.openSlots[w.course]) || []) {
      const opt = U.el('option', '', s.when + ', ' + s.evaluator + ' (' + s.placesLeft + (s.placesLeft === 1 ? ' place' : ' places') + ' left)');
      opt.value = String(s.id);
      sel.appendChild(opt);
    }
    showError('prBookError', null);
    openView('prBookView');
  }

  async function saveBook(e) {
    e.preventDefault();
    const w = state.booking;
    const slotId = parseInt($('prBookSlot').value, 10);
    if (!w || !slotId) return;
    const btn = $('prBookSave');
    btn.disabled = true;
    showError('prBookError', null);
    try {
      await window.EasyApi.bookPractical(slotId, w.enrollmentId);
      window.EasyUi.toast((w.learner.name || 'The learner') + ' is booked. A confirmation email is on its way.', 'success', 6000);
      back();
      load();
    } catch (err) {
      showError('prBookError', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- wiring ---------------- */

  function init() {
    $('prNewBtn').addEventListener('click', openNewSlot);
    $('prCourse').addEventListener('change', fillEvaluators);
    $('prSlotForm').addEventListener('submit', saveSlot);
    $('prResultForm').addEventListener('submit', saveResult);
    $('prBookForm').addEventListener('submit', saveBook);
    for (const input of document.querySelectorAll('input[name="prResult"]')) {
      input.addEventListener('change', updateResultForm);
    }
    for (const id of ['prSlotBack', 'prResultBack', 'prBookBack']) $(id).addEventListener('click', back);
    $('prPastToggle').addEventListener('click', () => {
      const nowHidden = $('prPastBody').classList.toggle('hidden');
      $('prPastToggle').setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
    });
  }

  window.EasyPracticals = { show, init, splitSlots, resultsToRecord };
})();
