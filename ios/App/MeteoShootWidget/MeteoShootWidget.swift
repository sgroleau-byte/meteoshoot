import ActivityKit
import WidgetKit
import SwiftUI

// Extension MeteoShootWidget: dessine l'activité en direct « Shooting du jour » sur l'écran verrouillé et dans la
// Dynamic Island. L'app la démarre, la met à jour et la termine (App/ShootActivityPlugin.swift); le modèle est
// dans App/ShootActivityAttributes.swift. Aucun widget classique: Stéphane les a trouvés trop petits.

// MARK: - Look de l'app (couleurs, Bebas Neue, icônes)

enum Look {
    static func color(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
    static let background = color(0x181b1e)
    static let active = color(0xFAF9F7)
    static let muted = color(0x8B9B99)
    static let inactive = color(0x404A48)
    static let gold = color(0xFBE37F)
    static func bebasBold(_ size: CGFloat) -> Font { .custom("BebasNeueBold", size: size) }
    static func bebasBook(_ size: CGFloat) -> Font { .custom("BebasNeueBook", size: size) }

    // Codes d'icônes de l'app (iconsLogic.js) vers les symboles SF.
    static func symbol(_ icon: String) -> String {
        switch icon {
        case "sunny", "sunny-bright": return "sun.max.fill"
        case "sunny-few-clouds", "mostly-sunny", "partly-cloudy": return "cloud.sun.fill"
        case "mostly-cloudy", "cloudy": return "cloud.fill"
        case "cloudy-glimpse": return "sun.haze.fill"
        case "rain": return "cloud.rain.fill"
        case "snow": return "cloud.snow.fill"
        case "thunderstorm": return "cloud.bolt.rain.fill"
        case "fog": return "cloud.fog.fill"
        default: return icon.hasPrefix("moon") ? "cloud.moon.fill" : "cloud.fill"
        }
    }
}

// Bornes sûres pour la barre et le compte à rebours (jamais un intervalle inversé).
extension ShootActivityAttributes.ContentState {
    var progressRange: ClosedRange<Date> {
        let end = max(targetDate, Date().addingTimeInterval(60))
        let start = min(startDate, end.addingTimeInterval(-60))
        return start...end
    }
    var targetIsAhead: Bool { targetDate > Date() }
    var targetLabel: String { targetIsSunrise ? "LEVER DANS" : "COUCHER DANS" }
}

// MARK: - Éléments

struct Caption: View {
    let text: String
    var color: Color = Look.muted
    var body: some View { Text(text).font(.system(size: 9, weight: .bold)).tracking(1.4).foregroundStyle(color) }
}

struct Stat: View {
    let symbol: String
    let value: String
    let label: String
    var size: CGFloat = 27
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(Look.muted)
                Text(value).font(Look.bebasBook(size)).foregroundStyle(Look.active).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7).fixedSize()
            }
            Caption(text: label)
        }
    }
}

struct Countdown: View {
    let state: ShootActivityAttributes.ContentState
    var size: CGFloat = 18
    var body: some View {
        if state.targetIsAhead {
            Text(state.targetDate, style: .relative)
                .font(Look.bebasBook(size)).foregroundStyle(Look.active).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        } else {
            Text("MAINTENANT").font(Look.bebasBook(size)).foregroundStyle(Look.gold)
        }
    }
}

