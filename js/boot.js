// Runs first: applies your theme and shows the lock screen before anything else
try {
  var r = document.documentElement;
  r.dataset.theme = localStorage.getItem("et_theme") || "auto";
  if (localStorage.getItem("et_pin") || localStorage.getItem("et_vault")) r.classList.add("locked");
} catch (e) {}

// Saves the app on your device so it works offline
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("service-worker.js").catch(function () {});
  });
}
