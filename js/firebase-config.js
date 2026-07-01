// ============================================================
// Configuration Firebase — Maestro Games
// ============================================================
// Étapes pour activer le mode "Jouer en ligne" :
//
// 1. Allez sur https://console.firebase.google.com et créez un projet
//    (gratuit, l'offre "Spark" suffit largement pour ce site).
//
// 2. Dans "Paramètres du projet" > "Vos applications", ajoutez une
//    application Web (icône </>). Copiez l'objet de configuration
//    fourni et collez ses valeurs ci-dessous.
//
// 3. Dans le menu "Build" > "Authentication" > onglet "Sign-in method",
//    activez le fournisseur "Anonyme". C'est nécessaire pour que chaque
//    visiteur ait une identité (uid) sans avoir à créer de compte.
//
// 4. Dans "Build" > "Firestore Database", créez une base en mode
//    production, puis remplacez les règles par défaut par celles du
//    fichier firestore.rules fourni à côté de ce fichier.
//
// 5. Remplacez les valeurs ci-dessous par celles de VOTRE projet, puis
//    déployez ce fichier avec le reste du site sur GitHub Pages.
// ============================================================

window.MAESTRO_FIREBASE_CONFIG = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "votre-projet.firebaseapp.com",
  projectId: "votre-projet",
  storageBucket: "votre-projet.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx"
};
