/* global __dirname, __filename */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const script = fs.readFileSync(
    path.resolve(
        __dirname,
        "../node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh",
    ),
    "utf8",
);
const computeHash = script.match(/compute_hash\(\) \{[\s\S]*?\n\}/)?.[0];
function hash(xcode, deviceSDK, simulatorSDK) {
    assert.ok(computeHash, "Expo cache-key function was not found");
    return execFileSync("bash", ["-s"], {
        encoding: "utf8",
        input: `set -euo pipefail
SOURCE_DIRS=("$FIXTURE_SOURCE")
SOURCE_FILES=("$FIXTURE_SOURCE")
PODS_ROOT=/fixture/Pods
RN_ROOT=/fixture/react-native
xcodebuild() { echo "$FIXTURE_XCODE"; }
xcrun() {
  if [[ "$1" == swiftc ]]; then echo 'same Swift compiler';
  elif [[ "$2" == iphoneos ]]; then echo "$FIXTURE_DEVICE_SDK";
  else echo "$FIXTURE_SIMULATOR_SDK"; fi
}
${computeHash}
compute_hash
`,
        env: {
            PATH: process.env.PATH,
            FIXTURE_SOURCE: __filename,
            FIXTURE_XCODE: xcode,
            FIXTURE_DEVICE_SDK: deviceSDK,
            FIXTURE_SIMULATOR_SDK: simulatorSDK,
        },
    }).trim();
}
test(
    "JSI cache invalidates when Xcode or either SDK changes with the same Swift version",
    { skip: process.platform !== "darwin" },
    () => {
        const first = hash("27A266a", "iOS27.0", "Simulator27.0");
        assert.equal(first, hash("27A266a", "iOS27.0", "Simulator27.0"));
        assert.notEqual(first, hash("27A9275", "iOS27.0", "Simulator27.0"));
        assert.notEqual(first, hash("27A266a", "iOS27.1", "Simulator27.0"));
        assert.notEqual(first, hash("27A266a", "iOS27.0", "Simulator27.1"));
    },
);
test(
    "Swift interface cleanup handles dot and colon C++ namespace spelling",
    { skip: process.platform !== "darwin" },
    () => {
        const program = script.match(/^\s+sed '([^']+)'/m)?.[1];
        assert.ok(program, "Expo interface cleanup command was not found");
        const input = `public struct KeptBefore {}
extension __ObjC.expo.CppError : Swift.Error {
  public var message: Swift.String { get }
}
public struct KeptBetween {}
extension __ObjC::expo.__ObjC::CppError : Swift::Error {
  public var message: Swift::String { get }
}
public struct KeptAfter {}
`;
        const output = execFileSync("sed", [program], {
            input,
            encoding: "utf8",
        });
        assert.equal(
            output,
            "public struct KeptBefore {}\npublic struct KeptBetween {}\npublic struct KeptAfter {}\n",
        );
    },
);
