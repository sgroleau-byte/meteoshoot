import ActivityKit
import WidgetKit
import SwiftUI

// Extension MeteoShootWidget: dessine l'activité en direct « Shooting du jour » sur l'écran verrouillé et dans la
// Dynamic Island. L'app la démarre, la met à jour et la termine (App/ShootActivityPlugin.swift); le modèle est
// dans App/ShootActivityAttributes.swift. Aucun widget classique: Stéphane les a trouvés trop petits.
//
// Carte de l'écran verrouillé: reproduction de la maquette _METEOSHOOT/_PSD/Live.psd de Stéphane (4 octobre 2026,
// écran d'iPhone 15 Pro à 3x: les cotes en points sont les pixels de la maquette divisés par 3, mesurées depuis le
// coin haut gauche de la carte système, 365,67 x 113,67 pt). Typo SF Pro (police système): titre SF Pro Rounded
// Thin, le reste SF Pro Medium. Fond: matière système de l'écran verrouillé, dégradé et étoiles de la maquette en
// images (Images/live-gradient.png, live-stars.png), icônes météo de l'app en blanc (Images/weather-*.png, rendues
// par tools/live-icons/render.mjs). La Dynamic Island garde le look précédent (Bebas) en attendant sa maquette.

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

    // Codes d'icônes de l'app (iconsLogic.js) vers les symboles SF (Dynamic Island).
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

    // Images du dossier Images de l'extension (dossier copié tel quel dans le bundle).
    static func image(_ name: String) -> Image? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Images"),
              let ui = UIImage(contentsOfFile: url.path) else { return nil }
        return Image(uiImage: ui)
    }
    // Icône météo de l'app en blanc; nuage si le code est inconnu (comme WeatherIcon.jsx).
    static func weatherImage(_ icon: String) -> Image {
        image("weather-" + icon) ?? image("weather-cloudy") ?? Image(systemName: "cloud")
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
    // Part écoulée entre le début de la barre et l'événement visé (anneau de la carte), au moment du rendu.
    var progressFraction: Double {
        let r = progressRange
        let total = r.upperBound.timeIntervalSince(r.lowerBound)
        return total > 0 ? min(1, max(0, Date().timeIntervalSince(r.lowerBound) / total)) : 1
    }
    var targetLabel: String { targetIsSunrise ? "LEVER DANS" : "COUCHER DANS" }
    // Heure de l'événement visé au format de la maquette (« 19h45 »).
    var targetTimeText: String { (targetIsSunrise ? sunriseText : sunsetText).replacingOccurrences(of: ":", with: "h") }
}

// MARK: - Éléments (Dynamic Island)

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
            Text(timerInterval: Date()...state.targetDate, countsDown: true, showsHours: true)
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

// MARK: - Carte de l'écran verrouillé (maquette Live.psd)

