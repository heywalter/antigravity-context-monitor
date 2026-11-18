import AppKit
import CoreGraphics
import Foundation

// MARK: - Formatting & Geometry Helpers

enum HudFormatter {
  static func fmtTokens(_ value: Double) -> String {
    let v = value.isFinite ? value : 0
    let absV = abs(v)
    let sign = v < 0 ? "-" : ""
    if absV >= 1_000_000 {
      return "\(sign)\(String(format: "%.2f", absV / 1_000_000))M"
    }
    if absV >= 10_000 {
      return "\(sign)\(String(format: "%.1f", absV / 1_000))K"
    }
    if absV >= 1_000 {
      return "\(sign)\(String(format: "%.2f", absV / 1_000))K"
    }
    let rounded = Int(absV.rounded())
    let nf = NumberFormatter()
    nf.numberStyle = .decimal
    return "\(sign)\(nf.string(from: NSNumber(value: rounded)) ?? "\(rounded)")"
  }

  static func fmtCompactTokens(_ value: Double) -> String {
    let v = value.isFinite ? abs(value) : 0
    if v >= 1_000_000 {
      return String(format: "%.1fM", v / 1_000_000)
    }
    if v >= 10_000 {
      return String(format: "%.0fK", v / 1_000)
    }
    if v >= 1_000 {
      return String(format: "%.1fK", v / 1_000)
    }
    return "\(Int(v.rounded()))"
  }

  static func fmtShortTokens(_ n: Double) -> String {
    fmtCompactTokens(n)
  }

  static func fmtPct(_ ratio: Double, decimals: Int = 1) -> String {
    let safe = ratio.isFinite ? max(0, ratio) * 100.0 : 0.0
    return String(format: "%.\(decimals)f%%", safe)
  }

  static func fmtIntPct(_ ratio: Double) -> Int {
    let safe = ratio.isFinite ? ratio * 100.0 : 0.0
    return Int(round(min(999.0, max(0.0, safe))))
  }

  static func fmtUsd(_ usd: Double) -> String {
    let safe = usd.isFinite ? max(0, usd) : 0
    if safe >= 100 { return String(format: "$%.1f", safe) }
    if safe >= 10 { return String(format: "$%.2f", safe) }
    return String(format: "$%.2f", safe)
  }

  static func fmtCny(_ cny: Double) -> String {
    let safe = cny.isFinite ? max(0, cny) : 0
    if safe >= 100 { return String(format: "¥%.1f", safe) }
    return String(format: "¥%.2f", safe)
  }

  static func fmtDurationMs(_ ms: Int?) -> String {
    guard let ms, ms >= 0 else { return "—" }
    if ms < 1000 { return "\(ms)ms" }
    return String(format: "%.1fs", Double(ms) / 1000.0)
  }

  static func formatTtftSummary(avgMs: Int?, lastMs: Int?, prefs: HudPrefs) -> (main: String, sub: String) {
    switch (avgMs, lastMs) {
    case let (a?, l?):
      let aStr = fmtDurationMs(a)
      let lStr = fmtDurationMs(l)
      return (
        aStr == lStr ? aStr : "\(aStr) / \(lStr)",
        prefs.t("Avg \(aStr) · Last \(lStr)", "平均 \(aStr) · 末步 \(lStr)")
      )
    case let (a?, nil):
      return (fmtDurationMs(a), prefs.t("Session avg", "会话平均"))
    case let (nil, l?):
      return (fmtDurationMs(l), prefs.t("Last step", "末步首字"))
    case (nil, nil):
      return ("—", prefs.t("Waiting for timing", "等待首字计时"))
    }
  }

  static func truncate(_ text: String, maxChars: Int) -> String {
    let clean = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if clean.count <= maxChars { return clean }
    return String(clean.prefix(max(1, maxChars - 1))) + "…"
  }

  static func cgToAppKitRect(_ cgRect: CGRect, primaryScreenHeight: CGFloat) -> NSRect {
    let appY = primaryScreenHeight - (cgRect.origin.y + cgRect.size.height)
    return NSRect(x: cgRect.origin.x, y: appY, width: cgRect.size.width, height: cgRect.size.height)
  }

  static let windowLimitTiers: [Int] = [
    80_000, 128_000, 160_000, 200_000, 256_000, 512_000, 840_000, 1_000_000, 2_000_000
  ]

  static func limitLabel(_ limit: Int) -> String {
    switch limit {
    case 0: return "Auto"
    case 80_000: return "80K"
    case 128_000: return "128K"
    case 160_000: return "160K"
    case 200_000: return "200K"
    case 256_000: return "256K"
    case 512_000: return "512K"
    case 840_000: return "840K"
    case 1_000_000: return "1M"
    case 2_000_000: return "2M"
    default: return fmtTokens(Double(limit))
    }
  }

  static func snapObservedCompactionLimit(_ tokens: Double) -> Int {
    if !tokens.isFinite || tokens <= 0 { return 256_000 }
    if tokens <= 95_000 { return 80_000 }
    if tokens <= 145_000 { return 128_000 }
    if tokens <= 185_000 { return 160_000 }
    if tokens <= 215_000 { return 200_000 }
    if tokens <= 310_000 { return 256_000 }
    if tokens <= 560_000 { return 512_000 }
    if tokens <= 880_000 { return 840_000 }
    return 1_000_000
  }

  static func inferModelCompactionLimit(_ modelName: String?) -> Int? {
    let s = (modelName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if s.isEmpty { return nil }
    if s.contains("gpt-oss") { return 80_000 }
    if s.contains("gemini-2.5") { return 128_000 }
    if s.range(of: #"(?:^|[-_.\s])1m(?:$|[-_.\s])"#, options: .regularExpression) != nil {
      return 840_000
    }
    return nil
  }

  static func effectiveWindowLimit(prefs: HudPrefs, response: HudApiResponse?) -> Int {
    if prefs.windowLimit > 0 {
      return prefs.windowLimit
    }
    if let apiLim = response?.effectiveWindowLimit, apiLim > 0 {
      return apiLim
    }
    var candidate = 256_000
    if let observed = response?.summary?.observedCompactionTokens, observed > 0 {
      candidate = snapObservedCompactionLimit(observed)
    } else if let modelLim = inferModelCompactionLimit(response?.modelName) {
      candidate = modelLim
    }
    let used = response?.summary?.estimatedNextContextTokens ?? 0
    if used > Double(candidate) {
      if let promoted = windowLimitTiers.first(where: { Double($0) >= used }) {
        candidate = promoted
      } else {
        candidate = Int(ceil(used / 100_000.0) * 100_000.0)
      }
    }
    return candidate
  }

  static func anchorBasePoint(
    winRect: NSRect,
    barSize: NSSize,
    anchorPosition: String
  ) -> NSPoint {
    switch anchorPosition {
    case "bottomCenter":
      return NSPoint(
        x: winRect.minX + (winRect.width - barSize.width) / 2.0,
        y: winRect.minY + 10.0
      )
    case "bottomRight":
      return NSPoint(
        x: winRect.maxX - barSize.width - 22.0,
        y: winRect.minY + 12.0
      )
    default: // "topRight" titlebar dock left of window toolbar buttons
      return NSPoint(
        x: winRect.maxX - barSize.width - 148.0,
        y: winRect.maxY - barSize.height - 7.0
      )
    }
  }
}

// MARK: - Data Models

struct HudPrefs: Codable, Equatable {
  var prefsVersion: Int = 2
  var windowLimit: Int = 0                 // 0 = Auto (Antigravity compaction ceiling, default 256K)
  var displayMode: String = "both"         // "both" | "window" | "menubar"
  var anchorPosition: String = "topRight"  // "topRight" | "bottomCenter" | "bottomRight"
  var capsuleStyle: String = "compact"     // "compact" | "full" | "minimal"
  var language: String = "en"              // "en" | "zh"
  var offsetX: Double = 0
  var offsetY: Double = 0
  var pinnedConversationId: String? = nil

  var isZh: Bool { language == "zh" }
  func t(_ en: String, _ zh: String) -> String { isZh ? zh : en }

  init() {}

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let rawVer = try c.decodeIfPresent(Int.self, forKey: .prefsVersion)
    let hasV2 = (rawVer ?? 0) >= 2
    self.prefsVersion = 2

    let rawLimit = try c.decodeIfPresent(Int.self, forKey: .windowLimit)
    if !hasV2 && (rawLimit == nil || rawLimit == 1_000_000 || (rawLimit ?? 0) <= 0) {
      self.windowLimit = 0
    } else if let rl = rawLimit, rl >= 0 {
      self.windowLimit = rl
    } else {
      self.windowLimit = 0
    }

    let rawMode = try c.decodeIfPresent(String.self, forKey: .displayMode) ?? "both"
    let normalizedMode = rawMode == "bottom" ? "window" : rawMode
    self.displayMode = ["both", "window", "menubar"].contains(normalizedMode) ? normalizedMode : "both"

    let rawAnchor = try c.decodeIfPresent(String.self, forKey: .anchorPosition) ?? "topRight"
    self.anchorPosition = ["topRight", "bottomCenter", "bottomRight"].contains(rawAnchor) ? rawAnchor : "topRight"

    let rawStyle = try c.decodeIfPresent(String.self, forKey: .capsuleStyle) ?? "compact"
    self.capsuleStyle = ["compact", "full", "minimal"].contains(rawStyle) ? rawStyle : "compact"

    let rawLang = try c.decodeIfPresent(String.self, forKey: .language) ?? "en"
    self.language = ["en", "zh"].contains(rawLang) ? rawLang : "en"

    let ox = try c.decodeIfPresent(Double.self, forKey: .offsetX) ?? 0
    let oy = try c.decodeIfPresent(Double.self, forKey: .offsetY) ?? 0
    self.offsetX = ox.isFinite ? ox : 0
    self.offsetY = oy.isFinite ? oy : 0
    self.pinnedConversationId = try c.decodeIfPresent(String.self, forKey: .pinnedConversationId)
  }

  static func load(from url: URL) -> HudPrefs {
    guard let data = try? Data(contentsOf: url),
          let decoded = try? JSONDecoder().decode(HudPrefs.self, from: data)
    else {
      return HudPrefs()
    }
    return decoded
  }

  func save(to url: URL) {
    let dir = url.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(self) else { return }
    try? data.write(to: url, options: .atomic)
  }
}

struct HudCost: Decodable {
  let inputCostUsd: Double?
  let cacheReadCostUsd: Double?
  let outputCostUsd: Double?
  let totalCostUsd: Double
  let savedByCacheUsd: Double
  let totalCostCny: Double
  let savedByCacheCny: Double?
}

struct HudSummary: Decodable {
  let userTurns: Int
  let stepsCount: Int
  let modelCalls: Int
  let toolCalls: Int
  let checkpoints: Int
  let observedCompactionTokens: Double?
  let allTokens: Double
  let promptTokens: Double
  let inputTokens: Double?
  let cacheReadTokens: Double?
  let outputTokens: Double
  let overallCacheHitRate: Double
  let avgTokPerSec: Int?
  let lastTokPerSec: Int?
  let avgTtftMs: Int?
  let lastTtftMs: Int?
  let ttftSampleCount: Int?
  let currentPromptTokens: Double
  let estimatedNextContextTokens: Double
  let initialBaselineTokens: Double
  let growthTokens: Double
  let currentCacheHitRate: Double
  let cost: HudCost?
}

struct HudRecentSession: Decodable {
  let conversationId: String
  let title: String?
  let promptTokens: Double?
  let estimatedNextContextTokens: Double?
  let stepsCount: Int?
  let userTurns: Int?
  let isRunning: Bool?
  let updatedAt: String?
}

struct HudHistoryBucket: Decodable {
  let allTokens: Double
  let inputTokens: Double
  let cacheReadTokens: Double
  let outputTokens: Double
  let cacheHitRate: Double
  let steps: Int
  let sessions: Int
  let totalCostUsd: Double
  let totalCostCny: Double
  let savedByCacheUsd: Double
}

struct HudHeatmapCell: Decodable {
  let date: String
  let weekday: Int
  let allTokens: Double
  let level: Int
  let costUsd: Double
}

struct HudSourceStat: Decodable {
  let sessions: Int
  let allTokens: Double
  let totalCostUsd: Double
}

struct HudSourceBreakdown: Decodable {
  let desktop: HudSourceStat
  let cli: HudSourceStat
}

struct HudHistorySummary: Decodable {
  let todayKey: String
  let today: HudHistoryBucket
  let last7Days: HudHistoryBucket
  let thisMonth: HudHistoryBucket
  let allTime: HudHistoryBucket
  let bySource: HudSourceBreakdown
  let heatmap: [HudHeatmapCell]
}

struct HudApiResponse: Decodable {
  let unchanged: Bool?
  let etag: String?
  let activeConversationId: String?
  let selectedConversationId: String?
  let title: String?
  let modelName: String?
  let effectiveWindowLimit: Int?
  let windowLimitMode: String?
  let windowLimitSource: String?
  let found: Bool?
  let hasData: Bool?
  let isRunning: Bool?
  let summary: HudSummary?
  let recentSessions: [HudRecentSession]?
  let historySummary: HudHistorySummary?
}

// MARK: - Capsule Components

final class RingView: NSView {
  var ratio: Double = 0 {
    didSet { needsDisplay = true }
  }
  var ringColor: NSColor = .secondaryLabelColor {
    didSet { needsDisplay = true }
  }
  var strokeWidth: CGFloat = 1.9

  override var intrinsicContentSize: NSSize {
    NSSize(width: 13, height: 13)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let side = min(bounds.width, bounds.height) - strokeWidth - 1
    guard side > 2 else { return }
    let center = NSPoint(x: bounds.midX, y: bounds.midY)
    let radius = side / 2.0

    let track = NSBezierPath()
    track.lineWidth = strokeWidth
    track.appendArc(withCenter: center, radius: radius, startAngle: 0, endAngle: 360, clockwise: false)
    NSColor.tertiaryLabelColor.withAlphaComponent(0.45).setStroke()
    track.stroke()

    let clamped = min(1.0, max(0.0, ratio))
    if clamped > 0.002 {
      let progress = NSBezierPath()
      progress.lineWidth = strokeWidth
      progress.lineCapStyle = .round
      progress.appendArc(
        withCenter: center,
        radius: radius,
        startAngle: 90.0,
        endAngle: 90.0 - CGFloat(360.0 * clamped),
        clockwise: true
      )
      ringColor.setStroke()
      progress.stroke()
    }
  }
}

