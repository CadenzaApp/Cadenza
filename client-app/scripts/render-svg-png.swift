// Renders an SVG to @1x, @2x, and @3x PNGs with AppKit, for places that take
// an image but not an SVG, like the native tab bar. macOS only.
//
//   swift scripts/render-svg-png.swift <in.svg> <out.png> <points> [viewBox]
//
// <points> is the square side at @1x. [viewBox] ("x y w h") replaces the SVG's
// own, to crop it. Writes out.png, out@2x.png, out@3x.png.

import AppKit

let args = CommandLine.arguments
guard args.count == 4 || args.count == 5, let points = Int(args[3]) else {
    FileHandle.standardError.write(
        "usage: render-svg-png.swift <in.svg> <out.png> <points> [viewBox]\n".data(using: .utf8)!)
    exit(1)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

var svg = try String(contentsOf: input, encoding: .utf8)
if args.count == 5 {
    svg = svg.replacingOccurrences(
        of: #"viewBox="[^"]*""#, with: "viewBox=\"\(args[4])\"", options: .regularExpression)
}
guard let image = NSImage(data: svg.data(using: .utf8)!) else {
    FileHandle.standardError.write("could not read \(input.path) as an SVG\n".data(using: .utf8)!)
    exit(1)
}

let base = output.deletingPathExtension().lastPathComponent
let folder = output.deletingLastPathComponent()
for scale in 1...3 {
    let side = points * scale
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    image.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "\(base).png" : "\(base)@\(scale)x.png"
    try bitmap.representation(using: .png, properties: [:])!
        .write(to: folder.appendingPathComponent(name))
    print("wrote \(name) (\(side)px)")
}
