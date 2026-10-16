# EASY Suite

One WordPress plugin for everything the EASY Safety Training site adds on top
of its theme and third-party plugins. It replaces:

| Old piece | Now |
|---|---|
| EASY Core 1.5.10 (plugin) | Modules *Certificate data & privacy*, *PDF gatekeeper*, *App bridge: approvals & expiring certs*, *Shop*, *SEO*, plus the admin pages |
| EASY Certificate Notifications 2.4.8 (plugin) | Module *Certificate emails* |
| EASY Instructor Calendar Feed 1.0.4 (plugin) | Module *Instructor calendar feed* |
| Code Snippets: course fallback, the two quiet-link snippets, certificates page redirect, branded email wrapper, UM checkbox HTML | One module each (the two quiet-link snippets share *Login & register form styling*) |

Settings, sent-email records, the employer-digest cutoff and certificate PDFs
carry over unchanged: the option names, meta keys, cron hooks, REST routes and
URLs are the same ones the old plugins used. Switching off the old
notifications plugin clears its cron events; EASY Suite schedules the same
hooks again on the next page load (the employer digest's twice-daily timing
restarts from then).

It also adds things the old plugins never had: Course Builder sync for the
EASY Operations app (2.1.0) and online course license keys (2.2.0).

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

## Updating

1. Take a backup (UpdraftPlus → Backup Now).
2. Plugins → Add New → Upload Plugin → the new `easy-suite.zip` → Install →
   **Replace current with uploaded**. Settings, courses, keys and certificate
   PDFs are kept.
3. Open any wp-admin page. When the version number changes, EASY Suite
   re-registers its rewrite rules and re-checks the private PDF folder. (The
   activation hook doesn't run on this kind of update.)
4. New modules arrive switched on. Updating from 2.0.0 turns on Course Builder
   sync and Online courses: license keys. The key module creates its tables
   and schedules its daily job on the first page load.
5. Check EASY Suite → Overview, including the Course Builder sync and Online
   course keys rows.

## Admin

- **EASY Suite → Overview**: health checks (dependencies, REST routes, PDF
  folder protection, Course Builder sync, online course keys, email
  schedules, feed rules, leftovers), module switches, and the certificate PDF
  migration tool. The Course Builder row counts courses and reviews waiting,
  and flags an author with no WordPress account. The online course keys row
  shows whether the key tables are set up, unused and soon-to-expire keys,
  learners in a course, and the next daily expiry job.
- **EASY Suite → Settings**: reminder days, daily send time, pages kept out of
  search, who may use "List a Product", and an **EASY Operations app**
  section: who can post certificates for other instructors, Course Builder
  authors and extra Course Builder reviewers. The online-course key expiry and
  access length are under **Online courses**. The Course Builder and
  online-course fields only appear while those modules are on.
- **EASY Suite → Online courses** has two tabs:
  - **Keys**: issue keys for phone and invoice sales, 1 to 200 at a time, for
    any course with an approved version in the app's Course Builder (other
    courses are greyed out). Copy a batch to read out or paste into an
    invoice. Search by key, email, name, company, invoice or order number.
    Revoke, restore or email a key again.
  - **Learners**: who is enrolled, their progress and access dates, and
    **Extend** (1 to 365 days) for anyone whose access has an end date.

  Admins, anyone who can publish certificates and the extra Course Builder
  reviewers can use this page; staff without admin rights see it as the only
  item under EASY Suite. If Course Builder sync is off, only admins can open
  it.
- **Tools → Cert Expiry Check / Employer Digest**: dry-run previews, as before.

## Changes compared with the old plugins

- The `acf` field on `/wp/v2/cert` only writes the certificate fields the app
  sends and ignores any other key. It validates emails, course choices and the
  PDF attachment, and refuses a bad value with a 400 (writing nothing) instead
  of writing arbitrary meta.
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

- `GET /easy/v1/cert-number?candidate=…&exclude=…` (anyone who can edit
  certificates) returns the next free certificate number, checked against
  every certificate (drafts included, trash left out), or a 409 when all 99
  numbers for that course and date are taken. A REST create or update that
  would duplicate a number is refused with a 409. Edits made in wp-admin
  aren't checked.
- "Can post certificates for other instructors" is a setting (EASY Suite →
  Settings, option `easy_proxy_posters`, default `pevans`). Admins and anyone
  who can publish certificates can always post for others on the site. The
  app reads the setting from `GET /easy/v1/app-config` (any signed-in user;
  returns `proxyPoster` and the EASY Suite `version`). `proxyPoster` only
  reflects the list, so in the app an admin who isn't listed is still locked
  to their own name. If the site is older than 2.1.0, the app uses its
  built-in list, scans the newest 100 published certificates for numbers, and
  passes Course Builder reviews as files. If the site doesn't answer, the
  proxy-poster check gives up after 5 seconds and uses the built-in list, and
  Course Builder keeps edits on the computer until the site is back (it only
  falls back to files on a computer that has never reached the site).
