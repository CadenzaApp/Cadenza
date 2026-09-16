package expo.modules.imagecolor

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.HttpURLConnection
import java.net.URL
import java.util.Collections

/**
 * Average color of a remote image, as `#rrggbb`.
 *
 * Deliberately knows nothing about Apple Music, or about what the color is for.
 * It takes a URL and returns a color.
 */
class ImageColorModule : Module() {
    /**
     * Results, keyed by URL. Averaging the same artwork twice costs a download
     * and a decode, and the answer cannot change for a given URL.
     */
    private val cache = Collections.synchronizedMap(mutableMapOf<String, String>())

    override fun definition() = ModuleDefinition {
        Name("ImageColorModule")

        AsyncFunction("getAverageColor") { url: String ->
            return@AsyncFunction averageColor(url)
        }
    }

    private fun averageColor(url: String): String? {
        cache[url]?.let { return it }

        val bitmap = decodeScaled(url) ?: return null
        val hex = try {
            averageHex(bitmap)
        } finally {
            bitmap.recycle()
        }
        if (hex != null) cache[url] = hex
        return hex
    }

    /**
     * Decodes at most [SAMPLE_EDGE] pixels on the long edge. The average of a
     * subsampled image is the average of the image, so there is no reason to
     * carry the full one through memory.
     */
    private fun decodeScaled(url: String): Bitmap? {
        val bytes = try {
            download(url)
        } catch (_: Exception) {
            null
        } ?: return null

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val longEdge = maxOf(bounds.outWidth, bounds.outHeight)
        if (longEdge <= 0) return null

        var sample = 1
        while (longEdge / (sample * 2) >= SAMPLE_EDGE) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    private fun download(url: String): ByteArray? {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            // Reads the shared response cache when the artwork has already been
            // fetched, rather than pulling the same bytes twice.
            connection.useCaches = true
            if (connection.responseCode !in 200..299) return null
            return connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }

    private fun averageHex(bitmap: Bitmap): String? {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 0 || height <= 0) return null

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var red = 0L
        var green = 0L
        var blue = 0L
        var weight = 0L
        for (pixel in pixels) {
            // Weighted by alpha, so a transparent corner does not drag the
            // average toward black the way a flat sum would.
            val alpha = (pixel ushr 24) and 0xff
            if (alpha == 0) continue
            red += ((pixel shr 16) and 0xff).toLong() * alpha
            green += ((pixel shr 8) and 0xff).toLong() * alpha
            blue += (pixel and 0xff).toLong() * alpha
            weight += alpha.toLong()
        }
        if (weight == 0L) return null

        return String.format("#%02x%02x%02x", red / weight, green / weight, blue / weight)
    }

    private companion object {
        const val SAMPLE_EDGE = 64
        const val TIMEOUT_MS = 10_000
    }
}
