import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

// Same Firebase project as the BANA user site (one shared database + one set of security rules).
// Firebase web config values are public identifiers; real protection is Firestore/Storage rules + admin roles.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCARq_SZRWktj5st9xyUTyVEl5LcGl0HqY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bana-a5770.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bana-a5770',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'bana-a5770.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '374199401810',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:374199401810:web:ad0470c40d6703b936ce8b',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Admin sessions end when the browser tab is closed (never persisted on disk).
setPersistence(auth, browserSessionPersistence).catch(() => {});

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || undefined;
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Must match the bootstrapped Super Admin email used in firestore.rules of the main project.
export const BOOTSTRAPPED_ADMIN_EMAIL = 'omor.faruk.sojol.2@gmail.com';

if (typeof window !== 'undefined' && import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // ignore duplicate initialization in dev
  }
}
