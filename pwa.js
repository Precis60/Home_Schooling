// Install prompt and service-worker update toast. No network calls of its own.
(function () {
  var installButtons = document.querySelectorAll('[data-pwa-install]');
  var updateToast = document.getElementById('pwaUpdate');
  var reloadButton = document.getElementById('pwaReload');
  var deferredPrompt = null;
  var registration = null;
  var reloadOnController = false;
  var refreshing = false;

  function inStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function setInstallVisible(visible) {
    var show = visible && !inStandalone();
    for (var i = 0; i < installButtons.length; i++) {
      installButtons[i].classList.toggle('hidden', !show);
    }
  }

  setInstallVisible(false);

  window.addEventListener('beforeinstallprompt', function (event) {
    if (inStandalone()) return;
    event.preventDefault();
    deferredPrompt = event;
    setInstallVisible(true);
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    setInstallVisible(false);
  });

  for (var b = 0; b < installButtons.length; b++) {
    installButtons[b].addEventListener('click', function () {
      if (!deferredPrompt) return;
      var promptEvent = deferredPrompt;
      deferredPrompt = null;
      setInstallVisible(false);
      promptEvent.prompt();
      Promise.resolve(promptEvent.userChoice).catch(function () {});
    });
  }

  if (!('serviceWorker' in navigator)) return;

  function showUpdateToast() {
    if (updateToast) updateToast.hidden = false;
  }

  function watchRegistration(reg) {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast();
    reg.addEventListener('updatefound', function () {
      var worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
      });
    });
  }

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!reloadOnController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  if (reloadButton) {
    reloadButton.addEventListener('click', function () {
      reloadOnController = true;
      var waiting = registration && registration.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });
  }

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
    watchRegistration(reg);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') reg.update();
    });
  }).catch(function (error) {
    console.error('Service worker registration failed', error);
  });
})();
