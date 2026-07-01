(function () {
  "use strict";

  // ---------- view switching ----------
  var viewSelect = document.getElementById("view-select");
  var viewComputer = document.getElementById("view-computer");
  var pickComputer = document.getElementById("pick-computer");
  var backLink = document.getElementById("back-link");

  if (pickComputer) {
    pickComputer.addEventListener("click", function () {
      viewSelect.classList.add("hidden");
      viewComputer.classList.remove("hidden");
      resetGame();
    });
  }
  if (backLink) {
    backLink.addEventListener("click", function (e) {
      e.preventDefault();
      viewComputer.classList.add("hidden");
      viewSelect.classList.remove("hidden");
    });
  }

  // ---------- state ----------
  var boardEl = document.getElementById("board");
  if (!boardEl) return; // page has no board (e.g. tournament page)

  var statusText = document.getElementById("status-text");
  var youSymbolLabel = document.getElementById("you-symbol");
  var scoreYouEl = document.getElementById("score-you");
  var scoreCpuEl = document.getElementById("score-cpu");
  var scoreDrawEl = document.getElementById("score-draw");

  var state = {
    cells: Array(9).fill(null),
    playerSymbol: "X",
    cpuSymbol: "O",
    difficulty: "normal",
    turn: "X",
    over: false,
    scores: { you: 0, cpu: 0, draw: 0 }
  };

  var WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  function renderBoard() {
    boardEl.innerHTML = "";
    state.cells.forEach(function (val, i) {
      var cell = document.createElement("div");
      cell.className = "cell" + (val ? " taken " + val.toLowerCase() : "");
      cell.textContent = val || "";
      cell.setAttribute("data-index", i);
      cell.addEventListener("click", function () { onCellClick(i); });
      boardEl.appendChild(cell);
    });
  }

  function checkWinner(cells) {
    for (var i = 0; i < WIN_LINES.length; i++) {
      var line = WIN_LINES[i];
      var a = cells[line[0]], b = cells[line[1]], c = cells[line[2]];
      if (a && a === b && b === c) return { symbol: a, line: line };
    }
    if (cells.every(function (c) { return c !== null; })) return { symbol: "draw", line: null };
    return null;
  }

  function onCellClick(i) {
    if (state.over || state.cells[i] || state.turn !== state.playerSymbol) return;
    playMove(i, state.playerSymbol);
    if (!state.over && state.turn === state.cpuSymbol) {
      setTimeout(cpuMove, 350);
    }
  }

  function playMove(i, symbol) {
    state.cells[i] = symbol;
    renderBoard();
    var result = checkWinner(state.cells);
    if (result) {
      endGame(result);
    } else {
      state.turn = state.turn === "X" ? "O" : "X";
      updateStatus();
    }
  }

  function endGame(result) {
    state.over = true;
    if (result.symbol === "draw") {
      state.scores.draw++;
      statusText.textContent = "Match nul";
    } else if (result.symbol === state.playerSymbol) {
      state.scores.you++;
      statusText.textContent = "Vous avez gagné !";
      highlightLine(result.line);
    } else {
      state.scores.cpu++;
      statusText.textContent = "L'ordinateur gagne";
      highlightLine(result.line);
    }
    scoreYouEl.textContent = state.scores.you;
    scoreCpuEl.textContent = state.scores.cpu;
    scoreDrawEl.textContent = state.scores.draw;
  }

  function highlightLine(line) {
    if (!line) return;
    var cells = boardEl.querySelectorAll(".cell");
    line.forEach(function (idx) { cells[idx].classList.add("win"); });
  }

  function updateStatus() {
    if (state.over) return;
    statusText.textContent = state.turn === state.playerSymbol
      ? "À vous de jouer"
      : "L'ordinateur réfléchit…";
  }

  // ---------- CPU AI ----------
  function cpuMove() {
    if (state.over) return;
    var empties = state.cells.map(function (v, i) { return v === null ? i : null; }).filter(function (v) { return v !== null; });
    var move;

    if (state.difficulty === "facile") {
      move = empties[Math.floor(Math.random() * empties.length)];
    } else if (state.difficulty === "normal") {
      move = Math.random() < 0.55
        ? bestMove(state.cells, state.cpuSymbol, state.playerSymbol)
        : empties[Math.floor(Math.random() * empties.length)];
    } else {
      move = bestMove(state.cells, state.cpuSymbol, state.playerSymbol);
    }

    playMove(move, state.cpuSymbol);
  }

  function bestMove(cells, cpu, human) {
    var bestScore = -Infinity;
    var move = null;
    cells.forEach(function (v, i) {
      if (v === null) {
        var copy = cells.slice();
        copy[i] = cpu;
        var score = minimax(copy, 0, false, cpu, human);
        if (score > bestScore) {
          bestScore = score;
          move = i;
        }
      }
    });
    return move;
  }

  function minimax(cells, depth, isMax, cpu, human) {
    var result = checkWinner(cells);
    if (result) {
      if (result.symbol === cpu) return 10 - depth;
      if (result.symbol === human) return depth - 10;
      return 0;
    }
    if (isMax) {
      var best = -Infinity;
      cells.forEach(function (v, i) {
        if (v === null) {
          var copy = cells.slice();
          copy[i] = cpu;
          best = Math.max(best, minimax(copy, depth + 1, false, cpu, human));
        }
      });
      return best;
    } else {
      var worst = Infinity;
      cells.forEach(function (v, i) {
        if (v === null) {
          var copy = cells.slice();
          copy[i] = human;
          worst = Math.min(worst, minimax(copy, depth + 1, true, cpu, human));
        }
      });
      return worst;
    }
  }

  // ---------- controls ----------
  document.getElementById("symbol-choice").addEventListener("click", function (e) {
    var pill = e.target.closest(".choice-pill");
    if (!pill) return;
    setSelected(this, pill);
    state.playerSymbol = pill.getAttribute("data-symbol");
    state.cpuSymbol = state.playerSymbol === "X" ? "O" : "X";
    youSymbolLabel.textContent = state.playerSymbol;
    resetGame();
  });

  document.getElementById("difficulty-choice").addEventListener("click", function (e) {
    var pill = e.target.closest(".choice-pill");
    if (!pill) return;
    setSelected(this, pill);
    state.difficulty = pill.getAttribute("data-level");
    resetGame();
  });

  function setSelected(container, pill) {
    container.querySelectorAll(".choice-pill").forEach(function (p) { p.classList.remove("selected"); });
    pill.classList.add("selected");
  }

  document.getElementById("restart-btn").addEventListener("click", resetGame);

  function resetGame() {
    state.cells = Array(9).fill(null);
    state.turn = "X";
    state.over = false;
    renderBoard();
    updateStatus();
    if (state.turn !== state.playerSymbol) {
      setTimeout(cpuMove, 350);
    }
  }

  renderBoard();
  updateStatus();
})();
