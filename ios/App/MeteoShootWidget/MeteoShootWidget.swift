import WidgetKit
import SwiftUI
import CoreLocation

// MeteoShoot, widget « Shooting du jour ». L'app dépose un instantané JSON dans le groupe d'apps (voir
// src/native/widget.js et App/WidgetBridgePlugin.swift); le widget l'affiche et y ajoute le temps de trajet
// depuis la position actuelle (Google Distance Matrix, clé « MeteoShoot natif » transmise par l'app).

// MARK: - Instantané déposé par l'app

struct Snapshot: Decodable {
    struct Project: Decodable {
        let id: String
        let name: String
        let address: String?
        let lat: Double
        let lng: Double
        let am: Bool
        let pm: Bool
    }
    struct Planned: Decodable {
        let durationSeconds: Int?
        let distanceMeters: Int?
    }
    struct Day: Decodable {
        let date: String            // « 2026-09-29 »
        let sunriseText: String?    // « 06:42 »
        let sunsetText: String?
        let icon: String?           // codes d'icônes de l'app (sunny-bright, partly-cloudy, rain...)
        let cloudcover: Double?
        let amGood: Bool?
        let pmGood: Bool?
        let departAMText: String?   // « 05H38 »
        let departPMText: String?
    }
    let version: Int
    let updatedAt: String
    let mapsKey: String?
    let project: Project
    let planned: Planned?
    let days: [Day]

    // Exemple pour la galerie de widgets et l'aperçu.
    static let sample: Snapshot = {
        let json = """
        {"version":1,"updatedAt":"2026-09-29T12:00:00Z","mapsKey":null,
         "project":{"id":"demo","name":"Manac","address":"Saint-Georges","lat":46.12,"lng":-70.67,"am":true,"pm":true},
         "planned":{"durationSeconds":4800,"distanceMeters":132000},
         "days":[{"date":"2026-09-29","sunriseText":"06:38","sunsetText":"18:26","icon":"partly-cloudy","cloudcover":49,
                  "amGood":true,"pmGood":false,"departAMText":"05H38","departPMText":"16H05"}]}
        """
        return try! JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
    }()
}

