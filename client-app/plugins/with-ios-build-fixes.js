// SDK 58 supplies scene lifecycle support; keep only local Xcode build settings.
const { withXcodeProject } = require("@expo/config-plugins");

// A raw `expo run:ios`/xcodebuild-only build (no interactive Xcode session)
// can't do the OAuth-y "create a profile for this account" step itself; it
// can only reuse a profile that already exists on disk. Without
// CODE_SIGN_STYLE explicitly set to Automatic, xcodebuild treats signing as
// disabled outright. `ios.appleTeamId` in app config already sets
// DEVELOPMENT_TEAM for us; this just adds the missing style flag, and turns
// off the newer script-phase sandboxing that blocks Expo dev-launcher's
// "Create Manifest IP" build step (Sandbox: bash deny file-write-data .../ip.txt).
function withAutomaticSigningAndSandboxFix(config) {
    return withXcodeProject(config, (config) => {
        const project = config.modResults;
        const configurations = project.pbxXCBuildConfigurationSection();
        for (const key in configurations) {
            const entry = configurations[key];
            if (typeof entry.buildSettings !== "object") continue;
            entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
            if (entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
                entry.buildSettings.CODE_SIGN_STYLE = "Automatic";
            }
        }
        return config;
    });
}

module.exports = function withIosBuildFixes(config) {
    config = withAutomaticSigningAndSandboxFix(config);
    return config;
};
