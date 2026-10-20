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

  // "2026-10-19 09:00" style stamps and ISO strings, shown plainly.
  function fmtWhen(ev) {
    const when = ev.allDay ? 'All day' : ev.startTime + ' to ' + ev.endTime;
    return ev.startDate === ev.endDate
      ? ev.startDate + ', ' + when
      : ev.startDate + ' to ' + ev.endDate + ', ' + when;
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
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysUntil(raw) {
    const d = parseDateLoose(raw);
    if (!d) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  function fmtClock(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  window.EasyUtil = { fmtYmd, todayYmd, addDays, addMonths, fmtWhen, fmtDateTime, timeAgo, el, parseDateLoose, fmtDateLoose, daysUntil, fmtClock };
})();
