import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    private let refreshControl = UIRefreshControl()
    private var splashOverlay: SplashOverlayView?

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = true
        webView?.scrollView.refreshControl = refreshControl
        refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        showAnimatedSplash()
    }

    private func showAnimatedSplash() {
        let overlay = SplashOverlayView(frame: view.bounds)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        overlay.animateIn()
        splashOverlay = overlay

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in
            self?.splashOverlay?.animateOut { self?.splashOverlay = nil }
        }
    }

    @objc private func handleRefresh() {
        webView?.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.refreshControl.endRefreshing()
        }
    }
}
