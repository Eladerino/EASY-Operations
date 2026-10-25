// util.js: small shared helpers (dates, escaping, element building).
(function () {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtYmd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayYmd() {
    return fmtYmd(new Date());
  }

  function addDays(ymd, days) {
    const parts = ymd.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2] + days);
    return fmtYmd(d);
  }

  function addMonths(ymd, months) {
    const parts = ymd.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1 + months, parts[2]);
    return fmtYmd(d);
  }

  // Site-time "16:30" as "4:30 p.m.". Done by hand rather than through
  // Date so the phone's own time zone never shifts a class time.
  function fmtTime(hm) {
    const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return String(hm || '');
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' a.m.' : ' p.m.');
  }

  function fmtTimeRange(ev) {
    return ev.allDay ? 'All day' : fmtTime(ev.startTime) + ' to ' + fmtTime(ev.endTime);
  }

  // A class's dates and times, shown plainly ("Oct 30, 2026, 8:00 a.m. to 4:00 p.m.").
  function fmtWhen(ev) {
    const when = fmtTimeRange(ev);
    return ev.startDate === ev.endDate
      ? fmtDateLoose(ev.startDate) + ', ' + when
      : fmtDateLoose(ev.startDate) + ' to ' + fmtDateLoose(ev.endDate) + ', ' + when;
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function timeAgo(ts) {
    const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  // Expiry dates come back as "2026-11-02" or "20261102".
  function parseDateLoose(raw) {
    const s = String(raw || '');
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function fmtDateLoose(raw) {
    const d = parseDateLoose(raw);
    if (!d) return String(raw || '');
    // Non-breaking spaces keep "Oct 24, 2026" on one line in a card.
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }).replace(/ /g, '\u00a0');
  }

  function daysUntil(raw) {
    const d = parseDateLoose(raw);
    if (!d) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  // The Suite's expiry reminder ladder (EASY Suite,
  // module-notifications.php, due_thresholds): a certificate is in the
  // 30 day window at 30 or fewer days left, the 7 day window at 7 or
  // fewer (down to the day itself), and the expired window once the
  // date has passed. Returns '30', '7', 'expired', or null when the
  // certificate is in no window.
  function expiryBand(daysLeft) {
    if (daysLeft === null || daysLeft === undefined || isNaN(daysLeft)) return null;
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 7) return '7';
    if (daysLeft <= 30) return '30';
    return null;
  }

  function fmtClock(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Adds a sentence-ending period unless the text already ends with one.
  // Some locales format the meridiem with its own period ("12:21 p.m."),
  // so composers must not append '.' blindly after a clock string.
  function endPeriod(s) {
    return /[.]$/.test(s) ? s : s + '.';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  window.EasyUtil = { fmtYmd, todayYmd, addDays, addMonths, fmtTime, fmtTimeRange, fmtWhen, fmtDateTime, timeAgo, el, parseDateLoose, fmtDateLoose, daysUntil, expiryBand, fmtClock, endPeriod };
})();
