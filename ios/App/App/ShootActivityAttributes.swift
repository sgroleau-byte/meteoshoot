import ActivityKit
import Foundation

// Activité en direct « Shooting du jour »: attributs fixes et état affiché. Partagé entre l'app, qui la
// démarre, la met à jour et la termine (ShootActivityPlugin), et l'extension MeteoShootWidget, qui la dessine.
@available(iOS 16.1, *)
struct ShootActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var name: String
        var sunriseText: String      // « 06:42 »
        var sunsetText: String       // « 18:28 »
        var icon: String             // code d'icône de l'app (partly-cloudy, rain...)
        var cloudText: String        // « 91% »
        var travelText: String?      // « 2H06 »
        var kmText: String?          // « 202 KM »
        var departText: String?      // « 16H05 »
        var targetDate: Date         // événement solaire visé par la barre et le compte à rebours
        var targetIsSunrise: Bool
        var startDate: Date          // début de la barre de progression
        var endDate: Date?           // fin du shooting: 30 min après son dernier événement solaire; l'activité disparaît
    }
    var projectId: String
}
