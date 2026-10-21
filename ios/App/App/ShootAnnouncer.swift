import Foundation
import UserNotifications

// Annonces vocales du coucher ou du lever visé par le shooting du jour (Stéphane, 21 octobre 2026): notifications
// locales programmées à 45, 30, 15, 10 et 5 minutes avant l'événement, puis à l'heure même (« maintenant »), avec un
// clip vocal embarqué (Sounds/annonce-<coucher|lever>-<minutes>.caf, voix Amélie du Mac, moins de 30 s) qui sort du
// haut-parleur même le téléphone dans la poche. iOS ne peut pas faire parler l'app fermée: d'où les clips. Coupées par
// le commutateur silencieux et les modes Concentration (alertes critiques réservées par Apple).
// Préférence « Annonces vocales » de l'app (prefs.liveAnnounce); programmées à chaque démarrage ou mise à jour de
// l'activité, annulées avec elle.
enum ShootAnnouncer {
    static let offsets = [45, 30, 15, 10, 5, 0]
    static let prefix = "meteoshoot.annonce."

    static func schedule(target: Date, isSunrise: Bool, enabled: Bool) {
        let center = UNUserNotificationCenter.current()
        cancel()
        guard enabled else { return }
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let event = isSunrise ? "lever" : "coucher"
            let label = isSunrise ? "Lever du soleil" : "Coucher du soleil"
            for minutes in offsets {
                let fire = target.addingTimeInterval(-Double(minutes) * 60)
                let delay = fire.timeIntervalSinceNow
                guard delay > 5 else { continue }
                let content = UNMutableNotificationContent()
                content.title = "MeteoShoot"
                content.body = minutes == 0 ? "\(label) maintenant" : "\(label) dans \(minutes) minutes"
                content.sound = UNNotificationSound(named: UNNotificationSoundName("annonce-\(event)-\(minutes).caf"))
                content.interruptionLevel = .timeSensitive
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
                center.add(UNNotificationRequest(identifier: prefix + "\(minutes)", content: content, trigger: trigger))
            }
        }
    }

    static func cancel() {
        let ids = offsets.map { prefix + "\($0)" }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
}
