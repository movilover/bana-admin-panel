import React from 'react';
import { ExternalLink, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/src/contexts/ThemeContext';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { getAdminRoleLabel } from '@/src/lib/adminRbac';

interface AdminShellProps {
  children: React.ReactNode;
  fullBleed?: boolean;
}

const USER_SITE_URL: string = (import.meta.env.VITE_USER_SITE_URL || '').replace(/\/$/, '');

/** Minimal top bar for the stand-alone BANA Admin Console (no user-site navigation, search or create menus). */
export function AdminShell({ children }: AdminShellProps) {
  const { firebaseUser, adminRole, logout, platformSettings } = useAuth();
  const { resolvedTheme, setThemeMode } = useTheme();

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-950 dark:text-neutral-50">
      <header className="sticky top-0 z-40 border-b border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-950/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {platformSettings.logoUrl ? (
              <img src={platformSettings.logoUrl} alt="" className="h-8 w-8 rounded-xl object-cover" />
            ) : (
              <BanaLogo compact />
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 text-[11px] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" /> Admin Console
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {firebaseUser && (
              <div className="hidden sm:flex flex-col items-end leading-tight mr-1">
                <span className="font-semibold truncate max-w-[200px]">{firebaseUser.email}</span>
                {adminRole && <span className="text-[10px] text-neutral-500">{getAdminRoleLabel(adminRole)}</span>}
              </div>
            )}
            {USER_SITE_URL && (
              <a
                href={USER_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <ExternalLink className="w-3.5 h-3.5" /> User site
              </a>
            )}
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() => setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {firebaseUser && (
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 font-semibold"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
