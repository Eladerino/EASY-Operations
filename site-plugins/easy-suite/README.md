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
  search, and who may use "List a Product".
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

## Development

Each module is `includes/module-<key>.php`; the registry is in
`includes/modules.php`. `php -l` every file before packaging. To build the
upload zip from the repo root:

    cd site-plugins && zip -r easy-suite.zip easy-suite -x 'easy-suite/README.md'
