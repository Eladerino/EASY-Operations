# EASY Manager (mobile)

A phone app for EASY Safety Training: today's classes, the class
schedule, the three approval queues, and the management queue.

It ships two ways from the same `www/` folder:

- **Android**: an APK (Capacitor), sideloaded, never in an app store.
- **Web version** (for iPhones): EASY Suite serves the same files at
  `/easy-app/`. Open it in Safari, then Share, Add to Home Screen. See
  "Web version" below.

Screens follow the signed-in account's rights. Management accounts see
everything; instructors and other everyday staff see Today, Schedule
and Alerts. See "Who sees what".

No personal data, email addresses, tokens, or passwords live in this
code. The app signs in to https://easysafety.ca with the user's own
WordPress credentials at runtime.

## Screens

- **Today**: classes running today (name, instructor, time, seats filled
  versus capacity from the seat sale state). Tapping a class opens its
  roster, read-only, with Call and Email actions for students who have
  contact details on file. Below the classes: counts of everything waiting
  for action (including course reviews waiting). The count boxes tap
  through to the screen holding the work, except course reviews, which
  has no screen in this app and is display only. Then the last few
  entries of the app's activity trail (Recent activity), with a View
  all button opening the Activity screen: the whole trail (newest 200
  entries, kept on the device), grouped by day, with filters for
  classes, certificates, accounts, and queue answers. The trail is
  read only. The Activity screen also has a This phone / Site switch:
  Site shows the site-wide activity log from EASY Suite (what the
  whole team did, on any surface), read from the site and never
  stored on the device. Below it, a footer line showing the EASY Suite version
  on the site, which doubles as a "did the site answer" check. The last
  good class list is kept on the device, so the screen paints straight
  away and says when it is showing a saved copy instead of fresh data.
- **Schedule**: a month calendar of classes (dots mark days with
  classes; a hollow dot means one of them is still a draft). Tapping a
  day lists its classes; tapping a class opens the editor: course
  (picked from the site's own event categories, which also sets the
  title and files the class under that course), title, description,
  dates and times or all day, instructor, location, cost, and seats.
  Picking a course also fills the description with that course's
  preset text when the description is still empty, the same presets
  and the same fill-only-when-empty rule the desktop editor uses; an
  existing or edited description is never replaced. New instructors
  and locations can be created from the same form. A class is saved
  as a draft or published live, and the saved status is verified by
  re-reading the class from the server, never just by the save
  answering OK, in both directions (a class can no more be falsely
  reported as a draft than falsely reported as published).
  Each save that changes the title, date or time, location, price,
  seats, or status writes one activity trail entry saying what
  changed (for example "Price $150 → $175 · Seats 10 → 12"); a save
  that changes none of those writes no entry.
  Publishing, moving a published class back to draft, and deleting
  each ask first with a confirmation that says
  exactly what will happen; deleting moves the class to the trash on
  the website. Classes use the same Events Calendar REST contract as
  the desktop Schedule, so a class created here is indistinguishable
  from one created there. An account that cannot publish classes gets
  a view-only schedule. Below the calendar, a collapsible Instructor
  calendar links section lists each instructor's private
  calendar subscription link with a Copy button, read from
  the site; resetting a link stays in EASY Suite, never in this app.
- **Approvals**: the triage inbox. Certificate drafts, class drafts, and
  account signups, one card per item, decided one at a time. There is
  deliberately no "approve all". Certificate cards show the expiry date
  and a "No PDF attached" warning when there is no PDF. Publishing a
  certificate asks first, because publishing emails the student. There
  is no undo for anything here: the Recent activity list at the foot of
  the screen is a read-only record of what the app did. The last good queues
  are kept on the device, so the screen paints straight away and says
  when a refresh failed and a saved copy is showing. A certificate
  search at the top of the screen looks up any certificate, published
  or draft, by student name or certificate number (read only).
  Certificate cards and search results carry a View PDF button when
  the certificate has a number: it downloads the stored PDF from the
  Suite into the app cache and opens it in the phone's PDF viewer.
  A certificate with no PDF on file yet says exactly that.
- **Queue**: the management queue feed. Open questions are answered
  right in the app: tap a choice (or type a free-text answer), confirm,
  and the answer saves through the Suite with the same validation and
  notification email as the website queue form. Decided questions show
  who decided and when. A decided question has two ways forward: Undo
  answer clears the answer and returns the question to the open list,
  and Mark resolved files it in the collapsed Archive section once the
  decision has been acted on; archived questions keep their answer,
  who decided it, and who resolved it, and can be un-resolved back to
  Decided. An "Ask the queue" form adds a new question
  for Colleen and Scott. Multiple choice questions need at least two
  choices before the form will post. The last good feed is kept on the
  device, like Today.
