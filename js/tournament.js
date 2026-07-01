(function () {
  "use strict";

  // ============================================================
  // Maestro Games — Tournoi à élimination directe (Firebase)
  // ============================================================
  // Modèle de données Firestore :
  //
  // tournaments/{code}
  //   nom, type: "elimination", nbJoueursMax, petiteFinale,
  //   visibilite, validation, formatMatch, gestionNul, grille,
  //   chronoCoup, dureeMatch,
  //   organisateur (uid), organisateurPseudo,
  //   statut: "inscription" | "en_cours" | "termine",
  //   joueurs: [{ uid, pseudo, statut: "accepte"|"attente", inscritLe }],
  //   bracket: [ { nom, matches: [ { id, joueurX, joueurO, pseudoX,
  //                pseudoO, bye, statut, vainqueur, matchCree } ] } ],
  //   petiteFinaleMatch: même forme qu'un match du bracket, ou null,
  //   vainqueurFinal, vainqueurPseudo
  //
  // tournaments/{code}/matches/{matchId}
  //   board, turn, playerX, playerO, pseudoX, pseudoO, statut,
  //   manchesGagnees: {X, O}, manchesJoueesTotal, mancheEnCours,
  //   manchesNecessaires, manchesTotal, gestionNul, suddenDeath,
  //   vainqueurMatch, tieBreakSymbole, chronoCoupSecondes,
  //   dureeMatchSecondes, coupDeadline, matchDeadline
  //
  // La progression du bracket (propagation des vainqueurs, création
  // de la petite finale, fin de tournoi) est gérée par transaction,
  // déclenchée par le client qui vient de terminer un match.
  // ============================================================

  var WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  var STATUT_LABELS = { attente: "En attente", en_cours: "En cours", termine: "Terminé" };

  // ---------- éléments : vue builder ----------
  var viewBuilder = document.getElementById("view-builder");
  var viewLobby = document.getElementById("view-lobby");
  var viewBracket = document.getElementById("view-bracket");
  var viewMatch = document.getElementById("view-match");

  if (!viewBuilder) return; // sécurité si la page change

  var tabs = document.querySelectorAll(".tab");
  var launchBtn = document.getElementById("launch-btn");
  var launchError = document.getElementById("launch-error");
  var launchErrorText = document.getElementById("launch-error-text");

  var tjJoinCode = document.getElementById("tj-join-code");
  var tjJoinBtn = document.getElementById("tj-join-btn");
  var tjPseudo = document.getElementById("tj-pseudo");
  var tjJoinError = document.getElementById("tj-join-error");
  var tjJoinErrorText = document.getElementById("tj-join-error-text");

  // ---------- éléments : lobby ----------
  var lobbyNom = document.getElementById("lobby-nom");
  var lobbyCode = document.getElementById("lobby-code");
  var lobbyCount = document.getElementById("lobby-count");
  var lobbyMax = document.getElementById("lobby-max");
  var lobbyPlayers = document.getElementById("lobby-players");
  var lobbyStartBtn = document.getElementById("lobby-start-btn");
  var lobbyCopyBtn = document.getElementById("lobby-copy-btn");
  var lobbyLeaveLink = document.getElementById("lobby-leave-link");
  var lobbyMsg = document.getElementById("lobby-msg");
  var lobbyMsgText = document.getElementById("lobby-msg-text");

  // ---------- éléments : bracket ----------
  var bracketNom = document.getElementById("bracket-nom");
  var bracketSub = document.getElementById("bracket-sub");
  var bracketRoundsEl = document.getElementById("bracket-rounds");
  var petiteFinaleBlock = document.getElementById("petite-finale-block");
  var bracketPfEl = document.getElementById("bracket-pf");
  var championBanner = document.getElementById("champion-banner");
  var championName = document.getElementById("champion-name");

  // ---------- éléments : match ----------
  var tmBoard = document.getElementById("tm-board");
  var tmYouSymbol = document.getElementById("tm-you-symbol");
  var tmOpponentLine = document.getElementById("tm-opponent-line");
  var tmStatusText = document.getElementById("tm-status-text");
  var tmChronoCard = document.getElementById("tm-chrono-card");
  var tmChronoValue = document.getElementById("tm-chrono-value");
  var tmChronoBar = document.getElementById("tm-chrono-bar");
  var tmMancheActuelle = document.getElementById("tm-manche-actuelle");
  var tmMancheTotal = document.getElementById("tm-manche-total");
  var tmScoreYou = document.getElementById("tm-score-you");
  var tmScoreOpp = document.getElementById("tm-score-opp");
  var tmDureeValue = document.getElementById("tm-duree-value");
  var tmBackBracketBtn = document.getElementById("tm-back-bracket-btn");

  // ---------- état ----------
  var db = null;
  var currentUid = null;
  var currentCode = null;
  var currentMatchId = null;
  var lastTournoiData = null;
  var lastMatchData = null;
  var unsubTournoi = null;
  var unsubMatch = null;
  var matchTimerInterval = null;

  function showView(view) {
    [viewBuilder, viewLobby, viewBracket, viewMatch].forEach(function (v) {
      if (v) v.classList.add("hidden");
    });
    view.classList.remove("hidden");
  }

  // ============================================================
  // Onglets + pastilles + récapitulatif (formulaire de création)
  // ============================================================
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("panel-" + tab.getAttribute("data-tab")).classList.add("active");
    });
  });

  function wirePillGroup(id, onChange) {
    var group = document.getElementById(id);
    group.addEventListener("click", function (e) {
      var pill = e.target.closest(".choice-pill");
      if (!pill || pill.classList.contains("disabled")) return;
      group.querySelectorAll(".choice-pill").forEach(function (p) { p.classList.remove("selected"); });
      pill.classList.add("selected");
      onChange(pill.getAttribute("data-value"));
    });
  }

  function getSelected(id) {
    var pill = document.querySelector("#" + id + " .choice-pill.selected");
    return pill ? pill.getAttribute("data-value") : null;
  }

  var LABELS = {
    type: { elimination: "Élimination directe" },
    visibilite: { prive: "Privé", public: "Public" },
    validation: { auto: "Automatique", manuelle: "Manuelle" },
    formatMatch: { "1": "1 manche sèche", "3": "Meilleur des 3", "5": "Meilleur des 5" },
    nul: { rejouer: "On rejoue", "demi-point": "0,5 pt chacun" },
    grille: { "3x3": "3 × 3" }
  };

  function updateRecap() {
    document.getElementById("r-nom").textContent = document.getElementById("f-nom").value.trim() || "—";
    document.getElementById("r-type").textContent = LABELS.type.elimination;
    document.getElementById("r-joueurs").textContent = document.getElementById("f-nb-joueurs").value;

    var petiteFinale = document.getElementById("f-petite-finale").checked;
    document.getElementById("r-petite-finale").textContent = petiteFinale ? "Oui" : "Non";

    document.getElementById("r-visibilite").textContent = LABELS.visibilite[getSelected("f-visibilite")];
    document.getElementById("r-validation").textContent = LABELS.validation[getSelected("f-validation")];
    document.getElementById("r-format-match").textContent = LABELS.formatMatch[getSelected("f-format-match")];
    document.getElementById("r-nul").textContent = LABELS.nul[getSelected("f-nul")];
    document.getElementById("r-grille").textContent = "3 × 3";

    var chronoVal = document.getElementById("f-chrono-coup").value;
    document.getElementById("r-chrono-coup").textContent = chronoVal === "0" ? "Sans limite" : chronoVal + " s";

    var dureeVal = document.getElementById("f-duree-match").value;
    document.getElementById("r-duree-match").textContent = dureeVal === "0" ? "Sans limite" : Math.round(dureeVal / 60) + " min";
  }

  ["f-nb-joueurs", "f-petite-finale", "f-chrono-coup", "f-duree-match", "f-nom"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", updateRecap);
    document.getElementById(id).addEventListener("change", updateRecap);
  });
  ["f-visibilite", "f-validation", "f-format-match", "f-nul"].forEach(function (id) {
    wirePillGroup(id, updateRecap);
  });
  document.getElementById("f-grille"); // grille verrouillée sur 3x3 en V1

  updateRecap();

  // ============================================================
  // Init Firebase
  // ============================================================
  function init() {
    if (typeof firebase === "undefined" || !window.MAESTRO_FIREBASE_CONFIG || window.MAESTRO_FIREBASE_CONFIG.apiKey === "VOTRE_API_KEY") {
      launchBtn.addEventListener("click", function () {
        showLaunchError("Le mode tournoi en ligne n'est pas encore configuré. Complétez js/firebase-config.js avec les clés de votre projet Firebase.");
      });
      tjJoinBtn.addEventListener("click", function () {
        showJoinError("Le mode tournoi en ligne n'est pas encore configuré.");
      });
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(window.MAESTRO_FIREBASE_CONFIG);
    }
    db = firebase.firestore();

    wireBuilder();
    wireLobby();
    wireMatch();
    checkUrlCode();
  }

  function ensureAuth(callback) {
    if (currentUid) { callback(currentUid); return; }
    var unsub = firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        currentUid = user.uid;
        unsub();
        callback(currentUid);
      }
    });
    if (!firebase.auth().currentUser) {
      firebase.auth().signInAnonymously().catch(function (err) {
        showLaunchError("Connexion à Firebase impossible : " + err.message);
      });
    }
  }

  function generateCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "";
    for (var i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function showLaunchError(msg) {
    launchErrorText.textContent = msg;
    launchError.classList.remove("hidden");
  }
  function showJoinError(msg) {
    tjJoinErrorText.textContent = msg;
    tjJoinError.classList.remove("hidden");
  }

  function checkUrlCode() {
    var params = new URLSearchParams(window.location.search);
    var urlCode = params.get("code");
    if (urlCode && urlCode.length === 4) {
      tjJoinCode.value = urlCode.toUpperCase();
      tjPseudo.focus();
    }
  }

  // ============================================================
  // Création + inscription
  // ============================================================
  function wireBuilder() {
    launchBtn.addEventListener("click", function () {
      launchError.classList.add("hidden");
      var pseudo = document.getElementById("f-pseudo").value.trim();
      var nom = document.getElementById("f-nom").value.trim() || "Tournoi sans nom";
      if (!pseudo) { showLaunchError("Merci d'indiquer votre pseudo."); return; }

      ensureAuth(function (uid) {
        var code = generateCode();
        var cfg = {
          nom: nom,
          type: "elimination",
          nbJoueursMax: parseInt(document.getElementById("f-nb-joueurs").value, 10),
          petiteFinale: document.getElementById("f-petite-finale").checked,
          visibilite: getSelected("f-visibilite"),
          validation: getSelected("f-validation"),
          formatMatch: getSelected("f-format-match"),
          gestionNul: getSelected("f-nul"),
          grille: "3x3",
          chronoCoup: parseInt(document.getElementById("f-chrono-coup").value, 10),
          dureeMatch: parseInt(document.getElementById("f-duree-match").value, 10)
        };

        var tournoiData = Object.assign({}, cfg, {
          organisateur: uid,
          organisateurPseudo: pseudo,
          statut: "inscription",
          joueurs: [{ uid: uid, pseudo: pseudo, statut: "accepte", inscritLe: Date.now() }],
          bracket: [],
          petiteFinaleMatch: null,
          vainqueurFinal: null,
          vainqueurPseudo: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        db.collection("tournaments").doc(code).set(tournoiData).then(function () {
          currentCode = code;
          listenTournoi(code);
        }).catch(function (err) {
          showLaunchError("Impossible de créer le tournoi : " + err.message);
        });
      });
    });

    tjJoinBtn.addEventListener("click", function () {
      tjJoinError.classList.add("hidden");
      var code = tjJoinCode.value.trim().toUpperCase();
      var pseudo = tjPseudo.value.trim();
      if (code.length !== 4) { showJoinError("Le code doit comporter 4 caractères."); return; }
      if (!pseudo) { showJoinError("Merci d'indiquer votre pseudo."); return; }

      ensureAuth(function (uid) {
        var ref = db.collection("tournaments").doc(code);
        db.runTransaction(function (tx) {
          return tx.get(ref).then(function (doc) {
            if (!doc.exists) throw new Error("Aucun tournoi ne correspond à ce code.");
            var t = doc.data();
            var joueurs = t.joueurs.slice();
            var deja = joueurs.some(function (j) { return j.uid === uid; });
            if (deja) return;
            if (t.statut !== "inscription") throw new Error("Les inscriptions sont closes pour ce tournoi.");
            if (joueurs.length >= t.nbJoueursMax) throw new Error("Ce tournoi est complet.");
            joueurs.push({
              uid: uid,
              pseudo: pseudo,
              statut: t.validation === "manuelle" ? "attente" : "accepte",
              inscritLe: Date.now()
            });
            tx.update(ref, { joueurs: joueurs, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          });
        }).then(function () {
          currentCode = code;
          listenTournoi(code);
        }).catch(function (err) {
          showJoinError(err.message);
        });
      });
    });
  }

  // ============================================================
  // Écoute du document tournoi + routage entre les vues
  // ============================================================
  function listenTournoi(code) {
    if (unsubTournoi) unsubTournoi();
    unsubTournoi = db.collection("tournaments").doc(code).onSnapshot(function (doc) {
      if (!doc.exists) return;
      var t = doc.data();
      lastTournoiData = t;
      if (t.statut === "inscription") {
        renderLobby(t);
        showView(viewLobby);
      } else {
        renderBracket(t);
        if (viewMatch.classList.contains("hidden")) {
          showView(viewBracket);
        }
      }
    }, function (err) {
      console.error("Erreur d'écoute du tournoi :", err);
    });
  }

  // ============================================================
  // Lobby
  // ============================================================
  function renderLobby(t) {
    lobbyNom.textContent = t.nom;
    lobbyCode.textContent = currentCode.split("").join(" ");
    lobbyCount.textContent = t.joueurs.length;
    lobbyMax.textContent = t.nbJoueursMax;

    var isOrganisateur = t.organisateur === currentUid;

    lobbyPlayers.innerHTML = "";
    t.joueurs.forEach(function (j) {
      var row = document.createElement("div");
      row.className = "player-row";

      var nameWrap = document.createElement("div");
      nameWrap.className = "p-name";
      var nameSpan = document.createElement("span");
      nameSpan.textContent = j.pseudo;
      nameWrap.appendChild(nameSpan);
      if (j.uid === t.organisateur) {
        var tag = document.createElement("span");
        tag.className = "p-tag";
        tag.textContent = "Organisateur";
        nameWrap.appendChild(tag);
      }
      row.appendChild(nameWrap);

      var actions = document.createElement("div");
      actions.className = "p-actions";

      var statusEl = document.createElement("span");
      statusEl.className = "p-status " + j.statut;
      statusEl.textContent = j.statut === "accepte" ? "Accepté" : "En attente";
      actions.appendChild(statusEl);

      if (isOrganisateur && j.statut === "attente") {
        var acceptBtn = document.createElement("button");
        acceptBtn.className = "btn btn-outline btn-sm";
        acceptBtn.textContent = "Accepter";
        acceptBtn.onclick = function () { setPlayerStatus(j.uid, "accepte"); };
        var refuseBtn = document.createElement("button");
        refuseBtn.className = "btn btn-ghost btn-sm";
        refuseBtn.textContent = "Refuser";
        refuseBtn.onclick = function () { setPlayerStatus(j.uid, "refuse"); };
        actions.appendChild(acceptBtn);
        actions.appendChild(refuseBtn);
      }

      row.appendChild(actions);
      lobbyPlayers.appendChild(row);
    });

    var acceptedCount = t.joueurs.filter(function (j) { return j.statut === "accepte"; }).length;
    lobbyStartBtn.style.display = isOrganisateur ? "" : "none";
    lobbyStartBtn.disabled = acceptedCount < 2;

    lobbyMsg.classList.toggle("hidden", !(isOrganisateur && acceptedCount < 2));
    lobbyMsgText.textContent = "Il faut au moins 2 joueurs acceptés pour démarrer le tournoi.";
  }

  function wireLobby() {
    lobbyStartBtn.addEventListener("click", demarrerTournoi);

    lobbyCopyBtn.addEventListener("click", function () {
      var link = window.location.origin + window.location.pathname + "?code=" + currentCode;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link);
        lobbyCopyBtn.textContent = "Lien copié";
        setTimeout(function () { lobbyCopyBtn.textContent = "Copier le lien d'invitation"; }, 1800);
      }
    });

    lobbyLeaveLink.addEventListener("click", function () {
      quitterTournoi();
    });
  }

  function setPlayerStatus(uid, statut) {
    var ref = db.collection("tournaments").doc(currentCode);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (doc) {
        var t = doc.data();
        var joueurs;
        if (statut === "refuse") {
          joueurs = t.joueurs.filter(function (j) { return j.uid !== uid; });
        } else {
          joueurs = t.joueurs.map(function (j) {
            return j.uid === uid ? Object.assign({}, j, { statut: statut }) : j;
          });
        }
        tx.update(ref, { joueurs: joueurs, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
    });
  }

  function quitterTournoi() {
    if (unsubTournoi) { unsubTournoi(); unsubTournoi = null; }
    if (unsubMatch) { unsubMatch(); unsubMatch = null; }
    if (matchTimerInterval) { clearInterval(matchTimerInterval); matchTimerInterval = null; }
    currentCode = null;
    lastTournoiData = null;
  }

  // ============================================================
  // Construction du bracket (élimination directe)
  // ============================================================
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function nextPowerOfTwo(n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function nomDuTour(roundIndex, size) {
    var restants = size / Math.pow(2, roundIndex);
    if (restants === 2) return "Finale";
    if (restants === 4) return "Demi-finale";
    if (restants === 8) return "Quart de finale";
    return "Tour de " + restants;
  }

  function buildBracket(joueurs) {
    var players = shuffle(joueurs);
    var size = nextPowerOfTwo(Math.max(2, players.length));
    var slots = players.slice();
    while (slots.length < size) slots.push(null);

    var round0Matches = [];
    for (var i = 0; i < size; i += 2) {
      var pX = slots[i], pO = slots[i + 1];
      round0Matches.push({
        id: "r0m" + (i / 2),
        joueurX: pX ? pX.uid : null,
        joueurO: pO ? pO.uid : null,
        pseudoX: pX ? pX.pseudo : null,
        pseudoO: pO ? pO.pseudo : null,
        bye: !pX || !pO,
        statut: (!pX || !pO) ? "termine" : "en_cours",
        vainqueur: (!pX && pO) ? pO.uid : ((!pO && pX) ? pX.uid : null),
        matchCree: false
      });
    }

    var rounds = [{ nom: nomDuTour(0, size), matches: round0Matches }];
    var nbTours = Math.log2(size);
    for (var r = 1; r < nbTours; r++) {
      var nbMatches = size / Math.pow(2, r + 1);
      var matches = [];
      for (var m = 0; m < nbMatches; m++) {
        matches.push({
          id: "r" + r + "m" + m,
          joueurX: null, joueurO: null, pseudoX: null, pseudoO: null,
          bye: false, statut: "attente", vainqueur: null, matchCree: false
        });
      }
      rounds.push({ nom: nomDuTour(r, size), matches: matches });
    }
    return rounds;
  }

  function propagateWinners(rounds) {
    for (var r = 0; r < rounds.length - 1; r++) {
      var round = rounds[r];
      var nextRound = rounds[r + 1];
      round.matches.forEach(function (m, idx) {
        if (m.statut === "termine" && m.vainqueur) {
          var nextMatch = nextRound.matches[Math.floor(idx / 2)];
          var isX = idx % 2 === 0;
          var pseudo = m.vainqueur === m.joueurX ? m.pseudoX : m.pseudoO;
          if (isX) { nextMatch.joueurX = m.vainqueur; nextMatch.pseudoX = pseudo; }
          else { nextMatch.joueurO = m.vainqueur; nextMatch.pseudoO = pseudo; }
        }
      });
      nextRound.matches.forEach(function (nm) {
        if (nm.statut === "attente" && nm.joueurX && nm.joueurO) {
          nm.statut = "en_cours";
        }
      });
    }
    return rounds;
  }

  function demarrerTournoi() {
    var ref = db.collection("tournaments").doc(currentCode);
    ref.get().then(function (doc) {
      var t = doc.data();
      if (t.organisateur !== currentUid) return;
      var acceptes = t.joueurs.filter(function (j) { return j.statut === "accepte"; });
      if (acceptes.length < 2) { alert("Il faut au moins 2 joueurs acceptés pour démarrer."); return; }

      var rounds = buildBracket(acceptes.map(function (j) { return { uid: j.uid, pseudo: j.pseudo }; }));
      propagateWinners(rounds);

      var batch = db.batch();
      rounds.forEach(function (round) {
        round.matches.forEach(function (m) {
          if (m.statut === "en_cours" && !m.matchCree) {
            m.matchCree = true;
            var mRef = db.collection("tournaments").doc(currentCode).collection("matches").doc(m.id);
            batch.set(mRef, initialMatchData(m, t));
          }
        });
      });
      batch.update(ref, { statut: "en_cours", bracket: rounds, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      batch.commit();
    });
  }

  // ============================================================
  // Rendu du bracket
  // ============================================================
  function renderBracket(t) {
    bracketNom.textContent = t.nom;

    if (t.statut === "termine") {
      championBanner.classList.remove("hidden");
      championName.textContent = t.vainqueurPseudo || "—";
      bracketSub.textContent = "Le tournoi est terminé.";
    } else {
      championBanner.classList.add("hidden");
      bracketSub.textContent = "Cliquez sur \"Jouer\" lorsque votre match est prêt.";
    }

    bracketRoundsEl.innerHTML = "";
    t.bracket.forEach(function (round) {
      var col = document.createElement("div");
      col.className = "bracket-round";

      var title = document.createElement("div");
      title.className = "bracket-round-title";
      title.textContent = round.nom;
      col.appendChild(title);

      round.matches.forEach(function (m) {
        col.appendChild(renderMatchCard(m));
      });

      bracketRoundsEl.appendChild(col);
    });

    if (t.petiteFinale && t.petiteFinaleMatch) {
      petiteFinaleBlock.classList.remove("hidden");
      bracketPfEl.innerHTML = "";
      bracketPfEl.appendChild(renderMatchCard(t.petiteFinaleMatch));
    } else {
      petiteFinaleBlock.classList.add("hidden");
    }
  }

  function renderMatchCard(m) {
    var card = document.createElement("div");
    card.className = "match-card " + m.statut;

    card.appendChild(renderMatchSlot(m.pseudoX, m.vainqueur && m.vainqueur === m.joueurX));
    card.appendChild(renderMatchSlot(m.pseudoO, m.vainqueur && m.vainqueur === m.joueurO));

    var meta = document.createElement("div");
    meta.className = "match-meta";
    var label = document.createElement("span");
    label.textContent = m.bye ? "Qualifié (bye)" : STATUT_LABELS[m.statut];
    meta.appendChild(label);

    var estJoueur = currentUid && (m.joueurX === currentUid || m.joueurO === currentUid);
    if (m.statut === "en_cours" && estJoueur) {
      var playBtn = document.createElement("button");
      playBtn.className = "btn btn-gold btn-sm";
      playBtn.textContent = "Jouer";
      playBtn.onclick = function () { ouvrirMatch(m.id); };
      meta.appendChild(playBtn);
    }

    card.appendChild(meta);
    return card;
  }

  function renderMatchSlot(pseudo, estVainqueur) {
    var slot = document.createElement("div");
    slot.className = "match-slot" + (estVainqueur ? " vainqueur" : "");
    var span = document.createElement("span");
    if (pseudo) {
      span.textContent = pseudo;
    } else {
      span.className = "empty";
      span.textContent = "En attente…";
    }
    slot.appendChild(span);
    if (estVainqueur) {
      var check = document.createElement("span");
      check.textContent = "✓";
      slot.appendChild(check);
    }
    return slot;
  }

  // ============================================================
  // Données initiales d'un match
  // ============================================================
  function initialMatchData(matchEntry, cfg) {
    var manchesTotal = parseInt(cfg.formatMatch, 10);
    var manchesNecessaires = Math.ceil(manchesTotal / 2);
    var now = Date.now();
    var chronoCoupSecondes = parseInt(cfg.chronoCoup, 10) || 0;
    var dureeMatchSecondes = parseInt(cfg.dureeMatch, 10) || 0;

    return {
      board: "---------",
      turn: "X",
      playerX: matchEntry.joueurX,
      playerO: matchEntry.joueurO,
      pseudoX: matchEntry.pseudoX,
      pseudoO: matchEntry.pseudoO,
      statut: "en_cours",
      manchesGagnees: { X: 0, O: 0 },
      manchesJoueesTotal: 0,
      mancheEnCours: 1,
      manchesNecessaires: manchesNecessaires,
      manchesTotal: manchesTotal,
      gestionNul: cfg.gestionNul,
      suddenDeath: false,
      vainqueurMatch: null,
      vainqueurSymbole: null,
      tieBreakSymbole: Math.random() < 0.5 ? "X" : "O",
      chronoCoupSecondes: chronoCoupSecondes,
      dureeMatchSecondes: dureeMatchSecondes,
      coupDeadline: chronoCoupSecondes > 0 ? now + chronoCoupSecondes * 1000 : null,
      matchDeadline: dureeMatchSecondes > 0 ? now + dureeMatchSecondes * 1000 : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  // ============================================================
  // Logique de jeu (partagée coup normal / coup forcé par le chrono)
  // ============================================================
  function boardStringToArray(str) {
    return str.split("").map(function (c) { return c === "-" ? null : c; });
  }

  function checkWinner(cells) {
    for (var i = 0; i < WIN_LINES.length; i++) {
      var line = WIN_LINES[i];
      var a = cells[line[0]], b = cells[line[1]], c = cells[line[2]];
      if (a && a === b && b === c) return { symbol: a, line: line };
    }
    if (cells.indexOf(null) === -1) return { symbol: "draw", line: null };
    return null;
  }

  function applyCellPlay(m, index, symbol) {
    var boardArr = m.board.split("");
    boardArr[index] = symbol;
    var newBoard = boardArr.join("");
    var result = checkWinner(boardStringToArray(newBoard));
    var update = { board: newBoard, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    if (!result) {
      update.turn = symbol === "X" ? "O" : "X";
      update.coupDeadline = m.chronoCoupSecondes > 0 ? Date.now() + m.chronoCoupSecondes * 1000 : null;
      return update;
    }

    // manche nulle : on rejoue (mode "rejouer", ou toujours en mort subite)
    if (result.symbol === "draw" && (m.gestionNul === "rejouer" || m.suddenDeath)) {
      update.board = "---------";
      update.turn = m.turn === "X" ? "O" : "X";
      update.coupDeadline = m.chronoCoupSecondes > 0 ? Date.now() + m.chronoCoupSecondes * 1000 : null;
      return update;
    }

    // manche décisive, ou nulle comptabilisée (demi-point)
    var manchesGagnees = { X: m.manchesGagnees.X, O: m.manchesGagnees.O };
    var manchesJoueesTotal = m.manchesJoueesTotal + 1;

    if (result.symbol === "draw") {
      manchesGagnees.X += 0.5;
      manchesGagnees.O += 0.5;
    } else {
      manchesGagnees[result.symbol] += 1;
    }

    var seriesWinner = null;
    if (!m.suddenDeath) {
      if (manchesGagnees.X >= m.manchesNecessaires) seriesWinner = "X";
      else if (manchesGagnees.O >= m.manchesNecessaires) seriesWinner = "O";
      else if (manchesJoueesTotal >= m.manchesTotal) {
        if (manchesGagnees.X > manchesGagnees.O) seriesWinner = "X";
        else if (manchesGagnees.O > manchesGagnees.X) seriesWinner = "O";
        // sinon égalité exacte -> mort subite
      }
    } else if (result.symbol !== "draw") {
      seriesWinner = result.symbol;
    }

    update.manchesGagnees = manchesGagnees;
    update.manchesJoueesTotal = manchesJoueesTotal;

    if (seriesWinner) {
      update.statut = "termine";
      update.vainqueurMatch = seriesWinner === "X" ? m.playerX : m.playerO;
      update.vainqueurSymbole = seriesWinner;
      update.coupDeadline = null;
    } else {
      var entreeMortSubite = !m.suddenDeath && manchesJoueesTotal >= m.manchesTotal;
      update.suddenDeath = m.suddenDeath || entreeMortSubite;
      update.mancheEnCours = m.mancheEnCours + 1;
      update.board = "---------";
      update.turn = update.mancheEnCours % 2 === 1 ? "X" : "O";
      update.coupDeadline = m.chronoCoupSecondes > 0 ? Date.now() + m.chronoCoupSecondes * 1000 : null;
    }

    return update;
  }

  function findMatchEntry(t, matchId) {
    if (t.petiteFinaleMatch && t.petiteFinaleMatch.id === matchId) {
      return { entry: t.petiteFinaleMatch, isPF: true };
    }
    for (var r = 0; r < t.bracket.length; r++) {
      for (var mi = 0; mi < t.bracket[r].matches.length; mi++) {
        if (t.bracket[r].matches[mi].id === matchId) {
          return { entry: t.bracket[r].matches[mi], isPF: false };
        }
      }
    }
    return null;
  }

  function updateBracketAfterMatch(t, matchId, vainqueurUid, tx, tRef) {
    var found = findMatchEntry(t, matchId);
    if (!found) return;

    if (found.isPF) {
      t.petiteFinaleMatch.statut = "termine";
      t.petiteFinaleMatch.vainqueur = vainqueurUid;
      tx.update(tRef, {
        petiteFinaleMatch: t.petiteFinaleMatch,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    found.entry.statut = "termine";
    found.entry.vainqueur = vainqueurUid;

    propagateWinners(t.bracket);

    var matchesCol = db.collection("tournaments").doc(currentCode).collection("matches");
    t.bracket.forEach(function (round) {
      round.matches.forEach(function (m) {
        if (m.statut === "en_cours" && !m.matchCree) {
          m.matchCree = true;
          tx.set(matchesCol.doc(m.id), initialMatchData(m, t));
        }
      });
    });

    var updateFields = { bracket: t.bracket, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    if (t.petiteFinale && t.bracket.length >= 2 && !t.petiteFinaleMatch) {
      var demiFinale = t.bracket[t.bracket.length - 2];
      var pretPourPF = demiFinale.matches.length === 2 &&
        demiFinale.matches.every(function (m) { return m.statut === "termine" && m.joueurX && m.joueurO; });
      if (pretPourPF) {
        var perdants = demiFinale.matches.map(function (m) {
          var uid = m.vainqueur === m.joueurX ? m.joueurO : m.joueurX;
          var pseudo = m.vainqueur === m.joueurX ? m.pseudoO : m.pseudoX;
          return { uid: uid, pseudo: pseudo };
        });
        var pf = {
          id: "petite-finale",
          joueurX: perdants[0].uid, pseudoX: perdants[0].pseudo,
          joueurO: perdants[1].uid, pseudoO: perdants[1].pseudo,
          statut: "en_cours", vainqueur: null, bye: false, matchCree: true
        };
        tx.set(matchesCol.doc(pf.id), initialMatchData(pf, t));
        t.petiteFinaleMatch = pf;
        updateFields.petiteFinaleMatch = pf;
      }
    }

    var finale = t.bracket[t.bracket.length - 1];
    if (finale.matches[0].statut === "termine") {
      var fm = finale.matches[0];
      t.statut = "termine";
      t.vainqueurFinal = fm.vainqueur;
      t.vainqueurPseudo = fm.vainqueur === fm.joueurX ? fm.pseudoX : fm.pseudoO;
      updateFields.statut = "termine";
      updateFields.vainqueurFinal = t.vainqueurFinal;
      updateFields.vainqueurPseudo = t.vainqueurPseudo;
    }

    tx.update(tRef, updateFields);
  }

  function matchesColRef() {
    return db.collection("tournaments").doc(currentCode).collection("matches");
  }
  function tournoiDocRef() {
    return db.collection("tournaments").doc(currentCode);
  }

  function runMoveTransaction(matchId, index, forced) {
    var tRef = tournoiDocRef();
    var mRef = matchesColRef().doc(matchId);
    return db.runTransaction(function (tx) {
      return Promise.all([tx.get(mRef), tx.get(tRef)]).then(function (res) {
        var mDoc = res[0], tDoc = res[1];
        if (!mDoc.exists || !tDoc.exists) return;
        var m = mDoc.data();
        if (m.statut !== "en_cours") return;

        var symbol, playIndex;
        if (forced) {
          if (!m.coupDeadline || Date.now() < m.coupDeadline) return;
          symbol = m.turn;
          var empties = [];
          m.board.split("").forEach(function (c, i) { if (c === "-") empties.push(i); });
          if (!empties.length) return;
          playIndex = empties[Math.floor(Math.random() * empties.length)];
        } else {
          symbol = (m.playerX === currentUid) ? "X" : (m.playerO === currentUid ? "O" : null);
          if (!symbol || m.turn !== symbol) return;
          if (m.board[index] !== "-") return;
          playIndex = index;
        }

        var update = applyCellPlay(m, playIndex, symbol);
        tx.update(mRef, update);

        if (update.statut === "termine") {
          var t = tDoc.data();
          updateBracketAfterMatch(t, matchId, update.vainqueurMatch, tx, tRef);
        }
      });
    }).catch(function (err) { console.error("Erreur de coup :", err); });
  }

  function runMatchDeadlineTransaction(matchId) {
    var tRef = tournoiDocRef();
    var mRef = matchesColRef().doc(matchId);
    return db.runTransaction(function (tx) {
      return Promise.all([tx.get(mRef), tx.get(tRef)]).then(function (res) {
        var mDoc = res[0], tDoc = res[1];
        if (!mDoc.exists || !tDoc.exists) return;
        var m = mDoc.data();
        if (m.statut !== "en_cours" || !m.matchDeadline || Date.now() < m.matchDeadline) return;

        var seriesWinner;
        if (m.manchesGagnees.X > m.manchesGagnees.O) seriesWinner = "X";
        else if (m.manchesGagnees.O > m.manchesGagnees.X) seriesWinner = "O";
        else seriesWinner = m.tieBreakSymbole;

        var update = {
          statut: "termine",
          vainqueurMatch: seriesWinner === "X" ? m.playerX : m.playerO,
          vainqueurSymbole: seriesWinner,
          terminePar: "duree_max",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        tx.update(mRef, update);
        var t = tDoc.data();
        updateBracketAfterMatch(t, matchId, update.vainqueurMatch, tx, tRef);
      });
    }).catch(function (err) { console.error("Erreur de fin de match :", err); });
  }

  // ============================================================
  // Vue "match"
  // ============================================================
  function ouvrirMatch(matchId) {
    currentMatchId = matchId;
    showView(viewMatch);
    if (unsubMatch) unsubMatch();
    unsubMatch = matchesColRef().doc(matchId).onSnapshot(function (doc) {
      if (!doc.exists) return;
      lastMatchData = doc.data();
      renderMatch(lastMatchData);
    });
    if (matchTimerInterval) clearInterval(matchTimerInterval);
    matchTimerInterval = setInterval(function () {
      if (!lastMatchData) return;
      if (lastMatchData.statut === "en_cours") {
        if (lastMatchData.coupDeadline && Date.now() >= lastMatchData.coupDeadline) {
          runMoveTransaction(currentMatchId, null, true);
        }
        if (lastMatchData.matchDeadline && Date.now() >= lastMatchData.matchDeadline) {
          runMatchDeadlineTransaction(currentMatchId);
        }
      }
      renderTimers(lastMatchData);
    }, 500);
  }

  function wireMatch() {
    tmBackBracketBtn.addEventListener("click", function () {
      if (unsubMatch) { unsubMatch(); unsubMatch = null; }
      if (matchTimerInterval) { clearInterval(matchTimerInterval); matchTimerInterval = null; }
      currentMatchId = null;
      showView(viewBracket);
      if (lastTournoiData) renderBracket(lastTournoiData);
    });
  }

  function renderMatch(m) {
    var mySymbol = (m.playerX === currentUid) ? "X" : (m.playerO === currentUid ? "O" : null);
    var oppSymbol = mySymbol === "X" ? "O" : "X";
    var oppPseudo = mySymbol === "X" ? m.pseudoO : m.pseudoX;

    tmYouSymbol.textContent = mySymbol || "?";
    tmOpponentLine.textContent = "Face à " + (oppPseudo || "—");

    tmBoard.innerHTML = "";
    var cells = boardStringToArray(m.board);
    cells.forEach(function (val, i) {
      var cell = document.createElement("div");
      cell.className = "cell" + (val ? " taken " + val.toLowerCase() : "");
      cell.textContent = val || "";
      cell.addEventListener("click", function () {
        if (m.statut === "en_cours" && m.turn === mySymbol && !val) {
          runMoveTransaction(currentMatchId, i, false);
        }
      });
      tmBoard.appendChild(cell);
    });

    tmMancheActuelle.textContent = Math.min(m.mancheEnCours, m.manchesTotal) + (m.suddenDeath ? " (mort subite)" : "");
    tmMancheTotal.textContent = m.manchesTotal;
    tmScoreYou.textContent = m.manchesGagnees[mySymbol];
    tmScoreOpp.textContent = m.manchesGagnees[oppSymbol];

    if (m.statut === "termine") {
      if (m.vainqueurMatch === currentUid) {
        tmStatusText.textContent = "Vous avez gagné le match !";
      } else {
        tmStatusText.textContent = "Vous avez perdu ce match.";
      }
    } else {
      tmStatusText.textContent = m.turn === mySymbol ? "À vous de jouer" : "L'adversaire réfléchit…";
    }

    renderTimers(m);
  }

  function renderTimers(m) {
    if (!m) return;

    if (m.statut === "termine" || !m.chronoCoupSecondes) {
      tmChronoCard.style.display = m.chronoCoupSecondes ? "" : "none";
      tmChronoValue.textContent = "—";
      tmChronoBar.style.width = "0%";
    } else if (m.coupDeadline) {
      var restant = Math.max(0, m.coupDeadline - Date.now());
      var pct = Math.max(0, Math.min(100, (restant / (m.chronoCoupSecondes * 1000)) * 100));
      tmChronoValue.textContent = Math.ceil(restant / 1000) + " s";
      tmChronoBar.style.width = pct + "%";
      tmChronoBar.classList.toggle("urgent", restant < 3000);
    }

    if (!m.dureeMatchSecondes) {
      tmDureeValue.textContent = "Sans limite";
    } else if (m.statut === "termine") {
      tmDureeValue.textContent = m.terminePar === "duree_max" ? "Terminé (temps écoulé)" : "Terminé";
    } else if (m.matchDeadline) {
      var restantMs = Math.max(0, m.matchDeadline - Date.now());
      var min = Math.floor(restantMs / 60000);
      var sec = Math.floor((restantMs % 60000) / 1000);
      tmDureeValue.textContent = min + ":" + (sec < 10 ? "0" : "") + sec;
    }
  }

  init();
})();
