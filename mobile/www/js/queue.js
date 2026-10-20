// queue.js: the management queue: questions waiting on a decision, ones
// already decided (with who decided and when), and a form to ask a new
// question, which posts to the same queue the website shows.
//
// Open questions are answered right here. A tap on a choice (or the
// send button for free text) asks for confirmation first, then posts
// to POST /easy/v1/management-queue/answers, which saves with the same
// validation and notification email as the website queue form. On
// success the question moves to Decided in place and the counts update
// without a reload.
//
// The last good feed is saved on the device, painted instantly on
// open, and refreshed in the background; a failed refresh keeps the
// saved copy on screen and says so.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);
  let feed = null;

  function questionCard(q, decided) {
    const card = U.el('div', 'card');
    if (q.section) card.appendChild(U.el('div', 'card-section', q.section));
    card.appendChild(U.el('div', 'card-title', q.label));
    if (decided) {
      if (Array.isArray(q.options) && q.options.length) {
        const chips = U.el('div', 'chips');
        for (const opt of q.options) chips.appendChild(U.el('span', 'chip', opt));
        card.appendChild(chips);
      }
      if (q.answer) card.appendChild(U.el('div', 'card-answer', q.answer));
      const by = [
        q.decided_by ? 'Decided by ' + q.decided_by : '',
        q.decided_at ? U.fmtDateTime(q.decided_at) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (by) card.appendChild(U.el('div', 'card-meta', by));
      return card;
    }
    card.appendChild(answerControls(q));
    return card;
  }

  /* ---------------- answering ---------------- */

  function setControlsEnabled(controls, enabled) {
    for (const node of controls) node.disabled = !enabled;
  }

  // One send path for every answer kind: confirm, disable the card's
  // controls while in flight, then move the question to Decided in
  // place on success or re-enable and report on failure.
  async function sendAnswer(q, value, other, displayText, controls) {
    const shown =
      displayText.length > 200 ? displayText.slice(0, 200) + '...' : displayText;
    const yes = await window.EasyUi.confirm(
      'Send this answer?',
      '"' + q.label + '"\n\nAnswer: ' + shown,
      'Send answer'
    );
    if (!yes) return;
    setControlsEnabled(controls, false);
    try {
      const res = await window.EasyApi.answerQuestion(q.key, value, other);
      const item = (res && res.question) || { ...q, decided: true };
      if (feed) {
        feed.open = feed.open.filter((o) => o.key !== q.key);
        feed.decided = [item, ...feed.decided.filter((d) => d.key !== q.key)];
        const counts = feed.counts || { open: 0, decided: 0, total: 0 };
        counts.open = feed.open.length;
        counts.decided = counts.decided + 1;
        feed.counts = counts;
        feed.last_activity = { by: item.decided_by || null, at: item.decided_at || null };
        render(feed);
        await window.EasyStore.setLastGood('queue', feed);
        $('queueUpdated').textContent = 'Last updated ' + U.fmtClock(Date.now()) + '.';
      }
      window.EasyUi.toast('Answer saved.', 'success');
    } catch (e) {
      window.EasyUi.toast('Could not save the answer: ' + e.message, 'error', 8000);
      setControlsEnabled(controls, true);
    }
  }

  function answerControls(q) {
    const area = U.el('div', 'answer-area');
    const controls = [];
    if (q.type === 'textarea') {
      const input = U.el('textarea', 'answer-input');
      input.rows = 3;
      input.placeholder = 'Type the answer';
      controls.push(input);
      area.appendChild(input);
      const send = U.el('button', 'btn btn-primary btn-block', 'Send answer');
      send.type = 'button';
      controls.push(send);
      send.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) {
          window.EasyUi.toast('Write an answer first.', 'error');
          return;
        }
        sendAnswer(q, text, undefined, text, controls);
      });
      area.appendChild(send);
      return area;
    }
    const options = Array.isArray(q.options) ? q.options : [];
    for (const opt of options) {
      const btn = U.el('button', 'btn btn-choice', opt);
      btn.type = 'button';
      controls.push(btn);
      btn.addEventListener('click', () => sendAnswer(q, opt, undefined, opt, controls));
      area.appendChild(btn);
    }
    if (q.type === 'radio_other') {
      const input = U.el('input', 'answer-input');
      input.type = 'text';
      input.placeholder = 'Something else (write-in)';
      controls.push(input);
      area.appendChild(input);
      const send = U.el('button', 'btn btn-secondary btn-block', 'Send write-in answer');
      send.type = 'button';
      controls.push(send);
      send.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) {
          window.EasyUi.toast('Write the write-in answer first.', 'error');
          return;
        }
        sendAnswer(q, '__other', text, text, controls);
      });
      area.appendChild(send);
    }
    return area;
  }

  /* ---------------- rendering ---------------- */

  function render(data) {
    if (!Array.isArray(data.open)) data.open = [];
    if (!Array.isArray(data.decided)) data.decided = [];
    const counts = data.counts || { open: 0, decided: 0, total: 0 };
    $('queueCounts').textContent =
      counts.open + ' open · ' + counts.decided + ' decided of ' + counts.total;
    const activity = data.last_activity || {};
    $('queueActivity').textContent =
      activity.by && activity.at
        ? 'Last activity by ' + activity.by + ' · ' + U.fmtDateTime(activity.at)
        : '';

    const openBox = $('queueOpen');
    openBox.innerHTML = '';
    if (!data.open.length) {
      openBox.appendChild(U.el('p', 'hint', 'Nothing waiting. The queue is clear.'));
    } else {
      for (const item of data.open) openBox.appendChild(questionCard(item, false));
    }

    const decidedBox = $('queueDecided');
    decidedBox.innerHTML = '';
    if (!data.decided.length) {
      decidedBox.appendChild(U.el('p', 'hint', 'No decisions yet.'));
    } else {
      for (const item of data.decided) decidedBox.appendChild(questionCard(item, true));
    }
  }

  async function show() {
    const errBox = $('queueError');
    const note = $('queueUpdated');
    const saved = await window.EasyStore.getLastGood('queue');
    if (saved && saved.data) {
      feed = saved.data;
      render(feed);
      errBox.classList.add('hidden');
      note.textContent = 'Last updated ' + U.fmtClock(saved.at) + '. Refreshing...';
    }
    try {
      const q = await window.EasyApi.mgmtQueue();
      feed = q;
      render(feed);
      errBox.classList.add('hidden');
      await window.EasyStore.setLastGood('queue', feed);
      note.textContent = 'Last updated ' + U.fmtClock(Date.now()) + '.';
    } catch (e) {
      if (saved && saved.data) {
        note.textContent =
          'Could not refresh, showing the last good copy from ' + U.fmtClock(saved.at) + '.';
      } else {
        errBox.textContent = 'Could not load the queue: ' + e.message;
        errBox.classList.remove('hidden');
        note.textContent = '';
      }
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
      await show();
    } catch (e) {
      window.EasyUi.toast('Could not add the question: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    $('askForm').addEventListener('submit', submitQuestion);
    $('queueRefresh').addEventListener('click', show);
  }

  window.EasyQueue = { show, init };
})();
