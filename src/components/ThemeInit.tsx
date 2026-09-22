'use client';

import { useServerInsertedHTML } from 'next/navigation';

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('vynko-theme');
    var isDark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`;

export function ThemeInit() {
  useServerInsertedHTML(() => (
    <script
      id="vynko-theme-init"
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  ));

  return null;
}
