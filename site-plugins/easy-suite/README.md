# EASY Suite

One WordPress plugin for everything the EASY Safety Training site adds on top
of its theme and third-party plugins. It replaces:

| Old piece | Now |
|---|---|
| EASY Core 1.5.10 (plugin) | Modules *Certificate data & privacy*, *PDF gatekeeper*, *App bridge*, *Shop*, *SEO*, plus the admin pages |
| EASY Certificate Notifications 2.4.8 (plugin) | Module *Certificate emails* |
| EASY Instructor Calendar Feed 1.0.4 (plugin) | Module *Instructor calendar feed* |
| Code Snippets: course fallback, the two quiet-link snippets, certificates page redirect, branded email wrapper, UM checkbox HTML | One module each |

Settings, sent-email records, the employer-digest cutoff, cron schedules and
certificate PDFs carry over unchanged: the option names, meta keys, cron hooks,
REST routes and URLs are the same ones the old plugins used.

## Install and switch over

1. Take a backup (UpdraftPlus → Backup Now).
2. Plugins → Add New → Upload Plugin → `easy-suite.zip` → Install → Activate.
   While the old plugins are active, EASY Suite stays **paused** and only shows
   a notice listing what it replaces.
3. In that notice, press **Switch these off and use EASY Suite**. It
   deactivates exactly the listed plugins and snippets and opens
   **EASY Suite → Overview**.
4. Check the Health table is green, then delete the three old plugins.

Rolling back is the reverse: deactivate EASY Suite, re-activate the old plugins
and snippets.

## Admin

- **EASY Suite → Overview**: health checks (dependencies, REST routes, PDF
  folder protection, email schedules, feed rules, leftovers), module switches,
  and the certificate PDF migration tool.
- **EASY Suite → Settings**: reminder days, daily send time, pages kept out of
  search, who may use "List a Product", and the online-course key expiry and
  access length.
- **EASY Suite → Online courses**: issue keys for phone and invoice sales, look
  up a key, revoke, restore or email it again, and see who is enrolled. Office
  staff who can publish certificates can open this page even without admin
  rights.
- **Tools → Cert Expiry Check / Employer Digest**: dry-run previews, as before.

## Changes compared with the old plugins

- The `acf` field on `/wp/v2/cert` only accepts the certificate fields the app
  sends, validates emails, course choices and the PDF attachment, and rejects
  anything else with a 400 instead of writing arbitrary meta.
- Certificate titles (which carry student names) no longer leak to logged-out
  visitors through REST search, the media endpoints, the cert RSS feed, oEmbed,
  attachment pages, front-end search or core sitemaps.
- Instructors can delete their own certificate PDFs when no certificate uses
  them (the app's cleanup after a failed post used to be refused), and the site
  deletes a certificate's old PDF when it is replaced.
- App-password logins are only treated as API requests on the exact
  `/cert-pdf/<number>/` path, not on any URL containing that text.
- The staff `/cert/` archive lists every certificate, not just the newest 10.
- The employer digest never starts without a cutoff date (which would have
  emailed employers every historical certificate).
- The branded email wrapper snippet had a PHP syntax error and never ran; the
  module version is fixed, so site emails are wrapped from switch-over on.
- "List a Product" usernames are a setting instead of a hardcoded list.

## 2.1.0

- `GET /easy/v1/cert-number?candidate=…&exclude=…` returns the next free
  certificate number checked against every certificate (drafts included), and
  the site refuses (409) a create or update that would duplicate a number.
- "Can post certificates for other instructors" is a setting (EASY Suite →
  Settings, default `pevans`). The site honours it, and the app reads it from
  `GET /easy/v1/app-config`.
- New module **App bridge: Course Builder sync** (`includes/module-courses.php`).
  Courses from the app's Course Builder are stored on the site (private
  `easy_course` posts, review snapshots as `easy_course_snap`), so every
  computer sees the same copy and reviews go through the in-app Review inbox
  instead of files. A save counter stops two computers from silently
  overwriting each other (the app keeps both versions instead). Authors
  (default `sglynn`) and extra reviewers are settings; admins and anyone who
  can publish certificates can review. Approved versions are served at
  `GET /easy/v1/course-builder/courses/<id>/final` for the module player.
  Routes are listed at the top of the module file.

## 2.2.0

- New module **Online courses: license keys** (`includes/module-licenses.php`,
  admin page in `includes/licenses-admin.php`). Slice 1 of the online-courses
  plan: single-use keys like `EASY-7K2P-9QXA-4MZD` (12 characters from 31 that
  can't be misread, from `random_int`), stored in three new tables
  (`wp_easy_licenses`, `wp_easy_enrollments`, `wp_easy_progress`) that the
  module creates on first load.
  - Redeeming (`POST /easy/v1/learn/redeem`) claims the key in one conditional
    update, so only one account can win it, and opens an enrollment pinned to
    the course's approved Course Builder version. A unique index stops a
    learner holding two open enrollments in the same course. Ten failed tries
    per account per hour, then a pause.
  - Unused keys expire 12 months after issue; course access has no time limit
    until EASY decides on one (both are settings). A daily job at 3:15 AM
    St. John's time marks expired keys and closes enrollments that ran out.
  - Revoking a used key suspends the learner's course; restoring reopens it.
  - Office routes under `/easy/v1/licenses` and `/easy/v1/enrollments` back the
    app's future Online Learning tab. Routes are listed at the top of the
    module file.
  - Key emails stay off until the My Courses page (`/student-portal/courses/`)
    exists, since they link to it.

## Development

Each module is `includes/module-<key>.php`; the registry is in
`includes/modules.php`. `php -l` every file before packaging. To build the
upload zip from the repo root:

    cd site-plugins && zip -r easy-suite.zip easy-suite -x 'easy-suite/README.md'
