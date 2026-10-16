# EASY Operations

Windows desktop app for EASY Safety Training staff and instructors. It works
against easysafety.ca and needs the site's **EASY Suite** plugin
(`site-plugins/easy-suite/`).

## Tabs

- **Certificates**
  - **New certificate**: fill in the form, and the app generates the PDF,
    uploads it and saves a draft `cert` post for office review. It can also
    print the ID card on the card printer.
  - **Find & reprint**: search issued certificates, then print or save the
    PDF.
  - **Expiring soon**: certificates expiring in the next 30/60/90 days,
    grouped by company.
- **Approvals**
  - **Certificates**: drafts waiting for review, with Preview, Edit and
    Publish. Publishing emails the student and the employer contact.
  - **Classes**: draft classes, with Edit and Publish.
  - **Accounts**: new site accounts, with Approve and Reject.
- **Schedule**: post classes to the site's event calendar.
- **Online Learning**: preview only, with sample data.
- **Course Builder**: authors build online courses, and reviewers approve
  them or send them back with a note. Courses are saved to the site, so every
  computer sees the same copy. If the site doesn't have EASY Suite's Course
  Builder sync, courses stay on one computer and reviews are passed as files.
  Backups go to `%APPDATA%\EASYOperations\course-builder-backups\`.

Instructors only see their own certificate drafts and can't publish. The
Publish button and the Classes and Accounts queues show for accounts listed
in EASY Suite → Settings → "Can post certificates for other instructors".
Who can author or review courses is set in the same Settings page.

## Setup

1. `npm install`, then `npm start`. Installed copies come from the installer
   instead.
2. On first launch, sign in with your WordPress username and an application
   password. Create the password under Users → Profile → Application
   Passwords; the setup screen has a button that opens that page. Click
   **Test connection**, enter your email, pick the card printer if this
   computer has one, then **Save & start**.
3. Settings are saved to `%APPDATA%\EASYOperations\config.json`, with the
   password encrypted. The **Setup** button in the header changes the
   sign-in or the printer.

The instructor name and email on a certificate are locked to whoever is
signed in, unless that account is on the "post for other instructors" list.

To print ID cards, pick a card printer in Setup, then tick **Print physical
ID card now** on the form. It prints silently through the bundled
SumatraPDF.

## Commands

| Command | Does |
|---|---|
| `npm start` | Run in development (no auto-updates) |
| `node --test` | Run the unit tests in `test/` |
| `npm run make` | Build the installer, update files and zip into `out/make/` (Windows) |
| `npm run publish` | Build and publish a release from your own PC (fallback, see below) |

## Releasing

1. Raise `version` in `package.json` above the last release, then merge it
   to `main`.
2. On GitHub, go to **Actions → Release → Run workflow** and pick branch
   `main`. It builds the installer, checks it and publishes release
   `v<version>`.

Installed apps check for updates on launch and every 10 minutes, and offer
to restart once one is downloaded. Every published release prompts every
user, so only publish something worth installing.

If you have to publish from your own PC, run this in PowerShell:
`$env:GITHUB_TOKEN="<token>"; npm run publish`. If it stops partway, delete
that release and its tag on GitHub before running it again.

Pull requests that change the app run the same build and checks without
publishing.

## Security

- The site address is fixed to `https://easysafety.ca`.
- Application passwords are encrypted with the Windows credential store.
- The window can only load the app's own files. All network calls go
  through the main process.
- Only known certificate fields are sent. EASY Suite checks them again on
  the site, enforces the instructor identity, and refuses duplicate
  certificate numbers.
- Preview and reprint only open real PDF files.

## Certificate fields

- **Certificate number**: `YYMMDD` + course code + a 2-digit instance number,
  for example `260930COUNTERBALANCEFORKLIFT01`. Use −/+ to change the
  instance. On posting, the app moves to the next free number if that one is
  taken.
- **Expiry**: set to the completion date plus 3 years, and can be edited.
- **Workplace NL courses**: require a control number, which is printed on
  the PDF.
- **Counter Balance Forklift**: requires at least one class; the classes are
  added to the title.
- **More students?**: keeps the course, dates and company, clears the
  student's details, and moves to the next number.

## Files

| Path | What |
|---|---|
| `main.js` | Main process: sign-in, posting, printing and all site calls |
| `preload.js` | The fixed set of functions the window can call |
| `renderer/` | The UI, one script per tab |
| `pdfgen.js`, `EASY_CertTemplate.pdf` | Certificate PDF generation and its template |
| `shared.js` | Course list, certificate numbers, expiry and file names |
| `forge.config.js` | Packaging and installer settings |
| `test/` | Unit tests |
| `site-plugins/easy-suite/` | The WordPress plugin (not part of the app) |
| `.github/workflows/release.yml` | Release build |
