// js/firebase-config.js
// =========================================================
// GANTI DENGAN KONFIGURASI FIREBASE KAMU
// Buat project di https://console.firebase.google.com
// Aktifkan: Realtime Database + Authentication (Anonymous)
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBL8MKPahsWBpVwIbXcHY5bLWlfKMlQzDg",
  authDomain: "tebakkata-6faba.firebaseapp.com",
  databaseURL: "https://tebakkata-6faba-default-rtdb.firebaseio.com",
  projectId: "tebakkata-6faba",
  storageBucket: "tebakkata-6faba.firebasestorage.app",
  messagingSenderId: "497076890001",
  appId: "1:497076890001:web:0f335faf6d54b828151230",
  measurementId: "G-2X90Z3235T"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

let _uid = null;
let _authPromise = null;

export async function ensureAuth() {
  if (_uid) return _uid;
  // Reuse in-flight auth promise so parallel calls don't race
  if (!_authPromise) {
    _authPromise = (async () => {
      if (auth.currentUser) {
        _uid = auth.currentUser.uid;
        return _uid;
      }
      const cred = await signInAnonymously(auth);
      _uid = cred.user.uid;
      return _uid;
    })();
  }
  return _authPromise;
}

export function getCurrentUID() { return _uid; }
