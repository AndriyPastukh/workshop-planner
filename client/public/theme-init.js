/* global document, localStorage */
(function () {
  try {
    if (localStorage.getItem('wp_theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch {
    // Ignore storage access restrictions
  }
})();
