const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withE2eCleartext(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const application = nextConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error("Android application manifest is unavailable");
    application.$ = application.$ || {};
    application.$["android:usesCleartextTraffic"] = "true";
    return nextConfig;
  });
};
