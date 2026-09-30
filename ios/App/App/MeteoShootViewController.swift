import UIKit
import Capacitor

// Contrôleur de l'app: celui de Capacitor, plus l'enregistrement du pont vers l'activité en direct.
// Instancié par SceneDelegate.
class MeteoShootViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShootActivityPlugin())
    }
}