enum SharedStore {
    static let suite = "group.com.meteoshoot.app"
    static let key = "shootOfDay"
    static func load() -> Snapshot? {
        guard let json = UserDefaults(suiteName: suite)?.string(forKey: key), let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

struct Travel {
    let seconds: Int
    let meters: Int
}

// MARK: - Position (une seule lecture) et temps de trajet en direct

@MainActor
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    func request() async -> CLLocation? {
        guard manager.isAuthorizedForWidgetUpdates else { return nil }
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        return await withCheckedContinuation { c in
            continuation = c
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.finish(locations.last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }
}

enum TravelService {
    static func live(to project: Snapshot.Project, key: String?) async -> Travel? {
        guard let key = key, !key.isEmpty else { return nil }
        let locator = await OneShotLocation()
        guard let here = await locator.request() else { return nil }
        var comps = URLComponents(string: "https://maps.googleapis.com/maps/api/distancematrix/json")!
        comps.queryItems = [
            URLQueryItem(name: "origins", value: "\(here.coordinate.latitude),\(here.coordinate.longitude)"),
            URLQueryItem(name: "destinations", value: "\(project.lat),\(project.lng)"),
            URLQueryItem(name: "mode", value: "driving"),
            URLQueryItem(name: "departure_time", value: "now"),
            URLQueryItem(name: "key", value: key),
        ]
        guard let url = comps.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("com.meteoshoot.app", forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = root["rows"] as? [[String: Any]],
              let element = (rows.first?["elements"] as? [[String: Any]])?.first,
              (element["status"] as? String) == "OK",
              let meters = (element["distance"] as? [String: Any])?["value"] as? Int else { return nil }
        let duration = (element["duration_in_traffic"] as? [String: Any]) ?? (element["duration"] as? [String: Any])
        guard let seconds = duration?["value"] as? Int else { return nil }
        return Travel(seconds: seconds, meters: meters)
    }
}

// MARK: - Chronologie

struct ShootEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    let day: Snapshot.Day?
    let live: Travel?

    static func make(_ snapshot: Snapshot?, live: Travel?) -> ShootEntry {
        let today = Fmt.dayString(Date())
        let day = snapshot?.days.first { $0.date == today } ?? snapshot?.days.first
        return ShootEntry(date: Date(), snapshot: snapshot, day: day, live: live)
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ShootEntry { .make(.sample, live: nil) }

    func getSnapshot(in context: Context, completion: @escaping (ShootEntry) -> Void) {
        completion(.make(context.isPreview ? .sample : SharedStore.load(), live: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShootEntry>) -> Void) {
        guard let snapshot = SharedStore.load() else {
            completion(Timeline(entries: [.make(nil, live: nil)], policy: .after(Date().addingTimeInterval(30 * 60))))
            return
        }
        Task {
            let live = await TravelService.live(to: snapshot.project, key: snapshot.mapsKey)
            completion(Timeline(entries: [.make(snapshot, live: live)], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }
}

// MARK: - Mise en forme (mêmes conventions que l'app: 01H20, 132 KM, 49%)

enum Fmt {
    static func duration(_ seconds: Int) -> String { String(format: "%dH%02d", seconds / 3600, (seconds % 3600) / 60) }
    static func timeString(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: date)
    }
    // Événement solaire à mettre en avant dans le rond: le lever pour un projet du matin, le coucher pour un
    // projet du soir; sinon le prochain des deux (le lever jusqu'à une heure après, puis le coucher).
    static func featuredSun(day: Snapshot.Day?, project: Snapshot.Project, now: Date) -> (text: String, isSunrise: Bool) {
        let sunrise = day?.sunriseText ?? "--:--", sunset = day?.sunsetText ?? "--:--"
        if project.am && !project.pm { return (sunrise, true) }
        if project.pm && !project.am { return (sunset, false) }
        let nowText = timeString(now.addingTimeInterval(-3600))
        return nowText < sunrise ? (sunrise, true) : (sunset, false)
    }
    static func km(_ meters: Int) -> String { "\(Int((Double(meters) / 1000).rounded())) KM" }
    static func cloud(_ value: Double?) -> String { value.map { "\(Int($0.rounded()))%" } ?? "--" }
    static func dayString(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: date)
    }
    static func symbol(_ icon: String?) -> String {
        switch icon ?? "" {
        case "sunny", "sunny-bright": return "sun.max.fill"
        case "sunny-few-clouds", "mostly-sunny", "partly-cloudy": return "cloud.sun.fill"
        case "mostly-cloudy", "cloudy": return "cloud.fill"
        case "cloudy-glimpse": return "sun.haze.fill"
        case "rain": return "cloud.rain.fill"
        case "snow": return "cloud.snow.fill"
        case "thunderstorm": return "cloud.bolt.rain.fill"
        case "fog": return "cloud.fog.fill"
        default: return (icon ?? "").hasPrefix("moon") ? "cloud.moon.fill" : "cloud.fill"
        }
    }
    static func color(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
    static let background = color(0x181b1e)
    static let active = color(0xFAF9F7)
    static let inactive = color(0x404A48)
    static let muted = color(0x8B9B99)
    static let gold = color(0xFBE37F)
}

extension ShootEntry {
    var travelText: String? {
        if let live = live { return Fmt.duration(live.seconds) }
        if let planned = snapshot?.planned?.durationSeconds, planned > 0 { return Fmt.duration(planned) }
        return nil
    }
    var kmText: String? {
        if let live = live { return Fmt.km(live.meters) }
        if let planned = snapshot?.planned?.distanceMeters, planned > 0 { return Fmt.km(planned) }
        return nil
    }
}

// MARK: - Vues

// Écran verrouillé: une seule information par widget, en gros (Apple limite le rectangle à 160 par 72 points,
// en monochrome). Le nom du projet va sur la ligne au-dessus de l'heure, le soleil dans un rectangle, la
// météo et le trajet dans un second rectangle; l'écran d'accueil garde une vue complète.

struct SunWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ShootEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            InlineNameView(entry: entry).containerBackground(for: .widget) { Color.clear }
        case .accessoryCircular:
            SunCircularView(entry: entry).containerBackground(for: .widget) { Color.clear }
        case .accessoryRectangular:
            SunRectangularView(entry: entry).containerBackground(for: .widget) { Color.clear }
        default:
            HomeView(entry: entry, compact: family == .systemSmall).containerBackground(for: .widget) { Fmt.background }
        }
    }
}

struct WeatherWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ShootEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            WeatherCircularView(entry: entry).containerBackground(for: .widget) { Color.clear }
        default:
            WeatherRectangularView(entry: entry).containerBackground(for: .widget) { Color.clear }
        }
    }
}

struct EmptyText: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("METEOSHOOT").font(.system(size: 13, weight: .heavy)).widgetAccentable()
            Text("Aucun shooting marqué").font(.system(size: 12, weight: .medium))
            Text("Appui long sur un projet").font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }
}