// Cotes en points, depuis le coin haut gauche de la carte. Base: la maquette (pixels à 3x divisés par 3), puis les
// retours de Stéphane du 21 octobre 2026: « tout est trop petit » (toute la carte x 1,2) et « grossit encore la typo,
// en bas du titre » (textes sous le titre x 1,35 de plus, météo x 1,25); colonnes et rangées réespacées pour que
// rien ne se touche; route et étoiles gardées à la taille de la maquette faute de place en largeur.
enum Live {
    static let k: CGFloat = 1.2                   // agrandissement général (titre, anneau, positions)
    static let cardWidth: CGFloat = 365.667       // 1097 px: largeur de la carte sur l'iPhone 15 Pro de la maquette
    static let cardHeight: CGFloat = k * 113.667  // 136,4 pt (341 px dans la maquette)
    static let centerX = cardWidth / 2
    // Typo (SF Pro = police système)
    static let titleFont = Font.system(size: 17.6, weight: .regular, design: .rounded)   // maquette 14,67 x 1,2; regular (Stéphane, 21 octobre 2026)
    static let labelFont = Font.system(size: 10.8, weight: .medium)                    // maquette 6,67 x 1,2 x 1,35
    static let valueFont = Font.system(size: 18.7, weight: .medium)                    // maquette 11,56 x 1,2 x 1,35
    static let weatherFont = Font.system(size: 13, weight: .medium)                  // maquette 9,56 x 1,2 x 1,18 (place pour « 10:47:12 »)
    static let titleTracking: CGFloat = -0.1, labelTracking: CGFloat = -0.3, valueTracking: CGFloat = 0, weatherTracking: CGFloat = -0.15
    // Titre
    static let titleX: CGFloat = 30, titleBaseline: CGFloat = 23   // aligné sur les étiquettes
    // Rangée 1: départ, arrivée (gauche), météo (droite)
    static let colAX: CGFloat = 30, colBX: CGFloat = 119   // place pour un compte à rebours « 10:47:12 »
    static let row1LabelBaseline: CGFloat = 55.5, row1ValueBaseline: CGFloat = 72.5
    static let weatherLabelFromRight: CGFloat = 166, weatherLabelBaseline: CGFloat = 55.5
    static let weatherValuesFromRight: CGFloat = 34, weatherValuesBaseline: CGFloat = 72.5
    static let smallIconOpacity: Double = 1.0      // blanc plein (maquette: 117/255; Stéphane, 21 octobre 2026: « en blanc seulement »)
    static let cloudIconSize: CGFloat = 22, cloudIconBaseline: CGFloat = 17.4, cloudIconGapBefore: CGFloat = 3, cloudIconGapAfter: CGFloat = -0.6
    static let sunIconSize: CGFloat = 22, sunIconBaseline: CGFloat = 15.8, sunIconGapBefore: CGFloat = 3.5, sunIconGapAfter: CGFloat = -2.5
    static let bigIconSize: CGFloat = 21, bigIconFromRight: CGFloat = 8, bigIconTop: CGFloat = 57
    // Rangée 2: anneau, compte à rebours, route, événement visé, étoiles
    static let ringCenter = CGPoint(x: 42.8, y: 112.5), ringDiameter: CGFloat = 24.4
    static let row2LabelX: CGFloat = 60.1, row2LabelBaseline: CGFloat = 106, row2ValueBaseline: CGFloat = 125
    static let targetCenterX: CGFloat = 272       // « Coucher du soleil » centré (259,12 dans la maquette)
    static let starsFromRight: CGFloat = 8.0, starsTop: CGFloat = 96, starsSize = CGSize(width: 48.333, height: 33.333)
    // Route (groupe ROUTE de la maquette, cotes de la maquette x 0,9 faute de place): boîte posée à (140, 93)
    static let routeScale: CGFloat = 0.9
    static let routeBox = CGRect(x: 146, y: 93, width: 92 * routeScale, height: 45 * routeScale)
    static let routeOrigin = CGPoint(x: 128, y: 73)   // origine de la boîte dans la maquette
    static let routeStart = CGPoint(x: 136.67, y: 96.33), routeC1 = CGPoint(x: 156.6, y: 115.83)
    static let routeC2 = CGPoint(x: 190.47, y: 79.07), routeEnd = CGPoint(x: 212.33, y: 96.0)
    static let routeLeftDot = CGPoint(x: 132.33, y: 92.33), routeRightDot = CGPoint(x: 215.33, y: 97.0)
    static let routeEtaDot = CGPoint(x: 176.73, y: 94.93), routeEtaRadius: CGFloat = 4.73
    static let kmBaseline: CGFloat = 105
}

// Texte posé par sa ligne de base: (x, baseline) depuis le coin haut gauche du conteneur (overlay topLeading).
struct Baseline: ViewModifier {
    let x: CGFloat
    let y: CGFloat
    func body(content: Content) -> some View {
        content.alignmentGuide(.top) { $0[.firstTextBaseline] }.offset(x: x, y: y)
    }
}
extension View {
    func baseline(x: CGFloat, y: CGFloat) -> some View { modifier(Baseline(x: x, y: y)) }
}

