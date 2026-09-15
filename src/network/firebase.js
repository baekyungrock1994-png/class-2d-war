import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

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

// Resolves once with the uid the first time sign-in completes. RoomService
// awaits this so it never touches the database before it's ready.
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

// .io-game style: no visible login step. An anonymous session (a stable uid,
// nothing else — no password, no linked account) is created silently the
// moment the app loads, so by the time a player has typed a nickname and
// clicked play, `authReady` has already resolved. Requires Anonymous sign-in
// to be enabled in the Firebase console (Authentication -> Sign-in method).
if (db) {
  signInAnonymously(auth).catch((err) => {
    console.warn("익명 로그인에 실패했습니다:", err);
  });
}

// Lets the UI react to sign-in completing, if it ever needs to.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