final class CapsuleVisualEffectView: NSVisualEffectView {
  var onMouseDown: ((NSEvent) -> Void)?
  var onMouseDragged: ((NSEvent) -> Void)?
  var onMouseUp: ((NSEvent) -> Void)?
  var onRightMouseDown: ((NSEvent) -> Void)?
  var onHoverChanged: ((Bool) -> Void)?

  private var tracking: NSTrackingArea?
  private(set) var isHovered = false {
    didSet {
      updateBorderColor()
      onHoverChanged?(isHovered)
    }
  }
  var isHighlighted = false {
    didSet { updateBorderColor() }
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    material = .hudWindow
    blendingMode = .behindWindow
    state = .active
    wantsLayer = true
    layer?.cornerRadius = 12
    layer?.masksToBounds = true
    layer?.borderWidth = 0.75
    updateBorderColor()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(area)
    tracking = area
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .pointingHand)
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
  }

  override func updateLayer() {
    super.updateLayer()
    updateBorderColor()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateBorderColor()
  }

  private func updateBorderColor() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      if self.isHighlighted {
        self.layer?.borderColor = NSColor.controlAccentColor.withAlphaComponent(0.75).cgColor
      } else if self.isHovered {
        self.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.70).cgColor
      } else {
        self.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.32).cgColor
      }
    }
  }

  override func mouseDown(with event: NSEvent) {
    onMouseDown?(event)
  }

  override func mouseDragged(with event: NSEvent) {
    onMouseDragged?(event)
  }

  override func mouseUp(with event: NSEvent) {
    onMouseUp?(event)
  }

  override func rightMouseDown(with event: NSEvent) {
    onRightMouseDown?(event)
  }
}

final class FloatingHudPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

// MARK: - Popover Custom Canvas Views (Flipped Coordinate Space)

private enum PopoverTheme {
  static func ratioColor(_ ratio: Double) -> NSColor {
    if ratio >= 0.85 { return .systemRed }
    if ratio >= 0.70 { return .systemOrange }
    return .systemTeal
  }

  static func cardFill() -> NSColor {
    NSColor.labelColor.withAlphaComponent(0.045)
  }

  static func cardBorder() -> NSColor {
    NSColor.separatorColor.withAlphaComponent(0.35)
  }

  static func heatColor(level: Int) -> NSColor {
    switch level {
    case 1: return NSColor.systemTeal.withAlphaComponent(0.28)
    case 2: return NSColor.systemTeal.withAlphaComponent(0.52)
    case 3: return NSColor.systemTeal.withAlphaComponent(0.78)
    case 4: return NSColor.systemGreen.withAlphaComponent(0.95)
    default: return NSColor.labelColor.withAlphaComponent(0.07)
    }
  }

  static func drawCard(_ rect: NSRect, radius: CGFloat = 8) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    cardFill().setFill()
    path.fill()
    path.lineWidth = 0.75
    cardBorder().setStroke()
    path.stroke()
  }

  static func drawText(
    _ text: String,
    in rect: NSRect,
    font: NSFont,
    color: NSColor = .labelColor,
    alignment: NSTextAlignment = .left
  ) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    style.lineBreakMode = .byTruncatingTail
    let attrs: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
      .paragraphStyle: style,
    ]
    (text as NSString).draw(in: rect, withAttributes: attrs)
  }
}

final class SessionCanvasView: NSView {
  var response: HudApiResponse? { didSet { needsDisplay = true } }
  var prefs: HudPrefs = HudPrefs() { didSet { needsDisplay = true } }
  var effectiveLimit: Int = 256_000 { didSet { needsDisplay = true } }

  override var isFlipped: Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let w = bounds.width
    guard w > 40 else { return }

    let hasData = response?.hasData == true
    let s = response?.summary
    let resolvedLimit = effectiveLimit > 0 ? effectiveLimit : HudFormatter.effectiveWindowLimit(prefs: prefs, response: response)
    let limit = Double(max(1, resolvedLimit))
    let used = s?.estimatedNextContextTokens ?? 0
    let ratio = limit > 0 ? used / limit : 0
    let free = max(0, limit - used)

    // 1. Main Context Window Card
    let gaugeCard = NSRect(x: 0, y: 0, width: w, height: 122)
    PopoverTheme.drawCard(gaugeCard, radius: 9)

    PopoverTheme.drawText(
      "CURRENT CONTEXT WINDOW",
      in: NSRect(x: 12, y: 10, width: 180, height: 14),
      font: .systemFont(ofSize: 10, weight: .semibold),
      color: .secondaryLabelColor
    )
    let rightMeta = hasData
      ? prefs.t("~\(HudFormatter.fmtTokens(free)) free", "剩余约 \(HudFormatter.fmtTokens(free))")
      : prefs.t("Waiting for response", "等待首条回复")
    PopoverTheme.drawText(
      rightMeta,
      in: NSRect(x: w - 160, y: 10, width: 148, height: 14),
      font: .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular),
      color: .secondaryLabelColor,
      alignment: .right
    )

    let usedStr = hasData ? HudFormatter.fmtTokens(used) : "0"
    let limitStr = HudFormatter.limitLabel(resolvedLimit)
    let pctStr = HudFormatter.fmtPct(ratio)
    let accent = PopoverTheme.ratioColor(ratio)

    PopoverTheme.drawText(
      "\(usedStr) / \(limitStr)",
      in: NSRect(x: 12, y: 29, width: 195, height: 24),
      font: .monospacedDigitSystemFont(ofSize: 19, weight: .semibold),
      color: .labelColor
    )

    // Pct badge pill
    let pctTextW: CGFloat = 52
    let pctBadgeRect = NSRect(x: w - pctTextW - 12, y: 31, width: pctTextW, height: 20)
    let badgePath = NSBezierPath(roundedRect: pctBadgeRect, xRadius: 10, yRadius: 10)
    accent.withAlphaComponent(0.18).setFill()
    badgePath.fill()
    PopoverTheme.drawText(
      pctStr,
      in: NSRect(x: pctBadgeRect.minX, y: pctBadgeRect.minY + 3, width: pctBadgeRect.width, height: 15),
      font: .monospacedDigitSystemFont(ofSize: 11, weight: .semibold),
      color: accent,
      alignment: .center
    )

    // 3-segment proportional progress bar
    let barRect = NSRect(x: 12, y: 61, width: w - 24, height: 9)
    let barTrack = NSBezierPath(roundedRect: barRect, xRadius: 4.5, yRadius: 4.5)
    NSColor.labelColor.withAlphaComponent(0.08).setFill()
    barTrack.fill()

    if hasData, let s {
      NSGraphicsContext.saveGraphicsState()
      barTrack.addClip()
      let baseW = min(barRect.width, barRect.width * CGFloat(max(0, s.initialBaselineTokens) / limit))
      let growthW = min(barRect.width - baseW, barRect.width * CGFloat(max(0, s.growthTokens) / limit))
      let lastOut = max(0, used - s.currentPromptTokens)
      let outW = min(barRect.width - baseW - growthW, barRect.width * CGFloat(lastOut / limit))

      if baseW > 0.5 {
        NSColor.systemBlue.setFill()
        NSBezierPath(rect: NSRect(x: barRect.minX, y: barRect.minY, width: baseW, height: barRect.height)).fill()
      }
      if growthW > 0.5 {
        NSColor.systemIndigo.setFill()
        NSBezierPath(rect: NSRect(x: barRect.minX + baseW, y: barRect.minY, width: growthW, height: barRect.height)).fill()
      }
      if outW > 0.5 {
        NSColor.systemGreen.setFill()
        NSBezierPath(rect: NSRect(x: barRect.minX + baseW + growthW, y: barRect.minY, width: outW, height: barRect.height)).fill()
      }
      NSGraphicsContext.restoreGraphicsState()
    }

    // Legend under bar
    let legendItems: [(String, NSColor, String)] = [
      (prefs.t("Base", "基线"), .systemBlue, HudFormatter.fmtTokens(s?.initialBaselineTokens ?? 0)),
      (prefs.t("Growth", "增量"), .systemIndigo, HudFormatter.fmtTokens(s?.growthTokens ?? 0)),
      (prefs.t("Input", "输入"), .systemTeal, HudFormatter.fmtTokens(s?.currentPromptTokens ?? 0)),
    ]
    var lx: CGFloat = 12
    for (title, dotCol, val) in legendItems {
      let dotRect = NSRect(x: lx, y: 81, width: 7, height: 7)
      dotCol.setFill()
      NSBezierPath(roundedRect: dotRect, xRadius: 2, yRadius: 2).fill()
      let txt = "\(title) \(val)"
      PopoverTheme.drawText(
        txt,
        in: NSRect(x: lx + 11, y: 78, width: 105, height: 14),
        font: .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular),
        color: .secondaryLabelColor
      )
      lx += 110
    }

    let cpCount = s?.checkpoints ?? 0
    let subLine = cpCount > 0
      ? prefs.t(
          "Compacted \(cpCount)x · Last cache hit \(HudFormatter.fmtPct(s?.currentCacheHitRate ?? 0))",
          "上下文已压缩 \(cpCount) 次 · 末步缓存命中 \(HudFormatter.fmtPct(s?.currentCacheHitRate ?? 0))"
        )
      : prefs.t(
          "Last step cache hit \(HudFormatter.fmtPct(s?.currentCacheHitRate ?? 0)) · Headroom healthy",
          "末步缓存命中 \(HudFormatter.fmtPct(s?.currentCacheHitRate ?? 0)) · 可用空间充足"
        )
    PopoverTheme.drawText(
      subLine,
      in: NSRect(x: 12, y: 99, width: w - 24, height: 14),
      font: .systemFont(ofSize: 10.5, weight: .regular),
      color: cpCount > 0 ? .systemGreen : .tertiaryLabelColor
    )

    // 2. 2x2 Metric Grid Cards + Full-Width TTFT Card
    let gap: CGFloat = 8
    let colW = floor((w - gap) / 2.0)
    let cardH: CGFloat = 64
    let row1Y: CGFloat = 130
    let row2Y: CGFloat = row1Y + cardH + gap
    let row3Y: CGFloat = row2Y + cardH + gap
    let ttftH: CGFloat = 44

    let avgTps = s?.avgTokPerSec
    let lastTps = s?.lastTokPerSec
    let speedMainStr: String
    let speedSubStr: String
    if let avg = avgTps, let last = lastTps {
      speedMainStr = avg == last ? "\(avg) tok/s" : "\(avg) / \(last) tok/s"
      speedSubStr = prefs.t("Avg \(avg) · Last \(last) tok/s", "平均 \(avg) · 末步 \(last) tok/s")
    } else if let avg = avgTps {
      speedMainStr = "\(avg) tok/s"
      speedSubStr = prefs.t("Session avg · End-to-end", "会话平均 · 含思考耗时")
    } else if let last = lastTps {
      speedMainStr = "\(last) tok/s"
      speedSubStr = prefs.t("Last step · End-to-end", "末步速率 · 含思考耗时")
    } else {
      speedMainStr = "—"
      speedSubStr = prefs.t("Waiting for timing", "等待定时数据")
    }
    let cacheRateStr = HudFormatter.fmtPct(s?.overallCacheHitRate ?? 0)
    let savedUsd = s?.cost?.savedByCacheUsd ?? 0
    let cacheSubStr = prefs.t(
      "Hit \(HudFormatter.fmtTokens(s?.cacheReadTokens ?? 0)) · Saved \(HudFormatter.fmtUsd(savedUsd))",
      "命中 \(HudFormatter.fmtTokens(s?.cacheReadTokens ?? 0)) · 省 \(HudFormatter.fmtUsd(savedUsd))"
    )
    let allTokStr = "\(HudFormatter.fmtTokens(s?.allTokens ?? 0))"
    let stepsSubStr = prefs.t(
      "\(s?.userTurns ?? 0) turns · \(s?.stepsCount ?? 0) steps · \(s?.toolCalls ?? 0) tools",
      "\(s?.userTurns ?? 0) 轮 · \(s?.stepsCount ?? 0) 步 · \(s?.toolCalls ?? 0) 工具"
    )
    let costUsdStr = HudFormatter.fmtUsd(s?.cost?.totalCostUsd ?? 0)
    let costSubStr = prefs.t(
      "≈ \(HudFormatter.fmtCny(s?.cost?.totalCostCny ?? 0)) · Out \(HudFormatter.fmtTokens(s?.outputTokens ?? 0))",
      "≈ \(HudFormatter.fmtCny(s?.cost?.totalCostCny ?? 0)) · 输出 \(HudFormatter.fmtTokens(s?.outputTokens ?? 0))"
    )

    let cards: [(NSRect, String, String, String)] = [
      (NSRect(x: 0, y: row1Y, width: colW, height: cardH), prefs.t("Speed (End-to-End)", "生成速率 (含思考)"), speedMainStr, speedSubStr),
      (NSRect(x: colW + gap, y: row1Y, width: colW, height: cardH), prefs.t("Cache Hit Rate", "Cache 命中率"), cacheRateStr, cacheSubStr),
      (NSRect(x: 0, y: row2Y, width: colW, height: cardH), prefs.t("Session Total", "本会话累计消耗"), allTokStr, stepsSubStr),
      (NSRect(x: colW + gap, y: row2Y, width: colW, height: cardH), prefs.t("Est. API Cost", "API 参考折算"), costUsdStr, costSubStr),
    ]

    for (rect, label, val, sub) in cards {
      PopoverTheme.drawCard(rect, radius: 8)
      PopoverTheme.drawText(
        label,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 7, width: rect.width - 20, height: 13),
        font: .systemFont(ofSize: 10.5, weight: .medium),
        color: .secondaryLabelColor
      )
      PopoverTheme.drawText(
        val,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 23, width: rect.width - 20, height: 21),
        font: .monospacedDigitSystemFont(ofSize: 16.5, weight: .semibold),
        color: .labelColor
      )
      PopoverTheme.drawText(
        sub,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 45, width: rect.width - 20, height: 13),
        font: .monospacedDigitSystemFont(ofSize: 10, weight: .regular),
        color: .tertiaryLabelColor
      )
    }

    let ttftRect = NSRect(x: 0, y: row3Y, width: w, height: ttftH)
    PopoverTheme.drawCard(ttftRect, radius: 8)
    PopoverTheme.drawText(
      prefs.t("First Token (TTFT)", "首字延迟 (TTFT)"),
      in: NSRect(x: 10, y: row3Y + 6, width: 190, height: 13),
      font: .systemFont(ofSize: 10.5, weight: .medium),
      color: .secondaryLabelColor
    )
    if let count = s?.ttftSampleCount, count > 0 {
      PopoverTheme.drawText(
        prefs.t("\(count) steps", "\(count) 次计时"),
        in: NSRect(x: w - 130, y: row3Y + 6, width: 120, height: 13),
        font: .monospacedDigitSystemFont(ofSize: 10, weight: .regular),
        color: .tertiaryLabelColor,
        alignment: .right
      )
    }
    let ttftPair = HudFormatter.formatTtftSummary(avgMs: s?.avgTtftMs, lastMs: s?.lastTtftMs, prefs: prefs)
    PopoverTheme.drawText(
      ttftPair.main,
      in: NSRect(x: 10, y: row3Y + 21, width: 185, height: 19),
      font: .monospacedDigitSystemFont(ofSize: 14.5, weight: .semibold),
      color: .labelColor
    )
    PopoverTheme.drawText(
      ttftPair.sub,
      in: NSRect(x: 190, y: row3Y + 23, width: w - 200, height: 14),
      font: .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular),
      color: .tertiaryLabelColor,
      alignment: .right
    )
  }
}

