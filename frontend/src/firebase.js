import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Only initialize if a real apiKey exists — prevents crash when .env is not set
let auth = null;

if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'undefined') {
  try {
    const app = getApps().length
      ? getApps()[0]
      : initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (e) {
    console.warn('[Firebase] Init failed — running in demo mode.', e.message);
  }
} else {
  console.info('[Firebase] No API key found — running in demo mode.');
}

export { auth };