// Ligne au-dessus de l'heure: le nom du projet, seul.
struct InlineNameView: View {
    let entry: ShootEntry
    var body: some View {
        if let s = entry.snapshot {
            Label(s.project.name.uppercased(), systemImage: Fmt.symbol(entry.day?.icon))
        } else {
            Text("METEOSHOOT · aucun shooting")
        }
    }
}

struct SunCircularView: View {
    let entry: ShootEntry
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let s = entry.snapshot {
                let sun = Fmt.featuredSun(day: entry.day, project: s.project, now: entry.date)
                VStack(spacing: -1) {
                    Image(systemName: sun.isSunrise ? "sunrise.fill" : "sunset.fill").font(.system(size: 12, weight: .semibold))
                    Text(sun.text).font(.system(size: 16, weight: .heavy, design: .rounded)).monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
                }.widgetAccentable()
            } else {
                Image(systemName: "camera.fill").font(.system(size: 18, weight: .semibold))
            }
        }
    }
}

// Rectangle « Soleil »: le lever et le coucher, deux lignes, le plus gros possible.
struct SunRectangularView: View {
    let entry: ShootEntry
    var body: some View {
        if entry.snapshot != nil {
            VStack(alignment: .leading, spacing: -6) {
                sunLine("sunrise.fill", entry.day?.sunriseText)
                sunLine("sunset.fill", entry.day?.sunsetText)
            }
            .widgetAccentable()
        } else {
            EmptyText()
        }
    }
    private func sunLine(_ symbol: String, _ text: String?) -> some View {
        (Text(Image(systemName: symbol)).font(.system(size: 14, weight: .semibold)) + Text(" " + (text ?? "--:--")).font(.system(size: 30, weight: .heavy, design: .rounded)))
            .monospacedDigit()
            .minimumScaleFactor(0.6)
            .lineLimit(1)
    }
}

struct WeatherCircularView: View {
    let entry: ShootEntry
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if entry.snapshot != nil {
                VStack(spacing: 1) {
                    Image(systemName: Fmt.symbol(entry.day?.icon)).font(.system(size: 17, weight: .semibold))
                    Text(Fmt.cloud(entry.day?.cloudcover)).font(.system(size: 13, weight: .bold, design: .rounded))
                }.widgetAccentable()
            } else {
                Image(systemName: "cloud.fill").font(.system(size: 18, weight: .semibold))
            }
        }
    }
}

// Rectangle « Météo et trajet »: les nuages sur une ligne, le temps de trajet sur l'autre, en gros.
struct WeatherRectangularView: View {
    let entry: ShootEntry
    var body: some View {
        if entry.snapshot != nil {
            VStack(alignment: .leading, spacing: -6) {
                (Text(Image(systemName: Fmt.symbol(entry.day?.icon))).font(.system(size: 14, weight: .semibold)) + Text(" " + Fmt.cloud(entry.day?.cloudcover)).font(.system(size: 30, weight: .heavy, design: .rounded)))
                    .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                (Text(Image(systemName: "car.fill")).font(.system(size: 14, weight: .semibold)) + Text(" " + (entry.travelText ?? "--")).font(.system(size: 30, weight: .heavy, design: .rounded)) + Text(entry.kmText.map { "  " + $0 } ?? "").font(.system(size: 13, weight: .semibold)))
                    .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            }
            .widgetAccentable()
        } else {
            EmptyText()
        }
    }
}

