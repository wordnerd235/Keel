# Setting up Keel

About 15 minutes, once. Everything here is free.

## 1. Publish the site (GitHub Pages)

1. In this repository on GitHub: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
2. Every push to `main` deploys through `.github/workflows/pages.yml`.
3. The site is at `https://<your-username>.github.io/Keel/`.

The site and code are public. Your data is not in the repository: it lives in your Firebase project
(or in each browser, if you skip Firebase).

## 2. Create the Firebase project (sync across devices)

In the [Firebase console](https://console.firebase.google.com):

1. **Create a project** named `keel`. Google Analytics is not needed.
2. **Build > Firestore Database > Create database.** Choose a US location and **production mode**.
3. **Build > Authentication > Get started > Sign-in method > Email/Password > Enable > Save.**
4. **Authentication > Users > Add user**, with your email and a password. Add one for anyone else in the
   household who should have access.
5. Also under **Authentication > Settings > User actions**, turn off **Enable create (sign-up)**, so nobody else
   can make an account in your project.
6. **Project settings (gear) > General > Your apps > Web (`</>`)**: register an app named "Keel" (no Hosting).
   Copy the `firebaseConfig` values into `assets/firebase-config.js`, replacing `export default null;`:

   ```js
   export default {
     apiKey: "…",
     authDomain: "….firebaseapp.com",
     projectId: "…",
     storageBucket: "….firebasestorage.app",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

   These values are not secret. Security comes from the rules in the next step.

## 3. Lock the database to your household

1. **Firestore Database > Rules**: replace everything with the contents of [`firestore.rules`](firestore.rules),
   then **Publish**.
2. **Authentication > Users**: copy the **User UID** of each person who should have access.
3. **Firestore Database > Data > Start collection** named `members`. For each person, add a document whose
   **Document ID is their User UID**, with one field such as `name` (string) = their name.

If you sign in before doing this, Keel shows your User UID with a Copy button.

## 4. Photo reading (optional)

- **Gemini (free):** in the Firebase console, **Build > AI Logic > Get started**, and choose the
  **Gemini Developer API**. Keep the project on the free Spark plan (no billing account) and the free tier is
  all it can use. Keel tries current Gemini Flash model names in order; if Google renames them, set one in
  Settings > Photo reading > Advanced.
- **Claude:** create an API key at [platform.claude.com](https://platform.claude.com) (Settings > API Keys),
  add prepaid credits under Billing, and paste the key into Keel's Settings on each device where you scan.

## 5. Bring in your data

1. Open Keel and sign in.
2. **Settings > Backup > Restore from a file**, and choose your `keel-backup-….json`.
3. That's it. Every signed-in device now sees the same data.

Keel can download a fresh backup any time (Settings > Backup). Firestore also keeps the data, but a periodic
backup file is cheap insurance.

## Free-plan limits

Firebase's free Spark plan allows about 50,000 reads and 20,000 writes a day and 1 GiB stored. A household
uses a small fraction of that. If a limit is ever hit, requests are refused until the next day; nothing is
billed.
