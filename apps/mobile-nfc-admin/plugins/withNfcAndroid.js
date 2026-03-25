const { withAndroidManifest } = require('expo/config-plugins');

function hasNameAttribute(entry, key, value) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const attrs = entry.$ || {};
  return attrs[key] === value;
}

module.exports = function withNfcAndroid(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;

    if (!Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = [];
    }
    if (
      !manifest['uses-permission'].some((entry) =>
        hasNameAttribute(entry, 'android:name', 'android.permission.NFC')
      )
    ) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.NFC' }
      });
    }

    if (!Array.isArray(manifest['uses-feature'])) {
      manifest['uses-feature'] = [];
    }
    if (
      !manifest['uses-feature'].some((entry) =>
        hasNameAttribute(entry, 'android:name', 'android.hardware.nfc')
      )
    ) {
      manifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.nfc',
          'android:required': 'false'
        }
      });
    }

    return configWithManifest;
  });
};
