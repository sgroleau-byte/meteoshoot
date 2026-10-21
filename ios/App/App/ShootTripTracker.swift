import Foundation
import CoreLocation
import ActivityKit

// Suivi du trajet vers le shooting du jour (21 octobre 2026, demande de Stéphane): sur la carte de l'activité en
// direct, « 5 km » est la distance qui reste entre lui et le lieu, en direct, et le rond avance sur la route jusqu'à
// l'arrivée. L'app ne tourne pas sur l'écran verrouillé: on suit la position en arrière-plan (permission « Toujours »,
// mode d'arrière-plan « location », changements significatifs pour être relancé si iOS a fermé l'app) et on met à
// jour l'activité quand la distance change.
//
// Distance restante: distance à vol d'oiseau vers le lieu, multipliée par le rapport route / vol d'oiseau mesuré au
// départ (distance Google du trajet planifié sur la distance à vol d'oiseau d'alors), borné entre 1 et 2. Pas d'appel
// réseau en arrière-plan. Avancement = 1 moins la distance restante sur la distance du trajet.
@available(iOS 16.2, *)
final class ShootTripTracker: NSObject, CLLocationManagerDelegate {
    static let shared = ShootTripTracker()
    private let manager = CLLocationManager()
    private var started = false
    private var lastSentKm: Int?
    private var lastSentProgress: Double?

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 200
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    // Démarre (ou poursuit) le suivi s'il y a une activité avec un lieu et un trajet; demande la permission « Toujours »
    // au besoin. Appelé au démarrage de l'activité et au lancement de l'app.
    func startIfNeeded() {
        guard currentActivity() != nil else { stop(); return }
        let status = manager.authorizationStatus
        if status == .notDetermined || status == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        if !started {
            started = true
            manager.allowsBackgroundLocationUpdates = (status == .authorizedAlways)
            manager.startUpdatingLocation()
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    func stop() {
        guard started else { return }
        started = false
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
    }

    private func currentActivity() -> Activity<ShootActivityAttributes>? {
        Activity<ShootActivityAttributes>.activities.first { a in
            let s = a.content.state
            return s.destLat != nil && s.destLng != nil && (s.travelMeters ?? 0) > 0 && (s.endDate.map { $0 > Date() } ?? true)
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        startIfNeeded()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, loc.horizontalAccuracy >= 0, loc.horizontalAccuracy < 1000,
              let activity = currentActivity() else { return }
        var state = activity.content.state
        guard let lat = state.destLat, let lng = state.destLng, let total = state.travelMeters, total > 0 else { return }
        let dest = CLLocation(latitude: lat, longitude: lng)
        let straight = loc.distance(from: dest)
        // Rapport route / vol d'oiseau, fixé à la première position reçue (ou envoyé par l'app).
        if state.roadFactor == nil {
            state.roadFactor = straight > 500 ? min(2, max(1, total / straight)) : 1.3
        }
        let remaining = min(total, straight * (state.roadFactor ?? 1.3))
        let arrived = straight < 150
        let progress = arrived ? 1 : min(1, max(0, 1 - remaining / total))
        let km = arrived ? 0 : Int((remaining / 1000).rounded())
        // Mise à jour seulement si quelque chose a changé de façon visible.
        if lastSentKm == km, let p = lastSentProgress, abs(p - progress) < 0.02 { return }
        lastSentKm = km; lastSentProgress = progress
        state.routeProgress = progress
        state.kmText = "\(km) km"   // « 0 km » à l'arrivée (un mot plus long toucherait « Coucher du soleil »)
        state.remainingMeters = remaining
        let stale = state.endDate ?? state.targetDate.addingTimeInterval(3 * 3600)
        Task { await activity.update(ActivityContent(state: state, staleDate: stale)) }
        if arrived { stop() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { }
}
