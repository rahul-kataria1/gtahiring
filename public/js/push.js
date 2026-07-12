(function () {
  if (!window.__PUSH_ENABLED) return;
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;

  var PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  if (!PushNotifications) return;

  var DISMISS_KEY = 'push_prompt_dismissed_until';

  function registerToken(token) {
    fetch('/push/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token, platform: 'ios' }),
    });
  }

  PushNotifications.addListener('registration', function (result) {
    registerToken(result.value);
  });

  PushNotifications.addListener('registrationError', function (err) {
    console.error('Push registration error', err);
  });

  function isDismissed() {
    var until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    return Date.now() < until;
  }

  function dismissFor14Days() {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 14 * 24 * 60 * 60 * 1000));
  }

  function showPrompt() {
    if (document.getElementById('pushPromptBanner')) return;

    var banner = document.createElement('div');
    banner.id = 'pushPromptBanner';
    banner.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
      'background:#fff', 'border-radius:16px', 'box-shadow:0 8px 32px rgba(0,0,0,0.22)',
      'padding:18px', 'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'display:flex', 'flex-direction:column', 'gap:12px',
    ].join(';');

    banner.innerHTML =
      '<div style="display:flex;gap:12px;align-items:flex-start;">' +
        '<div style="font-size:1.6rem;line-height:1;">🔔</div>' +
        '<div>' +
          '<div style="font-weight:700;font-size:0.95rem;color:#1a2540;margin-bottom:2px;">Stay in the loop</div>' +
          '<div style="font-size:0.84rem;color:#6b7280;line-height:1.4;">Get notified when your application status changes or your job posting is reviewed.</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<button id="pushPromptNotNow" style="flex:1;padding:10px;border-radius:10px;border:1.5px solid #d8e4f4;background:#fff;color:#6b7280;font-weight:600;font-size:0.86rem;">Not now</button>' +
        '<button id="pushPromptEnable" style="flex:1;padding:10px;border-radius:10px;border:none;background:#0057d8;color:#fff;font-weight:700;font-size:0.86rem;">Enable notifications</button>' +
      '</div>';

    document.body.appendChild(banner);

    document.getElementById('pushPromptNotNow').addEventListener('click', function () {
      dismissFor14Days();
      banner.remove();
    });

    document.getElementById('pushPromptEnable').addEventListener('click', function () {
      banner.remove();
      PushNotifications.requestPermissions().then(function (res) {
        if (res.receive === 'granted') {
          PushNotifications.register();
        } else {
          dismissFor14Days();
        }
      });
    });
  }

  PushNotifications.checkPermissions().then(function (res) {
    if (res.receive === 'granted') {
      PushNotifications.register();
    } else if (res.receive !== 'denied' && !isDismissed()) {
      showPrompt();
    }
  });
})();