- **Alerts**: a list of what needs attention right now (pending counts,
  certificates expiring within 30 days), with a note when a count has
  grown since the last check. "All clear" only appears when every check
  actually ran; a check that fails is named on screen instead. Tapping
  the expiring-certificates row opens the list itself, soonest first,
  with email and contact actions. No push notifications in this version.
  Below the list, an Upcoming expiry reminder emails section previews
  the certificates sitting in the Suite's reminder windows (30 day
  and 7 day) with the student, course, expiry date, and days left,
  which is who the next daily expiry checks will email. The section
  is collapsed until tapped; its summary line always shows how many
  certificates are in a window and when the next check runs. Last, a
  Site health section shows the Suite health checks plus the last and
  next runs of the expiry email check and the employer digest; a
  failed health check is named, never hidden.

The app follows the phone's light or dark setting by default; a Theme
setting (System, Light, Dark) at the foot of the Today screen can
force either look, and the choice is applied before first paint.
Every tab reloads its data when it is opened, and again when the app
comes back to the front after five minutes or more away (unless a
dialog or subview is open). Pulling down from
the top of any tab refreshes that tab (pull-to-refresh, on the main
view of each tab only, not inside subviews like the roster or the
class editor). The Android Back button closes dialogs and subviews
first, then returns to Today, then exits.

A home-screen widget shows the waiting counts the app itself last saw
(certificate drafts, class drafts, account signups, open queue
questions, certificates expiring in 30 days) with an "As of" time. It
reads a small snapshot the app writes after successful Approvals and
Alerts loads; the widget never talks to the network. The launcher
icon and splash screens carry the current EASY logo, the same artwork
the website uses.

## Who sees what

`www/js/roles.js` decides which screens show, from the capabilities the
sign-in check returns plus `proxyPoster` from the Suite's app-config.
The site still enforces every permission; this only hides what an
account cannot use.

| Screen or action | Shown when |
|---|---|
| Queue tab, site health, Site activity log | `manage_options` |
| Account signups | `promote_users` |
| Certificate drafts, course reviews count | `manage_options`, `publish_posts` or proxy poster |
| Class drafts | `manage_options` or `publish_tribe_events` |
| Class rosters | `manage_options` or proxy poster |
| Approvals tab | any of its three queues |

If the capabilities are unknown, everything shows.

## Sign-in and credential storage

**Sign in with easysafety.ca** uses WordPress's own Authorize Application
page: the person signs in with their normal website login, taps Approve,
and WordPress creates an application password and hands it back
(`www/js/websignin.js`). Nobody copies a password, and a lost one is
fixed by signing in again. Each sign-in shows up on the person's
WordPress profile as "EASY Manager (Android or web, date and time)"
and can be revoked there.

- **Android**: the authorize page opens in the phone's browser. Its
  success URL is the web version's `#connect-android` page, which shows
  one Open EASY Manager button: an `intent://` link that opens this app
  by package name with the new password
  (`easymanager://auth/callback`, received through the App plugin).
  This needs the web version on the site (EASY Suite 2.2.43 or newer);
  the app checks first and says so if it is missing.
- **Web version**: the success URL is the app page itself with
  `#connect`. The page reads the password and clears it from the
  address bar straight away.

The application password form is still there under "Use an application
password instead". Either way the app checks the sign-in with
`GET /wp-json/wp/v2/users/me?context=edit`. Requests never send cookies,
so a website login in the same browser does not interfere with the
application password.

Credentials are stored with Capacitor's Preferences API in the app's
private Android storage. Private means no other app can read it, but it
is **not encrypted**. That is an accepted trade for a personal sideloaded
app on a personal phone; it would not be acceptable for a store release
or a shared device. Signing out wipes the stored credentials.

Android backup is turned off for this app (`allowBackup="false"`), so
the saved sign-in does not travel inside phone backups or device
transfers. The trade: after a phone change, sign in again. Nothing
else the app stores would be missed.

The web version keeps the sign-in in the browser's storage for the
site (on iPhone, the home-screen app has its own, separate from
Safari). Same trade: private to that browser, not encrypted.

## Web version

Publish Suite copies `mobile/www` into the plugin's `app/` folder, so
the zip carries the app and the site serves it as plain files at
`/wp-content/plugins/easy-suite/app/` (short address `/easy-app/`, from
the Suite's phone-app module). A phone app change reaches iPhones on
the next Publish Suite; Android still needs Build APK.

- `manifest.webmanifest` and the `img/icon-*` files make Add to Home
  Screen open it full screen with the EASY icon.
- `sw.js` fetches the app's own files fresh every time (so a Suite
  update shows on the next open) and keeps the last copy for opening
  with no signal. It never touches site data.
- Differences from Android: no self-update (the site updates it), no
  home-screen widget, and certificate PDFs open in a browser tab after
  one extra tap on Open.

