// forge.config.js — single source of truth for packaging.
//
// NOTE: this file takes precedence over any "config.forge" section in
// package.json, so everything lives here and package.json stays clean.
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'Easy Operations',
    icon: './icon',
    // Executables cannot run from inside the asar archive, so unpack them:
    // pdf-to-printer's helpers and the bundled SumatraPDF used for silent printing.
    asarUnpack: [
      '**/node_modules/pdf-to-printer/**',
      './SumatraPDF-3.4.6-32.exe',
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'easy-operations',
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
