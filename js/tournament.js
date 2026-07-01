(function () {
  "use strict";

  // ---------- tabs ----------
  var tabs = document.querySelectorAll(".tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("panel-" + tab.getAttribute("data-tab")).classList.add("active");
    });
  });

  // ---------- pill choice groups ----------
  function wirePillGroup(id, onChange) {
    var group = document.getElementById(id);
    group.addEventListener("click", function (e) {
      var pill = e.target.closest(".choice-pill");
      if (!pill) return;
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
    type: { elimination: "Élimination directe", poules: "Championnat / Poules", suisse: "Rondes suisses" },
    visibilite: { prive: "Privé", public: "Public" },
    validation: { auto: "Automatique", manuelle: "Manuelle" },
    formatMatch: { "1": "1 manche sèche", "3": "Meilleur des 3", "5": "Meilleur des 5" },
    nul: { rejouer: "On rejoue", "demi-point": "0,5 pt chacun" },
    grille: { "3x3": "3 × 3", "4x4": "4 × 4", "5x5": "5 × 5" },
    chrono: { "0": "Sans limite" },
    duree: { "0": "Sans limite" }
  };

  function updateRecap() {
    document.getElementById("r-nom").textContent = document.getElementById("f-nom").value.trim() || "—";

    var type = document.getElementById("f-type").value;
    document.getElementById("r-type").textContent = LABELS.type[type];

    document.getElementById("r-joueurs").textContent = document.getElementById("f-nb-joueurs").value;

    var petiteFinaleWrap = document.getElementById("f-petite-finale-wrap");
    petiteFinaleWrap.style.display = type === "elimination" ? "" : "none";
    var petiteFinale = type === "elimination" && document.getElementById("f-petite-finale").checked;
    document.getElementById("r-petite-finale").textContent = petiteFinale ? "Oui" : "Non";

    document.getElementById("r-visibilite").textContent = LABELS.visibilite[getSelected("f-visibilite")];
    document.getElementById("r-validation").textContent = LABELS.validation[getSelected("f-validation")];
    document.getElementById("r-format-match").textContent = LABELS.formatMatch[getSelected("f-format-match")];
    document.getElementById("r-nul").textContent = LABELS.nul[getSelected("f-nul")];
    document.getElementById("r-grille").textContent = LABELS.grille[getSelected("f-grille")];

    var chronoVal = document.getElementById("f-chrono-coup").value;
    document.getElementById("r-chrono-coup").textContent = chronoVal === "0" ? "Sans limite" : chronoVal + " s";

    var dureeVal = document.getElementById("f-duree-match").value;
    document.getElementById("r-duree-match").textContent = dureeVal === "0" ? "Sans limite" : Math.round(dureeVal / 60) + " min";
  }

  ["f-type", "f-nb-joueurs", "f-petite-finale", "f-chrono-coup", "f-duree-match", "f-nom"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", updateRecap);
    document.getElementById(id).addEventListener("change", updateRecap);
  });

  ["f-visibilite", "f-validation", "f-format-match", "f-nul", "f-grille"].forEach(function (id) {
    wirePillGroup(id, updateRecap);
  });

  // ---------- launch ----------
  function generateCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "#";
    for (var i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  document.getElementById("launch-btn").addEventListener("click", function () {
    var config = {
      nom: document.getElementById("f-nom").value.trim() || "Tournoi sans nom",
      type: document.getElementById("f-type").value,
      nbJoueurs: document.getElementById("f-nb-joueurs").value,
      petiteFinale: document.getElementById("f-petite-finale").checked,
      visibilite: getSelected("f-visibilite"),
      validation: getSelected("f-validation"),
      formatMatch: getSelected("f-format-match"),
      gestionNul: getSelected("f-nul"),
      grille: getSelected("f-grille"),
      chronoCoup: document.getElementById("f-chrono-coup").value,
      dureeMatch: document.getElementById("f-duree-match").value,
      code: generateCode(),
      creeLe: new Date().toISOString()
    };

    try {
      var existing = JSON.parse(localStorage.getItem("maestro-tournaments") || "[]");
      existing.push(config);
      localStorage.setItem("maestro-tournaments", JSON.stringify(existing));
    } catch (e) {
      // localStorage indisponible : on continue sans persistance
    }

    document.getElementById("code-value").textContent = config.code;
    document.getElementById("code-block").classList.remove("hidden");

    var btn = document.getElementById("copy-code-btn");
    btn.onclick = function () {
      var text = window.location.origin + window.location.pathname.replace("tournament.html", "morpion.html") + "?code=" + encodeURIComponent(config.code);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        btn.textContent = "Lien copié";
        setTimeout(function () { btn.textContent = "Copier le lien d'invitation"; }, 1800);
      }
    };
  });

  updateRecap();
})();
