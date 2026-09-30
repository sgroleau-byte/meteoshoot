import Foundation
import Capacitor
import ActivityKit

// Pont entre l'app web et l'activité en direct « Shooting du jour »: l'app envoie l'état à afficher (JSON, dates
// en secondes depuis 1970) pour démarrer ou mettre à jour l'activité, et la termine quand le projet est démarqué.
// Côté web: src/native/liveActivity.js. Enregistré par MeteoShootViewController.
@objc(ShootActivityPlugin)
public class ShootActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShootActivityPlugin"
    public let jsName = "ShootActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("Activités en direct: iOS 16.2 requis"); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.reject("Activités en direct désactivées dans les réglages"); return }
        guard let projectId = call.getString("projectId"), let json = call.getString("state"), let data = json.data(using: .utf8) else {
            call.reject("paramètres manquants"); return
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        guard let state = try? decoder.decode(ShootActivityAttributes.ContentState.self, from: data) else { call.reject("état illisible"); return }
        Task {
            // La carte reste affichée jusqu'à trois heures après l'événement visé, puis iOS la considère périmée.
            let content = ActivityContent(state: state, staleDate: state.targetDate.addingTimeInterval(3 * 3600))
            var updated = false
            for activity in Activity<ShootActivityAttributes>.activities {
                if activity.attributes.projectId == projectId && !updated {
                    await activity.update(content)
                    updated = true
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            if !updated {
                do {
                    _ = try Activity.request(attributes: ShootActivityAttributes(projectId: projectId), content: content, pushType: nil)
                } catch {
                    call.reject("démarrage refusé: \(error.localizedDescription)")
                    return
                }
            }
            call.resolve(["updated": updated])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            for activity in Activity<ShootActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}
