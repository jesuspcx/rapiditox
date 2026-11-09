/**
 * Script síncrono y mínimo: aplica el tema antes del primer paint para
 * evitar el destello blanco. El resto de la gestión vive en app.js.
 */
(function applyStoredTheme() {
  try {
    var stored = localStorage.getItem('rapidito:theme');
    var prefersDark = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