// Compte à rebours « h:mm », calculé au rendu (chaque mise à jour de l'activité: ouverture de l'app, positions du suivi
// du trajet). Stéphane (21 octobre 2026) ne veut ni mots ni secondes; or les minuteries animées d'iOS donnent soit
// « 5:47:12 » (impossible à découper: masque et cadre coupé font disparaître le texte), soit des mots sur son iPhone.
struct MinuteCountdown: View {
    let to: Date?
    var body: some View {
        let remaining = max(0, Int(((to ?? Date()).timeIntervalSince(Date()) / 60).rounded()))
        Text(String(format: "%d:%02d", remaining / 60, remaining % 60))
    }
}

// Anneau du temps restant, comme celui de la maquette (anneau de la minuterie d'Apple): 61 px de diamètre, trait de 8 px,
// blanc à 78 % pour la part écoulée depuis midi dans le sens horaire, le reste atténué, petite aiguille vers la tête de l'arc.
// Dessiné à la dernière mise à jour de l'activité (iOS n'anime que ses propres anneaux, plus fins et sans aiguille).
struct TimerRing: View {
    let progress: Double
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let stroke: CGFloat = Live.k * 2.667
            let r = size.width / 2 - stroke / 2
            let start = Angle.degrees(-90), head = Angle.degrees(-90 + 360 * progress)
            var track = Path(); track.addArc(center: c, radius: r, startAngle: head, endAngle: start + .degrees(360), clockwise: false)
            ctx.stroke(track, with: .color(.white.opacity(0.3)), style: StrokeStyle(lineWidth: stroke, lineCap: .butt))
            var arc = Path(); arc.addArc(center: c, radius: r, startAngle: start, endAngle: head, clockwise: false)
            ctx.stroke(arc, with: .color(.white.opacity(0.78)), style: StrokeStyle(lineWidth: stroke, lineCap: .round))
            // Aiguille: segment arrondi du tiers au deux tiers du rayon, dans la direction de la tête de l'arc.
            var hand = Path()
            let dir = CGPoint(x: cos(head.radians), y: sin(head.radians))
            hand.move(to: CGPoint(x: c.x + dir.x * r * 0.3, y: c.y + dir.y * r * 0.3))
            hand.addLine(to: CGPoint(x: c.x + dir.x * r * 0.62, y: c.y + dir.y * r * 0.62))
            ctx.stroke(hand, with: .color(.white.opacity(0.78)), style: StrokeStyle(lineWidth: Live.k * 2.333, lineCap: .round))
        }
    }
}

// Point de la courbe de la route (paramètre 0 à 1) et paramètre du point d'étape de la maquette.
enum RouteCurve {
    static let designT: Double = 0.55
    static func point(_ t: Double) -> CGPoint {
        let p0 = Live.routeStart, p1 = Live.routeC1, p2 = Live.routeC2, p3 = Live.routeEnd
        let u = 1 - t
        let x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x
        let y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
        return CGPoint(x: x, y: y)
    }
    // Abscisse du rond dans la carte; pour centrer les kilomètres, bornée pour que le texte reste au-dessus de la route.
    static func dotX(_ progress: Double?) -> CGFloat {
        Live.routeBox.minX + (point(progress ?? designT).x - Live.routeOrigin.x) * Live.routeScale
    }
    static func kmX(_ progress: Double?) -> CGFloat {
        min(max(dotX(progress), Live.routeBox.minX + 16), Live.routeBox.maxX - 16)
    }
}

