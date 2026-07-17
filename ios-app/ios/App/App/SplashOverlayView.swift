import UIKit

// Custom animated splash overlay, added on top of the WebView in
// MainViewController. The native LaunchScreen.storyboard image (static,
// required by iOS before any app code runs) hands off to this the instant
// the app's first frame draws — it looks identical at rest, then animates.
final class SplashOverlayView: UIView {
    private let gradientLayer = CAGradientLayer()
    private let glowView = UIImageView(image: UIImage(named: "SplashGlow"))
    private let logoView = UIImageView(image: UIImage(named: "LogoMark"))

    private static let violet = UIColor(red: 0x00/255, green: 0x57/255, blue: 0xd8/255, alpha: 1)
    private static let violetDark = UIColor(red: 0x00/255, green: 0x41/255, blue: 0xa8/255, alpha: 1)

    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        backgroundColor = Self.violet

        gradientLayer.colors = [Self.violet.cgColor, Self.violetDark.cgColor]
        gradientLayer.startPoint = CGPoint(x: 0, y: 0)
        gradientLayer.endPoint = CGPoint(x: 1, y: 1)
        layer.addSublayer(gradientLayer)

        glowView.contentMode = .scaleAspectFit
        glowView.alpha = 0
        glowView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(glowView)

        logoView.contentMode = .scaleAspectFit
        logoView.alpha = 0
        logoView.transform = CGAffineTransform(scaleX: 0.82, y: 0.82)
        logoView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(logoView)

        NSLayoutConstraint.activate([
            glowView.centerXAnchor.constraint(equalTo: centerXAnchor),
            glowView.centerYAnchor.constraint(equalTo: centerYAnchor),
            glowView.widthAnchor.constraint(equalTo: widthAnchor, multiplier: 0.95),
            glowView.heightAnchor.constraint(equalTo: glowView.widthAnchor),

            logoView.centerXAnchor.constraint(equalTo: centerXAnchor),
            logoView.centerYAnchor.constraint(equalTo: centerYAnchor),
            logoView.widthAnchor.constraint(equalTo: widthAnchor, multiplier: 0.42),
            logoView.heightAnchor.constraint(equalTo: logoView.widthAnchor, multiplier: 288.0 / 866.0),
        ])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradientLayer.frame = bounds
    }

    /// Entrance: logo springs in with a fade, glow eases in and starts a
    /// slow continuous pulse, background gradient gently shifts angle.
    func animateIn() {
        UIView.animate(withDuration: 0.9, delay: 0, options: [.curveEaseOut]) {
            self.glowView.alpha = 1
        }

        UIView.animate(
            withDuration: 0.7, delay: 0.1,
            usingSpringWithDamping: 0.62, initialSpringVelocity: 0.4,
            options: [.curveEaseOut]
        ) {
            self.logoView.alpha = 1
            self.logoView.transform = .identity
        } completion: { _ in
            self.startIdlePulse()
        }

        let angleShift = CABasicAnimation(keyPath: "endPoint")
        angleShift.fromValue = CGPoint(x: 1.15, y: 0.85)
        angleShift.toValue = CGPoint(x: 1, y: 1)
        angleShift.duration = 1.4
        angleShift.timingFunction = CAMediaTimingFunction(name: .easeOut)
        gradientLayer.add(angleShift, forKey: "angleShift")
    }

    private func startIdlePulse() {
        let pulse = CABasicAnimation(keyPath: "transform.scale")
        pulse.fromValue = 1.0
        pulse.toValue = 1.06
        pulse.duration = 1.6
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        glowView.layer.add(pulse, forKey: "idlePulse")
    }

    /// Exit: whole overlay fades and eases up slightly to reveal the loaded
    /// site underneath.
    func animateOut(completion: @escaping () -> Void) {
        UIView.animate(
            withDuration: 0.45, delay: 0,
            options: [.curveEaseIn]
        ) {
            self.alpha = 0
            self.transform = CGAffineTransform(scaleX: 1.04, y: 1.04)
        } completion: { _ in
            self.removeFromSuperview()
            completion()
        }
    }
}
