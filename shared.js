// shared.js — pure certificate logic, no DOM, no Electron.
//
// Loaded by the renderer via <script> and unit-testable in plain Node.
(function (root) {
  'use strict';

  // Course catalogue. Kept identical to the original app.
  const titlesByCategory = {
    'workplace-nl-approved-training': [
      { value: 'confined-space-entry',             label: 'Confined Space Entry' },
      { value: 'fall-protection',                  label: 'Fall Protection' },
      { value: 'fall-protection-recertification',  label: 'Fall Protection Recertification' },
      { value: 'ohs-committee1',                   label: 'OH&S Committee I' },
      { value: 'ohs-committee2',                   label: 'OH&S Committee II' },
      { value: 'powerline-hazards',                label: 'Powerline Hazards' },
      { value: 'traffic-control',                  label: 'Traffic Control Person' },
    ],
    'powered-mobile-equipment': [
      { value: 'counter-balance-forklift', label: 'Counter Balance Forklift' },
      { value: 'skid-steer',               label: 'Skid Steer' },
      { value: 'telehandler-7',            label: 'Telehandler (Class7)' },
      { value: 'aerial-work-platform',     label: 'Aerial Work Platform' },
    ],
    'confined-space-training': [
      { value: 'confined-space-rescue',            label: 'Confined Space Rescue' },
      { value: 'gas-detection',                    label: 'Gas Detection' },
      { value: 'lockout-tagout',                   label: 'Lockout/Tagout' },
      { value: 'regulatory-awareness',             label: 'Regulatory Awareness' },
      { value: 'respiratory-protective-equipment', label: 'Respiratory Protective Equipment' },
      { value: 'saba-scba',                        label: 'SABA/SCBA' },
    ],
    'first-aid': [
      { value: 'emergency-first-aid', label: 'Emergency First Aid' },
      { value: 'standard-first-aid',  label: 'Standard First Aid' },
    ],
    'scaffolding': [
      { value: 'frame',                label: 'Frame' },
      { value: 'inspection-awareness', label: 'Inspection Awareness' },
      { value: 'swing-stage',          label: 'Swing Stage' },
      { value: 'system',               label: 'System' },
      { value: 'tube-clamp',          label: 'Tube & Clamp' },
    ],
    'additional-safety-training': [
      { value: 'arc-flash',                      label: 'Arc Flash' },
      { value: 'drops-prevention',               label: 'DROPS Prevention' },
      { value: 'hazard-risk-assessment',         label: 'Hazard and Risk Assessment' },
      { value: 'offshore-fall-protection',       label: 'Offshore Fall Protection' },
      { value: 'transportation-dangerous-goods', label: 'Transportation of Dangerous Goods' },
      { value: 'trenching-excavation',           label: 'Trenching & Excavation' },
      { value: 'whmis',                          label: 'WHMIS' },
    ],
    'crane-rigging-training': [
      { value: 'overhead-crane-rigging',          label: 'Overhead Crane Rigging' },
      { value: 'overhead-crane-rigging-slinging', label: 'Overhead Crane Rigging & Slinging' },
      { value: 'rigging-slinging-banksmen',      label: 'Rigging, Slinging & Banksmen' },
    ],
  };

  const WPNL_CATEGORY = 'workplace-nl-approved-training';
  const FORKLIFT_VALUE = 'counter-balance-forklift';

  // e.g. ("2026-09-30", "counter-balance-forklift", 1) -> "260930COUNTERBALANCEFORKLIFT01"
  function makeCertificateNumber(completionDate, courseTitleValue, instanceNumber) {
    const date = String(completionDate).replace(/-/g, '').slice(2);
    const titleCode = String(courseTitleValue).replace(/-/g, '').toUpperCase();
    return `${date}${titleCode}${String(instanceNumber).padStart(2, '0')}`;
  }

  function sanitizeFilename(str) {
    return String(str).replace(/[^a-z0-9_-]/gi, '');
  }

  // "Counter Balance Forklift" + ["1","4","5"] -> "Counter Balance Forklift (Class 1-4-5)"
  function makePdfCourseName(displayedTitle, courseValue, selectedClasses) {
    if (courseValue === FORKLIFT_VALUE && selectedClasses.length) {
      return `${displayedTitle} (Class ${selectedClasses.join('-')})`;
    }
    return displayedTitle;
  }

  function makeFilenameCoursePart(displayedTitle, courseValue) {
    if (courseValue === FORKLIFT_VALUE) return 'CounterBalanceForklift';
    return String(displayedTitle).replace(/\s+/g, '');
  }

  function makePdfFilename(studentName, filenameCoursePart, completionDate) {
    return `${sanitizeFilename(studentName)}-${filenameCoursePart}-${completionDate}.pdf`;
  }

  function makePostTitle(completionDate, pdfCourseName, studentName) {
    return `${completionDate} - ${pdfCourseName} - ${studentName}`;
  }

  // Certificates expire 3 years after completion.
  function expiryPlus3Years(completionDate) {
    const [y, m, d] = String(completionDate).split('-');
    return `${parseInt(y, 10) + 3}-${m}-${d}`;
  }

  const api = {
    titlesByCategory,
    WPNL_CATEGORY,
    FORKLIFT_VALUE,
    makeCertificateNumber,
    sanitizeFilename,
    makePdfCourseName,
    makeFilenameCoursePart,
    makePdfFilename,
    makePostTitle,
    expiryPlus3Years,
  };

  root.EasyCertShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
