'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const stored = localStorage.getItem('vynko-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored === 'dark' || (!stored && prefersDark);
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('vynko-theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  if (!mounted) {
    return (
      <div className={cn('h-6 w-11 rounded-full bg-gray-200 dark:bg-gray-700', className)} />
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === 'dark'}
      onClick={toggleTheme}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
        theme === 'dark' ? 'bg-indigo-600' : 'bg-gray-300',
        className
      )}
    >
      <Sun className="absolute left-1 h-3.5 w-3.5 text-amber-400" />
      <Moon className="absolute right-1 h-3.5 w-3.5 text-gray-600" />
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform duration-300 ease-in-out',
          theme === 'dark' ? 'translate-x-[22px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}
