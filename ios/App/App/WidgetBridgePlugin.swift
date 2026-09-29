import Foundation
import Capacitor
import WidgetKit

// Pont entre l'app web et le widget iPhone: l'app dépose un instantané JSON du shooting du jour dans le
// groupe d'apps partagé (UserDefaults « group.com.meteoshoot.app ») et demande au widget de se rafraîchir.
// Côté web: src/native/widget.js. Enregistré par MeteoShootViewController.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearData", returnType: CAPPluginReturnPromise),
    ]
    private let suite = "group.com.meteoshoot.app"
    private let key = "shootOfDay"

    @objc func setData(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { call.reject("json manquant"); return }
        UserDefaults(suiteName: suite)?.set(json, forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clearData(_ call: CAPPluginCall) {
        UserDefaults(suiteName: suite)?.removeObject(forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
