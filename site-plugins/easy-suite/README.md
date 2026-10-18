# EASY Suite

The WordPress plugin for easysafety.ca. It handles certificate data and
PDFs, certificate emails, the site routes the EASY Operations app uses,
online course keys, and a few small site tweaks.

## Install or update

1. Take a backup (UpdraftPlus → Backup Now).
2. Go to Plugins → Add New → Upload Plugin and choose `easy-suite.zip`. On
   an update, choose **Replace current with uploaded**. Settings and data
   are kept.
3. Open **EASY Suite → Overview** and check that the Health table is green.

If the old EASY plugins or snippets are still active, EASY Suite pauses.
Use the button in its notice to switch them off.

## Admin pages

- **Overview**: health checks, module switches and the certificate PDF
  migration tool.
- **Settings** sets:
  - reminder days and the daily send time;
  - pages kept out of search;
  - who can use "List a Product";
  - who can post certificates for other instructors;
  - Course Builder authors and extra reviewers;
  - how long online course keys and course access last.
- **Online courses**
  - **Keys**: issue keys for a course approved in the app's Course Builder,
    then look them up, revoke, restore or resend them.
  - **Learners**: see who is enrolled and extend their access.

  Admins, certificate publishers and Course Builder reviewers can use this
  page.
- **Tools → Cert Expiry Check / Employer Digest**: dry-run previews.

## Modules

Each module can be switched on or off in Overview. The two marked locked
always stay on.

| Module | Does |
|---|---|
| Certificate data & privacy (locked) | Checks the certificate fields the app sends, enforces the instructor identity, refuses duplicate numbers, and keeps certificate details private |
| Certificate PDF gatekeeper (locked) | Keeps PDFs in a private folder, served at `/cert-pdf/<number>/` only to the owner and staff |
| App bridge: approvals & expiring certs | Feeds the app's Accounts queue and Expiring soon list |
| App bridge: Course Builder sync | Stores Course Builder courses and reviews on the site |
| Online courses: license keys | Single-use course keys and enrollments (needs Course Builder sync) |
| Certificate emails | Student email on publish, expiry reminders, twice-daily employer digest |
| Instructor calendar feed | Private calendar feed per instructor at `/instructor-calendar/<token>.ics` (tokened URLs; instructors re-subscribe once) |
| Class rosters | Per-class student lists (manual enrollment in the app; online buyers added automatically) |
| Seat sales | Sells class seats as WooCommerce products: per-seat attendee details at checkout, roster sync, stock handling, sold-seat delete protection |
| Portal cards | Student/instructor portal card hub (`/student-portal/`, `/instructor-portal/`) |
| Management queue | Private decision page for the office (`[easy_management_queue]` shortcode) |
| Shop | Instructor-only products and the `[easy_product_form]` listing form |
| SEO noindex | Keeps utility pages out of search results |
| Past events: noindex | Keeps single event pages out of search results once the class date has passed |
| Staff certificate archive | Makes `/cert/` list every certificate |
| Small site tweaks | Course page "no upcoming sessions" message, login and register form styling, certificates page login redirect, branded email wrapper, links in Ultimate Member checkbox labels |

## Online course keys

- Keys look like `EASY-7K2P-9QXA-4MZD` and work once.
- Unused keys expire after 12 months, and course access has no time limit.
  Both can be changed in Settings.
- Learners redeem a key through `POST /wp-json/easy/v1/learn/redeem`. There's
  no learner page for it yet.
- Key emails stay off until a page is published at `/student-portal/courses/`.

## REST routes

All routes are under `/wp-json/easy/v1/`.

| Routes | Who can call them |
|---|---|
| `pending-users…` | Accounts that can promote users |
| `expiring-certs`, `cert-number` | Accounts that can edit certificates |
| `roster/<id>` (GET) | Accounts that can edit certificates |
| `roster/<id>` (PUT) | Accounts that can edit the class |
| `sale-state/<id>` | Accounts that can edit certificates |
| `management-queue` | Admins |
| `management-queue/questions` (POST) | Admins |
| `app-config`, `course-builder/me`, `learn/…` | Any signed-in user |
| `course-builder/…` | Course authors and reviewers |
| `licenses…`, `enrollments…` | Admins, certificate publishers and Course Builder reviewers |

The full route list is at the top of `module-courses.php` and
`module-licenses.php`.

## Development

- Each module is `includes/module-<key>.php`, and `includes/modules.php`
  lists them all.
- Run `php -l` on every file before packaging.
- For a new version, update both `Version:` and `EASY_SUITE_VERSION` in
  `easy-suite.php`.
- If you change the key tables, raise `EASY_LICENSES_DB`.

To build the upload zip, run this from the repo root:

    cd site-plugins && zip -r easy-suite.zip easy-suite -x 'easy-suite/README.md'
