// preload.js — locked-down bridge.
//
// The renderer gets a small fixed set of methods. There is intentionally no
// generic send/receive: renderer code must not be able to talk on
// arbitrary IPC channels.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyCert', {
  submit: (payload) => ipcRenderer.invoke('submit-certificate', payload),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  showWhatsNew: () => ipcRenderer.invoke('show-whats-new'),
  printPdf: () => ipcRenderer.invoke('print-pdf-dialog'),
  savePdfCopy: () => ipcRenderer.invoke('save-pdf-copy'),
  savePngCopy: (dataUrl, defaultName) => ipcRenderer.invoke('save-png-copy', { dataUrl, defaultName }),
  openPdfExternal: () => ipcRenderer.invoke('open-pdf-external'),
  testConnection: (args) => ipcRenderer.invoke('test-connection', args),
  openProfile: () => ipcRenderer.invoke('open-profile'),
  websiteSignIn: () => ipcRenderer.invoke('website-sign-in'),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  setPrinter: (name) => ipcRenderer.invoke('set-printer', name),
  saveSetup: (setup) => ipcRenderer.invoke('save-setup', setup),
  resetSetup: () => ipcRenderer.invoke('reset-setup'),
  schedule: {
    probe: () => ipcRenderer.invoke('schedule-probe'),
    listEvents: (start, end) => ipcRenderer.invoke('schedule-list-events', { start, end }),
    listVenues: () => ipcRenderer.invoke('schedule-list-venues'),
    listOrganizers: () => ipcRenderer.invoke('schedule-list-organizers'),
    listCategories: () => ipcRenderer.invoke('schedule-list-categories'),
    createVenue: (venue) => ipcRenderer.invoke('schedule-create-venue', venue),
    createOrganizer: (organizer) => ipcRenderer.invoke('schedule-create-organizer', organizer),
    createEvent: (payload) => ipcRenderer.invoke('schedule-create-event', payload),
    updateEvent: (id, payload) => ipcRenderer.invoke('schedule-update-event', { id, payload }),
    deleteEvent: (id) => ipcRenderer.invoke('schedule-delete-event', id),
    siteInfo: () => ipcRenderer.invoke('schedule-site-info'),
    getRoster: (eventId) => ipcRenderer.invoke('schedule-get-roster', eventId),
    saveRoster: (eventId, roster, revision) => ipcRenderer.invoke('schedule-save-roster', { eventId, roster, revision }),
    getSaleState: (eventId) => ipcRenderer.invoke('schedule-get-sale-state', eventId),
    getCheckin: (eventId) => ipcRenderer.invoke('schedule-get-checkin', eventId),
    checkinAction: (eventId, action) => ipcRenderer.invoke('schedule-checkin-action', { eventId, action }),
  },
  approvals: {
    probe: () => ipcRenderer.invoke('approvals-probe'),
    list: () => ipcRenderer.invoke('approvals-list'),
    approve: (id) => ipcRenderer.invoke('approvals-approve', id),
    reject: (id) => ipcRenderer.invoke('approvals-reject', id),
  },
  certApprovals: {
    probe: () => ipcRenderer.invoke('cert-approvals-probe'),
    list: () => ipcRenderer.invoke('cert-approvals-list'),
    publish: (id) => ipcRenderer.invoke('cert-approvals-publish', id),
    preview: (id) => ipcRenderer.invoke('cert-approvals-preview', id),
    get: (id) => ipcRenderer.invoke('cert-approvals-get', id),
  },
  courses: {
    sync: (op, args) => ipcRenderer.invoke('course-sync', { op, args }),
    backup: (snapshot) => ipcRenderer.invoke('course-builder-backup', snapshot),
    openBackups: () => ipcRenderer.invoke('course-builder-backup-folder'),
    uploadMedia: (kind, maxBytes) => ipcRenderer.invoke('course-media-upload', { kind, maxBytes }),
    getMedia: (id) => ipcRenderer.invoke('course-media-get', { id }),
  },
  certTools: {
    search: (query) => ipcRenderer.invoke('cert-tools-search', query),
    reprint: (id) => ipcRenderer.invoke('cert-tools-reprint', id),
    expiring: (days) => ipcRenderer.invoke('cert-tools-expiring', days),
  },
});
