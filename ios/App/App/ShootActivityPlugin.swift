import Foundation
import Capacitor
import ActivityKit
import BackgroundTasks

// Pont entre l'app web et l'activité en direct « Shooting du jour »: l'app envoie l'état à afficher (JSON, dates
// en secondes depuis 1970) pour démarrer ou mettre à jour l'activité, et la termine quand le projet est démarqué.
// Côté web: src/native/liveActivity.js. Enregistré par MeteoShootViewController.
//
// Fin du shooting (endDate, 30 min après son dernier événement solaire): l'activité doit disparaître. iOS ne laisse
// pas une app fermée agir; on la termine donc à chaque passage de l'app (sweep, appelé à l'ouverture et au retour) et
// par une tâche de fond demandée pour cette heure-là (FIN_TASK), qu'iOS exécute quand il le juge bon.
@objc(ShootActivityPlugin)
public class ShootActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShootActivityPlugin"
    public let jsName = "ShootActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sweep", returnType: CAPPluginReturnPromise),
    ]

    static let finTaskIdentifier = "com.meteoshoot.app.fin-shooting"

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
            // Shooting déjà terminé: rien à afficher.
            if let end = state.endDate, end <= Date() {
                await Self.endAll()
                call.resolve(["updated": false, "ended": true])
                return
            }
            // Périmée à la fin du shooting (ou trois heures après l'événement visé, faute de fin connue).
            let content = ActivityContent(state: state, staleDate: state.endDate ?? state.targetDate.addingTimeInterval(3 * 3600))
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
            Self.scheduleFinTask()
            call.resolve(["updated": updated])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            await Self.endAll()
            call.resolve()
        }
    }

    // Termine les activités dont le shooting est fini (appelé à l'ouverture et au retour dans l'app).
    @objc func sweep(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["ended": 0]); return }
        Task {
            let ended = await Self.endFinished()
            call.resolve(["ended": ended])
        }
    }

    @available(iOS 16.2, *)
    static func endAll() async {
        for activity in Activity<ShootActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    @discardableResult
    static func endFinished() async -> Int {
        guard #available(iOS 16.2, *) else { return 0 }
        var ended = 0
        let now = Date()
        for activity in Activity<ShootActivityAttributes>.activities {
            if let end = activity.content.state.endDate, end <= now {
                await activity.end(nil, dismissalPolicy: .immediate)
                ended += 1
            }
        }
        scheduleFinTask()
        return ended
    }

    // Demande à iOS de réveiller l'app à la prochaine fin de shooting (au plus tôt à cette heure-là).
    static func scheduleFinTask() {
        guard #available(iOS 16.2, *) else { return }
        let next = Activity<ShootActivityAttributes>.activities.compactMap { $0.content.state.endDate }.filter { $0 > Date() }.min()
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: finTaskIdentifier)
        guard let next else { return }
        let request = BGAppRefreshTaskRequest(identifier: finTaskIdentifier)
        request.earliestBeginDate = next
        try? BGTaskScheduler.shared.submit(request)
    }

    // Enregistré au lancement par AppDelegate (avant la fin du démarrage, comme l'exige iOS).
    static func registerFinTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: finTaskIdentifier, using: nil) { task in
            let work = Task {
                await endFinished()
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }
}
