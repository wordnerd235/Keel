// The parts of the Firebase JS SDK that Keel uses, bundled into one ES module
// (assets/vendor/firebase.js) so the app doesn't depend on a CDN and works offline.
// Rebuild: cd tools && npm install && npm run build-firebase
export { initializeApp } from "firebase/app";
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, connectAuthEmulator,
} from "firebase/auth";
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, FieldPath, writeBatch,
  waitForPendingWrites, getDoc, connectFirestoreEmulator,
} from "firebase/firestore";
export { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
