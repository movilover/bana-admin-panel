import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { BanaLogo } from '@/src/components/common/BanaLogo';

function friendlyAuthError(err: any): string {
  const code = String(err?.code || '');
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) {
    return 'Incorrect email or password.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorised in Firebase. Add it under Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  return 'Sign-in failed. Please try again.';
}

export function AdminLogin() {
  const { signInWithEmail, signInWithGoogle, sendResetEmail, idleSignedOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-5 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <BanaLogo />
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <LockKeyhole className="w-3.5 h-3.5" /> Admin Console — authorised staff only
          </div>
        </div>

        {idleSignedOut && (
          <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 p-2.5">
            You were signed out after a period of inactivity.
          </p>
        )}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email || !password) {
              setError('Enter your email and password.');
              return;
            }
            run(() => signInWithEmail(email, password));
          }}
        >
          <label className="block text-xs font-semibold space-y-1">
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2.5 text-sm font-normal outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block text-xs font-semibold space-y-1">
            Password
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2.5 pr-10 text-sm font-normal outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-rose-600">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </p>
          )}
          {info && <p className="text-xs text-emerald-600">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm py-2.5 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
          </button>
        </form>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(signInWithGoogle)}
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 text-sm font-semibold py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-60"
        >
          Continue with Google
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!email) {
              setError('Enter your email first, then tap “Forgot password”.');
              return;
            }
            run(async () => {
              await sendResetEmail(email);
              setInfo('If this email has an account, a reset link has been sent.');
            });
          }}
          className="block mx-auto text-xs text-neutral-500 hover:underline"
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