final class HistoryCanvasView: NSView {
  static let pricingDisclaimerEn = "Ref: Input $2 / Cache $0.2 / Out $10 per 1M tok · 1 USD = 7.25 CNY"
  static let pricingDisclaimerZh = "参考单价: Input $2 / Cache $0.2 / Out $10 (每 1M) · 1 USD = 7.25 CNY"

  var history: HudHistorySummary? { didSet { needsDisplay = true } }
  var prefs: HudPrefs = HudPrefs() { didSet { needsDisplay = true } }

  override var isFlipped: Bool { true }

  static func heatmapGridColumn(daysAgo: Int, lastWeekday: Int, totalColumns: Int = 13) -> Int? {
    let lastRow = (lastWeekday + 6) % 7 // Mon=0 .. Sun=6
    let weeksAgo: Int
    if daysAgo <= lastRow {
      weeksAgo = 0
    } else {
      weeksAgo = 1 + (daysAgo - lastRow - 1) / 7
    }
    let col = (totalColumns - 1) - weeksAgo
    return (col >= 0 && col < totalColumns) ? col : nil
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let w = bounds.width
    guard w > 40 else { return }

    guard let h = history else {
      PopoverTheme.drawCard(NSRect(x: 0, y: 0, width: w, height: 120), radius: 9)
      PopoverTheme.drawText(
        prefs.t("Loading cross-session token history…", "正在加载跨会话历史与费用统计…"),
        in: NSRect(x: 12, y: 50, width: w - 24, height: 20),
        font: .systemFont(ofSize: 12, weight: .regular),
        color: .secondaryLabelColor,
        alignment: .center
      )
      return
    }

    // 1. 2x2 Summary Cards
    let gap: CGFloat = 8
    let colW = floor((w - gap) / 2.0)
    let cardH: CGFloat = 66
    let row1Y: CGFloat = 0
    let row2Y: CGFloat = cardH + gap

    let summaryCards: [(NSRect, String, String, String)] = [
      (
        NSRect(x: 0, y: row1Y, width: colW, height: cardH),
        prefs.t("Today (\(h.todayKey))", "今日用量 (\(h.todayKey))"),
        HudFormatter.fmtTokens(h.today.allTokens),
        prefs.t(
          "\(HudFormatter.fmtUsd(h.today.totalCostUsd)) · \(h.today.sessions) sessions",
          "\(HudFormatter.fmtUsd(h.today.totalCostUsd)) · \(h.today.sessions) 会话"
        )
      ),
      (
        NSRect(x: colW + gap, y: row1Y, width: colW, height: cardH),
        prefs.t("Last 7 Days", "近 7 天累计"),
        HudFormatter.fmtTokens(h.last7Days.allTokens),
        "\(HudFormatter.fmtUsd(h.last7Days.totalCostUsd)) · Cache \(HudFormatter.fmtPct(h.last7Days.cacheHitRate))"
      ),
      (
        NSRect(x: 0, y: row2Y, width: colW, height: cardH),
        prefs.t("This Month", "本月累计"),
        HudFormatter.fmtTokens(h.thisMonth.allTokens),
        prefs.t(
          "\(HudFormatter.fmtUsd(h.thisMonth.totalCostUsd)) · \(h.thisMonth.steps) steps",
          "\(HudFormatter.fmtUsd(h.thisMonth.totalCostUsd)) · \(h.thisMonth.steps) 步"
        )
      ),
      (
        NSRect(x: colW + gap, y: row2Y, width: colW, height: cardH),
        prefs.t("All Time (Desktop+CLI)", "全量总计 (Desktop+CLI)"),
        HudFormatter.fmtTokens(h.allTime.allTokens),
        prefs.t(
          "Est. \(HudFormatter.fmtUsd(h.allTime.totalCostUsd)) · Saved \(HudFormatter.fmtUsd(h.allTime.savedByCacheUsd))",
          "参考 \(HudFormatter.fmtUsd(h.allTime.totalCostUsd)) · 省 \(HudFormatter.fmtUsd(h.allTime.savedByCacheUsd))"
        )
      ),
    ]

    for (rect, label, val, sub) in summaryCards {
      PopoverTheme.drawCard(rect, radius: 8)
      PopoverTheme.drawText(
        label,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 7, width: rect.width - 20, height: 13),
        font: .systemFont(ofSize: 10.5, weight: .medium),
        color: .secondaryLabelColor
      )
      PopoverTheme.drawText(
        val,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 23, width: rect.width - 20, height: 22),
        font: .monospacedDigitSystemFont(ofSize: 16.5, weight: .semibold),
        color: .labelColor
      )
      PopoverTheme.drawText(
        sub,
        in: NSRect(x: rect.minX + 10, y: rect.minY + 46, width: rect.width - 20, height: 13),
        font: .monospacedDigitSystemFont(ofSize: 10, weight: .regular),
        color: .tertiaryLabelColor
      )
    }

    // 2. 12-Week Activity Heatmap Card
    let heatTop = row2Y + cardH + 10
    let heatRect = NSRect(x: 0, y: heatTop, width: w, height: 158)
    PopoverTheme.drawCard(heatRect, radius: 9)

    PopoverTheme.drawText(
      prefs.t("12-Week Activity Heatmap", "近 12 周活跃热力图"),
      in: NSRect(x: 12, y: heatTop + 10, width: 190, height: 14),
      font: .systemFont(ofSize: 11, weight: .semibold),
      color: .labelColor
    )

    // Legend
    PopoverTheme.drawText(
      prefs.t("Less", "少"),
      in: NSRect(x: w - 122, y: heatTop + 10, width: 28, height: 13),
      font: .systemFont(ofSize: 9.5, weight: .regular),
      color: .tertiaryLabelColor,
      alignment: .right
    )
    for lvl in 0...4 {
      let cx = w - 90 + CGFloat(lvl) * 12
      let cell = NSRect(x: cx, y: heatTop + 12, width: 9, height: 9)
      PopoverTheme.heatColor(level: lvl).setFill()
      NSBezierPath(roundedRect: cell, xRadius: 2, yRadius: 2).fill()
    }
    PopoverTheme.drawText(
      prefs.t("More", "多"),
      in: NSRect(x: w - 30, y: heatTop + 10, width: 24, height: 13),
      font: .systemFont(ofSize: 9.5, weight: .regular),
      color: .tertiaryLabelColor
    )

    let gridX: CGFloat = 34
    let gridY: CGFloat = heatTop + 34
    let cols = 13
    let cellW: CGFloat = 19
    let cellH: CGFloat = 11.5
    let cellGapX: CGFloat = 5
    let cellGapY: CGFloat = 3

    let dayLabels: [(Int, String)] = prefs.isZh
      ? [(0, "一"), (2, "三"), (4, "五"), (6, "日")]
      : [(0, "M"), (2, "W"), (4, "F"), (6, "S")]
    for (rowIdx, label) in dayLabels {
      let ly = gridY + CGFloat(rowIdx) * (cellH + cellGapY) - 1
      PopoverTheme.drawText(
        label,
        in: NSRect(x: 10, y: ly, width: 18, height: 12),
        font: .systemFont(ofSize: 9.5, weight: .regular),
        color: .tertiaryLabelColor,
        alignment: .right
      )
    }

    let cells = h.heatmap
    if let lastCell = cells.last {
      let total = cells.count
      for (i, item) in cells.enumerated() {
        let daysAgo = (total - 1) - i
        guard let col = HistoryCanvasView.heatmapGridColumn(daysAgo: daysAgo, lastWeekday: lastCell.weekday, totalColumns: cols) else {
          continue
        }
        let row = (item.weekday + 6) % 7
        let cx = gridX + CGFloat(col) * (cellW + cellGapX)
        let cy = gridY + CGFloat(row) * (cellH + cellGapY)
        let cellRect = NSRect(x: cx, y: cy, width: cellW, height: cellH)
        let path = NSBezierPath(roundedRect: cellRect, xRadius: 2.5, yRadius: 2.5)
        PopoverTheme.heatColor(level: item.level).setFill()
        path.fill()
        if i == total - 1 {
          NSColor.controlAccentColor.withAlphaComponent(0.9).setStroke()
          path.lineWidth = 1.2
          path.stroke()
        }
      }
    }

    let sourceText = prefs.t(
      "Desktop: \(h.bySource.desktop.sessions) sess (\(HudFormatter.fmtTokens(h.bySource.desktop.allTokens)))  ·  CLI: \(h.bySource.cli.sessions) sess (\(HudFormatter.fmtTokens(h.bySource.cli.allTokens)))",
      "Desktop \(h.bySource.desktop.sessions) 会话 (\(HudFormatter.fmtTokens(h.bySource.desktop.allTokens)))  ·  CLI \(h.bySource.cli.sessions) 会话 (\(HudFormatter.fmtTokens(h.bySource.cli.allTokens)))"
    )
    PopoverTheme.drawText(
      sourceText,
      in: NSRect(x: 12, y: heatTop + 137, width: w - 24, height: 13),
      font: .monospacedDigitSystemFont(ofSize: 10, weight: .regular),
      color: .secondaryLabelColor
    )

    // 3. Pricing disclaimer
    PopoverTheme.drawText(
      prefs.t(Self.pricingDisclaimerEn, Self.pricingDisclaimerZh),
      in: NSRect(x: 2, y: heatRect.maxY + 8, width: w - 4, height: 14),
      font: .systemFont(ofSize: 9.2, weight: .regular),
      color: .tertiaryLabelColor
    )
  }
}

// MARK: - Rich Popover ViewController

final class DashboardPopoverViewController: NSViewController {
  var onTabChanged: ((Int) -> Void)?
  var onSelectConversation: ((String?) -> Void)?
  var onChangeAnchor: ((String) -> Void)?
  var onChangeStyle: ((String) -> Void)?
  var onChangeDisplayMode: ((String) -> Void)?
  var onChangeWindowLimit: ((Int) -> Void)?
  var onChangeLanguage: ((String) -> Void)?
  var onResetOffset: (() -> Void)?
  var onCopyReport: (() -> Void)?

  private var currentTab = 0
  private var latestResponse: HudApiResponse?
  private var currentPrefs = HudPrefs()

  private let statusDot = NSView()
  private let headerTitle = NSTextField(labelWithString: "Context & Usage")
  private let modelPill = NSTextField(labelWithString: "")
  private let subHeaderLabel = NSTextField(labelWithString: "Connecting to local data…")
  private let tabControl = NSSegmentedControl(labels: ["Session", "History", "Settings"], trackingMode: .selectOne, target: nil, action: nil)

  // Pages
  private let pageSession = NSView()
  private let pageHistory = NSView()
  private let pageSettings = NSView()

  // Session page controls
  private let sessionCanvas = SessionCanvasView()
  private let sessionPicker = NSPopUpButton()
  private let copyBtn = NSButton(title: "Copy", target: nil, action: nil)

  // History page canvas
  private let historyCanvas = HistoryCanvasView()

  // Settings page controls & dynamic labels
  private let langTitleLabel = NSTextField(labelWithString: "Language")
  private let anchorTitleLabel = NSTextField(labelWithString: "Position")
  private let styleTitleLabel = NSTextField(labelWithString: "Density")
  private let modeTitleLabel = NSTextField(labelWithString: "Display")
  private let limitTitleLabel = NSTextField(labelWithString: "Context Limit")
  private let langSeg = NSSegmentedControl(labels: ["English", "中文"], trackingMode: .selectOne, target: nil, action: nil)
  private let anchorSeg = NSSegmentedControl(labels: ["Top Right", "Bottom Center", "Bottom Right"], trackingMode: .selectOne, target: nil, action: nil)
  private let styleSeg = NSSegmentedControl(labels: ["Compact", "Full Bar", "Minimal"], trackingMode: .selectOne, target: nil, action: nil)
  private let modeSeg = NSSegmentedControl(labels: ["Window + Menu", "Window Only", "Menu Bar Only"], trackingMode: .selectOne, target: nil, action: nil)
  private let limitSeg = NSSegmentedControl(labels: ["Auto", "128K", "200K", "256K", "512K", "1M"], trackingMode: .selectOne, target: nil, action: nil)
  private let settingsHintLabel = NSTextField(wrappingLabelWithString: "")
  private let resetBtn = NSButton(title: "Reset Drag Offset", target: nil, action: nil)
  private let copyDiagBtn = NSButton(title: "Copy Session Summary", target: nil, action: nil)

