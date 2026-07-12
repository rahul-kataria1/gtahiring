(function () {
  if (!window.__PUSH_ENABLED) return;
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;

  var PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  if (!PushNotifications) return;

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

  PushNotifications.checkPermissions().then(function (res) {
    if (res.receive === 'granted') {
      PushNotifications.register();
    } else if (res.receive !== 'denied') {
      PushNotifications.requestPermissions().then(function (res2) {
        if (res2.receive === 'granted') PushNotifications.register();
      });
    }
  });
})();
