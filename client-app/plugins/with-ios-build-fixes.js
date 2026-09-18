// Recent iOS versions turned "app does not adopt UIScene lifecycle" from a
// console warning into a hard launch-time crash (EXC_BREAKPOINT in
// ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke).
// Expo SDK 57 / React Native 0.86 still generate a window-only AppDelegate
// with no scene support, so this plugin adds a SceneDelegate.swift, wires it
// up in Info.plist, and moves window creation out of AppDelegate into the
// scene delegate. Runs on every `expo prebuild` since ios/ is regenerated.
const { withAppDelegate, withInfoPlist, withXcodeProject, IOSConfig } = require("@expo/config-plugins");

const SCENE_DELEGATE_CLASS_NAME = "SceneDelegate";

const sceneDelegateSource = `import React
import UIKit

class ${SCENE_DELEGATE_CLASS_NAME}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else {
      NSLog("SceneDelegate: scene is not a UIWindowScene")
      return
    }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      NSLog("SceneDelegate: AppDelegate.reactNativeFactory is nil")
      return
    }
    NSLog("SceneDelegate: starting React Native")

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    window.makeKeyAndVisible()
  }
}
`;

// A plain fs.writeFileSync would drop the file on disk without registering it
// as a PBXBuildFile / Sources build phase member, so Xcode would never
// actually compile it (this project uses old-style explicit file references,
// not Xcode 16's file-system-synchronized groups). withBuildSourceFile does
// both: writes the file and links it into the project.
function withSceneDelegateFile(config) {
  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: `${SCENE_DELEGATE_CLASS_NAME}.swift`,
    contents: sceneDelegateSource,
    overwrite: true,
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE_CLASS_NAME}`,
          },
        ],
      },
    };
    return config;
  });
}

function withSceneAwareAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    // Window creation moves to the scene delegate; AppDelegate only builds
    // the React Native factory now.
    contents = contents.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n\n?/,
      ""
    );

    if (!contents.includes("configurationForConnecting")) {
      contents = contents.replace(
        /return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)\n  \}/,
        `return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
  }`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

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
  config = withSceneManifest(config);
  config = withSceneDelegateFile(config);
  config = withSceneAwareAppDelegate(config);
  config = withAutomaticSigningAndSandboxFix(config);
  return config;
};
