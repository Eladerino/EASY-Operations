// forge.config.js — single source of truth for packaging.
//
// NOTE: this file takes precedence over any "config.forge" section in
// package.json, so everything lives here and package.json stays clean.
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    // Executables cannot run from inside the asar archive, so SumatraPDF
    // (used for silent card printing) is unpacked next to it into
    // app.asar.unpacked: both the bundled copy and pdf-to-printer's own.
    // The pattern is matched against the file name. (This used to be an
    // `asarUnpack` list, which is an electron-builder option that Forge
    // silently ignores, so nothing was unpacked and card printing failed.)
    // plugin-auto-unpack-natives below adds native modules to this pattern.
    asar: { unpack: 'SumatraPDF-3.4.6-32.exe' },
    executableName: 'Easy Operations',
    icon: './icon',
    // The WordPress plugin source and tests live in this repo but aren't
    // part of the app, so they stay out of the installer.
    ignore: [/^\/site-plugins(\/|$)/, /^\/test(\/|$)/, /^\/mobile(\/|$)/],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'EASYOperations',
        // Display name used for the desktop/Start Menu shortcuts and the
        // Add/Remove Programs entry. (The old `shortcutName` key is not a
        // real electron-winstaller option and was silently ignored, which is
        // why shortcuts showed up as "easy-operations".)
        title: 'EASY Operations',
        setupIcon: './icon.ico',
        setupExe: 'EasyOperationsInstaller.exe',
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        noMsi: true,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'Eladerino',
          name: 'EASY-Operations',
        },
        // Published immediately: every `electron-forge publish` is a deliberate
        // release meant for users. (draft: true would need a manual click on
        // github.com before anyone's app sees the update.)
        draft: false,
        prerelease: false,
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
