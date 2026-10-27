// config.js: app-wide constants for EASY Manager.
//
// APP_VERSION must always match "version" in mobile/package.json.
// The CI workflow checks the two and fails the build if they drift.
window.EasyConfig = {
  SITE: 'https://easysafety.ca',
  APP_VERSION: '0.6.4',
  GITHUB_RELEASES:
    'https://api.github.com/repos/Eladerino/EASY-Operations/releases?per_page=100',
  APK_ASSET_PATTERN: /^easy-manager-(\d+\.\d+\.\d+)\.apk$/,
};
