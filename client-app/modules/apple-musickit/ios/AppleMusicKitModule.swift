import ExpoModulesCore
import MusicKit
import StoreKit

public class AppleMusicKitModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AppleMusicKit")

        AsyncFunction("authorize") { (developerToken: String) async throws -> [String: String] in
            guard #available(iOS 15.1, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Apple MusicKit requires iOS 15.1 or later."
                )
            }

            let status = await MusicAuthorization.request()

            switch status {
            case .authorized:
                guard !developerToken.isEmpty else {
                    return ["status": "authorized"]
                }

                do {
                    let userToken: String = try await withCheckedThrowingContinuation {
                        continuation in
                        SKCloudServiceController().requestUserToken(
                            forDeveloperToken: developerToken
                        ) { token, error in
                            if let error = error {
                                continuation.resume(throwing: error)
                            } else if let token = token {
                                continuation.resume(returning: token)
                            } else {
                                continuation.resume(
                                    throwing: NSError(
                                        domain: "AppleMusicKit",
                                        code: -1,
                                        userInfo: [
                                            NSLocalizedDescriptionKey:
                                                "requestUserToken returned neither a token nor an error."
                                        ]
                                    )
                                )
                            }
                        }
                    }
                    return ["status": "authorized", "userToken": userToken]
                } catch {
                    return ["status": "authorized", "error": error.localizedDescription]
                }

            case .denied:
                return ["status": "denied"]

            case .restricted:
                return ["status": "restricted"]

            case .notDetermined:
                return ["status": "notDetermined"]

            @unknown default:
                return ["status": "unknown"]
            }
        }
    }
}
