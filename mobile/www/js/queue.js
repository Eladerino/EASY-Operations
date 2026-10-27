// queue.js: the management queue: questions waiting on a decision, ones
// already decided (with who decided and when), and a form to ask a new
// question, which posts to the same queue the website shows. A new
// question can name who it is for and (unless unticked) queues a batched
// notification email to them (Suite 2.2.38): the digest goes out from
// here with the send button, from the website admin, or on its own
// about 30 minutes after the first question was queued.
//
// Open questions are answered right here. A tap on a choice (or the
// send button for free text) asks for confirmation first, then posts
// to POST /easy/v1/management-queue/answers, which saves with the same
// validation and notification email as the website queue form. On
// success the question moves to Decided in place and the counts update
// without a reload. Answering is also written to the activity trail.
//
// Decided is not the end of the line (Suite 2.2.32): a decided card
// can Undo its answer (the question reopens) or be Marked resolved
// once the decision has been acted on, which files it in the Archive
// section below. Archived questions can be un-resolved back to
// Decided. Every lifecycle step asks first and only changes the
// screen after the site confirms.
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
      // The answer alone is the decision. The full list of options
      // used to be re-shown here as chips, which was clutter once a
      // question was settled (and pure noise for a write-in answer,
      // where no chip is the answer), and the sentence-length chips
      // overflowed the card on a phone. A picked option's text IS
      // the answer, so nothing is lost by leaving the list off.
      if (q.answer) card.appendChild(U.el('div', 'card-answer', q.answer));
      const by = [
        q.decided_by ? 'Decided by ' + q.decided_by : '',
        q.decided_at ? U.fmtDateTime(q.decided_at) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (by) card.appendChild(U.el('div', 'card-meta', by));
      const actions = U.el('div', 'card-actions');
      const undoBtn = U.el('button', 'btn btn-small btn-secondary', 'Undo answer');
      undoBtn.type = 'button';
      undoBtn.addEventListener('click', () => undecideAnswer(q, undoBtn, resolveBtn));
      const resolveBtn = U.el('button', 'btn btn-small btn-secondary', 'Mark resolved');
      resolveBtn.type = 'button';
      resolveBtn.addEventListener('click', () => resolveDecided(q, undoBtn, resolveBtn));
      actions.appendChild(undoBtn);
      actions.appendChild(resolveBtn);
      card.appendChild(actions);
      return card;
    }
    card.appendChild(answerControls(q));
    return card;
  }

  function archiveCard(item) {
    const card = U.el('div', 'card');
    if (item.section) card.appendChild(U.el('div', 'card-section', item.section));
    card.appendChild(U.el('div', 'card-title', item.label));
    // Answer only, same as a decided card: the options list is not
    // re-shown once a question is settled.
    if (item.answer) card.appendChild(U.el('div', 'card-answer', item.answer));
    const decidedBy = [
      item.decided_by ? 'Decided by ' + item.decided_by : '',
      item.decided_at ? U.fmtDateTime(item.decided_at) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (decidedBy) card.appendChild(U.el('div', 'card-meta', decidedBy));
    const resolvedBy = [
      item.resolved_by ? 'Resolved by ' + item.resolved_by : '',
      item.resolved_at ? U.fmtDateTime(item.resolved_at) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (resolvedBy) card.appendChild(U.el('div', 'card-meta', resolvedBy));
    const actions = U.el('div', 'card-actions');
    const btn = U.el('button', 'btn btn-small btn-secondary', 'Un-resolve');
    btn.type = 'button';
    btn.addEventListener('click', () => unresolve(item, btn));
    actions.appendChild(btn);
    card.appendChild(actions);
    return card;
  }

  /* ---------------- lifecycle (Suite 2.2.32) ---------------- */

  // Counts always follow the lists after a lifecycle change, and the
  // total is the three states together, matching the site feed.
  function syncCounts() {
    if (!feed) return;
    const counts = feed.counts || { open: 0, decided: 0, resolved: 0, total: 0 };
    counts.open = feed.open.length;
    counts.decided = feed.decided.length;
    counts.resolved = (feed.resolved || []).length;
    counts.total = counts.open + counts.decided + counts.resolved;
    feed.counts = counts;
  }

  async function afterLifecycleChange() {
    syncCounts();
    render(feed);
    await window.EasyStore.setLastGood('queue', feed);
    $('queueUpdated').textContent = 'Last updated ' + U.endPeriod(U.fmtClock(Date.now()));
  }

  function lifecycleFailure(what, err, btns) {
    window.EasyUi.toast(
      'Could not ' + what + ': ' + window.EasyApi.queueLifecycleErrorText(err),
      'error',
      8000
    );
    for (const b of btns) b.disabled = false;
  }

  async function undecideAnswer(q, undoBtn, resolveBtn) {
    const yes = await window.EasyUi.confirm(
      'Undo this answer?',
      '"' + q.label + '" will go back to the open questions, and its saved answer will be cleared.',
      'Undo answer'
    );
    if (!yes) return;
    undoBtn.disabled = true;
    resolveBtn.disabled = true;
    try {
      const res = await window.EasyApi.undecideQuestion(q.key);
      const item = (res && res.question) || { ...q, decided: false };
      delete item.answer;
      delete item.decided_by;
      delete item.decided_at;
      if (feed) {
        feed.decided = feed.decided.filter((d) => d.key !== q.key);
        feed.open = [...feed.open.filter((o) => o.key !== q.key), item];
        await afterLifecycleChange();
      }
      window.EasyUi.toast('Answer undone. The question is open again.', 'success');
    } catch (e) {
      lifecycleFailure('undo the answer', e, [undoBtn, resolveBtn]);
    }
  }

  async function resolveDecided(q, undoBtn, resolveBtn) {
    const yes = await window.EasyUi.confirm(
      'Mark this question resolved?',
      '"' + q.label + '" was decided and has been acted on. It will leave the decided list and stay on record in the archive.',
      'Mark resolved'
    );
    if (!yes) return;
    undoBtn.disabled = true;
    resolveBtn.disabled = true;
    try {
      const res = await window.EasyApi.resolveQuestion(q.key);
      const item = (res && res.question) || { ...q };
      if (feed) {
        feed.decided = feed.decided.filter((d) => d.key !== q.key);
        if (!Array.isArray(feed.resolved)) feed.resolved = [];
        feed.resolved = [item, ...feed.resolved.filter((r) => r.key !== q.key)];
        await afterLifecycleChange();
      }
      window.EasyUi.toast('Question marked resolved.', 'success');
    } catch (e) {
      lifecycleFailure('mark the question resolved', e, [undoBtn, resolveBtn]);
    }
  }

  async function unresolve(item, btn) {
    const yes = await window.EasyUi.confirm(
      'Move this question back to decided?',
      '"' + item.label + '" will leave the archive and show in the decided list again.',
      'Un-resolve'
    );
    if (!yes) return;
    btn.disabled = true;
    try {
      const res = await window.EasyApi.unresolveQuestion(item.key);
      const back = (res && res.question) || { ...item };
      delete back.resolved_by;
      delete back.resolved_at;
      if (feed) {
        feed.resolved = (feed.resolved || []).filter((r) => r.key !== item.key);
        feed.decided = [back, ...feed.decided.filter((d) => d.key !== item.key)];
        await afterLifecycleChange();
      }
      window.EasyUi.toast('Question is back in the decided list.', 'success');
    } catch (e) {
      lifecycleFailure('un-resolve the question', e, [btn]);
    }
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
      // The answer joins the activity trail, titled by the question.
      const fullLabel = String(q.label || '').trim();
      const shortLabel =
        fullLabel.length > 60 ? fullLabel.slice(0, 57).trimEnd() + '...' : fullLabel;
      window.EasyStore.addDecision({
        kind: 'queue',
        id: q.key,
        title: shortLabel || 'Queue question',
        action: 'Question answered',
        at: Date.now(),
      }).catch(() => {});
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
        $('queueUpdated').textContent = 'Last updated ' + U.endPeriod(U.fmtClock(Date.now()));
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
    if (!Array.isArray(data.resolved)) data.resolved = [];
    const counts = data.counts || { open: 0, decided: 0, resolved: 0, total: 0 };
    if (window.EasyUi) window.EasyUi.setCount('queue', data.open.length);
    $('queueCounts').textContent =
      counts.open + ' open · ' + counts.decided + ' decided of ' + counts.total +
      (counts.resolved ? ' · ' + counts.resolved + ' resolved' : '');
    const activity = data.last_activity || {};
    $('queueActivity').textContent =
      activity.by && activity.at
        ? 'Last activity by ' + activity.by + ' · ' + U.fmtDateTime(activity.at)
        : '';

    const pending = Number(data.pending_notifications) || 0;
    const pendingEl = $('queuePending');
    const notifyBtn = $('queueNotifyBtn');
    if (pending > 0) {
      pendingEl.textContent =
        pending + ' new question' + (pending === 1 ? '' : 's') +
        ' waiting to be emailed. They go out on their own in about 30 minutes, or send them now.';
      pendingEl.classList.remove('hidden');
      notifyBtn.classList.remove('hidden');
    } else {
      pendingEl.textContent = '';
      pendingEl.classList.add('hidden');
      notifyBtn.classList.add('hidden');
    }

    // Audience picker options come from the feed, so the names always
    // match the site's queue list. Keep the current pick on refresh.
    const askAudience = $('askAudience');
    if (askAudience && Array.isArray(data.audience_options)) {
      const current = askAudience.value;
      askAudience.innerHTML = '';
      const everyone = document.createElement('option');
      everyone.value = '';
      everyone.textContent = 'Everyone';
      askAudience.appendChild(everyone);
      for (const person of data.audience_options) {
        const opt = document.createElement('option');
        opt.value = person.login;
        opt.textContent = person.name || person.login;
        askAudience.appendChild(opt);
      }
      askAudience.value = current;
    }

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

    const archiveBox = $('queueArchive');
    archiveBox.innerHTML = '';
    if (!data.resolved.length) {
      archiveBox.appendChild(U.el('p', 'hint', 'Nothing resolved yet.'));
    } else {
      for (const item of data.resolved) archiveBox.appendChild(archiveCard(item));
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
      note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(saved.at)) + ' Refreshing...';
    }
    try {
      const q = await window.EasyApi.mgmtQueue();
      feed = q;
      render(feed);
      errBox.classList.add('hidden');
      await window.EasyStore.setLastGood('queue', feed);
      note.textContent = 'Last updated ' + U.endPeriod(U.fmtClock(Date.now()));
    } catch (e) {
      if (saved && saved.data) {
        note.textContent =
          'Could not refresh, showing the last good copy from ' + U.endPeriod(U.fmtClock(saved.at));
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
      const audienceLogin = $('askAudience') ? $('askAudience').value : '';
      const res = await window.EasyApi.addQuestion({
        section: $('askSection').value.trim(),
        label,
        why: $('askWhy').value.trim(),
        type,
        options,
        audience: audienceLogin ? [audienceLogin] : [],
        notify: $('askNotify') ? $('askNotify').checked : true,
      });
      $('askForm').reset();
      if ($('askNotify')) $('askNotify').checked = true;
      $('askForm').classList.add('hidden');
      $('askToggle').setAttribute('aria-expanded', 'false');
      $('askToggle').textContent = 'Ask a question';
      window.EasyUi.toast(
        res && res.notification_queued
          ? 'Question added. Its notification is queued to send as a batch.'
          : 'Question added.',
        'success'
      );
      await show();
    } catch (e) {
      window.EasyUi.toast('Could not add the question: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  async function sendNotifications(btn) {
    const yes = await window.EasyUi.confirm(
      'Send notification emails now?',
      'Everyone with a new question waiting gets one email previewing their questions.',
      'Send emails'
    );
    if (!yes) return;
    btn.disabled = true;
    try {
      const res = await window.EasyApi.notifyQueue();
      const sent = (res && Number(res.sent)) || 0;
      window.EasyUi.toast(
        sent > 0
          ? 'Sent ' + sent + ' notification email' + (sent === 1 ? '' : 's') + '.'
          : 'No emails sent. The queued questions may already be decided.',
        sent > 0 ? 'success' : 'error',
        8000
      );
      await show();
    } catch (e) {
      window.EasyUi.toast('Could not send the notifications: ' + e.message, 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    $('askForm').addEventListener('submit', submitQuestion);
    // The ask form stays folded under its button until wanted, so the
    // open questions come first.
    const askToggle = $('askToggle');
    askToggle.addEventListener('click', () => {
      const nowHidden = $('askForm').classList.toggle('hidden');
      askToggle.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
      askToggle.textContent = nowHidden ? 'Ask a question' : 'Close the question form';
      if (!nowHidden) $('askLabel').focus();
    });
    const notifyBtn = $('queueNotifyBtn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', () => sendNotifications(notifyBtn));
    }
    const archiveToggle = $('queueArchiveToggle');
    if (archiveToggle) {
      archiveToggle.addEventListener('click', () => {
        const body = $('queueArchiveBody');
        const nowHidden = body.classList.toggle('hidden');
        archiveToggle.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
      });
    }
  }

  window.EasyQueue = { show, init };
})();