struct SunBar: View {
    let state: ShootActivityAttributes.ContentState
    var body: some View {
        ProgressView(timerInterval: state.progressRange, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
            .progressViewStyle(.linear)
            .tint(Look.gold)
    }
}

// Halos des cartes de l'app, en discret: teal en bas au centre, doré en bas à gauche, voile blanc à gauche.
struct Halos: View {
    var body: some View {
        GeometryReader { geo in
            let teal = Look.color(0x64C8BE)
            ZStack {
                RadialGradient(colors: [teal.opacity(0.26), teal.opacity(0.09), .clear], center: UnitPoint(x: 0.5, y: 1.15), startRadius: 0, endRadius: geo.size.width * 0.55)
                RadialGradient(colors: [Look.gold.opacity(0.20), Look.gold.opacity(0.05), .clear], center: UnitPoint(x: -0.05, y: 1.1), startRadius: 0, endRadius: geo.size.width * 0.45)
                RadialGradient(colors: [Color.white.opacity(0.06), .clear], center: UnitPoint(x: -0.2, y: 0.5), startRadius: 0, endRadius: geo.size.width * 0.5)
            }
        }
    }
}

// MARK: - Carte de l'écran verrouillé

struct LockScreenCard: View {
    let state: ShootActivityAttributes.ContentState
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(state.name.uppercased()).font(Look.bebasBook(26)).foregroundStyle(Look.active).lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: Look.symbol(state.icon)).font(.system(size: 24, weight: .regular)).foregroundStyle(Look.muted).padding(.top, 2)
            }
            HStack(alignment: .top, spacing: 14) {
                Stat(symbol: "sunrise.fill", value: state.sunriseText, label: "LEVER")
                Stat(symbol: "sunset.fill", value: state.sunsetText, label: "COUCHER")
                Stat(symbol: Look.symbol(state.icon), value: state.cloudText, label: "NUAGES")
                if let travel = state.travelText {
                    Stat(symbol: "car.fill", value: travel, label: state.kmText ?? "TRAJET")
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 3) {
                SunBar(state: state).frame(height: 6)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Caption(text: state.targetLabel, color: Look.muted)
                    Countdown(state: state)
                    Spacer()
                    if let depart = state.departText {
                        Caption(text: "DÉPART", color: Look.muted)
                        Text(depart).font(Look.bebasBook(18)).foregroundStyle(Look.active)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background { Halos() }
    }
}

// MARK: - Déclaration de l'activité

struct ShootLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShootActivityAttributes.self) { context in
            // Toucher la carte ouvre l'app sur la fiche du projet (lien lu par App.jsx).
            LockScreenCard(state: context.state)
                .activityBackgroundTint(Look.background.opacity(0.85))
                .activitySystemActionForegroundColor(Look.active)
                .widgetURL(projectURL(context.attributes.projectId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Stat(symbol: "sunrise.fill", value: context.state.sunriseText, label: "LEVER", size: 24).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Stat(symbol: "sunset.fill", value: context.state.sunsetText, label: "COUCHER", size: 24).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.name.uppercased()).font(Look.bebasBook(18)).foregroundStyle(Look.active).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        SunBar(state: context.state).frame(height: 5)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Caption(text: context.state.targetLabel, color: Look.muted)
                            Countdown(state: context.state, size: 16)
                            Spacer()
                            Image(systemName: Look.symbol(context.state.icon)).font(.system(size: 11)).foregroundStyle(Look.muted)
                            Text(context.state.cloudText).font(Look.bebasBook(16)).foregroundStyle(Look.active)
                            if let travel = context.state.travelText {
                                Image(systemName: "car.fill").font(.system(size: 11)).foregroundStyle(Look.muted)
                                Text(travel).font(Look.bebasBook(16)).foregroundStyle(Look.active)
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: context.state.targetIsSunrise ? "sunrise.fill" : "sunset.fill").foregroundStyle(Look.gold)
            } compactTrailing: {
                Countdown(state: context.state, size: 14).frame(maxWidth: 76)
            } minimal: {
                Image(systemName: context.state.targetIsSunrise ? "sunrise.fill" : "sunset.fill").foregroundStyle(Look.gold)
            }
            .keylineTint(Look.gold)
            .widgetURL(projectURL(context.attributes.projectId))
        }
    }
}

// Lien vers la fiche du projet dans l'app (schéma meteoshoot déclaré dans l'Info.plist de l'app).
private func projectURL(_ projectId: String) -> URL? {
    URL(string: "meteoshoot://projet/" + (projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId))
}

@main
struct MeteoShootWidgetBundle: WidgetBundle {
    var body: some Widget {
        ShootLiveActivity()
    }
}
