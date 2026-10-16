# EASY Operations

Desktop operations hub for EASY Safety Training. It has five tabs:

- **Certificates**, with three sub-tabs:
  - **New certificate**: fill in a student's details, generate the
    certificate PDF from the template, upload it to the WordPress site
    (`easysafety.ca`) and create the `cert` post with its ACF fields. The post
    is saved as a draft for office review.
  - **Find & reprint**: search issued certificates by student name or course
    and open the stored PDF to print or save it.
  - **Expiring soon**: certificates expiring in the next 30/60/90 days,
    grouped by company, for booking renewals. The badge counts the next 90
    days.
- **Approvals**: review queues (see below).
- **Schedule**: post classes to the site's event calendar with dates, times,
  locations and instructors, with no wp-admin needed.
- **Online Learning**: concept preview with sample data (student statuses,
  inquiries and the practical-booking queue). It isn't wired to real data
  yet, and a "Concept preview" notice shows before it opens.
- **Course Builder**: online-module courses and their review. Only course
  authors and reviewers see it (see below).

After posting, a result dialog previews the generated certificate PDF with
**Print…** (the normal system print dialog), **Save a copy…** and **Open in
viewer…** (the computer's default PDF app). It can also silent-print a
physical ID card on the NISCA PR5350 if that printer is connected and picked
in Setup.

The app relies on **EASY Suite**, the site's WordPress plugin, kept in this
repo under `site-plugins/easy-suite/`. It provides the certificate fields,
certificate PDF downloads, the Accounts queue, certificate-number checks, the
"post for other instructors" setting and Course Builder sync. Its README
covers installing, updating and its own change list. Online course license
keys (EASY Suite 2.2) are issued on the site under EASY Suite → Online
courses; the app doesn't use them yet.

## Approvals

The **Approvals** tab has three queues, **Certificates**, **Classes** and
**Accounts**, each with a pending-count badge; the Approvals tab itself shows
the total. The counts are filled in quietly right after launch, so the badges
are right before anyone opens the tab.

- **Certificates**: draft certificates submitted by instructors, waiting for
  office review. Each row shows the student, course, completion date,
  instructor, submission date and certificate number, plus who publishing
  will email (the student's address, or "No student email") and where the
  employer copy goes (the company contact). Buttons:
  - **Preview** (only when the draft has a PDF attached) downloads the PDF
    through EASY Suite's signed-in certificate link (`/cert-pdf/<number>/`)
    and opens it in a viewer window with print and save buttons.
  - **Edit** opens the draft in the New certificate form. Saving updates the
    same draft and replaces its PDF, with no card print or result dialog.
  - **Publish** (reviewers only) flips the post to `publish`, which is also
    what triggers the student notification email. Students are never emailed
    about a draft.

  Queue rows show pretty course names (old drafts that carry raw slugs are
  humanized via the shared catalogue). Listing and publishing use the native
  `/wp-json/wp/v2/cert` endpoints. Accounts without certificate edit rights
  see an explanatory banner instead of the queue.
- **Classes**: draft classes proposed on the Schedule tab for the next 12
  months (past drafts stay on the calendar only). Each row shows the class,
  dates and times, location, instructor and status, with **Edit** (opens the
  Schedule tab's class editor), **Calendar** (jumps to that month) and
  **Publish** (makes the class visible on the site). Uses The Events
  Calendar's REST API. Accounts without event publishing rights see an
  explanatory banner instead of the queue.
- **Accounts**: new student/member accounts (Ultimate Member) awaiting admin
  review, with **Approve** and **Reject**. Served by EASY Suite's "App bridge:
  approvals & expiring certs" module, which also feeds Expiring soon.
  Requires the `promote_users` capability.

The workflow: instructors submit drafts (posting never publishes); office
staff review the Certificates queue and publish what checks out. Instructor
accounts should have create/edit-draft rights but *not* publish rights, so
the queue can't be bypassed. Instructors see their own drafts with Preview
and Edit, but no Publish, and don't see the Classes and Accounts queues. In
the app, Publish and those two queues are only shown to reviewer accounts:
the ones listed under EASY Suite → Settings → "Can post certificates for
other instructors" (see First-time setup, step 3). Publishing also needs
WordPress publish rights.

## Course Builder

Course authors build online-module courses chapter by chapter in the
**Course Builder** tab. Authors are WordPress usernames (default `sglynn`)
set in EASY Suite → Settings → **Course Builder authors**, or by any author
from the **Course authors** card in the tab. With site sync, the list is
shared and only accepts real WordPress usernames, and there must always be at
least one author.

Reviewers are admins, anyone who can publish certificates, and any extra
usernames under EASY Suite → Settings → **Extra Course Builder reviewers**.
They get read-only access to every course, plus **Approve** and **Send back
with note** in the **Review inbox**. Authors see the inbox too, as a history
of what happened to their reviews. Reviewers also get a badge on the tab
with the number of courses waiting for them.

Who sees the tab is decided when the app starts, so restart it after
changing these lists. When the site has Course Builder sync, the tab shows
for every author and reviewer it knows about. Without it (an older site, the
module switched off, or the site not answering at startup), only the two
built-in accounts in `renderer/renderer.js` see the tab.

When the site runs EASY Suite 2.1 or later with the **App bridge: Course
Builder sync** module on (it is by default), courses are saved to the site as
the author works, so they're the same on every computer, and "Send for
review", approve and send back all happen in the app:

- Each computer keeps a cached copy. Once it has synced with the site,
  editing still works while the site can't be reached; edits retry every 30
  seconds and upload when it's back. A status chip shows whether everything
  is saved to the site, with a **Refresh** button.
- If two computers change the same course, the site's version is kept and the
  other computer's edits become a separate copy, so nothing is lost.
- **Send for review** runs a readiness check first, then freezes a numbered
  snapshot; the author can keep editing without touching it. It waits until
  the site can be reached.
- Only one version can be with the reviewers at a time. **Withdraw** it to
  send a newer one.
- **Send back** needs a note, which the author sees on the course.
  **Approve** stores that version on the site as the final package
  (**Download approved vN** in the course list). Online course keys can only
  be issued for a course with an approved version.
- Deleting a synced course removes it, and its reviews, from the site and
  every computer.
- A course can't be bigger than 2 MB (media files aren't stored in it).

Against an older site, or with that module switched off, the builder keeps
courses on one computer and passes files around. **Send for review**
downloads a `<course>-v<N>.review.json` file for the author to send to a
reviewer, who imports it in the Review inbox. Approving downloads the final
`.final.json` package, and sending back downloads a `.changes.json` file the
author imports. With sync on, the inbox can still import a review file from
someone working without the site.

The app also writes automatic backup files of every course, at most once a
minute, to `%APPDATA%\EASYOperations\course-builder-backups\`. It keeps
timestamped files (newest 20) plus `latest.json`; **Open backups folder** in
the tab opens it.

## First-time setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Run the app — the setup wizard handles the rest (recommended).**
   On first launch the app shows a "setup needed" message. It has just put a
   template `config.json` in place, which you don't need to edit. Close the
   message and the setup screen opens: enter the WordPress site URL, your WP
   username, and an **application password** you create in your own WP
   profile. The **Open my WordPress profile** button opens it in your browser
   for you. Under Application Passwords, add one named "EASY Operations" and
   paste it into the wizard. (The site URL is fixed to easysafety.ca.)
   **Test connection** verifies the login against WordPress and pulls your
   display name and email from your profile. It also checks the account's
   rights by listing media in edit mode, which only accounts with editing
   rights can do (if that check can't run, it falls back to the
   `upload_files` capability on your profile). If the check fails, the result
   warns that posting will fail, but it doesn't stop you saving. If the site
   withholds the email from the REST API (some security plugins filter it),
   the wizard asks you to type it instead. The setup screen also has an
   optional **Card printer** picker; card printing stays off until one is
   picked. **Save & start** writes `config.json` to your per-user app folder
   (`%APPDATA%\EASYOperations\` on Windows), with the application password
   encrypted by the OS keychain when available, and opens the app.

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

3. **Posting on behalf of another instructor.** Accounts listed on the site
   under **EASY Suite → Settings → Can post certificates for other
   instructors** are exempt from the identity lock: their instructor
   name/email fields stay blank and editable (they're required, so nothing
   ships without an instructor), and the main process doesn't stamp their
   identity over the form values, so office staff can post certificates on
   behalf of instructors. These accounts are also the app's reviewers (see
   Approvals). The app reads the list from the site
   (`/wp-json/easy/v1/app-config`) when it starts, waiting at most 5 seconds,
   and remembers the answer until you sign out or restart. If the site
   doesn't answer, or runs EASY Suite older than 2.1, the app uses its
   built-in list (`PROXY_POSTER_FALLBACK` in `main.js`) and asks again the
   next time it checks. Everyone else in instructor mode is locked to their
   own login and stamped on every submit, and the site enforces the same
   rule.

4. **Card printing (Windows).** SumatraPDF (`SumatraPDF-3.4.6-32.exe`) is
   committed in the project root, so there's nothing to add.
   `forge.config.js` unpacks it, and pdf-to-printer's own copy, out of the
   asar archive into `app.asar.unpacked`, and the app runs it from there to
   print silently to the card printer picked in Setup. Installed builds
   before 1.1.1 never unpacked it, so silent card printing works from 1.1.1
   on. The release build fails if either copy is missing.

## Running / building

- `npm start` — run in development (no auto-updates; uses a `config.json` in
  the project root if you haven't signed in through the wizard)
- `node --test` — run the unit tests in `test/` (the pure helpers in
  `shared.js`). There's no `npm test` script, and the GitHub build doesn't
  run them, so run them before opening a pull request.
- `npm run package` — build the app folder only
  (`out/EASYOperations-win32-x64/`), no installer
- `npm run make` — on Windows, build the installer
  (`out/make/squirrel.windows/x64/EasyOperationsInstaller.exe`) plus the
  update files (`EASYOperations-<version>-full.nupkg`, `RELEASES`) and a zip
  (`out/make/zip/win32/x64/`). `site-plugins/` and `test/` are left out of
  the app.
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
   and get it onto `main`. Use a plain number like `1.1.2`, higher than the
   last release.
2. On GitHub: **Actions → Release → Run workflow** (branch `main`). It builds
   the installer on GitHub's own Windows machine, checks the package
   (card-printing files unpacked, plugin code left out, `RELEASES` matching
   the update package, exactly the four usual release files) and publishes
   release `v<version>` with notes GitHub writes from the merged pull
   requests. The release stays a draft until every file is uploaded, so
   installed apps never see a half-finished one. It only runs from `main`,
   and refuses to run for a version that's already released or lower than
   the latest release. It also stops if a `v<version>` tag already exists on
   another commit; if a failed release left one behind, delete it or bump
   the version.

Pull requests that change the app run the same build and checks without
publishing. Pull requests that only touch `site-plugins/` or Markdown files
skip it.

Fallback, publishing from your own PC (PowerShell):
`$env:GITHUB_TOKEN="<token>"; npm run publish` (token: GitHub → Settings →
Developer settings → Personal access tokens (classic), `repo` scope). This
publishes the release first and uploads files after, so if it stops partway,
delete that release (and any leftover draft for that version) and its tag on
GitHub before running it again.

Only publish when there's something users should receive — every published
release triggers an update prompt. The updater only runs in the packaged app
(`app.isPackaged` guard); dev builds never phone home.

## Security

- **Site URL is pinned:** the setup wizard only accepts `https://easysafety.ca`; anything else is rejected at save time.
- **Passwords are encrypted:** WordPress application passwords from the setup wizard are stored with the OS keychain (Electron `safeStorage`) when available. Older plaintext sign-ins from the wizard are encrypted automatically on launch; the legacy shared office format (`mediaAuth`/`postAuth`) stays plaintext.
- **Locked-down UI:** a Content Security Policy lets the window load scripts, stylesheets, fonts and images only from the app's own files (images may also be `data:` URLs). Inline `style="…"` attributes are allowed since 1.1.1, because the Course Builder uses them. All network traffic goes through the main process, and every window denies popups and any navigation away from local files.
- **Instructor identity is enforced on the site too:** for accounts that can't publish certificates and aren't on the "post for other instructors" list, EASY Suite replaces the instructor name and email on every certificate saved through the API with the account's own profile.
- **No orphaned files:** if certificate posting fails after the PDF upload, the uploaded file is deleted, and saving over a draft deletes the superseded PDF. EASY Suite lets instructors delete their own unused certificate PDFs, so this cleanup works for them too, and it deletes a replaced PDF on the site as well. A delete the site refuses is logged, not shown.
- **Unique certificate numbers:** before generating the PDF, the app asks the site (EASY Suite 2.1+, `/wp-json/easy/v1/cert-number`) for the next free number, checked against every certificate including drafts, and the form switches to the number actually used. If all 99 numbers for that course and date are taken, posting stops. On an older site, or if the check can't be reached, the app falls back to scanning the newest 100 published certificates; if that fails too, it posts the number as is. EASY Suite also refuses to save a duplicate number ("Submit again to get the next free number").
- **ACF allowlist:** only known certificate fields are forwarded to WordPress. EASY Suite enforces the same list on the site and checks the values (valid emails, known courses, an uploaded PDF), refusing anything else with a 400.
- **Downloaded certificates are checked:** Preview and Find & reprint never follow a redirect and only open a file that really is a PDF. If WordPress no longer accepts the saved application password, they say to run Setup and sign in again instead of opening the WordPress login page as the certificate.
- **Course Builder sync is fenced in:** the window can only ask for a fixed list of Course Builder operations, each mapped to one `/wp-json/easy/v1/course-builder/` route with its ids checked, so it can't send requests anywhere else.

## Project layout

| File | Purpose |
|---|---|
| `main.js` | Main process: window lock-down, config and the setup wizard's sign-in check, certificate posting (number check, PDF upload, `cert` post), silent card printing, certificate preview/print/save, the Schedule, Approvals and certificate-tool API calls, Course Builder backups and site sync, and the auto-updater |
| `preload.js` | Locked-down bridge `window.easyCert`: a fixed set of methods (submit, print/save/open the PDF, setup and printers) plus `schedule`, `approvals`, `certApprovals`, `courses` and `certTools` groups. No generic send/receive |
| `pdfgen.js` | Certificate PDF generation from `EASY_CertTemplate.pdf` (no Electron deps, unit-testable) |
| `shared.js` | Pure form logic used by both the window and the main process: course catalogue, cert numbers (including the next-free bump), +3-year expiry, filenames and post titles |
| `renderer/` | UI: `index.html` (includes the CSP), `styles.css`, `schedule.css`, `builder.css`, `icon.png` (logo); scripts `renderer.js` (certificate form, setup), `cert-tools.js` (Find & reprint, Expiring soon), `schedule.js`, `approvals.js` (Accounts queue), `cert-approvals.js` (Certificates queue, Approvals sub-tabs), `class-approvals.js` (Classes queue), `startup-scan.js` (badge counts at launch), `online-learning.js` (concept preview), `course-builder.js` |
| `EASY_CertTemplate.pdf` | Fillable certificate template |
| `SumatraPDF-3.4.6-32.exe` | PDF printer used for silent card printing; unpacked from the asar archive at build time |
| `icon.ico` | App and installer icon |
| `config.example.json` | Template for `config.json`. Copied into place on first launch and overwritten by the setup wizard; its comment documents the legacy shared office format |
| `forge.config.js` | Packaging (Electron Forge): unpacks SumatraPDF, leaves `site-plugins/` and `test/` out of the app, Squirrel installer and zip, GitHub publisher, security fuses |
| `package.json` | Version (what the updater compares), dependencies, `start`/`package`/`make`/`publish` scripts |
| `test/shared.test.js` | Unit tests for `shared.js` (`node --test`) |
| `site-plugins/easy-suite/` | EASY Suite, the WordPress plugin the app relies on (see its README); not part of the app |
| `.github/workflows/release.yml` | Builds and checks the installer on pull requests; publishes a release when run from Actions |
| `LICENSE` | Proprietary licence |

## Release history

EASY Suite, the site plugin, has its own change list in
`site-plugins/easy-suite/README.md`. App features marked "EASY Suite 2.1+"
fall back to the old behaviour on an older site.

### 1.1.1

- **Silent card printing fixed:** SumatraPDF was never unpacked from the app
  archive, so "Print physical ID card now" failed in every installed build
  since 1.0.0. The packaging now unpacks it, and the app passes its path
  under the option name pdf-to-printer actually reads.
- **Course Builder styling restored:** the security policy added in 1.1.0
  blocked the Course Builder's inline styles, so Delete buttons lost their
  red colour and some fields and boxes lost their layout. Inline style
  attributes are allowed again; scripts and stylesheets are still limited to
  the app's own files.
- **Slow site no longer holds up startup:** when the app opens, it asks the
  site whether this account can post for other instructors. It now waits at
  most 5 seconds for an answer, then carries on.
- **Installer contents trimmed:** the WordPress plugin source
  (`site-plugins/`) and the tests (`test/`) are no longer packed into the
  app.
- **Releases built on GitHub:** releases are now built and published by
  **Actions → Release** (see Updates) instead of from someone's PC.

### 1.1.0

- **Site plugins combined into EASY Suite:** `site-plugins/easy-suite/`
  replaces EASY Core, EASY Certificate Notifications, EASY Instructor
  Calendar Feed, the `easy-approvals-bridge.php` snippet and the EASY Code
  Snippets. The Accounts queue now comes from EASY Suite.
- **Certificate numbers checked on the site (EASY Suite 2.1+):** the app asks
  the site for the next free number. The site checks every certificate,
  including drafts waiting in the review queue, and refuses to save a
  duplicate. If the number had to be bumped, the form shows the new number,
  so "More students?" carries on from it.
- **Posting for other instructors is a site setting (EASY Suite 2.1+):** who
  can post on behalf of other instructors is now set in EASY Suite →
  Settings, not in `main.js`. The site enforces the same rule.
- **Course Builder saved on the site (EASY Suite 2.1+):** courses, reviews
  and the authors list are shared through the site, with the Review inbox in
  the app instead of files. See Course Builder.
- **Revoked sign-ins caught on preview and reprint:** if WordPress no longer
  accepts the saved application password, previewing or reprinting a
  certificate says to run Setup and sign in again. It used to save the
  WordPress login page as the PDF and open a broken viewer.
- **Setup upload check fixed:** Test connection now really checks whether
  the account can upload files. The old check read the public media list, so
  every account passed.
- **Certificate queue shows who gets emailed:** each draft shows the student
  email that publishing will send to (or "No student email"), plus the
  employer contact who gets the employer copy.
- **Security hardening:** pinned site URL, OS-keychain password storage, a
  Content Security Policy with navigation guards, the ACF allowlist, and
  cleanup of PDFs left behind by a failed post or a replaced draft.
- **Leap-day expiry fixed:** a certificate completed on February 29 now
  expires on February 28 three years later, not on a date that doesn't
  exist. Course titles with slashes no longer break the PDF filename.
- **Unit tests:** `test/shared.test.js` checks the certificate-number, expiry
  and filename rules in `shared.js` (`node --test`).

## What changed from the old version

These notes cover the original 1.0 rewrite.

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

## Field logic

- Certificate number: `YYMMDD` + course code (dashes stripped, uppercased) +
  2-digit instance, e.g. `260930COUNTERBALANCEFORKLIFT01`. `+`/`-` step the
  instance (not below 01); picking a course resets it to 01. When you post,
  the app may move it to the next free number (see Security), and the form
  then shows the number actually used.
- Expiry is filled in as completion date + 3 years whenever the completion
  date changes (a February 29 completion expires February 28). It can be
  edited once a completion date is set, but can't be before completion.
  Editing a draft keeps its saved expiry.
- Workplace NL category reveals and requires the control # field, which is
  printed on the PDF as `Ctr #:`.
- Counter Balance Forklift reveals the class checkboxes (at least one
  required); the PDF/post title gets ` (Class 1-4-5)`, while the ACF
  `course_title` always stores the base course value.
- "More students?" keeps course/dates and company details, clears the
  student's details (and the control #), and continues from the number just
  used, plus one.