  private let langValues = ["en", "zh"]
  private let anchorValues = ["topRight", "bottomCenter", "bottomRight"]
  private let styleValues = ["compact", "full", "minimal"]
  private let modeValues = ["both", "window", "menubar"]
  private let limitValues = [0, 128_000, 200_000, 256_000, 512_000, 1_000_000]

  override func loadView() {
    let root = NSView(frame: NSRect(x: 0, y: 0, width: 396, height: 498))
    self.view = root
    preferredContentSize = NSSize(width: 396, height: 498)

    setupHeader(in: root)
    setupSessionPage(in: root)
    setupHistoryPage(in: root)
    setupSettingsPage(in: root)
    selectTab(0)
    syncUI()
  }

  private func setupHeader(in root: NSView) {
    statusDot.wantsLayer = true
    statusDot.layer?.cornerRadius = 3.5
    statusDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
    statusDot.translatesAutoresizingMaskIntoConstraints = false

    headerTitle.font = .systemFont(ofSize: 13.5, weight: .semibold)
    headerTitle.lineBreakMode = .byTruncatingTail
    headerTitle.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    headerTitle.translatesAutoresizingMaskIntoConstraints = false

    modelPill.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
    modelPill.textColor = .secondaryLabelColor
    modelPill.wantsLayer = true
    modelPill.layer?.cornerRadius = 5
    modelPill.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.07).cgColor
    modelPill.alignment = .center
    modelPill.setContentHuggingPriority(.required, for: .horizontal)
    modelPill.setContentCompressionResistancePriority(.required, for: .horizontal)
    modelPill.translatesAutoresizingMaskIntoConstraints = false

    subHeaderLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
    subHeaderLabel.textColor = .secondaryLabelColor
    subHeaderLabel.lineBreakMode = .byTruncatingTail
    subHeaderLabel.translatesAutoresizingMaskIntoConstraints = false

    tabControl.segmentStyle = .rounded
    tabControl.target = self
    tabControl.action = #selector(handleTabChange(_:))
    tabControl.selectedSegment = 0
    tabControl.translatesAutoresizingMaskIntoConstraints = false

    let divider = NSBox()
    divider.boxType = .separator
    divider.translatesAutoresizingMaskIntoConstraints = false

    root.addSubview(statusDot)
    root.addSubview(headerTitle)
    root.addSubview(modelPill)
    root.addSubview(subHeaderLabel)
    root.addSubview(tabControl)
    root.addSubview(divider)

