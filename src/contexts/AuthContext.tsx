import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, BOOTSTRAPPED_ADMIN_EMAIL } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import type { AdminRoleType, BanaUser, PlatformSettings } from '@/src/types/bana';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platformName: 'BANA',
  tagline: 'Discover More. Connect Better.',
  websiteTitle: 'BANA — Discover More. Connect Better.',
  websiteDescription:
    'Discover More. Connect Better. A vibrant, safe social platform with Communities, Reels, Messenger, Marketplace, and Creator Studio.',
  logoUrl: '',
  faviconUrl: '',
  maintenanceMode: false,
  maintenanceMessage: 'Scheduled upgrades are underway. Normal interactive services will resume shortly.',
  registrationOpen: true,
  allowGoogleSignIn: true,
  allowEmailPasswordSignIn: true,
  requireEmailVerification: true,
  enableReels: true,
  enableMarketplace: true,
  enableCalling: true,
  enableMessaging: true,
  enableCommunities: true,
  enableMonetization: true,
  enableAds: true,
  defaultPostVisibility: 'public',
  defaultMessagePrivacy: 'everyone',
  defaultAccountPrivate: false,
  defaultEmailNotifications: true,
  defaultPushNotifications: true,
  contentPolicyText:
    'Share original, authentic content. Harassment, hate speech, non-consensual media, fraud, and illegal goods are prohibited.',
  communityGuidelinesText:
    'Respect community members, verify facts before sharing, disclose sponsored content transparently, and keep spaces safe for everyone.',
  announcementEnabled: false,
  announcementMessage: '',
  announcementSeverity: 'info',
};

const VALID_ADMIN_ROLES: string[] = [
  'super_admin',
  'admin',
  'moderator',
  'support_staff',
  'finance_manager',
  'ad_manager',
  'content_manager',
  'support_manager',
];

// Auto sign-out after this many idle minutes (override with VITE_ADMIN_IDLE_MINUTES).
const IDLE_MINUTES = Number(import.meta.env.VITE_ADMIN_IDLE_MINUTES) > 0 ? Number(import.meta.env.VITE_ADMIN_IDLE_MINUTES) : 30;

interface AdminAuthContextValue {
  firebaseUser: FirebaseUser | null;
  /** Minimal profile (display name only) - the admin console never creates or edits user-site profiles. */
  profile: BanaUser | null;
  adminRole: AdminRoleType | null;
  claimsAdminRole: AdminRoleType | null;
  platformSettings: PlatformSettings;
  loading: boolean;
  idleSignedOut: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendResetEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AdminAuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRoleType | null>(null);
  const [claimsAdminRole, setClaimsAdminRole] = useState<AdminRoleType | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [idleSignedOut, setIdleSignedOut] = useState(false);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAdminRole(null);
        setClaimsAdminRole(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      let claimRole: AdminRoleType | null = null;
      try {
        const token = await user.getIdTokenResult();
        const v = token?.claims?.adminRole;
        if (typeof v === 'string' && VALID_ADMIN_ROLES.includes(v)) claimRole = v as AdminRoleType;
      } catch {
        claimRole = null;
      }
      setClaimsAdminRole(claimRole);

      // Same order as the user site: custom claim -> verified bootstrapped Super Admin email -> adminRoles/{uid}.
      let resolved: AdminRoleType | null = null;
      if (claimRole) {
        resolved = claimRole;
      } else if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified) {
        resolved = 'super_admin';
        invokeCloudFunction('syncMyAdminClaims')
          .then(() => user.getIdTokenResult(true))
          .then((r) => {
            const v = r?.claims?.adminRole;
            if (typeof v === 'string' && VALID_ADMIN_ROLES.includes(v)) setClaimsAdminRole(v as AdminRoleType);
          })
          .catch(() => {});
      } else {
        try {
          const snap = await getDoc(doc(db, 'adminRoles', user.uid));
          const r = snap.exists() ? snap.data()?.role : null;
          resolved = typeof r === 'string' && VALID_ADMIN_ROLES.includes(r) ? (r as AdminRoleType) : null;
        } catch {
          resolved = null;
        }
      }
      setAdminRole(resolved);

      if (resolved) {
        try {
          const s = await getDoc(doc(db, 'adminSettings', 'platform'));
          if (s.exists()) setPlatformSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...(s.data() as Partial<PlatformSettings>) });
        } catch {
          // keep defaults
        }
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  // Idle auto sign-out for signed-in admins.
  useEffect(() => {
    if (!firebaseUser) return;
    const reset = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        setIdleSignedOut(true);
        signOut(auth).catch(() => {});
      }, IDLE_MINUTES * 60 * 1000);
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [firebaseUser]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setIdleSignedOut(false);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setIdleSignedOut(false);
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const sendResetEmail = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const profile = useMemo<BanaUser | null>(
    () =>
      firebaseUser
        ? ({
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'BANA Admin',
            avatarUrl: firebaseUser.photoURL || '',
          } as unknown as BanaUser)
        : null,
    [firebaseUser]
  );

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      adminRole,
      claimsAdminRole,
      platformSettings,
      loading,
      idleSignedOut,
      signInWithEmail,
      signInWithGoogle,
      sendResetEmail,
      logout,
    }),
    [firebaseUser, profile, adminRole, claimsAdminRole, platformSettings, loading, idleSignedOut, signInWithEmail, signInWithGoogle, sendResetEmail, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AdminAuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
