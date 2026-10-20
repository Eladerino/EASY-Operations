// queue.js: the management queue: questions waiting on a decision, ones
// already decided (with who decided and when), and a form to ask a new
// question, which posts to the same queue the website shows.
//
// Answering a question is read-only here: EASY Suite has no REST route
// that saves an answer (the website queue page saves through its own
// form). That gap is recorded in the README as a future Suite follow-up.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);

  function questionCard(q, decided) {
    const card = U.el('div', 'card');
    if (q.section) card.appendChild(U.el('div', 'card-section', q.section));
    card.appendChild(U.el('div', 'card-title', q.label));
    if (Array.isArray(q.options) && q.options.length) {
      const chips = U.el('div', 'chips');
      for (const opt of q.options) chips.appendChild(U.el('span', 'chip', opt));
      card.appendChild(chips);
    }
    if (decided) {
      if (q.answer) card.appendChild(U.el('div', 'card-answer', q.answer));
      const by = [
        q.decided_by ? 'Decided by ' + q.decided_by : '',
        q.decided_at ? U.fmtDateTime(q.decided_at) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (by) card.appendChild(U.el('div', 'card-meta', by));
    }
    return card;
  }

  async function load() {
    const errBox = $('queueError');
    errBox.classList.add('hidden');
    try {
      const q = await window.EasyApi.mgmtQueue();
      if (!Array.isArray(q.open)) q.open = [];
      if (!Array.isArray(q.decided)) q.decided = [];
      const counts = q.counts || { open: 0, decided: 0, total: 0 };
      $('queueCounts').textContent =
        counts.open + ' open · ' + counts.decided + ' decided of ' + counts.total;
      const activity = q.last_activity || {};
      $('queueActivity').textContent =
        activity.by && activity.at
          ? 'Last activity by ' + activity.by + ' · ' + U.fmtDateTime(activity.at)
          : '';

      const openBox = $('queueOpen');
      openBox.innerHTML = '';
      if (!q.open.length) {
        openBox.appendChild(U.el('p', 'hint', 'Nothing waiting. The queue is clear.'));
      } else {
        openBox.appendChild(
          U.el('p', 'hint', 'Answers are given on the queue page on the website for now.')
        );
        for (const item of q.open) openBox.appendChild(questionCard(item, false));
      }

      const decidedBox = $('queueDecided');
      decidedBox.innerHTML = '';
      if (!q.decided.length) {
        decidedBox.appendChild(U.el('p', 'hint', 'No decisions yet.'));
      } else {
        for (const item of q.decided) decidedBox.appendChild(questionCard(item, true));
      }
    } catch (e) {
      errBox.textContent = 'Could not load the queue: ' + e.message;
      errBox.classList.remove('hidden');
    }
  }

  async function submitQuestion(ev) {
    ev.preventDefault();
    const label = $('askLabel').value.trim();
    if (!label) {
      window.EasyUi.toast('Write the question first.', 'error');
      return;
    }
    const type = $('askType').value;
    const options = $('askOptions')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (type !== 'textarea' && options.length < 2) {
      window.EasyUi.toast(
        'Add at least two choices for a multiple choice question, one per line, or switch the answer type to free text.',
        'error',
        8000
      );
      return;
    }
    const btn = $('askSubmit');
    btn.disabled = true;
    try {
      await window.EasyApi.addQuestion({
        section: $('askSection').value.trim(),
        label,
        why: $('askWhy').value.trim(),
        type,
        options,
      });
      $('askForm').reset();
      window.EasyUi.toast('Question added to the queue.', 'success');
      await load();
    } catch (e) {
      window.EasyUi.toast('Could not add the question: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    $('askForm').addEventListener('submit', submitQuestion);
    $('queueRefresh').addEventListener('click', load);
  }

  window.EasyQueue = { show: load, init };
})();
