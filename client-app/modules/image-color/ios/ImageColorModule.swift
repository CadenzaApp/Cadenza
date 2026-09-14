import ExpoModulesCore
import UIKit

/// Average color of a remote image, as `#rrggbb`.
///
/// Deliberately knows nothing about Apple Music, or about what the color is
/// for. It takes a URL and returns a color.
public class ImageColorModule: Module {
    /// Results, keyed by URL. Averaging the same artwork twice costs a download
    /// and a decode, and the answer cannot change for a given URL.
    private let cache = NSCache<NSString, NSString>()
    /// Shares the app's URL cache, so artwork the image views have already
    /// pulled down is read from disk rather than fetched a second time.
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 10
        return URLSession(configuration: configuration)
    }()

    public func definition() -> ModuleDefinition {
        Name("ImageColorModule")

        AsyncFunction("getAverageColor") { (url: String) async throws -> String? in
            try await self.averageColor(of: url)
        }
    }

    private func averageColor(of urlString: String) async throws -> String? {
        let key = urlString as NSString
        if let cached = self.cache.object(forKey: key) {
            return cached as String
        }
        guard let url = URL(string: urlString) else { return nil }

        let (data, _) = try await session.data(from: url)
        guard let image = UIImage(data: data), let hex = Self.averageHex(of: image) else {
            return nil
        }
        self.cache.setObject(hex as NSString, forKey: key)
        return hex
    }

    /// Draws the whole image into a single pixel and reads it back. The
    /// downsample is the average, so there is no loop over pixels to write.
    private static func averageHex(of image: UIImage) -> String? {
        guard let cgImage = image.cgImage else { return nil }

        var pixel = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(
            data: &pixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }

        context.interpolationQuality = .medium
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))

        // Fully transparent artwork averages to black, which would read as a
        // real color. Nothing to report instead.
        let alpha = pixel[3]
        guard alpha > 0 else { return nil }

        // The context is premultiplied, so a partly transparent average has to
        // be divided back out or it comes back darker than the image looks.
        let channel = { (value: UInt8) -> Int in
            let scaled = (Double(value) * 255 / Double(alpha)).rounded()
            return Int(max(0, min(255, scaled)))
        }
        return String(
            format: "#%02x%02x%02x", channel(pixel[0]), channel(pixel[1]), channel(pixel[2]))
    }
}
