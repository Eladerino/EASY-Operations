// renderer.js — form UI logic. Talks to the main process only through
// the locked-down window.easyCert bridge (submit / getAppInfo).
(function () {
  'use strict';

  const S = window.EasyCertShared;
  // Must match BUILD_TAG in main.js; a mismatch means stale/mixed app files.
  const EXPECTED_BUILD_TAG = 'ops-20261010c';
  const $ = (id) => document.getElementById(id);

  // Review privileges, resolved from getAppInfo during startup. Proxy-poster
  // and office-mode accounts see every approval queue; plain
  // instructor accounts get the review UI trimmed (no Classes queue, no
  // cert Publish button, no Accounts sub-tab). WordPress still enforces
  // the actual actions, so this is presentation, not security.
  window.EasyPerms = { privileged: true };

  const form = $('certForm');
  const postButton = $('postButton');
  const clearButton = $('clearButton');
  const incrementButton = $('incrementButton');
  const decrementButton = $('decrementButton');
  const courseCategory = $('courseCategory');
  const courseTitle = $('courseTitle');
  const completionDate = $('completionDate');
  const expiryDate = $('expiryDate');
  const certificateNumber = $('certificateNumber');
  const confirmEmail = $('confirmEmail');
  const studentEmail = $('studentEmail');
  const wpnlControlGroup = $('wpnlControlGroup');
  const WPNLcontrol = $('WPNLcontrol');
  const forkliftClassGroup = $('forkliftClassGroup');
  const errorSummary = $('errorSummary');

  let instanceNumber = 1;
  let submitting = false;
  // Fix-before-publish: when set, the form edits an existing draft instead
  // of posting a new certificate.
  let editingDraftId = null;
  // Error messages stay hidden until the user tries to submit.
  let submitAttempted = false;

  /* ---------------- toasts ---------------- */

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

  /* ---------------- modal ---------------- */

  const modal = $('modal');
  const modalTitle = $('modalTitle');
  const modalBody = $('modalBody');
  const modalOk = $('modalOk');
  const modalCancel = $('modalCancel');
  let modalResolve = null;

  function showModal({ title, body, okText, cancelText }) {
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modalOk.textContent = okText || 'OK';
    if (cancelText) {
      modalCancel.style.display = '';
      modalCancel.textContent = cancelText;
    } else {
      modalCancel.style.display = 'none';
    }
    modal.classList.remove('hidden');
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeModal(value) {
    modal.classList.add('hidden');
    if (modalResolve) {
      const r = modalResolve;
      modalResolve = null;
      r(value);
    }
  }

  modalOk.addEventListener('click', () => closeModal(true));
  modalCancel.addEventListener('click', () => closeModal(false));

  /* ---------------- first-time setup / modes ---------------- */

  let setupWired = false;
  let setupIdentity = null;   // { name, email } from a successful Test connection
  let lockedInstructor = null; // { name, email } when running in instructor mode

  function applyLockedIdentity(identity) {
    lockedInstructor = identity;
    const nameEl = $('instructorName');
    const emailEl = $('instructorEmail');
    nameEl.value = identity.name || '';
    emailEl.value = identity.email || '';
    for (const el of [nameEl, emailEl]) {
      el.readOnly = true;
      el.classList.add('locked');
      el.title = 'Locked to your signed-in WordPress account';
    }
    if (!$('instructorLockNote')) {
      const note = document.createElement('div');
      note.id = 'instructorLockNote';
      note.className = 'lock-note';
      note.textContent = 'Locked to your signed-in WordPress account.';
      $('instructorEmailError').after(note);
    }
  }

  // Enables/disables the silent NISCA card-print option based on whether a
  // card printer is configured.
  function applyPrinterState(configured) {
    const cb = $('printPhysicalCard');
    if (!cb) return;
    const small = cb.closest('.print-card').querySelector('small');
    if (configured) {
      cb.disabled = false;
      if (small) small.textContent = 'Silent print to the NISCA PR5350 card printer (if connected)';
    } else {
      cb.checked = false;
      cb.disabled = true;
      if (small) small.textContent = 'No card printer configured: open Setup to set one.';
    }
  }

  function applyAppMode(info) {
    if (!info) return;
    if (info.mode === 'instructor' && info.instructor && !info.proxyPosting) {
      applyLockedIdentity(info.instructor);
    } else if (info && info.proxyPosting) {
      applyProxyPostingNote();
    }
    applyPrinterState(info.printerConfigured !== false);
  }

  // Proxy-poster accounts (e.g. designated office accounts): the instructor fields stay blank and
  // editable so certificates can be posted for another instructor. The
  // fields are required, so nothing ships without an instructor on it.
  function applyProxyPostingNote() {
    if ($('instructorProxyNote')) return;
    const note = document.createElement('div');
    note.id = 'instructorProxyNote';
    note.className = 'lock-note';
    note.textContent = 'You can post for another instructor: enter their name and email.';
    $('instructorEmailError').after(note);
  }

  /* ---------------- setup / settings ---------------- */

  // setupIsRerun: true when the Settings screen was opened from the header
  // button (an existing sign-in is kept); false on first run (nothing saved).
  let setupIsRerun = false;
  let setupSavedUser = '';

  function showSetupScreen(isRerun, info) {
    setupIsRerun = isRerun;
    document.body.classList.add('setup-mode');
    $('setupScreen').classList.remove('hidden');
    if (!setupWired) {
      setupWired = true;
      wireSetupOnce();
    }
    // Per-open state.
    $('setupHeading').textContent = isRerun ? 'Settings' : 'Set up EASY Operations';
    $('setupSub').textContent = isRerun
      ? 'Change your sign-in or card printer below. Your current sign-in stays until you change it.'
      : 'Sign in with your WordPress account. Your instructor name and email are taken from your profile and locked to your login.';
    const hasAccount = isRerun && info && info.accountUser;
    $('signInStatus').classList.toggle('hidden', !hasAccount);
    // With a saved sign-in the credential form starts collapsed; changing
    // sign-in means entering full new credentials (no blank-password magic).
    $('signInForm').classList.toggle('hidden', !!hasAccount);
    $('signInChangeButton').textContent = 'Change sign-in';
    const saveBtn = $('setupSaveButton');
    saveBtn.textContent = isRerun ? 'Save' : 'Save & start';
    setupIdentity = null;
    $('setupTestResult').classList.add('hidden');
    $('setupEmailField').classList.add('hidden');
    if (hasAccount) {
      setupSavedUser = info.accountUser;
      $('signInUser').textContent = setupSavedUser;
      $('setupUser').value = setupSavedUser;
    } else {
      setupSavedUser = '';
      $('setupUser').value = '';
    }
    $('setupAppPassword').value = '';
    $('setupBackButton').classList.toggle('hidden', !isRerun);
    // Save starts enabled on re-run (printer-only changes need no test);
    // the click handler enforces a fresh test when sign-in details change.
    saveBtn.disabled = !isRerun;
    loadSetupPrinters().then(() => {
      if (isRerun && info && info.printerName) $('setupPrinter').value = info.printerName;
    });
  }

  function exitSetupScreen() {
    $('setupScreen').classList.add('hidden');
    document.body.classList.remove('setup-mode');
  }

  function showSetupResult(ok, message) {
    const el = $('setupTestResult');
    el.classList.remove('hidden', 'ok', 'err');
    el.classList.add(ok ? 'ok' : 'err');
    el.textContent = message;
  }

  async function loadSetupPrinters() {
    const sel = $('setupPrinter');
    if (sel.options.length > 1) return;
    try {
      const res = await window.easyCert.getPrinters();
      if (res && res.ok) {
        for (const name of res.printers) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        }
      }
    } catch (err) {
      console.error('Could not list printers:', err);
    }
  }

  function wireSetupOnce() {
    const testBtn = $('setupTestButton');
    const saveBtn = $('setupSaveButton');

    const invalidateTest = () => {
      setupIdentity = null;
      // First run needs a fresh test before saving; on re-run the Save
      // button stays enabled for printer-only changes.
      if (!setupIsRerun) saveBtn.disabled = true;
      $('setupTestResult').classList.add('hidden');
      $('setupEmailField').classList.add('hidden');
    };
    ['setupBaseUrl', 'setupUser', 'setupAppPassword'].forEach((id) => {
      $(id).addEventListener('input', invalidateTest);
    });

    testBtn.addEventListener('click', async () => {
      const baseUrl = $('setupBaseUrl').value.trim();
      const user = $('setupUser').value.trim();
      const appPassword = $('setupAppPassword').value;
      testBtn.disabled = true;
      testBtn.textContent = 'Testing\u2026';
      try {
        const res = await window.easyCert.testConnection({ baseUrl, user, appPassword });
        if (res && res.ok) {
          // If WordPress withholds the email (e.g. a security plugin filters
          // it out of REST responses), let the instructor type it instead.
          if (res.email) {
            $('setupEmailField').classList.add('hidden');
            setupIdentity = { name: res.name, email: res.email };
          } else {
            $('setupEmail').value = '';
            $('setupEmailField').classList.remove('hidden');
            setupIdentity = { name: res.name, email: '' };
          }
          let msg = `Connected as ${res.name}${res.email ? ` (${res.email})` : ''}.`;
          if (res.canUpload === false) {
            msg += ' Warning: this account cannot upload files, so posting will fail. It needs the upload_files capability (usually via the Administrator or Instructor role).';
          } else if (res.canUpload !== true) {
            msg += ' Note: file-upload permission could not be verified.';
          }
          showSetupResult(true, msg);
          await loadSetupPrinters();
          saveBtn.disabled = false;
        } else {
          showSetupResult(false, (res && res.error) || 'Connection failed.');
        }
      } catch (err) {
        showSetupResult(false, `Could not test the connection: ${err.message}`);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection';
      }
    });

    $('setupProfileButton').addEventListener('click', () => {
      window.easyCert.openProfile();
    });

    // Reveal/hide the credential form. Collapsing discards half-entered
    // credentials and test state, so Save falls back to a printer-only save.
    $('signInChangeButton').addEventListener('click', () => {
      const form = $('signInForm');
      const willShow = form.classList.contains('hidden');
      form.classList.toggle('hidden', !willShow);
      $('signInChangeButton').textContent = willShow ? 'Cancel' : 'Change sign-in';
      if (willShow) {
        $('setupUser').value = setupSavedUser;
        $('setupAppPassword').value = '';
      } else {
        $('setupAppPassword').value = '';
        setupIdentity = null;
        $('setupTestResult').classList.add('hidden');
        $('setupEmailField').classList.add('hidden');
      }
    });

    saveBtn.addEventListener('click', async () => {
      const user = $('setupUser').value.trim();
      const appPassword = $('setupAppPassword').value;
      const printerName = $('setupPrinter').value || null;
      // The sign-in counts as changed only when its form is open and the
      // username differs or a new password was entered. Otherwise this is
      // a printer-only update: no test, no credential rewrite.
      const signInOpen = !$('signInForm').classList.contains('hidden');
      const signInChanged = signInOpen && (user !== setupSavedUser || appPassword !== '');

      if (!signInChanged) {
        saveBtn.disabled = true;
        const label = saveBtn.textContent;
        saveBtn.textContent = 'Saving\u2026';
        try {
          const res = await window.easyCert.setPrinter(printerName);
          if (res && res.ok) {
            toast('Printer updated.', 'success');
            applyPrinterState(!!printerName);
            exitSetupScreen();
          } else {
            toast((res && res.error) || 'Could not save the printer.', 'error', 8000);
          }
        } catch (err) {
          toast(`Could not save the printer: ${err.message}`, 'error', 8000);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = label;
        }
        return;
      }

      // New or changed sign-in details: a fresh test is required first.
      if (!setupIdentity) {
        toast('Test the connection before saving new sign-in details.', 'error');
        return;
      }
      // Email typed by hand when WordPress didn't provide one.
      let email = setupIdentity.email;
      if (!$('setupEmailField').classList.contains('hidden')) {
        email = $('setupEmail').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          showSetupResult(false, 'Enter a valid email address to continue.');
          return;
        }
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving\u2026';
      try {
        const res = await window.easyCert.saveSetup({
          baseUrl: $('setupBaseUrl').value.trim(),
          user: $('setupUser').value.trim(),
          appPassword: $('setupAppPassword').value,
          name: setupIdentity.name,
          email,
          printerName: $('setupPrinter').value || null,
        });
        if (res && res.ok) {
          location.reload();
        } else {
          showSetupResult(false, (res && res.error) || 'Could not save the setup.');
          saveBtn.disabled = false;
          saveBtn.textContent = setupIsRerun ? 'Save' : 'Save & start';
        }
      } catch (err) {
        showSetupResult(false, `Could not save the setup: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = setupIsRerun ? 'Save' : 'Save & start';
      }
    });

    $('setupBackButton').addEventListener('click', exitSetupScreen);

    $('setupSignOutButton').addEventListener('click', async () => {
      const yes = await showModal({
        title: 'Sign out?',
        body: 'This removes the saved WordPress sign-in from this computer. You will need your username and a new application password to sign back in.',
        okText: 'Sign out',
        cancelText: 'Cancel',
      });
      if (!yes) return;
      try {
        const res = await window.easyCert.resetSetup();
        if (res && res.ok) location.reload();
        else toast((res && res.error) || 'Could not sign out.', 'error');
      } catch (err) {
        toast(`Could not sign out: ${err.message}`, 'error');
      }
    });
  }

  // Header "What's New" button: show the recent release notes dialog.
  // The notes are plain staff-facing release notes (kept in main.js).
  // Nothing business-internal is shown here; the full project summary
  // lives on the website's management queue page instead.
  $('whatsNewHeaderButton').addEventListener('click', () => {
    window.easyCert.showWhatsNew();
  });

  // Header "Setup" button: open Settings without signing out.
  $('setupHeaderButton').addEventListener('click', async () => {
    try {
      const info = await window.easyCert.getAppInfo();
      showSetupScreen(true, info);
    } catch (err) {
      toast(`Could not open Settings: ${err.message}`, 'error');
    }
  });

  /* ---------------- certificate number ---------------- */

  function generateCertificateNumber() {
    if (completionDate.value && courseTitle.value) {
      certificateNumber.value = S.makeCertificateNumber(completionDate.value, courseTitle.value, instanceNumber);
    } else {
      certificateNumber.value = '';
    }
  }

  incrementButton.addEventListener('click', () => {
    instanceNumber++;
    generateCertificateNumber();
  });

  decrementButton.addEventListener('click', () => {
    if (instanceNumber > 1) instanceNumber--;
    generateCertificateNumber();
  });

  /* ---------------- dynamic field visibility ---------------- */

  courseCategory.addEventListener('change', () => {
    const selected = courseCategory.value;
    courseTitle.innerHTML = '<option value="">Select title</option>';

    if (selected === S.WPNL_CATEGORY) {
      wpnlControlGroup.classList.remove('hidden');
      WPNLcontrol.setAttribute('required', 'required');
    } else {
      wpnlControlGroup.classList.add('hidden');
      WPNLcontrol.removeAttribute('required');
      WPNLcontrol.value = '';
    }

    (S.titlesByCategory[selected] || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      courseTitle.appendChild(option);
    });
    validateForm();
  });

  courseTitle.addEventListener('change', () => {
    instanceNumber = 1;
    generateCertificateNumber();

    if (courseTitle.value === S.FORKLIFT_VALUE) {
      forkliftClassGroup.classList.remove('hidden');
    } else {
      forkliftClassGroup.classList.add('hidden');
      forkliftClassGroup.querySelectorAll('input[name="forkliftClass"]').forEach((cb) => { cb.checked = false; });
    }
    validateForm();
  });

  completionDate.addEventListener('change', () => {
    expiryDate.disabled = !completionDate.value;
    expiryDate.min = completionDate.value || '';

    if (completionDate.value) {
      expiryDate.value = S.expiryPlus3Years(completionDate.value);
    } else {
      expiryDate.value = '';
    }

    generateCertificateNumber();
    validateForm();
  });

  expiryDate.addEventListener('change', () => {
    if (expiryDate.value && completionDate.value && expiryDate.value < completionDate.value) {
      expiryDate.value = '';
      toast('Expiry date cannot be before the completion date.', 'error');
    }
    validateForm();
  });

  /* ---------------- validation ---------------- */

  function setFieldError(field, message) {
    const errorDiv = $(`${field.id}Error`);
    if (message) {
      field.classList.add('error');
      if (errorDiv) errorDiv.textContent = message;
    } else {
      field.classList.remove('error');
      if (errorDiv) errorDiv.textContent = '';
    }
  }

  // Pure validity check — no UI side effects.
  function checkValidity() {
    const problems = [];

    form.querySelectorAll('[required]').forEach((field) => {
      if (!field.checkValidity()) problems.push(field);
    });

    // Forklift class required when the group is visible.
    if (!forkliftClassGroup.classList.contains('hidden') &&
        forkliftClassGroup.querySelectorAll('input[name="forkliftClass"]:checked').length === 0) {
      problems.push('forkliftClass');
    }

    // Confirm-email match.
    if (studentEmail.value !== confirmEmail.value) problems.push(confirmEmail);

    // Company contact is optional, but when filled it must be a valid email
    // (it feeds the employer certificate digest).
    const companyContactField = $('companyContact');
    const ccValue = companyContactField.value.trim();
    if (ccValue !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ccValue)) {
      problems.push(companyContactField);
    }

    return problems;
  }

  // Update the error UI. Messages only appear after the user has tried
  // to submit; before that the form stays quiet while they type.
  function validateForm() {
    const problems = checkValidity();

    if (submitAttempted) {
      form.querySelectorAll('[required]').forEach((field) => {
        setFieldError(field, field.checkValidity() ? '' : field.validationMessage);
      });

      const forkliftError = $('forkliftClassError');
      if (problems.includes('forkliftClass')) {
        forkliftError.textContent = 'Please select at least one forklift class.';
      } else {
        forkliftError.textContent = '';
      }

      if (studentEmail.value !== confirmEmail.value) {
        setFieldError(confirmEmail, 'Emails do not match.');
      } else if (confirmEmail.checkValidity()) {
        setFieldError(confirmEmail, '');
      }

      const companyContactField = $('companyContact');
      if (problems.includes(companyContactField)) {
        setFieldError(companyContactField, 'Enter a valid email address, or leave this blank.');
      } else {
        setFieldError(companyContactField, '');
      }

      if (problems.length) {
        errorSummary.textContent = `Please fix ${problems.length} field${problems.length === 1 ? '' : 's'} below before posting.`;
        errorSummary.classList.remove('hidden');
      } else {
        errorSummary.classList.add('hidden');
      }
    }

    postButton.disabled = submitting;
    return problems.length === 0;
  }

  function hideAllErrors() {
    form.querySelectorAll('.error').forEach((f) => f.classList.remove('error'));
    form.querySelectorAll('.error-message').forEach((d) => { d.textContent = ''; });
    errorSummary.classList.add('hidden');
  }

  // After the first submit attempt, re-validate live so errors clear as they're fixed.
  form.addEventListener('input', () => { if (submitAttempted) validateForm(); });
  form.addEventListener('change', () => { if (submitAttempted) validateForm(); });

  /* ---------------- clear ---------------- */

  clearButton.addEventListener('click', async () => {
    const yes = await showModal({
      title: 'Clear form?',
      body: 'All entered data will be discarded.',
      okText: 'Clear it',
      cancelText: 'Keep editing',
    });
    if (!yes) return;

    form.reset();
    if (lockedInstructor) applyLockedIdentity(lockedInstructor);
    courseTitle.innerHTML = '<option value="">Select title</option>';
    expiryDate.disabled = true;
    wpnlControlGroup.classList.add('hidden');
    WPNLcontrol.removeAttribute('required');
    forkliftClassGroup.classList.add('hidden');
    instanceNumber = 1;
    certificateNumber.value = '';
    submitAttempted = false;
    hideAllErrors();
    validateForm();
    $('studentName').focus();
  });

  /* ---------------- submit ---------------- */

  function selectedForkliftClasses() {
    return Array.from(forkliftClassGroup.querySelectorAll('input[name="forkliftClass"]:checked'))
      .map((cb) => cb.value);
  }

  function buildPayload() {
    const courseValue = courseTitle.value;
    const displayedTitle = courseTitle.options[courseTitle.selectedIndex].text;
    const studentName = $('studentName').value.trim();
    const rawDate = completionDate.value;
    const classes = selectedForkliftClasses();

    const pdfCourseName = S.makePdfCourseName(displayedTitle, courseValue, classes);
    const filenameCoursePart = S.makeFilenameCoursePart(displayedTitle, courseValue);
    const isWpnl = courseCategory.value === S.WPNL_CATEGORY;

    return {
      pdf: {
        studentName,
        certificateNumber: certificateNumber.value,
        completionDate: rawDate,
        expiryDate: expiryDate.value,
        instructorName: $('instructorName').value.trim(),
        pdfCourseName,
        isWpnl,
        wpnlControl: WPNLcontrol.value.trim(),
      },
      filename: S.makePdfFilename(studentName, filenameCoursePart, rawDate),
      title: S.makePostTitle(rawDate, pdfCourseName, studentName),
      acf: {
        student_name: studentName,
        student_email: studentEmail.value.trim(),
        student_phone: $('studentPhone').value.trim(),
        course_category: courseCategory.value,
        course_title: courseValue, // always the base course; classes live in the PDF/post title
        completion_date: rawDate,
        expiry_date: expiryDate.value,
        instructor: $('instructorName').value.trim(),
        instructor_email: $('instructorEmail').value.trim(),
        company: $('companyName').value.trim(),
        company_contact: $('companyContact').value.trim(),
        certificate_number: certificateNumber.value,
        wpnl: WPNLcontrol.value.trim(),
      },
      printCard: $('printPhysicalCard').checked,
    };
  }

  function setSubmitting(active, label) {
    submitting = active;
    postButton.disabled = active;
    postButton.innerHTML = active
      ? '<span class="spinner"></span><span class="btn-label">Posting…</span>'
      : '<span class="btn-label">Post certificate</span>';
    if (label) postButton.querySelector('.btn-label').textContent = label;
  }

  /* ---------------- certificate result: preview / print / save ---------------- */

  const certModal = $('certModal');
  const certPreview = $('certPreview');
  const certPrintButton = $('certPrintButton');
  const certSaveButton = $('certSaveButton');
  const certOpenButton = $('certOpenButton');
  const certDoneButton = $('certDoneButton');
  const certMoreButton = $('certMoreButton');
  let certModalResolve = null;

  function pdfFileUrl(pdfPath) {
    return encodeURI(`file:///${pdfPath.replace(/\\/g, '/')}`);
  }

  // Opens the result modal with the generated certificate previewed.
  // Print/Save keep the modal open; the student buttons resolve with
  // true/false and close it.
  function openCertModal(pdfPath) {
    if (pdfPath) {
      certPreview.setAttribute('src', pdfFileUrl(pdfPath));
      certPrintButton.disabled = false;
      certSaveButton.disabled = false;
      certOpenButton.disabled = false;
    } else {
      certPreview.removeAttribute('src');
      certPrintButton.disabled = true;
      certSaveButton.disabled = true;
      certOpenButton.disabled = true;
    }
    certModal.classList.remove('hidden');
    return new Promise((resolve) => { certModalResolve = resolve; });
  }

  function closeCertModal(value) {
    certModal.classList.add('hidden');
    certPreview.removeAttribute('src');
    if (certModalResolve) {
      const r = certModalResolve;
      certModalResolve = null;
      r(value);
    }
  }

  certPrintButton.addEventListener('click', async () => {
    certPrintButton.disabled = true;
    try {
      const res = await window.easyCert.printPdf();
      if (!res.ok && !res.canceled) {
        toast(`Printing failed: ${res.error}`, 'error', 8000);
      }
    } catch (err) {
      toast(`Printing failed: ${err.message}`, 'error', 8000);
    } finally {
      certPrintButton.disabled = false;
    }
  });

  certSaveButton.addEventListener('click', async () => {
    certSaveButton.disabled = true;
    try {
      const res = await window.easyCert.savePdfCopy();
      if (res.ok) {
        toast('Certificate PDF saved.', 'success');
      } else if (!res.canceled) {
        toast(`Save failed: ${res.error}`, 'error', 8000);
      }
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'error', 8000);
    } finally {
      certSaveButton.disabled = false;
    }
  });

  certOpenButton.addEventListener('click', async () => {
    certOpenButton.disabled = true;
    try {
      const res = await window.easyCert.openPdfExternal();
      if (!res.ok) {
        toast(`Could not open the PDF: ${res.error}`, 'error', 8000);
      }
    } catch (err) {
      toast(`Could not open the PDF: ${err.message}`, 'error', 8000);
    } finally {
      certOpenButton.disabled = false;
    }
  });

  certMoreButton.addEventListener('click', () => closeCertModal(true));
  certDoneButton.addEventListener('click', () => closeCertModal(false));

  async function showCertResult(result) {
    const more = await openCertModal(result.pdfPath);

    if (more) {
      instanceNumber++;
      $('studentName').value = '';
      studentEmail.value = '';
      confirmEmail.value = '';
      $('studentPhone').value = '';
      WPNLcontrol.value = '';
      generateCertificateNumber();
      validateForm();
      $('studentName').focus();
    } else {
      resetCertForm();
    }
  }

  $('editDraftCancel').addEventListener('click', cancelEdit);

  postButton.addEventListener('click', async () => {
    if (submitting) return;

    submitAttempted = true;
    if (!validateForm()) {
      toast('Please fix the highlighted fields before posting.', 'error');
      return;
    }
    if (studentEmail.value !== confirmEmail.value) {
      toast('Email confirmation does not match the primary email.', 'error');
      return;
    }

    const payload = buildPayload();
    if (editingDraftId) payload.updateId = editingDraftId;
    setSubmitting(true, editingDraftId ? 'Updating draft…' : 'Generating PDF…');

    try {
      const result = await window.easyCert.submit(payload);

      if (!result.ok) {
        toast(`Failed: ${result.error}`, 'error', 8000);
        return;
      }

      // The main process may have bumped the certificate number to avoid a
      // collision — keep the form in sync for the "more students" flow.
      if (result.certificateNumber) {
        certificateNumber.value = result.certificateNumber;
        const numMatch = /(\d{2})$/.exec(result.certificateNumber);
        if (numMatch) instanceNumber = parseInt(numMatch[1], 10);
      }

      if (result.updated) {
        toast('Draft updated.', 'success');
        cancelEdit();
        window.EasyViews.showView('approvals');
        if (window.EasyApprovalTabs) window.EasyApprovalTabs.show('certs');
        else if (window.EasyCertApprovals) window.EasyCertApprovals.show();
        return;
      }

      toast(`Certificate posted (ID ${result.postId}).`, 'success');

      if (payload.printCard) {
        if (result.print && result.print.ok) {
          toast('Physical ID card printed on the NISCA PR5350.', 'success');
        } else {
          const err = (result.print && result.print.error) || 'unknown printer error';
          toast(`Card printing failed: ${err}`, 'error', 8000);
        }
      }

      await showCertResult(result);
    } catch (err) {
      console.error('Submit failed:', err);
      toast(`An unexpected error occurred: ${err.message}`, 'error', 8000);
    } finally {
      setSubmitting(false);
    }
  });

  /* ---------------- edit-draft mode (fix before publish) ---------------- */

  function setEditMode(id, student) {
    editingDraftId = id || null;
    const banner = $('editDraftBanner');
    const label = document.querySelector('#postButton .btn-label');
    if (editingDraftId) {
      $('editDraftBannerText').textContent =
        `Editing draft for ${student || 'this certificate'} — saving updates the draft. Publish it from the Approvals tab when ready.`;
      banner.classList.remove('hidden');
      if (label) label.textContent = 'Update draft';
    } else {
      banner.classList.add('hidden');
      if (label) label.textContent = 'Post certificate';
    }
  }

  function prefillFromAcf(acf) {
    acf = acf || {};
    $('studentName').value = acf.student_name || '';
    studentEmail.value = acf.student_email || '';
    confirmEmail.value = acf.student_email || '';
    $('studentPhone').value = acf.student_phone || '';
    // Category first: its change handler repopulates the course select.
    courseCategory.value = acf.course_category || '';
    courseCategory.dispatchEvent(new Event('change'));
    courseTitle.value = acf.course_title || '';
    courseTitle.dispatchEvent(new Event('change'));
    completionDate.value = acf.completion_date || '';
    completionDate.dispatchEvent(new Event('change'));
    // Override the auto-computed expiry with the stored one.
    expiryDate.value = acf.expiry_date || '';
    WPNLcontrol.value = acf.wpnl || '';
    if (lockedInstructor) {
      // Instructor mode: identity is locked to the signed-in account and
      // stamped server-side, so keep showing it instead of a draft's copy.
      applyLockedIdentity(lockedInstructor);
    } else {
      $('instructorName').value = acf.instructor || '';
      $('instructorEmail').value = acf.instructor_email || '';
    }
    $('companyName').value = acf.company || '';
    $('companyContact').value = acf.company_contact || '';
    // Set after the course change (which regenerates the number).
    certificateNumber.value = acf.certificate_number || '';
    validateForm();
  }

  function resetCertForm() {
    form.reset();
    // form.reset() wipes the JS-applied identity too; restore the lock.
    if (lockedInstructor) applyLockedIdentity(lockedInstructor);
    courseTitle.innerHTML = '<option value="">Select title</option>';
    expiryDate.disabled = true;
    wpnlControlGroup.classList.add('hidden');
    WPNLcontrol.removeAttribute('required');
    forkliftClassGroup.classList.add('hidden');
    instanceNumber = 1;
    certificateNumber.value = '';
    submitAttempted = false;
    hideAllErrors();
    validateForm();
  }

  function cancelEdit() {
    resetCertForm();
    setEditMode(null);
  }

  async function openDraftById(id) {
    try {
      const res = await window.easyCert.certApprovals.get(id);
      if (!res.ok) throw new Error(res.error || 'Could not load the draft.');
      const d = res.cert;
      if (d.status && d.status !== 'draft') {
        toast('Only draft certificates can be edited.', 'error');
        return;
      }
      window.EasyViews.showView('certs');
      if (window.EasyCertTabs) window.EasyCertTabs.show('new');
      prefillFromAcf(d.rawAcf || {});
      setEditMode(d.id, d.student);
      window.scrollTo(0, 0);
      $('studentName').focus();
    } catch (err) {
      toast(`Could not open the draft for editing: ${err.message}`, 'error', 8000);
    }
  }

  window.EasyCertEdit = {
    openDraft: openDraftById,
    cancel: cancelEdit,
    isEditing: () => !!editingDraftId,
  };

  /* ---------------- startup ---------------- */

  (async function init() {
    let info = null;
    try {
      info = await window.easyCert.getAppInfo();
      const banner = $('configBanner');
      if (info.buildTag !== EXPECTED_BUILD_TAG) {
        banner.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = 'Update needed: ';
        banner.appendChild(strong);
        banner.appendChild(document.createTextNode(
          'this copy of the app is running old or mismatched files, so new features may not work. ' +
          'Unzip the latest easy-operations.zip over the project folder and restart the app.'
        ));
        banner.classList.remove('hidden');
      } else if (!info.configOk) {
        showSetupScreen(false, info);
        return;
      }
      applyAppMode(info);
      // Course Builder tab: only allowlisted accounts may see
      // it. Everyone else gets the tab hidden; showView() also refuses the
      // 'builder' view for them as a backstop.
      const builderUser = (info && info.accountUser ? String(info.accountUser) : '').toLowerCase();
      window.EasyCourseBuilderAllowed = builderUser === 'author1' || builderUser === 'sglynn';
      const builderTab = $('tabCourseBuilder');
      if (builderTab) builderTab.style.display = window.EasyCourseBuilderAllowed ? '' : 'none';
      // When the site runs EASY Suite's Course Builder module, it decides
      // instead: every course author and reviewer gets the tab, and
      // reviewers see how many courses are waiting for them.
      if (window.easyCert.courses) {
        window.easyCert.courses.sync('me').then((r) => {
          if (!r || !r.ok || !r.data) return;
          window.EasyCourseBuilderAllowed = Boolean(r.data.isAuthor || r.data.isReviewer);
          if (builderTab) builderTab.style.display = window.EasyCourseBuilderAllowed ? '' : 'none';
          const badge = $('tabCourseBuilderBadge');
          const n = r.data.isReviewer ? (r.data.pendingReviews | 0) : 0;
          if (badge) { badge.textContent = n; badge.classList.toggle('hidden', !n); }
        }).catch(() => {});
      }
      // Resolve review privileges and trim the approval UI for plain
      // instructor accounts (office mode keeps everything).
      window.EasyPerms.privileged = Boolean(info.proxyPosting || info.mode === 'office');
      if (!window.EasyPerms.privileged) {
        for (const id of ['subTabClasses', 'subTabAccounts']) {
          const el = $(id);
          if (el) el.classList.add('hidden');
        }
      }
      // Background attention scan: populate the badge counts so nothing
      // needing review looks "all clear" on launch. Fire and forget —
      // the scan is silent and never blocks the UI.
      if (window.EasyStartupScan) {
        window.EasyStartupScan.run().catch(() => {});
      }
    } catch (err) {
      console.error('Could not reach main process:', err);
    }
    validateForm();
  })();
})();