## How it is built (CI)

The `.github/workflows/build-apk.yml` workflow does the whole build on
GitHub's runners; no Android SDK is needed on a local machine.

- **Run workflow** (Actions, Build APK, Run workflow): builds a signed
  release APK, uploads it as a workflow artifact named
  `easy-manager-<version>`, and attaches it to the newest full
  (non-prerelease) release as `easy-manager-<version>.apk`. Any older
  `easy-manager-*.apk` assets on that release are deleted first, so a
  release only ever carries the newest APK.
- **Release published**: when a GitHub release is published (the desktop
  app's Release workflow creates those), the APK is built and attached to
  that same release as `easy-manager-<version>.apk`.

Before building, the workflow checks all four signing secrets are set
and proves the keystore opens with the given password and alias, so a
typo fails in seconds with the secret named, not as a Gradle error at
the end.

The version comes from `mobile/package.json`. The workflow stamps it into
the Android build and checks that `APP_VERSION` in `www/js/config.js`
matches; if the two disagree the build fails on purpose. Version codes
are derived as major × 10000 + minor × 100 + patch, so they always rise.

To release a new app version: bump `version` in `mobile/package.json`
and `APP_VERSION` in `mobile/www/js/config.js`, commit, then run the
workflow: it attaches the APK to the newest full release and the
phone offers it as an update (or sideload the workflow artifact).

## Self-update

On launch and when the app comes back to the front (at most once every
6 hours, ETag-cached) the app asks GitHub for this repo's newest 100
releases and scans them newest first, because
most releases here are desktop app releases and the APK rides along as
an asset on only some of them. Among all APK assets found, the newest
app version wins. If it is newer than the running app, a banner offers
the update. "Skip this version" hides that version for good; a newer
one is still offered. Tapping Update downloads the APK into the app
cache and hands it to the Android installer through a small native
plugin (`ApkInstaller`, FileProvider plus install intent). Android
always shows its own install confirmation; silent installs are
impossible and are not attempted. The first time, Android asks to allow
installs from this app; the app opens the right settings page and
explains. If the in-app install path fails, the app says how to install
manually from the GitHub releases page instead.

## The keystore warning (read this)

Android only accepts an update if it is signed with the **same key** as
the installed app. The signing key lives in a keystore file that CI reads
from repository secrets:

- `ANDROID_KEYSTORE_BASE64` (the keystore file, base64 encoded)
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Create the keystore once, keep a backup of the file and its passwords
somewhere safe (a password manager), and never regenerate it. **If the
keystore is lost, no update can ever be installed again.** The only way
forward then is a new package name and a fresh install, losing the saved
sign-in. Losing the keystore is the one unrecoverable mistake in this
setup.

Creating one (any machine with a JDK):

```
keytool -genkeypair -v -keystore easy-manager.keystore -alias easy-manager \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 easy-manager.keystore   # paste into ANDROID_KEYSTORE_BASE64
```

## Local development

```
cd mobile
npm install
npx cap sync android
```

Local Gradle builds need JDK 21 (Capacitor 7 projects compile at Java
21 level; the CI workflow uses JDK 21 for the same reason).

A release build without `android/keystore.properties` produces an
**unsigned** APK, which Android will not install. That build is only
useful as a compile check. For layout checks use the debug build or the
browser preview below, not a release APK.

The web UI is plain HTML/CSS/JS in `www/` (no framework, no bundler).
Opened in a desktop browser it runs in a preview mode where stored data
falls back to localStorage; that is for layout checks only.

## First sideload test (do this before relying on the app)

The app page runs inside a WebView and calls easysafety.ca across
origins, so the first install is also the test of whether the site's
REST responses are readable from that setup:

1. Install the APK and sign in.
2. Open all five tabs (Today, Schedule, Approvals, Queue, Alerts) and
   let each finish loading.
3. Publish nothing and decide nothing during this pass.
4. Check that counts and lists appear on every tab.

If every screen fails at once while the same data loads fine in the
desktop app, the likely cause is cross-origin (CORS) handling between
the WebView and the site, and the fix is to route the app's requests
through Capacitor's native HTTP layer, which is not subject to WebView
CORS. That change is a known follow-up if this test fails, not part of
the first build. Failures in this app are loud by design now: a screen
that could not load says so, and Alerts names what it could not check.

## API contract

Every route mirrors the desktop app and the EASY Suite plugin:

| Purpose | Route | Source |
| --- | --- | --- |
| Sign-in probe | `GET /wp-json/wp/v2/users/me?context=edit` | desktop `main.js` setup |
| Account queue | `GET /wp-json/easy/v1/pending-users` | plugin `module-approvals.php` |
| Account decide | `POST /wp-json/easy/v1/pending-users/<id>/approve` or `/reject` | plugin `module-approvals.php` |
| Cert drafts | `GET /wp-json/wp/v2/cert?status=draft` | desktop cert approvals |
| Cert publish | `POST /wp-json/wp/v2/cert/<id>` with `{status}` | desktop cert approvals |
| Classes | `GET /wp-json/tribe/events/v1/events?start_date&end_date` | desktop schedule |
| Class publish | `PUT /wp-json/tribe/events/v1/events/<id>` with `{status}` | desktop schedule |
| Class create and edit | `POST` or `PUT /wp-json/tribe/events/v1/events[/<id>]` with the desktop payload shape | desktop schedule |
| Class delete | `DELETE /wp-json/tribe/events/v1/events/<id>` (moves to trash) | desktop schedule |
| Venues, instructors, categories | `GET` and `POST /wp-json/tribe/events/v1/venues`, `/organizers`, `/categories` | desktop schedule |
| Cert search | `GET /wp-json/easy/v1/cert-search?q=<text>` | plugin `module-approvals.php` (Suite 2.2.28) |
| Cert PDF | `GET /wp-json/easy/v1/cert-pdf/<certificate_number>` (returns the stored PDF as base64 in a JSON body: `number`, `filename`, `pdf_base64`) | plugin `module-approvals.php` (Suite 2.2.31) |
| Instructor calendar links | `GET /wp-json/easy/v1/instructor-feeds` | plugin `includes/admin.php` (Suite 2.2.28) |
| Seats filled | `GET /wp-json/easy/v1/sale-state/<event_id>` | plugin `module-seat-sales.php` |
| Class roster | `GET /wp-json/easy/v1/roster/<event_id>` | plugin `module-roster.php` |
| Expiring certs | `GET /wp-json/easy/v1/expiring-certs?days=30` | plugin `module-approvals.php` |
| Queue feed | `GET /wp-json/easy/v1/management-queue` (open, decided, and resolved lists, with counts for each) | plugin `module-management-queue.php` (Suite 2.2.32) |
| Ask the queue | `POST /wp-json/easy/v1/management-queue/questions` | plugin `module-management-queue.php` (Suite 2.2.24) |
| Answer a question | `POST /wp-json/easy/v1/management-queue/answers` | plugin `module-management-queue.php` (Suite 2.2.27) |
| Undo a queue answer | `POST /wp-json/easy/v1/management-queue/undecide` with `{question_id}` | plugin `module-management-queue.php` (Suite 2.2.32) |
| Resolve a queue question | `POST /wp-json/easy/v1/management-queue/resolve` with `{question_id}` | plugin `module-management-queue.php` (Suite 2.2.32) |
| Un-resolve a queue question | `POST /wp-json/easy/v1/management-queue/unresolve` with `{question_id}` | plugin `module-management-queue.php` (Suite 2.2.32) |
| Site health | `GET /wp-json/easy/v1/site-health` | plugin `includes/admin.php` (Suite 2.2.27) |
| Suite version | `GET /wp-json/easy/v1/app-config` | plugin `module-cert-rest.php` |
| Course reviews count | `GET /wp-json/easy/v1/course-builder/me` | plugin `module-courses.php` |

## Known gaps (honest list)

- **Website sign-in has not been tried on a real phone yet.** The
  pieces are tested with mocks; the Ultimate Member login page and the
  Turnstile check sending the person back to the Approve page is the
  part only a real run proves.

- **No money glance and no new-order alerts.** Nothing in the desktop app
  or the plugin reads WooCommerce orders, so there is no existing route
  to mirror. The blocks were left out rather than inventing a contract.
  Follow-up if wanted: a small Suite route for recent order totals.
- **There is no undo for publishes or account decisions.** The app
  used to offer one for certificate and class publishes, but it could
  only flip the item back to draft; it could never unsend the student
  email a certificate publish already triggered (the site sends that
  email only the first time a certificate is published, so publishing
  again later will not email the student a second time either).
  Rather than pretend otherwise, 0.4.4 removed the undo buttons; the
  activity trail is a record, not a control. The one real undo left
  is for queue answers, where undo just clears a saved form value
  and reopens the question, with no side effects to chase.
- **Certificate and class queues have no reject action.** That mirrors
  the desktop app: publish is the only forward action there, and sending
  something back is done by editing the draft in wp-admin or the desktop
  app. Only account signups have approve and reject.
- **Push notifications are deferred.** Alerts are computed when the
  Alerts screen opens. A future version could poll on an interval, but
  real push needs a server-side sender the site does not have yet.
- **No recurring classes.** The Events Calendar REST API does not
  support recurrence, so a repeating class is created as individual
  classes, the same limit the desktop Schedule has.
- **The native side is only compiled in CI.** This project is authored
  on a VM with no Android SDK, so Gradle compilation is proven by the
  Build APK workflow runs, not locally.