struct HomeView: View {
    let entry: ShootEntry
    let compact: Bool

    var body: some View {
        if let s = entry.snapshot {
            VStack(alignment: .leading, spacing: 4) {
                Text("SHOOTING DU JOUR").font(.system(size: 10, weight: .bold)).tracking(1.5).foregroundStyle(Fmt.gold)
                Text(s.project.name.uppercased()).font(.system(size: compact ? 17 : 21, weight: .heavy)).foregroundStyle(Fmt.active).lineLimit(compact ? 2 : 1)
                Spacer(minLength: 2)
                HStack(alignment: .top, spacing: compact ? 12 : 16) {
                    column("SOLEIL", [("AM " + (entry.day?.sunriseText ?? "--:--"), s.project.am), ("PM " + (entry.day?.sunsetText ?? "--:--"), s.project.pm)])
                    if !compact {
                        column("MÉTÉO", [(Fmt.cloud(entry.day?.cloudcover), true), (goodText, entry.day?.amGood == true || entry.day?.pmGood == true)], symbol: Fmt.symbol(entry.day?.icon))
                    }
                    column("TRAJET", [(entry.travelText ?? "-", entry.travelText != nil), (entry.kmText ?? "", entry.kmText != nil)])
                    if !compact {
                        column("DÉPART", [(entry.day?.departAMText ?? "-", s.project.am && entry.day?.departAMText != nil), (entry.day?.departPMText ?? "-", s.project.pm && entry.day?.departPMText != nil)])
                    }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("METEOSHOOT").font(.system(size: 12, weight: .heavy)).tracking(1.5).foregroundStyle(Fmt.muted)
                Text("Aucun shooting marqué").font(.system(size: 16, weight: .bold)).foregroundStyle(Fmt.active)
                Text("Appui long sur un projet dans la liste").font(.system(size: 12)).foregroundStyle(Fmt.muted)
            }
        }
    }

    private var goodText: String {
        let am = entry.day?.amGood == true, pm = entry.day?.pmGood == true
        if am && pm { return "AM PM" }
        if am { return "AM" }
        if pm { return "PM" }
        return "-"
    }

    private func column(_ title: String, _ rows: [(String, Bool)], symbol: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.system(size: 9, weight: .bold)).tracking(1).foregroundStyle(Fmt.inactive)
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 4) {
                    if index == 0, let symbol = symbol { Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(Fmt.active) }
                    Text(row.0).font(.system(size: title == "SOLEIL" ? 16 : 13, weight: .bold)).monospacedDigit().foregroundStyle(row.1 ? Fmt.active : Fmt.inactive)
                }
            }
        }
    }
}

// MARK: - Déclaration des widgets

struct SunWidget: Widget {
    let kind = "MeteoShootShootOfDay"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            SunWidgetView(entry: entry)
        }
        .configurationDisplayName("Soleil du shooting")
        .description("Lever et coucher du soleil au lieu du projet marqué; le nom du projet au-dessus de l'heure.")
        .supportedFamilies([.accessoryInline, .accessoryCircular, .accessoryRectangular, .systemSmall, .systemMedium])
    }
}

struct WeatherWidget: Widget {
    let kind = "MeteoShootWeatherTravel"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            WeatherWidgetView(entry: entry)
        }
        .configurationDisplayName("Météo et trajet")
        .description("Nuages au lieu du projet marqué et temps de trajet depuis votre position.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

@main
struct MeteoShootWidgetBundle: WidgetBundle {
    var body: some Widget {
        SunWidget()
        WeatherWidget()
    }
}
