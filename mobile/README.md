# EASY Manager (mobile)

A personal Android companion app for EASY Safety Training. It puts the
management work that normally needs the desktop app or wp-admin into a
phone-sized triage tool: today's classes, the three approval queues, and
the management queue.

This app is for Brandon only. It is sideloaded (installed from an APK
file), never published to an app store, and it is not part of the EASY
Operations desktop app that Pam and the instructors use.

No personal data, email addresses, tokens, or passwords live in this
code. The app signs in to https://easysafety.ca with the user's own
WordPress credentials at runtime.

## Screens

- **Today**: classes running today (name, instructor, time, seats filled
  versus capacity from the seat sale state). Tapping a class opens its
  roster, read-only. Below the classes: counts of everything waiting
  for action (including course reviews waiting), the last few decisions
  made from this app, and a footer line showing the EASY Suite version
  on the site, which doubles as a "did the site answer" check. The last
  good class list is kept on the device, so the screen paints straight
  away and says when it is showing a saved copy instead of fresh data.
- **Approvals**: the triage inbox. Certificate drafts, class drafts, and
  account signups, one card per item, decided one at a time. There is
  deliberately no "approve all". Certificate cards show the expiry date
  and a "No PDF attached" warning when there is no PDF. Publishing a
  certificate asks first, because publishing emails the student. Recent
  certificate and class publishes can be undone (they flip back to
  draft, and the undo asks first); account decisions cannot be reversed
  through the API, so they show no Undo button.
- **Queue**: the management queue feed. Open questions, decided questions
  with who decided and when, and an "Ask the queue" form that adds a new
  question for Colleen and Scott. Multiple choice questions need at
  least two choices before the form will post.
- **Alerts**: a list of what needs attention right now (pending counts,
  certificates expiring within 30 days), with a note when a count has
  grown since the last check. "All clear" only appears when every check
  actually ran; a check that fails is named on screen instead. Tapping
  the expiring-certificates row opens the list itself, soonest first,
  with email and contact actions. No push notifications in this version.

The app follows the phone's light or dark setting, has a floating
Refresh button reachable by thumb on every tab, and the Android Back
button closes dialogs and subviews first, then returns to Today, then
exits.

## Sign-in and credential storage

Sign-in uses a WordPress Application Password (HTTP Basic over HTTPS),
validated against `GET /wp-json/wp/v2/users/me?context=edit`. Create one
in wp-admin under Users, your profile, Application Passwords. If the
signed-in account is missing key permissions (reviewing signups,
managing the queue, publishing), the app says so once in plain language
instead of letting screens fail quietly.

Credentials are stored with Capacitor's Preferences API in the app's
private Android storage. Private means no other app can read it, but it
is **not encrypted**. That is an accepted trade for a personal sideloaded
app on a personal phone; it would not be acceptable for a store release
or a shared device. Signing out wipes the stored credentials.

Android backup is turned off for this app (`allowBackup="false"`), so
the saved sign-in does not travel inside phone backups or device
transfers. The trade: after a phone change, sign in again with the
application password. Nothing else the app stores would be missed.

## How it is built (CI)

The `.github/workflows/build-apk.yml` workflow does the whole build on
GitHub's runners; no Android SDK is needed on a local machine.

- **Run workflow** (Actions, Build APK, Run workflow): builds a signed
  release APK and uploads it as a workflow artifact named
  `easy-manager-<version>`.
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
and `APP_VERSION` in `mobile/www/js/config.js`, commit, then publish a
release (or run the workflow and sideload the artifact).

## Self-update

On launch (at most once every 6 hours, ETag-cached) the app asks GitHub
for this repo's recent releases and scans them newest first, because
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
2. Open all four tabs (Today, Approvals, Queue, Alerts) and let each
   finish loading.
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
| Seats filled | `GET /wp-json/easy/v1/sale-state/<event_id>` | plugin `module-seat-sales.php` |
| Class roster | `GET /wp-json/easy/v1/roster/<event_id>` | plugin `module-roster.php` |
| Expiring certs | `GET /wp-json/easy/v1/expiring-certs?days=30` | plugin `module-approvals.php` |
| Queue feed | `GET /wp-json/easy/v1/management-queue` | plugin `module-management-queue.php` (Suite 2.2.24) |
| Ask the queue | `POST /wp-json/easy/v1/management-queue/questions` | plugin `module-management-queue.php` (Suite 2.2.24) |
| Suite version | `GET /wp-json/easy/v1/app-config` | plugin `module-cert-rest.php` |
| Course reviews count | `GET /wp-json/easy/v1/course-builder/me` | plugin `module-courses.php` |

## Known gaps (honest list)

- **Answering queue questions from the app is not possible yet.** EASY
  Suite has no REST route that saves an answer; the website queue page
  saves through its own form (the saving logic lives in that form
  handler and needs extracting into a shared function first). The app
  shows open and decided questions read-only and says so on the Queue
  screen. Follow-up: add a `POST /wp-json/easy/v1/management-queue/answers`
  route in a future EASY Suite version, unscheduled.
- **No money glance and no new-order alerts.** Nothing in the desktop app
  or the plugin reads WooCommerce orders, so there is no existing route
  to mirror. The blocks were left out rather than inventing a contract.
  Follow-up if wanted: a small Suite route for recent order totals.
- **Undo cannot unsend email.** Undoing a certificate publish flips it
  back to draft, but the student notification email fired at publish
  time has already gone out. The site sends that email only the first
  time a certificate is published, so publishing again later will not
  email the student a second time either. The undo confirmation in the
  app states both halves of this.
- **Certificate and class queues have no reject action.** That mirrors
  the desktop app: publish is the only forward action there, and sending
  something back is done by editing the draft in wp-admin or the desktop
  app. Only account signups have approve and reject.
- **Push notifications are deferred.** Alerts are computed when the
  Alerts screen opens. A future version could poll on an interval, but
  real push needs a server-side sender the site does not have yet.
- **The native side has not been compiled on a developer machine.** This
  project was authored on a VM with no Android SDK, so the first
  CI run is the first real compile of the Java plugin and Gradle config.
  Watch the first Build APK run; small fixes there would be normal.
