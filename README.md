# EASY Operations

Desktop operations hub for EASY Safety Training. It has four tabs: **Certificates**
(fill in a student's details, generate the certificate PDF from the template,
upload it to the WordPress site (`easysafety.ca`) as a media attachment, create
the `cert` post with its ACF fields), **Approvals** (review queues — see below),
**Schedule** (post classes to the site's event calendar with dates, times,
locations, and instructors — no wp-admin needed), and **Online Learning**
(concept preview with sample data: student statuses, inquiries, and the
practical-booking queue — not yet wired to real data).
After posting, a result dialog previews the generated certificate
PDF with options to print it via the normal system print dialog or save a
copy — and optionally silent-print a physical ID card on the NISCA PR5350
(if the printer is connected).

## Approvals

The **Approvals** tab has two queues, each with a pending-count badge:

- **Certificates** — draft certificates submitted by instructors, waiting for
  office review. Each row shows the student, course, completion date,
  instructor, and certificate number, with **Preview** (opens the attached PDF
  in a viewer window) and **Publish**. Publishing flips the post to `publish`,
  which is also what triggers the student notification email — students are
  never emailed about a draft. Queue rows show pretty course names (old drafts
  that carry raw slugs are humanized via the shared catalogue); the Preview
  button only appears when the draft actually has a PDF attached. Uses the native `/wp-json/wp/v2/cert`
  endpoints; no site snippet needed. Accounts without certificate edit rights
  see an explanatory banner instead of the queue.
- **Accounts** — new student/member accounts awaiting admin review, served by
  the EASY Suite plugin on the site (`site-plugins/easy-suite/`; requires the
  `promote_users` capability).

The workflow: instructors submit drafts (the app never publishes); office staff
review the Certificates queue and publish what checks out. Instructor accounts
should have create/edit-draft rights but *not* publish rights, so the queue
can't be bypassed.

## Course Builder

Course authors (WordPress usernames set in EASY Suite → Settings, default
`sglynn`) build online-module courses chapter by chapter in the **Course
Builder** tab; reviewers (admins and anyone who can publish certificates)
get read-only access plus the **Review inbox**.

When the site runs EASY Suite 2.1 or later, courses are saved to the site as
the author works, so they're the same on every computer, and "Send for
review", approve and send back all happen in the app. Each computer keeps a
cached copy, so editing still works while the site can't be reached; edits
upload when it's back. If two computers change the same course, the site's
version is kept and the other computer's edits become a separate copy, so
nothing is lost. The app also writes automatic backup files of every course
(newest 20, "Open backups folder" in the tab). Against an older site the
builder falls back to keeping courses on one computer and passing review
files around.

## First-time setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Run the app — the setup wizard handles the rest (recommended).**
   On first launch with no `config.json`, the app shows a setup screen:
   enter the WordPress site URL, your WP username, and an **application
   password** you create in your own WP profile — the **Open my WordPress
   profile** button opens it in your browser for you. Under Application
   Passwords, add one named "EASY Operations" and paste it into the wizard.
   (The site URL is fixed to easysafety.ca.) **Test connection** verifies the
   login against WordPress, pulls your display name and email from your
   profile, and probes whether the account can upload files (listing media
   requires the upload_files capability). If the site withholds the email
   from the REST API — some security plugins filter it — the wizard asks you
   to type it instead. **Save & start** writes the config and opens the app.

   This is **instructor mode**: the Instructor name/email fields are prefilled
   from your WordPress profile and locked, and the main process stamps that
   identity onto every posted certificate — so the record always shows who
   actually posted it. Each instructor signs in with their own WP account, so
   there are no shared passwords and any login can be revoked individually in
   WordPress.

   The header **Setup** button opens **Settings** without signing out: a
   WordPress sign-in section (shows "Signed in as …", with Change sign-in and
   Sign out) above a card-printer picker. Changing the printer never touches
   the saved sign-in; changing the sign-in requires full new credentials and
   a successful Test connection.

3. **Posting on behalf of another instructor.** A designated office account
   (listed in `PROXY_POSTER_USERNAMES` in `main.js`) is exempt from the identity
   lock: its instructor name/email fields stay blank and editable (they're
   required, so nothing ships without an instructor), and the main process does
   not stamp its identity over the form values — so office staff can post
   certificates on behalf of instructors. Everyone else in instructor mode is
   locked to their own login, stamped server-side on every submit.

4. **Card printing (Windows).**
   Place `SumatraPDF-3.4.6-32.exe` in the project root before running
   `npm run make`. It is unpacked from the asar archive at package time so the
   printer helper can execute it.

## Running / building

- `npm start` — run in development
- `npm run make` — build the Windows installer (`EasyOperationsInstaller.exe`)
- `npm run publish` — build and publish a GitHub Release from your own PC
  (needs `GITHUB_TOKEN` in the environment); installed apps pick it up
  automatically. Normally releases are built on GitHub instead (see below).

## Updates

Installed apps self-update from GitHub Releases (public repo
`Eladerino/EASY-Operations`) via `update-electron-app`: on launch and every 10
minutes the app checks for a newer release, downloads it in the background,
and prompts for a restart to install. Release flow:

1. Bump `version` in `package.json` — the updater compares this, not the
   `ops-*` build tag. Bump it once per *published release*, not per build —
   and get it onto `main`.
2. On GitHub: **Actions → Release → Run workflow** (branch `main`). It builds
   the installer on GitHub's own Windows machine, checks the package
   (card-printing files unpacked, plugin code left out, `RELEASES` matching
   the update package) and publishes release `v<version>`. The release stays
   a draft until every file is uploaded, so installed apps never see a
   half-finished one. It refuses to run for a version that's already released.

Pull requests run the same build and checks without publishing.

Fallback, publishing from your own PC (PowerShell):
`$env:GITHUB_TOKEN="<token>"; npm run publish` (token: GitHub → Settings →
Developer settings → Personal access tokens (classic), `repo` scope). This
publishes the release first and uploads files after, so if it stops partway,
delete that release and its tag on GitHub before running it again.

Only publish when there's something users should receive — every published
release triggers an update prompt. The updater only runs in the packaged app
(`app.isPackaged` guard); dev builds never phone home.

## Security

- **Site URL is pinned:** the setup wizard only accepts `https://easysafety.ca`; anything else is rejected at save time.
- **Passwords are encrypted:** WordPress application passwords are stored with the OS keychain (Electron `safeStorage`) when available. Older plaintext configs keep working and are migrated automatically on launch.
- **Locked-down UI:** a Content Security Policy restricts the renderer to local files, and every window denies popups and non-local navigation.
- **No orphaned files:** if certificate posting fails after the PDF upload, the uploaded file is deleted; saving over a draft deletes the superseded PDF.
- **Unique certificate numbers:** the app scans recent certificates and auto-bumps the instance number on collision instead of posting duplicates.
- **ACF allowlist:** only known certificate fields are forwarded to WordPress.

## Project layout

| File | Purpose |
|---|---|
| `main.js` | App window, config loading, WP uploads, silent printing, certificate preview/print/save |
| `preload.js` | Locked-down bridge: `easyCert.submit()`, `getAppInfo()`, `printPdf()`, `savePdfCopy()` |
| `pdfgen.js` | Certificate PDF generation from `EASY_CertTemplate.pdf` (no Electron deps, unit-testable) |
| `shared.js` | Pure form logic: cert numbers, filenames, course catalogue |
| `renderer/` | UI: `index.html`, `styles.css`, `renderer.js`, `schedule.js`, `approvals.js`, `cert-approvals.js`, `course-builder.js` |
| `config.example.json` | Template for `config.json` |

## What changed from the old version

- **Security:** WP credentials moved out of the HTML into a per-machine
  `config.json`. The renderer never sees them — uploads happen in the main
  process. The old generic `send`/`receive` IPC bridge was removed.
- **Printing fixed:** the old code ignored the print result and waited on an
  event the main process never sent, so it always fell through to a 40-second
  fallback. It now awaits the result directly. Temp files get unique names and
  are cleaned up; the printer list is cached for 60s.
- **Certificate preview / print / save:** after a successful post, the app
  shows the generated certificate PDF in a result dialog. **Print…** opens
  the normal Windows print dialog for the certificate file (for anyone who
  wants physical copies); **Save a copy…** saves the PDF anywhere via a
  file dialog. The NISCA silent-print checkbox remains for the card printer
  where it is still connected.
- **Packaging fixed:** `forge.config.js` used to silently override the forge
  config in `package.json`, which dropped the `asarUnpack` entries — meaning
  SumatraPDF couldn't execute from the packaged app. There is now one config.
  (Until 1.1.1 it still used `asarUnpack`, which Forge ignores, so silent card
  printing failed in installed builds; it now uses `asar.unpack`.)
- **No more double-posts:** the Post button disables with a spinner while
  submitting.
- **UI refresh:** sectioned form, sticky action bar, inline toasts and modals
  instead of `alert()`/`confirm()`, setup banner if `config.json` is missing.
- **Branding:** EASY Safety Training green (`#1EB250`) accents with a clean
  white header, and the full-resolution EASY Safety logo (`renderer/icon.png`,
  converted from the supplied BMP — swap in a different PNG anytime by
  replacing that file).
- **Quieter validation:** error messages only appear after the first submit
  attempt; after that they update live as fields are fixed.
- **Offline-ready:** pdf-lib now runs in the main process from npm — no more
  CDN script tag.
- Removed dead code: the no-op `sanitizePrinterName`, the broken `mklink`
  "shortcut" (Squirrel creates real shortcuts), unused `@pdf-lib/fontkit`,
  unused deb/rpm makers.

## Field logic (unchanged from the original)

- Certificate number: `YYMMDD` + course code (dashes stripped, uppercased) +
  2-digit instance, e.g. `260930COUNTERBALANCEFORKLIFT01`. `+`/`-` step the instance.
- Expiry auto-set to completion date + 3 years; can't be before completion.
- Workplace NL category reveals and requires the control # field, which is
  printed on the PDF as `Ctr #:`.
- Counter Balance Forklift reveals the class checkboxes (at least one
  required); the PDF/post title gets ` (Class 1-4-5)`, while the ACF
  `course_title` always stores the base course value.
- "More students?" flow keeps course/dates and bumps the instance number.
