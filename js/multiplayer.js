(function () {
  "use strict";

  // ---------- éléments de la vue "sélection du mode" ----------
  var viewSelect = document.getElementById("view-select");
  var viewOnline = document.getElementById("view-online");
  var viewOnlineGame = document.getElementById("view-online-game");
  var pickOnline = document.getElementById("pick-online");

  if (!pickOnline) return; // page sans mode en ligne (sécurité)

  // ---------- éléments du lobby ----------
  var onlineChoice = document.getElementById("online-choice");
  var onlineCreateCard = document.getElementById("online-create");
  var onlineJoinCard = document.getElementById("online-join-card");
  var onlineJoinForm = document.getElementById("online-join-form");
  var onlineWaiting = document.getElementById("online-waiting");
  var joinCodeInput = document.getElementById("join-code-input");
  var joinCodeBtn = document.getElementById("join-code-btn");
  var joinError = document.getElementById("join-error");
  var joinErrorText = document.getElementById("join-error-text");
  var waitingCodeEl = document.getElementById("waiting-code");
  var copyWaitingBtn = document.getElementById("copy-waiting-code");
  var onlineBackLink = document.getElementById("online-back-link");

  // ---------- éléments de la partie ----------
  var onlineBoardEl = document.getElementById("online-board");
  var onlineStatusText = document.getElementById("online-status-text");
  var onlineYouSymbol = document.getElementById("online-you-symbol");
  var onlineCodeLabel = document.getElementById("online-code-label");
  var onlineScoreYouSymbol = document.getElementById("online-score-you-symbol");
  var onlineScoreYouEl = document.getElementById("online-score-you");
  var onlineScoreOppEl = document.getElementById("online-score-opp");
  var onlineScoreDrawEl = document.getElementById("online-score-draw");
  var onlineRematchBtn = document.getElementById("online-rematch-btn");
  var onlineLeaveLink = document.getElementById("online-leave-link");

  var WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  var db = null;
  var currentUid = null;
  var currentCode = null;
  var myRole = null; // "X" ou "O"
  var unsubscribe = null;

  function showView(view) {
    [viewSelect, viewOnline, viewOnlineGame].forEach(function (v) {
      if (v) v.classList.add("hidden");
    });
    view.classList.remove("hidden");
  }

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

  function generateCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "";
    for (var i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ---------- initialisation Firebase ----------
  function init() {
    if (typeof firebase === "undefined" || !window.MAESTRO_FIREBASE_CONFIG || window.MAESTRO_FIREBASE_CONFIG.apiKey === "VOTRE_API_KEY") {
      pickOnline.addEventListener("click", function () {
        alert("Le mode en ligne n'est pas encore configuré.\nComplétez js/firebase-config.js avec les clés de votre projet Firebase.");
      });
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(window.MAESTRO_FIREBASE_CONFIG);
    }
    db = firebase.firestore();

    wireLobby();
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
        alert("Connexion à Firebase impossible : " + err.message);
      });
    }
  }

  function wireLobby() {
    pickOnline.addEventListener("click", function () {
      resetLobby();
      showView(viewOnline);
    });

    onlineBackLink.addEventListener("click", function (e) {
      e.preventDefault();
      leaveGame();
      showView(viewSelect);
    });

    onlineCreateCard.addEventListener("click", createGame);

    onlineJoinCard.addEventListener("click", function () {
      onlineChoice.style.display = "none";
      onlineJoinForm.style.display = "";
      joinCodeInput.focus();
    });

    joinCodeBtn.addEventListener("click", function () {
      var code = joinCodeInput.value.trim().toUpperCase();
      if (code.length !== 4) {
        showJoinError("Le code doit comporter 4 caractères.");
        return;
      }
      joinGame(code);
    });

    joinCodeInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") joinCodeBtn.click();
    });

    onlineRematchBtn.addEventListener("click", requestRematch);

    onlineLeaveLink.addEventListener("click", function (e) {
      e.preventDefault();
      leaveGame();
      showView(viewSelect);
    });
  }

  function checkUrlCode() {
    var params = new URLSearchParams(window.location.search);
    var urlCode = params.get("code");
    if (urlCode && urlCode.length === 4) {
      resetLobby();
      showView(viewOnline);
      onlineChoice.style.display = "none";
      onlineJoinForm.style.display = "";
      joinCodeInput.value = urlCode.toUpperCase();
    }
  }

  function resetLobby() {
    onlineChoice.style.display = "";
    onlineJoinForm.style.display = "none";
    onlineWaiting.style.display = "none";
    joinError.classList.add("hidden");
    joinCodeInput.value = "";
  }

  function showJoinError(msg) {
    joinErrorText.textContent = msg;
    joinError.classList.remove("hidden");
  }

  // ---------- créer une partie ----------
  function createGame() {
    ensureAuth(function (uid) {
      var code = generateCode();
      var gameRef = db.collection("games").doc(code);
      var initialData = {
        board: "---------",
        turn: "X",
        playerX: uid,
        playerO: null,
        status: "waiting",
        winner: null,
        scores: { X: 0, O: 0, draw: 0 },
        rematch: { X: false, O: false },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      gameRef.set(initialData).then(function () {
        currentCode = code;
        myRole = "X";
        onlineChoice.style.display = "none";
        waitingCodeEl.textContent = code.split("").join(" ");
        onlineWaiting.style.display = "";

        copyWaitingBtn.onclick = function () {
          var link = window.location.origin + window.location.pathname + "?code=" + code;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(link);
            copyWaitingBtn.textContent = "Lien copié";
            setTimeout(function () { copyWaitingBtn.textContent = "Copier le lien d'invitation"; }, 1800);
          }
        };

        listenToGame(code);
      }).catch(function (err) {
        showJoinError("Impossible de créer la partie : " + err.message);
        onlineJoinForm.style.display = "";
      });
    });
  }

  // ---------- rejoindre une partie ----------
  function joinGame(code) {
    ensureAuth(function (uid) {
      var gameRef = db.collection("games").doc(code);
      gameRef.get().then(function (doc) {
        if (!doc.exists) {
          showJoinError("Aucune partie ne correspond à ce code.");
          return;
        }
        var data = doc.data();

        if (data.playerX === uid) { myRole = "X"; currentCode = code; listenToGame(code); return; }
        if (data.playerO === uid) { myRole = "O"; currentCode = code; listenToGame(code); return; }
        if (data.playerO) {
          showJoinError("Cette partie est déjà complète.");
          return;
        }

        gameRef.update({
          playerO: uid,
          status: "playing",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          myRole = "O";
          currentCode = code;
          listenToGame(code);
        }).catch(function (err) {
          showJoinError("Impossible de rejoindre : " + err.message);
        });
      }).catch(function (err) {
        showJoinError("Erreur de connexion : " + err.message);
      });
    });
  }

  // ---------- écoute temps réel ----------
  function listenToGame(code) {
    onlineCodeLabel.textContent = "#" + code;
    onlineYouSymbol.textContent = myRole;
    onlineScoreYouSymbol.textContent = myRole;
    showView(viewOnlineGame);

    if (unsubscribe) unsubscribe();
    unsubscribe = db.collection("games").doc(code).onSnapshot(function (doc) {
      if (!doc.exists) {
        onlineStatusText.textContent = "Cette partie n'existe plus.";
        return;
      }
      renderGame(doc.data());
    }, function (err) {
      onlineStatusText.textContent = "Connexion perdue : " + err.message;
    });
  }

  function renderGame(data) {
    var cells = boardStringToArray(data.board);

    onlineBoardEl.innerHTML = "";
    cells.forEach(function (val, i) {
      var cell = document.createElement("div");
      cell.className = "cell" + (val ? " taken " + val.toLowerCase() : "");
      cell.textContent = val || "";
      cell.setAttribute("data-index", i);
      cell.addEventListener("click", function () { onOnlineCellClick(i, data); });
      onlineBoardEl.appendChild(cell);
    });

    var opponentSymbol = myRole === "X" ? "O" : "X";
    onlineScoreYouEl.textContent = data.scores[myRole];
    onlineScoreOppEl.textContent = data.scores[opponentSymbol];
    onlineScoreDrawEl.textContent = data.scores.draw;

    if (data.status === "waiting") {
      onlineStatusText.textContent = "En attente d'un adversaire…";
    } else if (data.status === "playing") {
      onlineStatusText.textContent = data.turn === myRole ? "À vous de jouer" : "L'adversaire réfléchit…";
    } else if (data.status === "finished") {
      if (data.winner === "draw") {
        onlineStatusText.textContent = "Match nul";
      } else if (data.winner === myRole) {
        onlineStatusText.textContent = "Vous avez gagné !";
      } else {
        onlineStatusText.textContent = "L'adversaire a gagné";
      }
      var result = checkWinner(cells);
      if (result && result.line) {
        var cellEls = onlineBoardEl.querySelectorAll(".cell");
        result.line.forEach(function (idx) { cellEls[idx].classList.add("win"); });
      }
    }

    var iAskedRematch = data.rematch && data.rematch[myRole];
    onlineRematchBtn.disabled = data.status !== "finished";
    onlineRematchBtn.textContent = iAskedRematch ? "En attente de l'adversaire…" : "Rejouer";
  }

  // ---------- jouer un coup (transaction pour éviter les conflits) ----------
  function onOnlineCellClick(i, data) {
    if (!currentCode || data.status !== "playing" || data.turn !== myRole) return;
    if (data.board[i] !== "-") return;

    var gameRef = db.collection("games").doc(currentCode);
    db.runTransaction(function (tx) {
      return tx.get(gameRef).then(function (doc) {
        var d = doc.data();
        if (!d || d.status !== "playing" || d.turn !== myRole || d.board[i] !== "-") return;

        var boardArr = d.board.split("");
        boardArr[i] = myRole;
        var newBoard = boardArr.join("");
        var result = checkWinner(boardStringToArray(newBoard));

        var update = {
          board: newBoard,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (result) {
          update.status = "finished";
          update.winner = result.symbol;
          var scores = { X: d.scores.X, O: d.scores.O, draw: d.scores.draw };
          if (result.symbol === "draw") scores.draw++; else scores[result.symbol]++;
          update.scores = scores;
        } else {
          update.turn = myRole === "X" ? "O" : "X";
        }

        tx.update(gameRef, update);
      });
    }).catch(function (err) {
      onlineStatusText.textContent = "Erreur : " + err.message;
    });
  }

  // ---------- revanche (les deux joueurs doivent accepter) ----------
  function requestRematch() {
    if (!currentCode) return;
    var gameRef = db.collection("games").doc(currentCode);
    db.runTransaction(function (tx) {
      return tx.get(gameRef).then(function (doc) {
        var d = doc.data();
        if (!d || d.status !== "finished") return;

        var rematch = { X: !!(d.rematch && d.rematch.X), O: !!(d.rematch && d.rematch.O) };
        rematch[myRole] = true;

        if (rematch.X && rematch.O) {
          tx.update(gameRef, {
            board: "---------",
            turn: "X",
            status: "playing",
            winner: null,
            rematch: { X: false, O: false },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          tx.update(gameRef, { rematch: rematch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
      });
    });
  }

  function leaveGame() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    currentCode = null;
    myRole = null;
  }

  init();
})();