    NSLayoutConstraint.activate([
      statusDot.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 15),
      statusDot.centerYAnchor.constraint(equalTo: headerTitle.centerYAnchor),
      statusDot.widthAnchor.constraint(equalToConstant: 7),
      statusDot.heightAnchor.constraint(equalToConstant: 7),

      headerTitle.leadingAnchor.constraint(equalTo: statusDot.trailingAnchor, constant: 7),
      headerTitle.topAnchor.constraint(equalTo: root.topAnchor, constant: 12),
      headerTitle.trailingAnchor.constraint(lessThanOrEqualTo: modelPill.leadingAnchor, constant: -8),

      modelPill.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
      modelPill.centerYAnchor.constraint(equalTo: headerTitle.centerYAnchor),
      modelPill.heightAnchor.constraint(equalToConstant: 18),

      subHeaderLabel.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
      subHeaderLabel.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
      subHeaderLabel.topAnchor.constraint(equalTo: headerTitle.bottomAnchor, constant: 3),

      tabControl.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
      tabControl.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
      tabControl.topAnchor.constraint(equalTo: subHeaderLabel.bottomAnchor, constant: 9),

      divider.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      divider.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      divider.topAnchor.constraint(equalTo: tabControl.bottomAnchor, constant: 9),
    ])
  }

  private func setupPageConstraints(_ page: NSView, in root: NSView) {
    page.translatesAutoresizingMaskIntoConstraints = false
    root.addSubview(page)
    NSLayoutConstraint.activate([
      page.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
      page.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
      page.topAnchor.constraint(equalTo: tabControl.bottomAnchor, constant: 18),
      page.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -12),
    ])
  }

  private func setupSessionPage(in root: NSView) {
    setupPageConstraints(pageSession, in: root)
    sessionCanvas.translatesAutoresizingMaskIntoConstraints = false

    sessionPicker.controlSize = .small
    sessionPicker.font = .systemFont(ofSize: 11.5)
    sessionPicker.target = self
    sessionPicker.action = #selector(handleSessionPick(_:))
    sessionPicker.translatesAutoresizingMaskIntoConstraints = false

    copyBtn.bezelStyle = .rounded
    copyBtn.controlSize = .small
    copyBtn.target = self
    copyBtn.action = #selector(handleCopy(_:))
    copyBtn.translatesAutoresizingMaskIntoConstraints = false

    pageSession.addSubview(sessionCanvas)
    pageSession.addSubview(sessionPicker)
    pageSession.addSubview(copyBtn)

    NSLayoutConstraint.activate([
      sessionCanvas.leadingAnchor.constraint(equalTo: pageSession.leadingAnchor),
      sessionCanvas.trailingAnchor.constraint(equalTo: pageSession.trailingAnchor),
      sessionCanvas.topAnchor.constraint(equalTo: pageSession.topAnchor),
      sessionCanvas.heightAnchor.constraint(equalToConstant: 318),

      sessionPicker.leadingAnchor.constraint(equalTo: pageSession.leadingAnchor),
      sessionPicker.bottomAnchor.constraint(equalTo: pageSession.bottomAnchor),
      sessionPicker.trailingAnchor.constraint(equalTo: copyBtn.leadingAnchor, constant: -8),

      copyBtn.trailingAnchor.constraint(equalTo: pageSession.trailingAnchor),
      copyBtn.centerYAnchor.constraint(equalTo: sessionPicker.centerYAnchor),
      copyBtn.widthAnchor.constraint(equalToConstant: 82),
    ])
  }

  private func setupHistoryPage(in root: NSView) {
    setupPageConstraints(pageHistory, in: root)
    historyCanvas.translatesAutoresizingMaskIntoConstraints = false
    pageHistory.addSubview(historyCanvas)
    NSLayoutConstraint.activate([
      historyCanvas.leadingAnchor.constraint(equalTo: pageHistory.leadingAnchor),
      historyCanvas.trailingAnchor.constraint(equalTo: pageHistory.trailingAnchor),
      historyCanvas.topAnchor.constraint(equalTo: pageHistory.topAnchor),
      historyCanvas.bottomAnchor.constraint(equalTo: pageHistory.bottomAnchor),
    ])
  }

  private func setupSettingsPage(in root: NSView) {
    setupPageConstraints(pageSettings, in: root)

    langSeg.target = self
    langSeg.action = #selector(handleLangSeg(_:))
    anchorSeg.target = self
    anchorSeg.action = #selector(handleAnchorSeg(_:))
    styleSeg.target = self
    styleSeg.action = #selector(handleStyleSeg(_:))
    modeSeg.target = self
    modeSeg.action = #selector(handleModeSeg(_:))
    limitSeg.target = self
    limitSeg.action = #selector(handleLimitSeg(_:))

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false

    for (lbl, seg) in [
      (langTitleLabel, langSeg),
      (anchorTitleLabel, anchorSeg),
      (styleTitleLabel, styleSeg),
      (modeTitleLabel, modeSeg),
      (limitTitleLabel, limitSeg),
    ] {
      lbl.font = .systemFont(ofSize: 11, weight: .semibold)
      lbl.textColor = .secondaryLabelColor
      seg.controlSize = .small
      seg.translatesAutoresizingMaskIntoConstraints = false

      let group = NSStackView(views: [lbl, seg])
      group.orientation = .vertical
      group.alignment = .leading
      group.spacing = 3
      group.translatesAutoresizingMaskIntoConstraints = false
      stack.addArrangedSubview(group)
      NSLayoutConstraint.activate([
        seg.widthAnchor.constraint(equalTo: stack.widthAnchor),
      ])
    }

    settingsHintLabel.font = .systemFont(ofSize: 10)
    settingsHintLabel.textColor = .tertiaryLabelColor
    settingsHintLabel.translatesAutoresizingMaskIntoConstraints = false
    stack.addArrangedSubview(settingsHintLabel)

    resetBtn.target = self
    resetBtn.action = #selector(handleReset(_:))
    resetBtn.bezelStyle = .rounded
    resetBtn.controlSize = .small
    copyDiagBtn.target = self
    copyDiagBtn.action = #selector(handleCopy(_:))
    copyDiagBtn.bezelStyle = .rounded
    copyDiagBtn.controlSize = .small
    let btnRow = NSStackView(views: [resetBtn, copyDiagBtn])
    btnRow.orientation = .horizontal
    btnRow.spacing = 8
    stack.addArrangedSubview(btnRow)

    pageSettings.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: pageSettings.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: pageSettings.trailingAnchor),
      stack.topAnchor.constraint(equalTo: pageSettings.topAnchor),
    ])
  }

  private func setSegmentLabels(_ seg: NSSegmentedControl, _ labels: [String]) {
    for (i, label) in labels.enumerated() where i < seg.segmentCount {
      seg.setLabel(label, forSegment: i)
    }
  }

  func update(response: HudApiResponse?, prefs: HudPrefs) {
    self.latestResponse = response
    self.currentPrefs = prefs
    if isViewLoaded {
      syncUI()
    }
  }

  func selectTab(_ index: Int) {
    currentTab = max(0, min(2, index))
    if isViewLoaded {
      tabControl.selectedSegment = currentTab
      pageSession.isHidden = currentTab != 0
      pageHistory.isHidden = currentTab != 1
      pageSettings.isHidden = currentTab != 2
    }
    onTabChanged?(currentTab)
  }

  private func syncUI() {
    let resp = latestResponse
    let p = currentPrefs
    let convId = resp?.selectedConversationId ?? resp?.activeConversationId ?? ""
    let shortId = convId.isEmpty ? "—" : String(convId.prefix(8))
    let rawTitle = (resp?.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let fallback = convId.isEmpty ? p.t("Waiting for session", "等待会话") : "Session \(shortId)"
    let title = rawTitle.isEmpty ? fallback : HudFormatter.truncate(rawTitle, maxChars: 28)

    headerTitle.stringValue = title
    let running = resp?.isRunning == true
    statusDot.layer?.backgroundColor = (running ? NSColor.systemGreen : NSColor.tertiaryLabelColor).cgColor

    let model = (resp?.modelName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if model.isEmpty {
      modelPill.isHidden = true
    } else {
      modelPill.isHidden = false
      modelPill.stringValue = " \(HudFormatter.truncate(model, maxChars: 22)) "
    }

    let effLimit = HudFormatter.effectiveWindowLimit(prefs: p, response: resp)
    let effLimitLabel = HudFormatter.limitLabel(effLimit)
    let limitText = p.windowLimit == 0
      ? p.t("Auto (\(effLimitLabel))", "自动 (\(effLimitLabel))")
      : effLimitLabel
    let stateText = running ? p.t("Running", "运行中") : p.t("Idle", "空闲")
    let modeNote = p.pinnedConversationId == nil ? p.t("Auto-follow", "自动跟随") : p.t("Pinned", "已锁定会话")
    let winLabel = p.t("Window", "窗口")
    subHeaderLabel.stringValue = "ID \(shortId) · \(modeNote) · \(winLabel) \(limitText) · \(stateText)"

    setSegmentLabels(tabControl, p.isZh ? ["当前会话", "全局看板", "外观设置"] : ["Session", "History", "Settings"])
    copyBtn.title = p.t("Copy", "复制摘要")

    langTitleLabel.stringValue = p.t("Language", "界面语言")
    anchorTitleLabel.stringValue = p.t("Position", "挂载位置")
    styleTitleLabel.stringValue = p.t("Density", "胶囊密度")
    modeTitleLabel.stringValue = p.t("Display", "显示载体")
    limitTitleLabel.stringValue = p.t("Context Limit", "上下文上限")
    setSegmentLabels(langSeg, ["English", "中文"])
    setSegmentLabels(anchorSeg, p.isZh ? ["顶栏右上", "底部居中", "窗口右下"] : ["Top Right", "Bottom Center", "Bottom Right"])
    setSegmentLabels(styleSeg, p.isZh ? ["紧凑双徽章", "完整长条", "极简圆环"] : ["Compact", "Full Bar", "Minimal"])
    setSegmentLabels(modeSeg, p.isZh ? ["窗口+菜单栏", "仅窗口胶囊", "仅菜单栏"] : ["Window + Menu", "Window Only", "Menu Bar Only"])
    setSegmentLabels(limitSeg, [p.t("Auto", "自动"), "128K", "200K", "256K", "512K", "1M"])
    settingsHintLabel.stringValue = p.t(
      "Tip: Drag the capsule to fine-tune its offset. Changing Position resets drag offset. Auto matches Antigravity's compaction limit (default 256K).",
      "提示：按住悬浮胶囊可拖拽微调位置；自动模式默认按 Antigravity 256K 压缩上限实时校准。"
    )
    resetBtn.title = p.t("Reset Drag Offset", "重置拖拽偏移")
    copyDiagBtn.title = p.t("Copy Summary", "复制会话摘要")

    sessionCanvas.effectiveLimit = effLimit
    sessionCanvas.response = resp
    sessionCanvas.prefs = p
    historyCanvas.history = resp?.historySummary
    historyCanvas.prefs = p

    rebuildSessionPicker(resp: resp)

    if let idx = langValues.firstIndex(of: p.language) {
      langSeg.selectedSegment = idx
    }
    if let idx = anchorValues.firstIndex(of: p.anchorPosition) {
      anchorSeg.selectedSegment = idx
    }
    if let idx = styleValues.firstIndex(of: p.capsuleStyle) {
      styleSeg.selectedSegment = idx
    }
    if let idx = modeValues.firstIndex(of: p.displayMode) {
      modeSeg.selectedSegment = idx
    }
    if let idx = limitValues.firstIndex(of: p.windowLimit) {
      limitSeg.selectedSegment = idx
    } else {
      limitSeg.selectedSegment = -1
    }
  }

  private func rebuildSessionPicker(resp: HudApiResponse?) {
    sessionPicker.removeAllItems()
    let autoItem = NSMenuItem(title: currentPrefs.t("Follow Active Session", "自动跟随当前活跃会话"), action: nil, keyEquivalent: "")
    autoItem.representedObject = nil
    sessionPicker.menu?.addItem(autoItem)

    var selectedIdx = 0
    if let recent = resp?.recentSessions, !recent.isEmpty {
      sessionPicker.menu?.addItem(.separator())
      for s in recent.prefix(8) {
        let sShort = String(s.conversationId.prefix(8))
        let raw = (s.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let name = raw.isEmpty ? "Session \(sShort)" : HudFormatter.truncate(raw, maxChars: 22)
        let tok = HudFormatter.fmtCompactTokens(s.estimatedNextContextTokens ?? s.promptTokens ?? 0)
        let item = NSMenuItem(title: "\(name) · \(tok)", action: nil, keyEquivalent: "")
        item.representedObject = s.conversationId
        sessionPicker.menu?.addItem(item)
        if currentPrefs.pinnedConversationId == s.conversationId {
          selectedIdx = (sessionPicker.numberOfItems - 1)
        }
      }
    }
    sessionPicker.selectItem(at: selectedIdx)
  }

  @objc private func handleTabChange(_ sender: NSSegmentedControl) {
    selectTab(sender.selectedSegment)
  }

  @objc private func handleSessionPick(_ sender: NSPopUpButton) {
    let cid = sender.selectedItem?.representedObject as? String
    onSelectConversation?(cid)
  }

  @objc private func handleLangSeg(_ sender: NSSegmentedControl) {
    let idx = sender.selectedSegment
    guard idx >= 0, idx < langValues.count else { return }
    onChangeLanguage?(langValues[idx])
  }

  @objc private func handleAnchorSeg(_ sender: NSSegmentedControl) {
    let idx = sender.selectedSegment
    guard idx >= 0, idx < anchorValues.count else { return }
    onChangeAnchor?(anchorValues[idx])
  }

  @objc private func handleStyleSeg(_ sender: NSSegmentedControl) {
    let idx = sender.selectedSegment
    guard idx >= 0, idx < styleValues.count else { return }
    onChangeStyle?(styleValues[idx])
  }

  @objc private func handleModeSeg(_ sender: NSSegmentedControl) {
    let idx = sender.selectedSegment
    guard idx >= 0, idx < modeValues.count else { return }
    onChangeDisplayMode?(modeValues[idx])
  }

  @objc private func handleLimitSeg(_ sender: NSSegmentedControl) {
    let idx = sender.selectedSegment
    guard idx >= 0, idx < limitValues.count else { return }
    onChangeWindowLimit?(limitValues[idx])
  }

  @objc private func handleReset(_ sender: Any?) {
    onResetOffset?()
  }

  @objc private func handleCopy(_ sender: NSButton) {
    onCopyReport?()
    let prev = sender.title
    sender.title = currentPrefs.t("Copied", "已复制")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { [weak sender] in
      sender?.title = prev
    }
  }
}

// MARK: - Application Controller

final class HudController: NSObject, NSMenuDelegate, NSPopoverDelegate {
  private let apiUrlString: String
  private let prefsUrl: URL
  private let pidFileUrl: URL
  private let parentPid: pid_t
  private let hudToken: String = ProcessInfo.processInfo.environment["CONTEXT_MONITOR_HUD_TOKEN"] ?? ""

  private var prefs: HudPrefs
  private var lastPrefsMtime: Date?
  private var latestResponse: HudApiResponse?
  private var lastEtag: String = ""
  private var isFetching = false
  private var isMenuOpen = false
  private var isDragging = false
  private var dragStartMouse: NSPoint = .zero
  private var dragStartOffset: NSPoint = .zero
  private var lastWindowWidth: CGFloat = 1280

  private let panel: FloatingHudPanel
  private let capsuleView: CapsuleVisualEffectView
  private let activeDot: NSView
  private let ringView: RingView
  private let leftLabel: NSTextField
  private let dividerLine: NSView
  private let rightIcon: NSImageView
  private let rightLabel: NSTextField

  private var statusItem: NSStatusItem?
  private let contextMenu: NSMenu
  private let popover: NSPopover
  private let popoverVC: DashboardPopoverViewController

  private var pollTimer: Timer?
  private var windowTimer: Timer?
  private var parentTimer: Timer?
  private var nextPollAt: Date = .distantPast
  private let urlSession: URLSession

  private var sigTermSource: DispatchSourceSignal?
  private var sigIntSource: DispatchSourceSignal?

  init(apiUrlString: String, prefsUrl: URL, parentPid: pid_t) {
    self.apiUrlString = apiUrlString
    self.prefsUrl = prefsUrl
    self.pidFileUrl = prefsUrl.deletingLastPathComponent().appendingPathComponent("hud_bar.pid")
    self.parentPid = parentPid
    self.prefs = HudPrefs.load(from: prefsUrl)
    self.lastPrefsMtime = (try? FileManager.default.attributesOfItem(atPath: prefsUrl.path)[.modificationDate]) as? Date

    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 2.5
    config.timeoutIntervalForResource = 3.0
    self.urlSession = URLSession(configuration: config)

    self.panel = FloatingHudPanel(
      contentRect: NSRect(x: 0, y: 0, width: 210, height: 24),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.capsuleView = CapsuleVisualEffectView(frame: NSRect(x: 0, y: 0, width: 210, height: 24))
    self.activeDot = NSView()
    self.ringView = RingView()
    self.leftLabel = NSTextField(labelWithString: "0% · —")
    self.dividerLine = NSView()
    self.rightIcon = NSImageView()
    self.rightLabel = NSTextField(labelWithString: "0 tok")
    self.contextMenu = NSMenu()
    self.popover = NSPopover()
    self.popoverVC = DashboardPopoverViewController()

    super.init()

    contextMenu.delegate = self
    setupPanelUI()
    setupPopover()
    ensureSingleInstanceAndWritePid()
    setupSignalHandlers()
    syncMenuBarItemVisibility()
    renderMetrics()
    startObserversAndTimers()
    fetchMetricsNow()
  }

  private func setupPanelUI() {
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.ignoresMouseEvents = false
    panel.alphaValue = 0.90

    activeDot.wantsLayer = true
    activeDot.layer?.cornerRadius = 2.75
    activeDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
    activeDot.isHidden = true

    leftLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11.2, weight: .medium)
    leftLabel.textColor = .labelColor

    dividerLine.wantsLayer = true
    dividerLine.layer?.backgroundColor = NSColor.separatorColor.withAlphaComponent(0.45).cgColor

    rightIcon.image = NSImage(systemSymbolName: "cylinder.split.1x2", accessibilityDescription: "Tokens")?
      .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 10.5, weight: .regular))
    rightIcon.imageScaling = .scaleProportionallyDown
    rightIcon.contentTintColor = .secondaryLabelColor
    rightLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11.0, weight: .regular)
    rightLabel.textColor = .secondaryLabelColor

    for lbl in [leftLabel, rightLabel] {
      lbl.lineBreakMode = .byClipping
    }

    // Use deterministic frame layout instead of nested NSStackViews so shrinking leftLabel never stalls divider/rightLabel frames.
    for subview in [activeDot, ringView, leftLabel, dividerLine, rightIcon, rightLabel] {
      capsuleView.addSubview(subview)
    }

    capsuleView.autoresizingMask = [.width, .height]
    _ = layoutCapsuleSubviews()

    capsuleView.onHoverChanged = { [weak self] hovered in
      guard let self else { return }
      self.panel.animator().alphaValue = (hovered || self.popover.isShown) ? 1.0 : 0.90
    }
    capsuleView.onMouseDown = { [weak self] _ in
      guard let self else { return }
      self.dragStartMouse = NSEvent.mouseLocation
      self.dragStartOffset = NSPoint(x: self.prefs.offsetX, y: self.prefs.offsetY)
      self.isDragging = false
    }
    capsuleView.onMouseDragged = { [weak self] _ in
      guard let self else { return }
      let cur = NSEvent.mouseLocation
      let dx = cur.x - self.dragStartMouse.x
      let dy = cur.y - self.dragStartMouse.y
      if !self.isDragging && hypot(dx, dy) > 3.0 {
        self.isDragging = true
        if self.popover.isShown { self.popover.close() }
      }
      if self.isDragging {
        self.prefs.offsetX = Double(self.dragStartOffset.x + dx)
        self.prefs.offsetY = Double(self.dragStartOffset.y + dy)
        self.updateVisibilityAndPosition()
      }
    }
    capsuleView.onMouseUp = { [weak self] _ in
      guard let self else { return }
      if self.isDragging {
        self.isDragging = false
        self.savePrefs()
      } else {
        self.togglePopover(from: self.capsuleView)
      }
    }
    capsuleView.onRightMouseDown = { [weak self] _ in
      self?.openQuickMenuFromCapsule()
    }

    panel.contentView = capsuleView
  }

  @discardableResult
  static func layoutCapsuleRow(
    barHeight: CGFloat,
    activeDot: NSView,
    ringView: NSView,
    leftLabel: NSTextField,
    dividerLine: NSView,
    rightIcon: NSImageView,
    rightLabel: NSTextField
  ) -> CGFloat {
    var x: CGFloat = 10.0
    if !activeDot.isHidden {
      activeDot.frame = NSRect(x: x, y: round((barHeight - 5.5) / 2.0), width: 5.5, height: 5.5)
      x += 5.5 + 5.0
    }
    ringView.frame = NSRect(x: x, y: round((barHeight - 13.0) / 2.0), width: 13.0, height: 13.0)
    x += 13.0 + 5.0

    leftLabel.sizeToFit()
    let lw = ceil(leftLabel.frame.width)
    let lh = ceil(leftLabel.frame.height)
    leftLabel.frame = NSRect(x: x, y: round((barHeight - lh) / 2.0), width: lw, height: lh)
    x += lw

    if !dividerLine.isHidden {
      x += 8.0
      dividerLine.frame = NSRect(x: x, y: round((barHeight - 12.0) / 2.0), width: 1.0, height: 12.0)
      x += 1.0 + 8.0
    }
    if !rightIcon.isHidden {
      rightIcon.frame = NSRect(x: x, y: round((barHeight - 13.0) / 2.0), width: 13.0, height: 13.0)
      x += 13.0 + 4.0
    }
    if !rightLabel.isHidden {
      rightLabel.sizeToFit()
      let rw = ceil(rightLabel.frame.width)
      let rh = ceil(rightLabel.frame.height)
      rightLabel.frame = NSRect(x: x, y: round((barHeight - rh) / 2.0), width: rw, height: rh)
      x += rw
    }

    return max(92.0, ceil(x + 10.0))
  }

  @discardableResult
  private func layoutCapsuleSubviews() -> CGFloat {
    HudController.layoutCapsuleRow(
      barHeight: 24.0,
      activeDot: activeDot,
      ringView: ringView,
      leftLabel: leftLabel,
      dividerLine: dividerLine,
      rightIcon: rightIcon,
      rightLabel: rightLabel
    )
  }

  private func setupPopover() {
    popover.contentViewController = popoverVC
    popover.behavior = .transient
    popover.animates = true
    popover.delegate = self

    popoverVC.onSelectConversation = { [weak self] cid in
      guard let self else { return }
      self.prefs.pinnedConversationId = cid
      self.savePrefs()
      self.lastEtag = ""
      self.nextPollAt = .distantPast
      self.fetchMetricsNow()
    }
    popoverVC.onChangeAnchor = { [weak self] anchor in
      guard let self else { return }
      if self.prefs.anchorPosition != anchor {
        self.prefs.anchorPosition = anchor
        self.prefs.offsetX = 0
        self.prefs.offsetY = 0
        if self.prefs.displayMode == "menubar" {
          self.prefs.displayMode = "both"
          self.syncMenuBarItemVisibility()
        }
        self.savePrefs()
        self.renderMetrics()
      }
    }
    popoverVC.onChangeStyle = { [weak self] style in
      guard let self else { return }
      self.prefs.capsuleStyle = style
      self.savePrefs()
      self.renderMetrics()
    }
    popoverVC.onChangeDisplayMode = { [weak self] mode in
      guard let self else { return }
      self.prefs.displayMode = mode
      self.savePrefs()
      self.syncMenuBarItemVisibility()
      self.renderMetrics()
    }
    popoverVC.onChangeWindowLimit = { [weak self] limit in
      guard let self else { return }
      self.prefs.windowLimit = limit
      self.savePrefs()
      self.renderMetrics()
    }
    popoverVC.onChangeLanguage = { [weak self] lang in
      guard let self else { return }
      self.prefs.language = lang
      self.savePrefs()
      self.renderMetrics()
    }
    popoverVC.onResetOffset = { [weak self] in
      guard let self else { return }
      self.prefs.offsetX = 0
      self.prefs.offsetY = 0
      self.savePrefs()
      self.updateVisibilityAndPosition()
    }
    popoverVC.onCopyReport = { [weak self] in
      self?.copyFullReportText()
    }
  }

  private func togglePopover(from anchorView: NSView) {
    if popover.isShown {
      popover.close()
      return
    }
    nextPollAt = .distantPast
    fetchMetricsNow()
    popoverVC.update(response: latestResponse, prefs: prefs)

    let edge: NSRectEdge = (anchorView == statusItem?.button || prefs.anchorPosition == "topRight") ? .minY : .maxY
    capsuleView.isHighlighted = (anchorView == capsuleView)
    panel.alphaValue = 1.0
    popover.show(relativeTo: anchorView.bounds, of: anchorView, preferredEdge: edge)
  }

  @objc private func handleStatusItemClick(_ sender: NSStatusBarButton) {
    if let event = NSApp.currentEvent,
       event.type == .rightMouseUp || event.type == .rightMouseDown
    {
      if popover.isShown { popover.close() }
      rebuildQuickMenu(contextMenu)
      isMenuOpen = true
      contextMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
      isMenuOpen = false
      updateVisibilityAndPosition()
      return
    }
    togglePopover(from: sender)
  }

  private func openQuickMenuFromCapsule() {
    if popover.isShown { popover.close() }
    rebuildQuickMenu(contextMenu)
    isMenuOpen = true
    let anchor = NSPoint(x: 0, y: prefs.anchorPosition == "topRight" ? -6 : capsuleView.bounds.height + 6)
    contextMenu.popUp(positioning: nil, at: anchor, in: capsuleView)
    isMenuOpen = false
    updateVisibilityAndPosition()
  }

  func popoverWillShow(_ notification: Notification) {
    updateVisibilityAndPosition()
  }

  func popoverDidClose(_ notification: Notification) {
    capsuleView.isHighlighted = false
    panel.alphaValue = capsuleView.isHovered ? 1.0 : 0.90
    updateVisibilityAndPosition()
  }

  // MARK: - Lifecycle & Single Instance

  private func ensureSingleInstanceAndWritePid() {
    let dir = pidFileUrl.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    if let oldStr = try? String(contentsOf: pidFileUrl, encoding: .utf8),
       let oldPid = Int32(oldStr.trimmingCharacters(in: .whitespacesAndNewlines)),
       oldPid > 1,
       oldPid != getpid(),
       isHudBarProcess(pid: oldPid)
    {
      kill(oldPid, SIGTERM)
    }

    let myPid = "\(getpid())\n"
    try? myPid.write(to: pidFileUrl, atomically: true, encoding: .utf8)
  }

  private func isHudBarProcess(pid: pid_t) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/ps")
    proc.arguments = ["-p", "\(pid)", "-o", "comm="]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = FileHandle.nullDevice
    do {
      try proc.run()
      proc.waitUntilExit()
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      let out = String(data: data, encoding: .utf8) ?? ""
      return out.contains("hud_bar")
    } catch {
      return false
    }
  }

  private func cleanupAndExit() {
    if let curStr = try? String(contentsOf: pidFileUrl, encoding: .utf8),
       Int32(curStr.trimmingCharacters(in: .whitespacesAndNewlines)) == getpid()
    {
      try? FileManager.default.removeItem(at: pidFileUrl)
    }
    exit(0)
  }

  private func setupSignalHandlers() {
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)

    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    term.setEventHandler { [weak self] in self?.cleanupAndExit() }
    term.resume()
    self.sigTermSource = term

    let intr = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    intr.setEventHandler { [weak self] in self?.cleanupAndExit() }
    intr.resume()
    self.sigIntSource = intr
  }

  private func startObserversAndTimers() {
    let wsCenter = NSWorkspace.shared.notificationCenter
    wsCenter.addObserver(
      self,
      selector: #selector(handleWorkspaceChange),
      name: NSWorkspace.didActivateApplicationNotification,
      object: nil
    )
    wsCenter.addObserver(
      self,
      selector: #selector(handleWorkspaceChange),
      name: NSWorkspace.didDeactivateApplicationNotification,
      object: nil
    )

    windowTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      self?.updateVisibilityAndPosition()
    }
    if let windowTimer { RunLoop.main.add(windowTimer, forMode: .common) }

    pollTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.syncPrefsIfChangedExternally()
      if Date() >= self.nextPollAt {
        self.fetchMetricsNow()
      }
    }
    if let pollTimer { RunLoop.main.add(pollTimer, forMode: .common) }

    parentTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
      guard let self else { return }
      if self.parentPid > 0 {
        let alive = getppid() == self.parentPid && kill(self.parentPid, 0) == 0
        if !alive {
          self.cleanupAndExit()
        }
      }
    }
    if let parentTimer { RunLoop.main.add(parentTimer, forMode: .common) }
  }

  private func savePrefs() {
    prefs.save(to: prefsUrl)
    lastPrefsMtime = (try? FileManager.default.attributesOfItem(atPath: prefsUrl.path)[.modificationDate]) as? Date
    popoverVC.update(response: latestResponse, prefs: prefs)
  }

  private func syncPrefsIfChangedExternally() {
    if isDragging { return }
    let mtime = (try? FileManager.default.attributesOfItem(atPath: prefsUrl.path)[.modificationDate]) as? Date
    guard mtime != lastPrefsMtime else { return }
    lastPrefsMtime = mtime
    let updated = HudPrefs.load(from: prefsUrl)
    if updated == prefs { return }
    let convChanged = updated.pinnedConversationId != prefs.pinnedConversationId
    let modeChanged = updated.displayMode != prefs.displayMode
    prefs = updated
    if modeChanged {
      syncMenuBarItemVisibility()
    }
    renderMetrics()
    if convChanged {
      lastEtag = ""
      nextPollAt = .distantPast
      fetchMetricsNow()
    }
  }

  @objc private func handleWorkspaceChange(_ note: Notification) {
    syncPrefsIfChangedExternally()
    updateVisibilityAndPosition()
    if isAntigravityFrontmostNow() {
      nextPollAt = .distantPast
      fetchMetricsNow()
    }
  }

  // MARK: - Window Tracking

  private func isAntigravityFrontmostNow() -> Bool {
    guard let front = NSWorkspace.shared.frontmostApplication else { return false }
    if front.bundleIdentifier?.hasPrefix("com.google.antigravity") == true || front.localizedName == "Antigravity" {
      return true
    }
    if front.processIdentifier == getpid() {
      return true
    }
    return false
  }

  private func findAntigravityWindowRect() -> NSRect? {
    if !isAntigravityFrontmostNow() && !isMenuOpen && !popover.isShown && !isDragging {
      return nil
    }
    guard let winList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
      return nil
    }
    let primaryH = NSScreen.screens.first(where: { $0.frame.origin == .zero })?.frame.height
      ?? NSScreen.screens.first?.frame.height
      ?? 900.0

    for w in winList {
      let owner = w[kCGWindowOwnerName as String] as? String ?? ""
      if owner != "Antigravity" { continue }
      let layer = w[kCGWindowLayer as String] as? Int ?? -1
      if layer != 0 { continue }
      guard let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
            let cgRect = CGRect(dictionaryRepresentation: boundsDict),
            cgRect.width >= 560,
            cgRect.height >= 400
      else { continue }
      return HudFormatter.cgToAppKitRect(cgRect, primaryScreenHeight: primaryH)
    }
    return nil
  }

  private func effectiveStyle(forWindowWidth width: CGFloat) -> String {
    if width < 720 && prefs.capsuleStyle != "minimal" {
      return "minimal"
    }
    return prefs.capsuleStyle
  }

  private func updateVisibilityAndPosition() {
    if prefs.displayMode == "menubar" {
      if panel.isVisible { panel.orderOut(nil) }
      return
    }

    guard let winRect = findAntigravityWindowRect() else {
      if panel.isVisible { panel.orderOut(nil) }
      return
    }

    if abs(winRect.width - lastWindowWidth) > 20 {
      lastWindowWidth = winRect.width
      renderCapsuleLabelsOnly()
    } else {
      lastWindowWidth = winRect.width
    }

    let naturalW = layoutCapsuleSubviews()
    let barW = min(naturalW, max(120.0, winRect.width - 24.0))
    let barH: CGFloat = 24.0

    let basePt = HudFormatter.anchorBasePoint(
      winRect: winRect,
      barSize: NSSize(width: barW, height: barH),
      anchorPosition: prefs.anchorPosition
    )
    let rawX = basePt.x + CGFloat(prefs.offsetX)
    let rawY = basePt.y + CGFloat(prefs.offsetY)

    let safeBounds = winRect.insetBy(dx: 8.0, dy: 4.0)
    let maxX = max(safeBounds.minX, safeBounds.maxX - barW)
    let maxY = max(safeBounds.minY, safeBounds.maxY - barH)
    let clampedX = min(maxX, max(safeBounds.minX, rawX))
    let clampedY = min(maxY, max(safeBounds.minY, rawY))

    let targetFrame = NSRect(x: round(clampedX), y: round(clampedY), width: barW, height: barH)
    if panel.frame != targetFrame {
      panel.setFrame(targetFrame, display: true)
    }
    capsuleView.frame = NSRect(x: 0, y: 0, width: barW, height: barH)
    capsuleView.needsDisplay = true
    if !panel.isVisible {
      panel.orderFrontRegardless()
    }
  }

  // MARK: - Polling

  private func fetchMetricsNow() {
    if isFetching { return }
    guard var components = URLComponents(string: apiUrlString) else { return }
    var items: [URLQueryItem] = []
    if !hudToken.isEmpty {
      items.append(URLQueryItem(name: "hudToken", value: hudToken))
    }
    if !lastEtag.isEmpty {
      items.append(URLQueryItem(name: "etag", value: lastEtag))
    }
    if let pinned = prefs.pinnedConversationId, !pinned.isEmpty {
      items.append(URLQueryItem(name: "conversationId", value: pinned))
    }
    components.queryItems = items.isEmpty ? nil : items
    guard let url = components.url else { return }

    isFetching = true
    let interval = (isAntigravityFrontmostNow() || popover.isShown || isMenuOpen) ? 1.2 : 3.5
    nextPollAt = Date().addingTimeInterval(interval)

    var req = URLRequest(url: url)
    req.cachePolicy = .reloadIgnoringLocalCacheData

    urlSession.dataTask(with: req) { [weak self] data, _, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.isFetching = false
        guard let data,
              let decoded = try? JSONDecoder().decode(HudApiResponse.self, from: data)
        else {
          return
        }
        if let etag = decoded.etag {
          self.lastEtag = etag
        }
        if decoded.unchanged == true {
          return
        }
        self.latestResponse = decoded
        self.renderMetrics()
      }
    }.resume()
  }

  // MARK: - Rendering

  private func currentMetricsNumbers() -> (
    hasData: Bool,
    isRunning: Bool,
    turns: Int,
    steps: Int,
    avgTokPerSec: Int?,
    lastTokPerSec: Int?,
    avgTtftMs: Int?,
    lastTtftMs: Int?,
    allTokens: Double,
    cacheHitRate: Double,
    ratio: Double,
    pctInt: Int,
    usedTokens: Double,
    effectiveLimit: Int
  ) {
    let effLimit = HudFormatter.effectiveWindowLimit(prefs: prefs, response: latestResponse)
    guard let resp = latestResponse, resp.hasData == true, let s = resp.summary else {
      return (false, false, 0, 0, nil, nil, nil, nil, 0, 0, 0, 0, 0, effLimit)
    }
    let limit = Double(max(1, effLimit))
    let used = s.estimatedNextContextTokens
    let ratio = used / limit
    return (
      true,
      resp.isRunning == true,
      s.userTurns,
      s.stepsCount,
      s.avgTokPerSec,
      s.lastTokPerSec,
      s.avgTtftMs,
      s.lastTtftMs,
      s.allTokens,
      s.overallCacheHitRate,
      ratio,
      HudFormatter.fmtIntPct(ratio),
      used,
      effLimit
    )
  }

  private func speedSuffix(avg: Int?, last: Int?, compact: Bool) -> String {
    if let a = avg, let l = last {
      if a == l { return " · \(a) tok/s" }
      if compact {
        return prefs.t(" · \(l) tok/s (avg \(a))", " · \(l) tok/s (均 \(a))")
      }
      return prefs.t(" · Avg \(a)/Last \(l) tok/s", " · 均 \(a)/末 \(l) tok/s")
    }
    if let single = last ?? avg {
      return " · \(single) tok/s"
    }
    return ""
  }

  private func renderCapsuleLabelsOnly() {
    let m = currentMetricsNumbers()
    let ratioColor = PopoverTheme.ratioColor(m.ratio)
    let style = effectiveStyle(forWindowWidth: lastWindowWidth)

    if !m.hasData {
      activeDot.isHidden = true
      ringView.ratio = 0
      ringView.ringColor = .secondaryLabelColor
      leftLabel.stringValue = style == "minimal" ? "—" : prefs.t("Waiting…", "等待会话…")
      leftLabel.textColor = .secondaryLabelColor
      dividerLine.isHidden = (style == "minimal")
      rightIcon.isHidden = (style == "minimal")
      rightLabel.isHidden = (style == "minimal")
      rightLabel.stringValue = "0 tok"
      capsuleView.toolTip = prefs.t(
        "Waiting for active session telemetry · Click for details",
        "等待当前会话数据 · 点击展开详情"
      )
      _ = layoutCapsuleSubviews()
      return
    }

    let limitStr = HudFormatter.limitLabel(m.effectiveLimit)
    let usedStr = HudFormatter.fmtShortTokens(m.usedTokens)
    let totalShort = HudFormatter.fmtShortTokens(m.allTokens)
    let cacheInt = HudFormatter.fmtIntPct(m.cacheHitRate)

    activeDot.isHidden = !m.isRunning
    ringView.ratio = m.ratio
    ringView.ringColor = ratioColor

    switch style {
    case "minimal":
      leftLabel.stringValue = "\(m.pctInt)% · \(usedStr)/\(limitStr)"
      leftLabel.textColor = m.ratio >= 0.70 ? ratioColor : .labelColor
      dividerLine.isHidden = true
      rightIcon.isHidden = true
      rightLabel.isHidden = true
    case "full":
      let speedPart = speedSuffix(avg: m.avgTokPerSec, last: m.lastTokPerSec, compact: false)
      leftLabel.stringValue = prefs.t(
        "\(m.pctInt)% (\(usedStr)/\(limitStr)) · \(m.turns) turns \(m.steps) steps\(speedPart)",
        "\(m.pctInt)% (\(usedStr)/\(limitStr)) · \(m.turns) 轮 \(m.steps) 步\(speedPart)"
      )
      leftLabel.textColor = m.ratio >= 0.70 ? ratioColor : .labelColor
      dividerLine.isHidden = false
      rightIcon.isHidden = false
      rightLabel.isHidden = false
      let costPart = latestResponse?.summary?.cost.map { " · \(HudFormatter.fmtUsd($0.totalCostUsd))" } ?? ""
      rightLabel.stringValue = prefs.t(
        "\(HudFormatter.fmtTokens(m.allTokens)) tok · Cache \(HudFormatter.fmtPct(m.cacheHitRate))\(costPart)",
        "\(HudFormatter.fmtTokens(m.allTokens)) tok · 缓存 \(HudFormatter.fmtPct(m.cacheHitRate))\(costPart)"
      )
    default: // "compact" two-badge pill (Option A)
      let speedPart = m.isRunning ? speedSuffix(avg: m.avgTokPerSec, last: m.lastTokPerSec, compact: true) : ""
      leftLabel.stringValue = "\(m.pctInt)% (\(usedStr)/\(limitStr))\(speedPart)"
      leftLabel.textColor = m.ratio >= 0.70 ? ratioColor : .labelColor
      dividerLine.isHidden = false
      rightIcon.isHidden = false
      rightLabel.isHidden = false
      rightLabel.stringValue = prefs.t(
        "\(totalShort) tok · Cache \(cacheInt)%",
        "\(totalShort) tok · 缓存 \(cacheInt)%"
      )
    }

    var tipParts: [String] = [
      prefs.t(
        "Context: \(HudFormatter.fmtTokens(m.usedTokens)) / \(limitStr) (\(HudFormatter.fmtPct(m.ratio)))",
        "上下文: \(HudFormatter.fmtTokens(m.usedTokens)) / \(limitStr) (\(HudFormatter.fmtPct(m.ratio)))"
      ),
      prefs.t(
        "Session Total: \(HudFormatter.fmtTokens(m.allTokens)) tok · Cache Hit \(HudFormatter.fmtPct(m.cacheHitRate))",
        "会话累计: \(HudFormatter.fmtTokens(m.allTokens)) tok · 缓存命中 \(HudFormatter.fmtPct(m.cacheHitRate))"
      ),
    ]
    if let cost = latestResponse?.summary?.cost {
      tipParts.append(
        prefs.t(
          "Est. Cost: \(HudFormatter.fmtUsd(cost.totalCostUsd)) (≈ \(HudFormatter.fmtCny(cost.totalCostCny)))",
          "参考费用: \(HudFormatter.fmtUsd(cost.totalCostUsd)) (≈ \(HudFormatter.fmtCny(cost.totalCostCny)))"
        )
      )
    }
    if let avg = m.avgTokPerSec, let last = m.lastTokPerSec {
      tipParts.append(
        prefs.t(
          "Speed (end-to-end): Avg \(avg) · Last \(last) tok/s",
          "生成速率 (含思考): 平均 \(avg) · 末步 \(last) tok/s"
        )
      )
    } else if let single = m.lastTokPerSec ?? m.avgTokPerSec {
      tipParts.append(prefs.t("Speed (end-to-end): \(single) tok/s", "生成速率 (含思考): \(single) tok/s"))
    }
    if m.avgTtftMs != nil || m.lastTtftMs != nil {
      let ttftTip = HudFormatter.formatTtftSummary(avgMs: m.avgTtftMs, lastMs: m.lastTtftMs, prefs: prefs)
      tipParts.append(prefs.t("First Token (TTFT): \(ttftTip.sub)", "首字延迟 (TTFT): \(ttftTip.sub)"))
    }
    tipParts.append(prefs.t("Click for details · Right-click for quick settings", "左键展开详情 · 右键快速设置"))
    capsuleView.toolTip = tipParts.joined(separator: "\n")
    _ = layoutCapsuleSubviews()
  }

  private func renderMetrics() {
    renderCapsuleLabelsOnly()

    let m = currentMetricsNumbers()
    if let item = statusItem, let btn = item.button {
      btn.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
      if m.hasData {
        btn.title = "\(m.isRunning ? "●" : "◔") \(m.pctInt)%"
      } else {
        btn.title = "◔ —"
      }
      var statusTip = prefs.t(
        "Click to open Context & Usage dashboard (Right-click for quick menu)",
        "点击打开 Context & Usage 面板 (右键快速切换)"
      )
      if m.avgTtftMs != nil || m.lastTtftMs != nil {
        let ttftTip = HudFormatter.formatTtftSummary(avgMs: m.avgTtftMs, lastMs: m.lastTtftMs, prefs: prefs)
        statusTip = prefs.t("TTFT: \(ttftTip.sub)\n", "首字: \(ttftTip.sub)\n") + statusTip
      }
      if let avg = m.avgTokPerSec, let last = m.lastTokPerSec {
        statusTip = prefs.t("Speed: Avg \(avg) · Last \(last) tok/s\n", "速率: 平均 \(avg) · 末步 \(last) tok/s\n") + statusTip
      }
      btn.toolTip = statusTip
    }

    popoverVC.update(response: latestResponse, prefs: prefs)
    updateVisibilityAndPosition()
  }

  // MARK: - Menu Bar & Quick Right-Click Menu

  private func syncMenuBarItemVisibility() {
    let wantsMenuBar = prefs.displayMode == "both" || prefs.displayMode == "menubar"
    if wantsMenuBar {
      if statusItem == nil {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = "context-monitor-hud"
        if let btn = item.button {
          btn.target = self
          btn.action = #selector(handleStatusItemClick(_:))
          btn.sendAction(on: [.leftMouseUp, .rightMouseDown])
        }
        statusItem = item
      }
    } else if let item = statusItem {
      NSStatusBar.system.removeStatusItem(item)
      statusItem = nil
    }
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    rebuildQuickMenu(menu)
  }

  func menuWillOpen(_ menu: NSMenu) {
    isMenuOpen = true
    nextPollAt = .distantPast
    fetchMetricsNow()
  }

  func menuDidClose(_ menu: NSMenu) {
    isMenuOpen = false
    updateVisibilityAndPosition()
  }

  private func rebuildQuickMenu(_ menu: NSMenu) {
    menu.removeAllItems()
    let p = prefs

    let openPopItem = NSMenuItem(
      title: p.t("Open Dashboard (Popover)", "打开统计面板 (Popover)"),
      action: #selector(openPopoverMenuAction),
      keyEquivalent: ""
    )
    openPopItem.target = self
    menu.addItem(openPopItem)
    menu.addItem(.separator())

    // Anchor Presets
    let anchorMenu = NSMenu()
    for (title, key) in [
      (p.t("Top Right Titlebar (Default)", "顶栏右上角 (默认推荐)"), "topRight"),
      (p.t("Bottom Center (DeepSeek Style)", "窗口底部居中 (DeepSeek 风格)"), "bottomCenter"),
      (p.t("Bottom Right", "窗口右下角"), "bottomRight"),
    ] {
      let item = NSMenuItem(title: title, action: #selector(selectAnchorAction(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = key
      item.state = prefs.anchorPosition == key ? .on : .off
      anchorMenu.addItem(item)
    }
    let anchorParent = NSMenuItem(title: p.t("Position", "挂载位置"), action: nil, keyEquivalent: "")
    anchorParent.submenu = anchorMenu
    menu.addItem(anchorParent)

    // Style Presets
    let styleMenu = NSMenu()
    for (title, key) in [
      (p.t("Compact Dual-Badge (Default)", "紧凑双徽章 (推荐)"), "compact"),
      (p.t("Full Bar (DeepSeek Style)", "完整三段式 (DeepSeek)"), "full"),
      (p.t("Minimal Ring", "极简圆环"), "minimal"),
    ] {
      let item = NSMenuItem(title: title, action: #selector(selectStyleAction(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = key
      item.state = prefs.capsuleStyle == key ? .on : .off
      styleMenu.addItem(item)
    }
    let styleParent = NSMenuItem(title: p.t("Density", "胶囊密度"), action: nil, keyEquivalent: "")
    styleParent.submenu = styleMenu
    menu.addItem(styleParent)

    // Window Limit Presets
    let effLimit = HudFormatter.effectiveWindowLimit(prefs: prefs, response: latestResponse)
    let effLimitLabel = HudFormatter.limitLabel(effLimit)
    let limitMenu = NSMenu()
    let autoItem = NSMenuItem(
      title: p.t("Auto (\(effLimitLabel))", "自动 (\(effLimitLabel))"),
      action: #selector(selectWindowLimit(_:)),
      keyEquivalent: ""
    )
    autoItem.target = self
    autoItem.tag = 0
    autoItem.state = prefs.windowLimit == 0 ? .on : .off
    limitMenu.addItem(autoItem)
    limitMenu.addItem(.separator())
    for (title, val) in [("128K", 128_000), ("200K", 200_000), ("256K", 256_000), ("512K", 512_000), ("1M", 1_000_000), ("2M", 2_000_000)] {
      let item = NSMenuItem(title: title, action: #selector(selectWindowLimit(_:)), keyEquivalent: "")
      item.target = self
      item.tag = val
      item.state = prefs.windowLimit == val ? .on : .off
      limitMenu.addItem(item)
    }
    let limitSummary = prefs.windowLimit == 0 ? p.t("Auto · \(effLimitLabel)", "自动 · \(effLimitLabel)") : effLimitLabel
    let limitParent = NSMenuItem(
      title: p.t("Context Limit (\(limitSummary))", "窗口上限 (\(limitSummary))"),
      action: nil,
      keyEquivalent: ""
    )
    limitParent.submenu = limitMenu
    menu.addItem(limitParent)

    // Language Switcher
    let langMenu = NSMenu()
    for (title, key) in [("English (Default)", "en"), ("中文", "zh")] {
      let item = NSMenuItem(title: title, action: #selector(selectLanguageAction(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = key
      item.state = prefs.language == key ? .on : .off
      langMenu.addItem(item)
    }
    let langParent = NSMenuItem(title: "Language / 语言", action: nil, keyEquivalent: "")
    langParent.submenu = langMenu
    menu.addItem(langParent)

    menu.addItem(.separator())

    let resetItem = NSMenuItem(title: p.t("Reset Drag Offset", "重置拖拽偏移"), action: #selector(resetPosition), keyEquivalent: "")
    resetItem.target = self
    menu.addItem(resetItem)

    let hideMode = prefs.displayMode == "menubar" ? "both" : "menubar"
    let hideTitle = prefs.displayMode == "menubar"
      ? p.t("Show Floating Capsule", "恢复窗口悬浮胶囊")
      : p.t("Hide Capsule (Menu Bar Only)", "隐藏悬浮胶囊 (仅系统菜单栏)")
    let hideItem = NSMenuItem(title: hideTitle, action: #selector(selectDisplayMode(_:)), keyEquivalent: "")
    hideItem.target = self
    hideItem.representedObject = hideMode
    menu.addItem(hideItem)

    let copyItem = NSMenuItem(title: p.t("Copy Session Summary", "复制当前会话统计摘要"), action: #selector(copySummaryAction), keyEquivalent: "")
    copyItem.target = self
    menu.addItem(copyItem)
  }

  @objc private func selectLanguageAction(_ sender: NSMenuItem) {
    guard let lang = sender.representedObject as? String else { return }
    prefs.language = lang
    savePrefs()
    renderMetrics()
  }

  @objc private func openPopoverMenuAction() {
    if prefs.displayMode != "menubar", panel.isVisible {
      togglePopover(from: capsuleView)
    } else if let btn = statusItem?.button {
      togglePopover(from: btn)
    }
  }

  @objc private func selectAnchorAction(_ sender: NSMenuItem) {
    guard let key = sender.representedObject as? String else { return }
    prefs.anchorPosition = key
    prefs.offsetX = 0
    prefs.offsetY = 0
    if prefs.displayMode == "menubar" {
      prefs.displayMode = "both"
      syncMenuBarItemVisibility()
    }
    savePrefs()
    renderMetrics()
  }

  @objc private func selectStyleAction(_ sender: NSMenuItem) {
    guard let key = sender.representedObject as? String else { return }
    prefs.capsuleStyle = key
    savePrefs()
    renderMetrics()
  }

  @objc private func selectWindowLimit(_ sender: NSMenuItem) {
    prefs.windowLimit = sender.tag
    savePrefs()
    renderMetrics()
  }

  @objc private func selectDisplayMode(_ sender: NSMenuItem) {
    guard let mode = sender.representedObject as? String else { return }
    prefs.displayMode = mode
    savePrefs()
    syncMenuBarItemVisibility()
    renderMetrics()
  }

  @objc private func resetPosition() {
    prefs.offsetX = 0
    prefs.offsetY = 0
    savePrefs()
    updateVisibilityAndPosition()
  }

  @objc private func copySummaryAction() {
    copyFullReportText()
  }

  private func copyFullReportText() {
    let m = currentMetricsNumbers()
    let resp = latestResponse
    let s = resp?.summary
    let hist = resp?.historySummary
    var lines: [String] = []
    if m.hasData, let s {
      let title = (resp?.title ?? "").isEmpty ? (resp?.selectedConversationId ?? "-") : resp!.title!
      lines.append(prefs.t("Session: \(title)", "会话: \(title)"))
      lines.append("Context: \(HudFormatter.fmtTokens(s.estimatedNextContextTokens)) / \(HudFormatter.limitLabel(m.effectiveLimit)) (\(HudFormatter.fmtPct(m.ratio)))")
      lines.append(prefs.t(
        "Session Total: \(HudFormatter.fmtTokens(s.allTokens)) tok · Cache Hit \(HudFormatter.fmtPct(s.overallCacheHitRate))",
        "累计消耗: \(HudFormatter.fmtTokens(s.allTokens)) tok · Cache 命中 \(HudFormatter.fmtPct(s.overallCacheHitRate))"
      ))
      if let avg = s.avgTokPerSec, let last = s.lastTokPerSec {
        lines.append(prefs.t(
          "Speed (end-to-end): Avg \(avg) · Last \(last) tok/s",
          "生成速率 (含思考): 平均 \(avg) · 末步 \(last) tok/s"
        ))
      } else if let single = s.lastTokPerSec ?? s.avgTokPerSec {
        lines.append(prefs.t("Speed (end-to-end): \(single) tok/s", "生成速率 (含思考): \(single) tok/s"))
      }
      if s.avgTtftMs != nil || s.lastTtftMs != nil {
        let ttftPair = HudFormatter.formatTtftSummary(avgMs: s.avgTtftMs, lastMs: s.lastTtftMs, prefs: prefs)
        lines.append(prefs.t("First Token (TTFT): \(ttftPair.sub)", "首字延迟 (TTFT): \(ttftPair.sub)"))
      }
      if let cost = s.cost {
        lines.append(prefs.t(
          "Est. Cost: \(HudFormatter.fmtUsd(cost.totalCostUsd)) (≈ \(HudFormatter.fmtCny(cost.totalCostCny))) · Saved \(HudFormatter.fmtUsd(cost.savedByCacheUsd))",
          "参考费用: \(HudFormatter.fmtUsd(cost.totalCostUsd)) (≈ \(HudFormatter.fmtCny(cost.totalCostCny))) · Cache 省 \(HudFormatter.fmtUsd(cost.savedByCacheUsd))"
        ))
      }
      if let hist {
        lines.append(prefs.t(
          "Today (All): \(HudFormatter.fmtTokens(hist.today.allTokens)) tok (\(HudFormatter.fmtUsd(hist.today.totalCostUsd))) · All Time \(HudFormatter.fmtTokens(hist.allTime.allTokens)) tok",
          "今日全局: \(HudFormatter.fmtTokens(hist.today.allTokens)) tok (\(HudFormatter.fmtUsd(hist.today.totalCostUsd))) · 全量累计 \(HudFormatter.fmtTokens(hist.allTime.allTokens)) tok"
        ))
      }
    } else {
      lines.append(prefs.t("Antigravity Context Monitor: Waiting for session data", "Antigravity Context Monitor: 等待会话数据"))
    }
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(lines.joined(separator: "\n"), forType: .string)
  }
}

// MARK: - Self-Test & Main Entrypoint

func runSelfTest() -> Int32 {
  precondition(HudFormatter.fmtTokens(31_900_000) == "31.90M", "fmtTokens M failed")
  precondition(HudFormatter.fmtTokens(72_592) == "72.6K", "fmtTokens 10k+ failed")
  precondition(HudFormatter.fmtCompactTokens(184_100) == "184K", "fmtCompactTokens failed")
  precondition(HudFormatter.fmtShortTokens(29_713_654) == "29.7M", "fmtShortTokens M failed")
  precondition(HudFormatter.fmtShortTokens(54_277) == "54K", "fmtShortTokens K failed")
  precondition(HudFormatter.fmtUsd(12.345) == "$12.35", "fmtUsd failed")
  precondition(HudFormatter.fmtPct(0.995) == "99.5%", "fmtPct failed")
  precondition(HudFormatter.fmtIntPct(0.184) == 18, "fmtIntPct failed")
  precondition(HudFormatter.limitLabel(256_000) == "256K" && HudFormatter.limitLabel(0) == "Auto", "limitLabel failed")
  precondition(HudFormatter.snapObservedCompactionLimit(255_194) == 256_000, "snapObservedCompactionLimit failed")
  precondition(HudFormatter.inferModelCompactionLimit("gemini-2.5-pro") == 128_000, "inferModelCompactionLimit 2.5 failed")
  precondition(HudFormatter.inferModelCompactionLimit("gpt-oss-120b-medium") == 80_000, "inferModelCompactionLimit oss failed")

  let converted = HudFormatter.cgToAppKitRect(
    CGRect(x: 1440, y: -150, width: 2048, height: 1152),
    primaryScreenHeight: 900
  )
  precondition(
    converted.origin.x == 1440 && converted.origin.y == -102 && converted.size.width == 2048 && converted.size.height == 1152,
    "cgToAppKitRect mismatch: \(converted)"
  )

  let topRightPt = HudFormatter.anchorBasePoint(
    winRect: converted,
    barSize: NSSize(width: 200, height: 24),
    anchorPosition: "topRight"
  )
  precondition(
    topRightPt.x == 3140 && topRightPt.y == 1019,
    "topRight anchor mismatch: \(topRightPt)"
  )

  // Heatmap column alignment sanity check
  precondition(HistoryCanvasView.heatmapGridColumn(daysAgo: 0, lastWeekday: 6) == 12, "today grid col failed")
  precondition(HistoryCanvasView.heatmapGridColumn(daysAgo: 6, lastWeekday: 6) == 11, "prev sun grid col failed")
  precondition(HistoryCanvasView.heatmapGridColumn(daysAgo: 5, lastWeekday: 6) == 12, "this week mon grid col failed")

  // History footer text fits within the 368pt canvas width without truncation
  let footerFont = NSFont.systemFont(ofSize: 9.2, weight: .regular)
  let enFooterW = (HistoryCanvasView.pricingDisclaimerEn as NSString).size(withAttributes: [.font: footerFont]).width
  let zhFooterW = (HistoryCanvasView.pricingDisclaimerZh as NSString).size(withAttributes: [.font: footerFont]).width
  precondition(
    enFooterW < 356.0 && zhFooterW < 356.0,
    "History footer exceeds popover width: en=\(enFooterW), zh=\(zhFooterW)"
  )

  let speedSubFont = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular)
  let enSpeedSubW = ("Avg 999 · Last 999 tok/s" as NSString).size(withAttributes: [.font: speedSubFont]).width
  let zhSpeedSubW = ("平均 999 · 末步 999 tok/s" as NSString).size(withAttributes: [.font: speedSubFont]).width
  precondition(
    enSpeedSubW < 158.0 && zhSpeedSubW < 158.0,
    "Speed card subtitle exceeds 160pt card inner width: en=\(enSpeedSubW), zh=\(zhSpeedSubW)"
  )

  // Deterministic capsule frame layout across running -> idle transition (no stale stackView gap or clipping)
  let tDot = NSView()
  let tRing = RingView()
  let tLeft = NSTextField(labelWithString: "12% (119K/1M) · 68 tok/s")
  tLeft.font = NSFont.monospacedDigitSystemFont(ofSize: 11.2, weight: .medium)
  let tDiv = NSView()
  let tIcon = NSImageView()
  let tRight = NSTextField(labelWithString: "55.8M tok · Cache 83%")
  tRight.font = NSFont.monospacedDigitSystemFont(ofSize: 11.0, weight: .regular)
  _ = HudController.layoutCapsuleRow(
    barHeight: 24.0,
    activeDot: tDot,
    ringView: tRing,
    leftLabel: tLeft,
    dividerLine: tDiv,
    rightIcon: tIcon,
    rightLabel: tRight
  )
  tDot.isHidden = true
  tLeft.stringValue = "12% (119K/1M)"
  let idleWidth = HudController.layoutCapsuleRow(
    barHeight: 24.0,
    activeDot: tDot,
    ringView: tRing,
    leftLabel: tLeft,
    dividerLine: tDiv,
    rightIcon: tIcon,
    rightLabel: tRight
  )
  precondition(
    tDiv.frame.minX == tLeft.frame.maxX + 8.0 && idleWidth == tRight.frame.maxX + 10.0,
    "Capsule layout transition mismatch: idleWidth=\(idleWidth), leftMaxX=\(tLeft.frame.maxX), divMinX=\(tDiv.frame.minX), rightMaxX=\(tRight.frame.maxX)"
  )

  let sampleJson = """
  {
    "unchanged": false,
    "etag": "e1",
    "activeConversationId": "00000000-0000-4000-8000-000000000001",
    "selectedConversationId": "00000000-0000-4000-8000-000000000001",
    "title": "Sample Session",
    "modelName": "gemini-2.5-pro",
    "found": true,
    "hasData": true,
    "isRunning": false,
    "summary": {
      "userTurns": 7,
      "stepsCount": 256,
      "modelCalls": 80,
      "toolCalls": 160,
      "checkpoints": 1,
      "allTokens": 31900000,
      "promptTokens": 31700000,
      "inputTokens": 300000,
      "cacheReadTokens": 31400000,
      "outputTokens": 200000,
      "overallCacheHitRate": 0.995,
      "avgTokPerSec": 207,
      "lastTokPerSec": 190,
      "avgTtftMs": 2250,
      "lastTtftMs": 3400,
      "ttftSampleCount": 12,
      "currentPromptTokens": 179000,
      "estimatedNextContextTokens": 180000,
      "initialBaselineTokens": 15000,
      "growthTokens": 164000,
      "currentCacheHitRate": 0.99,
      "cost": {
        "totalCostUsd": 8.88,
        "savedByCacheUsd": 56.52,
        "totalCostCny": 64.38
      }
    },
    "recentSessions": [],
    "historySummary": {
      "todayKey": "2026-11-14",
      "today": { "allTokens": 1000, "inputTokens": 500, "cacheReadTokens": 400, "outputTokens": 100, "cacheHitRate": 0.44, "steps": 2, "sessions": 1, "totalCostUsd": 0.01, "totalCostCny": 0.07, "savedByCacheUsd": 0.0 },
      "last7Days": { "allTokens": 5000, "inputTokens": 2000, "cacheReadTokens": 2500, "outputTokens": 500, "cacheHitRate": 0.55, "steps": 10, "sessions": 2, "totalCostUsd": 0.05, "totalCostCny": 0.36, "savedByCacheUsd": 0.01 },
      "thisMonth": { "allTokens": 10000, "inputTokens": 4000, "cacheReadTokens": 5000, "outputTokens": 1000, "cacheHitRate": 0.55, "steps": 20, "sessions": 3, "totalCostUsd": 0.10, "totalCostCny": 0.72, "savedByCacheUsd": 0.02 },
      "allTime": { "allTokens": 20000, "inputTokens": 8000, "cacheReadTokens": 10000, "outputTokens": 2000, "cacheHitRate": 0.55, "steps": 40, "sessions": 5, "totalCostUsd": 0.20, "totalCostCny": 1.45, "savedByCacheUsd": 0.04 },
      "bySource": {
        "desktop": { "sessions": 4, "allTokens": 18000, "totalCostUsd": 0.18 },
        "cli": { "sessions": 1, "allTokens": 2000, "totalCostUsd": 0.02 }
      },
      "heatmap": [
        { "date": "2026-11-14", "weekday": 6, "allTokens": 1000, "level": 2, "costUsd": 0.01 }
      ]
    }
  }
  """
  guard let data = sampleJson.data(using: .utf8),
        let decoded = try? JSONDecoder().decode(HudApiResponse.self, from: data),
        decoded.summary?.cost?.totalCostUsd == 8.88,
        decoded.historySummary?.bySource.cli.sessions == 1
  else {
    fputs("JSON decode self-test failed\n", stderr)
    return 1
  }

  let legacyPrefsData = "{\"displayMode\":\"bottom\",\"windowLimit\":1000000}".data(using: .utf8)!
  let legacyPrefs = try? JSONDecoder().decode(HudPrefs.self, from: legacyPrefsData)
  precondition(
    legacyPrefs?.displayMode == "window" && legacyPrefs?.windowLimit == 0 && legacyPrefs?.prefsVersion == 2 && legacyPrefs?.anchorPosition == "topRight" && legacyPrefs?.capsuleStyle == "compact" && legacyPrefs?.language == "en",
    "Legacy HudPrefs normalization failed"
  )
  let v2Manual1MData = "{\"prefsVersion\":2,\"windowLimit\":1000000}".data(using: .utf8)!
  let v2Manual1M = try? JSONDecoder().decode(HudPrefs.self, from: v2Manual1MData)
  precondition(v2Manual1M?.windowLimit == 1_000_000, "v2 explicit 1M preservation failed")
  // Default fallback is 256K; sampleJson has modelName "gemini-2.5-pro" (128K) with used=180K -> promotes to 200K
  precondition(HudFormatter.effectiveWindowLimit(prefs: HudPrefs(), response: nil) == 256_000, "Default auto effectiveWindowLimit failed")
  precondition(HudFormatter.effectiveWindowLimit(prefs: HudPrefs(), response: decoded) == 200_000, "Model + overflow promotion effectiveWindowLimit failed")
  precondition(HudFormatter.fmtDurationMs(nil) == "—", "fmtDurationMs(nil) failed")
  precondition(HudFormatter.fmtDurationMs(480) == "480ms", "fmtDurationMs(480) failed")
  precondition(HudFormatter.fmtDurationMs(2552) == "2.6s", "fmtDurationMs(2552) failed")
  precondition(decoded.summary?.avgTtftMs == 2250 && decoded.summary?.lastTtftMs == 3400, "TTFT JSON decode failed")

  print("SELF_TEST_OK")
  return 0
}

let args = CommandLine.arguments
if args.contains("--self-test") {
  exit(runSelfTest())
}

var apiUrl = "http://127.0.0.1:0/api/hud"
var prefsPath = NSString(string: "~/.gemini/antigravity/sidecar_data/context-monitor/context_monitor/hud_prefs.json").expandingTildeInPath
var parentPid: pid_t = 0

var idx = 1
while idx < args.count {
  switch args[idx] {
  case "--api":
    if idx + 1 < args.count { apiUrl = args[idx + 1]; idx += 1 }
  case "--prefs":
    if idx + 1 < args.count { prefsPath = args[idx + 1]; idx += 1 }
  case "--ppid":
    if idx + 1 < args.count { parentPid = pid_t(Int32(args[idx + 1]) ?? 0); idx += 1 }
  default:
    break
  }
  idx += 1
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = HudController(
  apiUrlString: apiUrl,
  prefsUrl: URL(fileURLWithPath: prefsPath),
  parentPid: parentPid
)
withExtendedLifetime(controller) {
  app.run()
}
