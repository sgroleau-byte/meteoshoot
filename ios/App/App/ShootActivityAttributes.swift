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
        var icon: String             // code d'icône de l'app (partly-cloudy, rain...) à l'heure de l'événement visé
        var cloudText: String        // « 91% » (nuages à l'heure de l'événement visé)
        var tempText: String?        // « 13° » (température à l'heure de l'événement visé)
        var sunText: String?         // « 87% » (soleil direct à l'heure de l'événement visé, « -- » s'il fait nuit)
        var travelText: String?      // « 2H06 »
        var kmText: String?          // « 202 km »
        var departText: String?      // « 16:05 »
        var arriveDate: Date?        // arrivée prévue sur place (départ plus trajet): compte à rebours « Arrivé dans »
        var targetDate: Date         // événement solaire visé par la barre et le compte à rebours
        var targetIsSunrise: Bool
        var startDate: Date          // début de la barre de progression
        var endDate: Date?           // fin du shooting: 30 min après son dernier événement solaire; l'activité disparaît
    }
    var projectId: String
}
