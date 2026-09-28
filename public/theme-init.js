(function () {
  try {
    var t = localStorage.getItem('vynko-theme');
    var isDark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch {}
})();