// Groupe ROUTE: deux cercles creux, tracé pointillé en courbe, rond plein avec son halo à l'avancement du trajet
// (position de la maquette si l'app ne suit pas le trajet).
struct RouteView: View {
    var progress: Double?
    var body: some View {
        let o = Live.routeOrigin
        Canvas { ctx, _ in
            let r0 = Live.routeScale
            func p(_ pt: CGPoint) -> CGPoint { CGPoint(x: (pt.x - o.x) * r0, y: (pt.y - o.y) * r0) }
            // Tracé pointillé: 5 px de trait, tirets 4 x et espaces 2 x le trait, bouts ronds.
            var path = Path()
            path.move(to: p(Live.routeStart))
            path.addCurve(to: p(Live.routeEnd), control1: p(Live.routeC1), control2: p(Live.routeC2))
            ctx.stroke(path, with: .color(.white), style: StrokeStyle(lineWidth: 1.667 * r0, lineCap: .round, dash: [6.667 * r0, 3.333 * r0]))
            // Cercles des extrémités: rayon 3 pt, trait 1 pt, blanc à 48 % et 47 %.
            for (c, a) in [(Live.routeLeftDot, 0.478), (Live.routeRightDot, 0.471)] {
                let r = CGRect(x: p(c).x - 3 * r0, y: p(c).y - 3 * r0, width: 6 * r0, height: 6 * r0)
                ctx.stroke(Path(ellipseIn: r), with: .color(.white.opacity(a)), lineWidth: r0)
            }
            // Halo doux puis rond plein, sur la courbe.
            let e = p(RouteCurve.point(progress ?? RouteCurve.designT))
            let haloR: CGFloat = 16 * r0
            ctx.fill(Path(ellipseIn: CGRect(x: e.x - haloR, y: e.y - haloR, width: haloR * 2, height: haloR * 2)),
                     with: .radialGradient(Gradient(colors: [.white.opacity(0.26), .white.opacity(0)]), center: e, startRadius: 0, endRadius: haloR))
            let r = Live.routeEtaRadius * r0
            ctx.fill(Path(ellipseIn: CGRect(x: e.x - r, y: e.y - r, width: r * 2, height: r * 2)), with: .color(.white))
        }
        .frame(width: Live.routeBox.width, height: Live.routeBox.height)
    }
}

