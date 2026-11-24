import React, { Suspense, lazy } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ThemeProvider } from '@/src/contexts/ThemeContext';
import { ToastProvider } from '@/src/contexts/ToastContext';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { ErrorBoundary } from '@/src/components/common/ErrorBoundary';
import { AdminLogin } from '@/src/pages/AdminLogin';

const AdminPage = lazy(() => import('@/src/pages/AdminPage').then((m) => ({ default: m.AdminPage })));

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-xs text-neutral-500">
      {children}
    </div>
  );
}

function AccessDenied() {
  const { firebaseUser, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="font-display font-bold text-xl">Authorized Admin Access Required</h1>
        <p className="text-sm text-neutral-500">
          {firebaseUser?.email ? `${firebaseUser.email} does not have` : 'This account does not have'} an administrator role.
          Ask a Super Admin to grant access, then sign in again.
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="px-4 py-2 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-sm font-semibold"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function Gate() {
  const { firebaseUser, adminRole, loading } = useAuth();
  if (loading) return <FullScreenMessage>Verifying permissions...</FullScreenMessage>;
  if (!firebaseUser) return <AdminLogin />;
  if (!adminRole) return <AccessDenied />;
  return (
    <Suspense fallback={<FullScreenMessage>Loading admin console...</FullScreenMessage>}>
      <AdminPage />
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
