import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// getDatabase() throws synchronously if databaseURL isn't a real Realtime
// Database URL yet (see firebaseConfig.js). Solo/offline play never touches
// `db`, so a missing/placeholder URL shouldn't break the whole app — only
// online features should fail, with a clear message, when actually used.
export let db = null;
try {
  db = getDatabase(app);
} catch (err) {
  console.warn(
    "Realtime Database가 아직 설정되지 않았습니다 (firebaseConfig.js의 databaseURL 확인). " +
      "오프라인(혼자 연습) 모드는 정상 동작하지만, 온라인 매치는 사용할 수 없습니다.",
    err
  );
}

let currentUid = null;
let currentUser = null;
export function getUid() {
  return currentUid;
}
export function getCurrentUser() {
  return currentUser;
}

// Resolves once with the uid the first time a real sign-in happens. RoomService
// awaits this so it never touches the database before login completes.
let readyResolve;
let readyResolved = false;
export const authReady = new Promise((resolve) => {
  readyResolve = resolve;
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  currentUid = user ? user.uid : null;
  if (user && !readyResolved) {
    readyResolved = true;
    readyResolve(user.uid);
  }
});

// Lets the UI react to sign-in/sign-out (login screen <-> user badge).
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}