struct LockScreenCard: View {
    let state: ShootActivityAttributes.ContentState
    var body: some View {
        let sunWord = state.targetIsSunrise ? "lever" : "coucher"
        let sunWordCap = state.targetIsSunrise ? "Lever" : "Coucher"
        Color.clear
            .frame(height: Live.cardHeight)
            .frame(maxWidth: .infinity)
            // Dégradé de la maquette, étiré sur la carte
            .background { (Look.image("live-gradient") ?? Image(uiImage: UIImage())).resizable() }
            // Titre
            .overlay(alignment: .topLeading) {
                Text(state.name).font(Live.titleFont).tracking(Live.titleTracking).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: Live.cardWidth - Live.titleX - 14, alignment: .leading)
                    .baseline(x: Live.titleX, y: Live.titleBaseline)
            }
            // Rangée 1, gauche: heure du départ, arrivée
            .overlay(alignment: .topLeading) {
                Text("Heure du départ").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).baseline(x: Live.colAX, y: Live.row1LabelBaseline)
            }
            .overlay(alignment: .topLeading) {
                Text(state.departText ?? "--:--").font(Live.valueFont).tracking(Live.valueTracking).foregroundStyle(.white).monospacedDigit().baseline(x: Live.colAX, y: Live.row1ValueBaseline)
            }
            .overlay(alignment: .topLeading) {
                Text("Arrivé dans").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).baseline(x: Live.colBX, y: Live.row1LabelBaseline)
            }
            .overlay(alignment: .topLeading) {
                Group {
                    if state.arriveDate != nil { MinuteCountdown(to: state.arriveDate) } else { Text("--:--") }
                }
                .font(Live.valueFont).tracking(Live.valueTracking).foregroundStyle(.white).monospacedDigit().baseline(x: Live.colBX, y: Live.row1ValueBaseline)
            }
            // Rangée 1, droite: météo à l'heure de l'événement visé
            .overlay(alignment: .topTrailing) {
                // Étiquette alignée à gauche à 144,89 pt du bord droit (comme les valeurs, ancrées à droite).
                Text("Météo au \(sunWord) du soleil").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).fixedSize()
                    .frame(width: Live.weatherLabelFromRight, alignment: .leading)
                    .baseline(x: 0, y: Live.weatherLabelBaseline)
            }
            .overlay(alignment: .topTrailing) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text(state.tempText ?? "--°")
                    (Look.image("small-cloud") ?? Image(uiImage: UIImage())).resizable().opacity(Live.smallIconOpacity)
                        .frame(width: Live.cloudIconSize, height: Live.cloudIconSize)
                        .alignmentGuide(.firstTextBaseline) { _ in Live.cloudIconBaseline }
                        .padding(.leading, Live.cloudIconGapBefore).padding(.trailing, Live.cloudIconGapAfter)
                    Text(state.cloudText)
                    (Look.image("small-sun") ?? Image(uiImage: UIImage())).resizable().opacity(Live.smallIconOpacity)
                        .frame(width: Live.sunIconSize, height: Live.sunIconSize)
                        .alignmentGuide(.firstTextBaseline) { _ in Live.sunIconBaseline }
                        .padding(.leading, Live.sunIconGapBefore).padding(.trailing, Live.sunIconGapAfter)
                    Text(state.sunText ?? "--")
                }
                .font(Live.weatherFont).tracking(Live.weatherTracking).foregroundStyle(.white).monospacedDigit().fixedSize()
                .baseline(x: -Live.weatherValuesFromRight, y: Live.weatherValuesBaseline)
            }
            .overlay(alignment: .topTrailing) {
                Look.weatherImage(state.icon).resizable()
                    .frame(width: Live.bigIconSize, height: Live.bigIconSize)
                    .offset(x: -Live.bigIconFromRight, y: Live.bigIconTop)
            }
            // Rangée 2: anneau du temps restant, compte à rebours, route, événement visé, étoiles
            .overlay(alignment: .topLeading) {
                TimerRing(progress: state.progressFraction)
                    .frame(width: Live.ringDiameter, height: Live.ringDiameter)
                    .offset(x: Live.ringCenter.x - Live.ringDiameter / 2, y: Live.ringCenter.y - Live.ringDiameter / 2)
            }
            .overlay(alignment: .topLeading) {
                Text("\(sunWordCap) dans").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).baseline(x: Live.row2LabelX, y: Live.row2LabelBaseline)
            }
            .overlay(alignment: .topLeading) {
                MinuteCountdown(to: state.targetDate).font(Live.valueFont).tracking(Live.valueTracking).foregroundStyle(.white).monospacedDigit()
                    .baseline(x: Live.row2LabelX, y: Live.row2ValueBaseline)
            }
            .overlay(alignment: .top) {
                RouteView(progress: state.routeProgress).offset(x: Live.routeBox.midX - Live.centerX, y: Live.routeBox.minY)
            }
            .overlay(alignment: .top) {
                Text(state.kmText ?? "").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).fixedSize()
                    .baseline(x: RouteCurve.kmX(state.routeProgress) - Live.centerX, y: Live.kmBaseline)
            }
            .overlay(alignment: .top) {
                Text("\(sunWordCap) du soleil").font(Live.labelFont).tracking(Live.labelTracking).foregroundStyle(.white).fixedSize()
                    .baseline(x: Live.targetCenterX - Live.centerX, y: Live.row2LabelBaseline)
            }
            .overlay(alignment: .top) {
                Text(state.targetTimeText).font(Live.valueFont).tracking(Live.valueTracking).foregroundStyle(.white).monospacedDigit().fixedSize()
                    .baseline(x: Live.targetCenterX - Live.centerX, y: Live.row2ValueBaseline)
            }
            .overlay(alignment: .topTrailing) {
                (Look.image("live-stars") ?? Image(uiImage: UIImage())).resizable()
                    .frame(width: Live.starsSize.width, height: Live.starsSize.height)
                    .offset(x: -Live.starsFromRight, y: Live.starsTop)
            }
            .clipped()
    }
}

// MARK: - Déclaration de l'activité

struct ShootLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShootActivityAttributes.self) { context in
            // Toucher la carte ouvre l'app sur la fiche du projet (lien lu par App.jsx).
            LockScreenCard(state: context.state)
                .activityBackgroundTint(Color.clear)
                .activitySystemActionForegroundColor(.white)
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