- New module **App bridge: Course Builder sync** (`includes/module-courses.php`).
  Courses from the app's Course Builder are stored on the site (private
  `easy_course` posts, review snapshots as `easy_course_snap`), so every
  computer sees the same copy and reviews go through the in-app Review inbox
  instead of files. A save counter stops two computers from silently
  overwriting each other (the app keeps both versions instead).
  - Authors (`easy_course_authors`, default `sglynn`) and extra reviewers
    (`easy_course_reviewers`) are settings; admins and anyone who can publish
    certificates can review. Authors and admins can also change the author
    list from the app, where every name must be an existing WordPress
    username. Settings doesn't check the names, so Overview flags an author
    with no account. In both places at least one author stays.
  - Only one version of a course can wait for review at a time; the author
    withdraws it to send a newer one. Send back needs a note. A course over
    2 MB is refused.
  - Courses and snapshots have no wp-admin screen. Deleting a course in the
    app moves it and its snapshots to the WordPress trash, which empties after
    30 days.
  - Approved versions are kept as review snapshots.
    `GET /easy/v1/course-builder/courses/<id>/final` returns the approved
    package to authors and reviewers (the app's **Download approved vN**
    button), and online course keys pin each enrollment to that version.
    Learners can't read it; the course player comes later.
  - Switching the module off makes the app go back to keeping courses on each
    computer and passing review files.
  - Routes are listed at the top of the module file.

## 2.2.0

- New module **Online courses: license keys** (`includes/module-licenses.php`,
  admin page in `includes/licenses-admin.php`). Slice 1 of the online-courses
  plan: single-use keys like `EASY-7K2P-9QXA-4MZD` (12 characters from 31 that
  can't be misread, from `random_int`), stored in three new tables
  (`easy_licenses`, `easy_enrollments`, `easy_progress`, with the site's table
  prefix, normally `wp_`). The module creates them on the first page load
  after it is switched on; if that fails, Overview shows why and it retries
  every 10 minutes. Switching the module off or deactivating EASY Suite keeps
  the tables and their data.
  - Keys depend on Course Builder sync: the course list comes from it, and
    keys can only be issued (1 to 200 at a time, buyer email required) for a
    course with an approved version.
  - Redeeming (`POST /easy/v1/learn/redeem`) claims the key in one conditional
    update, so only one account can win it, and opens an enrollment pinned to
    the course's approved Course Builder version. A unique index stops a
    learner holding two open enrollments in the same course. Ten failed tries
    per account per hour, then a pause.
  - Unused keys expire 12 months after issue (Settings → Online courses,
    `easy_license_key_months`, 1 to 60). Course access has no time limit
    (`easy_license_access_days`, 0 = no limit, up to 3650) until EASY decides
    on one. Changes apply to keys issued or used from then on, and the office
    can extend one learner's access. A daily job (`easy_licenses_daily`,
    3:15 AM St. John's time) marks expired keys and closes enrollments that
    ran out. Deactivating EASY Suite or switching the module off clears the
    job; it is scheduled again on the next page load once the module is on.
  - Revoking a used key suspends the learner's course. Restoring reopens it,
    unless the learner has since started the course with another key (then
    the restore is refused) or their access ran out meanwhile (then it comes
    back as ended). A course the learner already finished, and its
    certificate, stay put. Revoking an unused key just stops it working;
    restoring makes it usable again until its expiry date.
  - A learner whose access ran out can use a new key right away; they don't
    wait for the daily job.
  - Learner routes: `POST /easy/v1/learn/redeem` and
    `GET /easy/v1/learn/my-courses` (any signed-in account). Office routes
    under `/easy/v1/licenses` (list, issue, revoke, restore, resend, batch
    resend) and `/easy/v1/enrollments` (list, extend) back the app's future
    Online Learning tab; the app doesn't call them yet. "Office" means admins,
    anyone who can publish certificates and the extra Course Builder reviewers
    (admins only if Course Builder sync is off). Routes are listed at the top
    of the module file.
  - Not built yet: the My Courses page, a form where learners enter a key, the
    course player (nothing writes `easy_progress` yet), and keys from shop
    orders. Until then, keys come from EASY Suite → Online courses and the
    office reads them out or pastes them.
  - Key emails stay off until a published page exists at
    `/student-portal/courses/` (or the `easy_licenses_redeem_url` filter
    returns a URL), since they link to it. Until then **Email the keys to the
    buyer** is greyed out and **Email again** is hidden.

## REST routes

All under `/wp-json/easy/v1/`.

| Routes | Who | Module |
|---|---|---|
| `pending-users`, `pending-users/<id>/approve`, `…/reject` | can promote users | App bridge: approvals & expiring certs |
| `expiring-certs` | can edit certificates | App bridge: approvals & expiring certs |
| `cert-number` | can edit certificates | Certificate data & privacy |
| `app-config` | any signed-in user | Certificate data & privacy |
| `course-builder/me` | any signed-in user | App bridge: Course Builder sync |
| `course-builder/courses…`, `course-builder/reviews…`, `course-builder/authors` | course authors and reviewers | App bridge: Course Builder sync |
| `learn/redeem`, `learn/my-courses` | any signed-in user | Online courses: license keys |
| `licenses…`, `enrollments…` | office (admins, certificate publishers, extra reviewers) | Online courses: license keys |

The full Course Builder and license routes, with what each takes, are listed
at the top of each module file.

## Development

Each module is `includes/module-<key>.php`; the registry is in
`includes/modules.php`. `includes/licenses-admin.php` is the Online courses
page, loaded by the licenses module in wp-admin. `php -l` every file before
packaging.

For a new version, change both `Version:` in the header and
`EASY_SUITE_VERSION` in `easy-suite.php`, and add a section above. The
constant is what makes an uploaded update re-register rewrite rules. If you
change the key tables in `easy_licenses_schema()`, raise `EASY_LICENSES_DB` so
existing sites upgrade them.

The GitHub release workflow builds only the app. It doesn't lint, zip or
publish EASY Suite, pull requests that only touch `site-plugins/` skip it, and
`site-plugins/` is left out of the packaged app. Build the upload zip by hand
from the repo root (it lands in `site-plugins/` and isn't gitignored, so don't
commit it):

    cd site-plugins && zip -r easy-suite.zip easy-suite -x 'easy-suite/README.md'
