// Same content as the old app.json, except ios.bundleIdentifier and
// ios.appleTeamId read from env vars so each developer's personal bundle id
// and signing team can differ without editing this tracked file. Expo CLI
// loads client-app/.env before evaluating this file, so set APPLE_BUNDLE_ID
// and APPLE_TEAM_ID there (gitignored, per-developer) to override the shared
// default. Leave APPLE_TEAM_ID unset and Xcode will resolve the team itself
// from whichever account is signed in locally the first time you build from
// the Xcode GUI; set it once you know your team id so headless builds
// (./.personal/dev.sh rebuild, xcodebuild) don't need a GUI session to
// resolve signing.
module.exports = {
  expo: {
    name: "client-app",
    slug: "client-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "client-app",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: process.env.APPLE_BUNDLE_ID || "com.cadenza.cs4000",
      appleTeamId: process.env.APPLE_TEAM_ID,
      infoPlist: {
        NSAppleMusicUsageDescription:
          "Cadenza needs access to Apple Music to sync and play your library.",
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: "com.cadenza.cs4000",
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
          },
        },
      ],
      "expo-font",
      "expo-image",
      "expo-web-browser",
      "expo-secure-store",
      "./plugins/with-ios-build-fixes",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
