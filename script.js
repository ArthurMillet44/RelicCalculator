"use strict";

/* =====================================================================
 * Calculateur de reliques Warframe
 *
 * Règles modélisées :
 *  - une ouverture = `draws` tirages indépendants de la relique ciblée
 *    (4 en 4b4, 2 en 2b2) ;
 *  - tu ne peux récupérer qu'UN seul loot par ouverture : on prend la
 *    pièce voulue dont il te manque le plus d'exemplaires ;
 *  - `openingsPerRelic` = nombre d'ouvertures auxquelles tu participes
 *    par relique "bonne" dépensée (2 en 2b2 : l'autre ouverture se fait
 *    avec une relique aléatoire).
 *
 * Les besoins sont communs à toutes les reliques : une pièce présente dans
 * plusieurs reliques compte pour le même objectif. À chaque ouverture, on
 * prend la pièce voulue dont il manque le plus d'exemplaires (le surplus
 * n'est pris que s'il n'y a rien d'autre d'utile). En mode "sets voulus",
 * on ouvre à chaque fois la relique la plus utile pour ce qu'il manque.
 * ===================================================================== */

/* ---------- Cœur de calcul (utilisable aussi sous Node) ---------- */

function partKey(prime, part) {
  return prime + "|" + part;
}

/**
 * Nombre d'exemplaires d'une pièce nécessaires pour construire un set.
 * @param {Object|null} sets composition des sets, { "Prime": { "Pièce": n } }.
 * @param {string} prime nom du set (ex. "Akstiletto").
 * @param {string} part nom de la pièce (ex. "Barrel").
 * @returns {number} la quantité (1 si la composition est inconnue).
 */
function partQuantity(sets, prime, part) {
  const q = sets && sets[prime] ? Number(sets[prime][part]) : NaN;
  return q >= 1 ? Math.floor(q) : 1;
}

function buildItems(relic, refinement) {
  const items = relic.items.map(function (it) {
    return Object.assign({}, it, { w: Number(refinement[it.rarity]) || 0 });
  });
  const total = items.reduce(function (s, i) {
    return s + i.w;
  }, 0);
  let acc = 0;
  items.forEach(function (i) {
    i.p = total > 0 ? i.w / total : 0;
    acc += i.p;
    i.cum = acc;
  });
  return items;
}

// Sets disponibles : ceux déclarés dans "primes" (optionnel) + tous ceux détectés
// dans les items des reliques (champs "prime" et "part").
function catalogPrimes(data) {
  const cat = {};
  function add(prime, part) {
    if (!cat[prime]) cat[prime] = [];
    if (cat[prime].indexOf(part) === -1) cat[prime].push(part);
  }
  Object.keys(data.primes || {}).forEach(function (p) {
    data.primes[p].forEach(function (part) {
      add(p, part);
    });
  });
  data.relics.forEach(function (r) {
    r.items.forEach(function (it) {
      if (it.prime && it.part) add(it.prime, it.part);
    });
  });
  const sorted = {};
  Object.keys(cat)
    .sort()
    .forEach(function (p) {
      sorted[p] = cat[p];
    });
  return sorted;
}

// Pièces réellement présentes dans au moins une relique.
function presentKeys(data) {
  const out = {};
  data.relics.forEach(function (r) {
    r.items.forEach(function (it) {
      if (it.prime && it.part) out[partKey(it.prime, it.part)] = true;
    });
  });
  return out;
}

function defaultRefinementKey(data) {
  return data.refinements.radiant
    ? "radiant"
    : Object.keys(data.refinements)[0];
}

// Raffinement de chaque relique (choisi par relique, Radiant par défaut).
function refinementKeyFor(data, cfg, name) {
  const rc = (cfg.relics && cfg.relics[name]) || {};
  const relic = data.relics.find(function (r) {
    return r.name === name;
  });
  const k = rc.refinement || cfg.refinement;
  if (data.refinements[k]) return k;
  if (relic && data.refinements[relic.defaultRefinement])
    return relic.defaultRefinement;
  return defaultRefinementKey(data);
}

function planSimulation(data, cfg) {
  const warnings = [];
  const wanted = {};

  const catalog = catalogPrimes(data);
  Object.keys(cfg.targets).forEach(function (prime) {
    const parts = (cfg.parts && cfg.parts[prime]) || catalog[prime];
    if (!parts) return;
    parts.forEach(function (part) {
      // cfg.sets (optionnel) : composition des sets, pour les pièces en plusieurs exemplaires.
      const perSet = partQuantity(cfg.sets, prime, part);
      wanted[partKey(prime, part)] = {
        prime: prime,
        part: part,
        perSet: perSet,
        target: cfg.targets[prime] * perSet,
        sources: [],
        missing: false,
      };
    });
  });

  const tables = {};
  data.relics.forEach(function (r) {
    tables[r.name] = {
      relic: r,
      items: buildItems(
        r,
        data.refinements[refinementKeyFor(data, cfg, r.name)],
      ),
    };
  });

  // Les reliques qui contiennent une pièce voulue sont des sources de cette pièce.
  // cfg.sources (optionnel) restreint les sources : { "Prime|Pièce": [reliques] }.
  data.relics.forEach(function (r) {
    tables[r.name].items.forEach(function (it) {
      if (!it.prime) return;
      const k = partKey(it.prime, it.part);
      const allowed = cfg.sources && cfg.sources[k];
      if (allowed && allowed.indexOf(r.name) === -1) return;
      if (wanted[k] && wanted[k].sources.indexOf(r.name) === -1)
        wanted[k].sources.push(r.name);
    });
  });

  Object.keys(wanted).forEach(function (k) {
    if (!wanted[k].sources.length) {
      wanted[k].missing = true;
      const label = wanted[k].prime + " " + wanted[k].part;
      warnings.push(
        cfg.sources && cfg.sources[k]
          ? "Aucune relique sélectionnée pour " + label + "."
          : "Aucune relique du JSON ne contient " + label + ".",
      );
    }
  });

  const relicNames = data.relics
    .map(function (r) {
      return r.name;
    })
    .filter(function (n) {
      return Object.keys(wanted).some(function (k) {
        return wanted[k].sources.indexOf(n) !== -1;
      });
    });

  return {
    wanted: wanted,
    tables: tables,
    relicNames: relicNames,
    warnings: warnings,
  };
}

function pickIndex(items, r) {
  for (let i = 0; i < items.length; i++) {
    if (r < items[i].cum) return i;
  }
  return items.length - 1;
}

function mean(arr) {
  return (
    arr.reduce(function (s, v) {
      return s + v;
    }, 0) / (arr.length || 1)
  );
}

function percentile(arr, p) {
  const s = arr.slice().sort(function (a, b) {
    return a - b;
  });
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

function runSimulation(data, cfg, rng) {
  rng = rng || Math.random;
  const plan = planSimulation(data, cfg);
  const runs = cfg.runs;
  const mode = cfg.mode;
  const takeRare = !!cfg.takeRare;

  const keys = Object.keys(plan.wanted).filter(function (k) {
    return !plan.wanted[k].missing;
  });
  const keyIdx = {};
  keys.forEach(function (k, i) {
    keyIdx[k] = i;
  });
  const target = keys.map(function (k) {
    return plan.wanted[k].target;
  });

  const R = plan.relicNames.map(function (name) {
    const rc = (cfg.relics && cfg.relics[name]) || {};
    const relic = plan.tables[name].relic;
    const methodKey =
      rc.method || relic.defaultMethod || Object.keys(data.methods)[0];
    const method = data.methods[methodKey];
    const items = plan.tables[name].items;
    const itemK = items.map(function (it) {
      if (!it.prime) return -1;
      const k = keyIdx[partKey(it.prime, it.part)];
      return k === undefined ? -1 : k;
    });
    // Pièces pour lesquelles cette relique a été choisie comme source
    // (une pièce voulue tombée d'une autre relique reste récupérable).
    const useful = [];
    itemK.forEach(function (k, i) {
      if (k >= 0 && plan.wanted[keys[k]].sources.indexOf(name) !== -1)
        useful.push(i);
    });
    return {
      name: name,
      methodKey: methodKey,
      method: method,
      refKey: refinementKeyFor(data, cfg, name),
      buf: new Array(method.draws),
      N: method.draws,
      opr: method.openingsPerRelic || 1,
      fixedCount: Math.max(0, Math.floor(Number(rc.count) || 0)),
      items: items,
      itemK: itemK,
      useful: useful,
    };
  });

  const openedRuns = R.map(function () {
    return [];
  });
  const picksRuns = keys.map(function () {
    return [];
  });
  const appearedSum = keys.map(function () {
    return 0;
  });
  const lostRare = keys.map(function () {
    return 0;
  });
  const lostOther = keys.map(function () {
    return 0;
  });
  const rarePicks = R.map(function (r) {
    return r.items.map(function () {
      return 0;
    });
  });

  for (let run = 0; run < runs; run++) {
    const picks = keys.map(function () {
      return 0;
    });
    const opened = R.map(function () {
      return 0;
    });
    let queue = null;
    let qi = 0;
    if (mode === "fixed") {
      queue = [];
      R.forEach(function (r, ri) {
        for (let i = 0; i < r.fixedCount * r.opr; i++) queue.push(ri);
      });
      shuffle(queue, rng);
    }

    let total = 0;
    while (total < 5e6) {
      let ri;
      if (mode === "target") {
        let done = true;
        for (let k = 0; k < keys.length; k++) {
          if (picks[k] < target[k]) {
            done = false;
            break;
          }
        }
        if (done) break;
        // On ouvre la relique la plus utile pour ce qu'il manque encore.
        let best = -1;
        let bestValue = 0;
        for (let x = 0; x < R.length; x++) {
          const r = R[x];
          let q = 0;
          for (let u = 0; u < r.useful.length; u++) {
            const idx = r.useful[u];
            if (picks[r.itemK[idx]] < target[r.itemK[idx]]) q += r.items[idx].p;
          }
          if (q <= 0) continue;
          const v = r.opr * (1 - Math.pow(1 - q, r.N));
          if (v > bestValue) {
            bestValue = v;
            best = x;
          }
        }
        if (best < 0) break;
        ri = best;
      } else {
        if (qi >= queue.length) break;
        ri = queue[qi++];
      }

      const r = R[ri];
      opened[ri]++;
      total++;

      // Un seul loot récupéré par ouverture.
      // Option "loot or" : si un rare apparaît, on le prend quoi qu'il arrive à côté
      // (s'il y en a plusieurs, on préfère celui dont il manque le plus).
      // Sinon : la pièce voulue dont il manque le plus d'exemplaires.
      let bestK = -1;
      let bestNeed = -Infinity;
      let bestD = -1;
      let rareIdx = -1;
      let rareK = -1;
      let rareNeed = -Infinity;
      let rareD = -1;
      for (let d = 0; d < r.N; d++) {
        const idx = pickIndex(r.items, rng());
        r.buf[d] = idx;
        const k = r.itemK[idx];
        if (k >= 0) {
          appearedSum[k]++;
          const need = target[k] - picks[k];
          if (need > bestNeed) {
            bestNeed = need;
            bestK = k;
            bestD = d;
          }
        }
        if (takeRare && r.items[idx].rarity === "rare") {
          const need = k >= 0 ? target[k] - picks[k] : -Infinity;
          if (rareIdx < 0 || (k >= 0 && need > rareNeed)) {
            rareIdx = idx;
            rareK = k;
            rareNeed = need;
            rareD = d;
          }
        }
      }
      let chosenD = -1;
      if (rareIdx >= 0) {
        chosenD = rareD;
        if (rareK >= 0) picks[rareK]++;
        else rarePicks[ri][rareIdx]++;
      } else if (bestK >= 0) {
        chosenD = bestD;
        picks[bestK]++;
      }
      // Pièces voulues apparues mais non prises (loot or / autres)
      for (let d = 0; d < r.N; d++) {
        if (d === chosenD) continue;
        const idx = r.buf[d];
        const k = r.itemK[idx];
        if (k >= 0) {
          if (r.items[idx].rarity === "rare") lostRare[k]++;
          else lostOther[k]++;
        }
      }
    }

    R.forEach(function (r, i) {
      openedRuns[i].push(opened[i]);
    });
    picks.forEach(function (v, k) {
      picksRuns[k].push(v);
    });
  }

  // Reliques dépensées par type (en 2b2, 1 relique pour 2 ouvertures)
  const relicsRuns = R.map(function (r, i) {
    return openedRuns[i].map(function (o) {
      return Math.ceil(o / r.opr);
    });
  });

  const relicResults = R.map(function (r, i) {
    const relicsMean = mean(relicsRuns[i]);
    const openingsMean = mean(openedRuns[i]);
    return {
      name: r.name,
      methodKey: r.methodKey,
      methodLabel: r.method.label || r.methodKey,
      refKey: r.refKey,
      relicsMean: relicsMean,
      relicsP95: percentile(relicsRuns[i], 0.95),
      junkMean: openingsMean - relicsMean,
      openingsMean: openingsMean,
    };
  });

  const parts = keys.map(function (key, k) {
    const w = plan.wanted[key];
    const appeared = appearedSum[k] / runs;
    const picked = mean(picksRuns[k]);
    return {
      prime: w.prime,
      part: w.part,
      sources: w.sources,
      perSet: w.perSet,
      target: w.target,
      appeared: appeared,
      picked: picked,
      lost: appeared - picked,
      lostRare: lostRare[k] / runs,
      lostOther: lostOther[k] / runs,
    };
  });

  const rares = [];
  if (takeRare) {
    R.forEach(function (r, ri) {
      r.items.forEach(function (it, idx) {
        if (it.rarity === "rare" && r.itemK[idx] < 0) {
          rares.push({
            relic: r.name,
            name: it.name,
            picked: rarePicks[ri][idx] / runs,
          });
        }
      });
    });
  }

  const totalPerRun = [];
  for (let r = 0; r < runs; r++) {
    let t = 0;
    relicsRuns.forEach(function (arr) {
      t += arr[r];
    });
    totalPerRun.push(t);
  }
  const totals = {
    relicsMean: mean(totalPerRun),
    relicsP95: percentile(totalPerRun, 0.95),
    junkMean: relicResults.reduce(function (s, r) {
      return s + r.junkMean;
    }, 0),
  };

  return {
    warnings: plan.warnings,
    relics: relicResults,
    parts: parts,
    rares: rares,
    totals: totals,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    runSimulation: runSimulation,
    planSimulation: planSimulation,
    catalogPrimes: catalogPrimes,
    presentKeys: presentKeys,
    defaultRefinementKey: defaultRefinementKey,
    partQuantity: partQuantity,
  };
}

/* ---------- Interface (navigateur uniquement) ---------- */

if (typeof document !== "undefined") {
  (function () {
    let data = null;
    let sets = null; // composition des sets (sets.json), null si non chargée
    const state = { mode: "target", rows: [], relics: {} };

    const $ = function (id) {
      return document.getElementById(id);
    };
    const fmt = function (n, d) {
      return n.toLocaleString("fr-FR", {
        minimumFractionDigits: d || 0,
        maximumFractionDigits: d || 0,
      });
    };
    const esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c];
      });
    };

    function validate(d) {
      if (!d || typeof d !== "object")
        throw new Error("Le JSON doit être un objet.");
      d.primes = d.primes || {};
      ["refinements", "methods", "primes"].forEach(function (k) {
        if (!d[k] || typeof d[k] !== "object")
          throw new Error("Clé manquante ou invalide : '" + k + "'.");
      });
      if (!Array.isArray(d.relics))
        throw new Error("'relics' doit être une liste.");
      d.relics.forEach(function (r, i) {
        if (!r.name || !Array.isArray(r.items) || !r.items.length) {
          throw new Error(
            "Relique #" + (i + 1) + " : 'name' et 'items' sont requis.",
          );
        }
        r.items.forEach(function (it) {
          if (!["common", "uncommon", "rare"].includes(it.rarity)) {
            throw new Error(
              "Relique '" +
                r.name +
                "' : rareté invalide pour '" +
                it.name +
                "'.",
            );
          }
        });
      });
    }

    function setData(d) {
      validate(d);
      data = d;

      const catalog = catalogPrimes(d);
      const names = Object.keys(catalog);
      state.rows = state.rows.filter(function (r) {
        return catalog[r.prime];
      });
      if (!state.rows.length) {
        const initial = Object.keys(d.primes).filter(function (p) {
          return catalog[p];
        });
        (initial.length ? initial : names.slice(0, 1)).forEach(function (p) {
          state.rows.push(newRow(p));
        });
      }
      renderPrimes();
      renderRelics();
      $("results").hidden = true;
    }

    function defaultParts(prime) {
      const present = presentKeys(data);
      const parts = {};
      (catalogPrimes(data)[prime] || []).forEach(function (part) {
        parts[part] = !!present[partKey(prime, part)];
      });
      return parts;
    }

    // choice : relique choisie pour chaque pièce, { "Pièce": "Relique" }.
    function newRow(prime) {
      return {
        prime: prime,
        sets: 100,
        parts: defaultParts(prime),
        choice: {},
      };
    }

    function relicsWithPart(prime, part) {
      return data.relics
        .filter(function (r) {
          return r.items.some(function (it) {
            return it.prime === prime && it.part === part;
          });
        })
        .map(function (r) {
          return r.name;
        });
    }

    // Relique choisie pour une pièce (la première qui la contient par défaut).
    function chosenRelic(row, part) {
      const names = relicsWithPart(row.prime, part);
      return names.indexOf(row.choice[part]) !== -1
        ? row.choice[part]
        : names[0];
    }

    /**
     * Libellé du nombre d'exemplaires d'une pièce par set.
     * @param {string} prime nom du set.
     * @param {string} part nom de la pièce.
     * @returns {string} "x2" par exemple, ou "x?" si la composition est inconnue.
     */
    function quantityLabel(prime, part) {
      const known = sets && sets[prime] && sets[prime][part];
      return known ? "x" + partQuantity(sets, prime, part) : "x?";
    }

    function relicPicksHtml(row) {
      let html = "";
      Object.keys(row.parts).forEach(function (part) {
        if (!row.parts[part]) return;
        const names = relicsWithPart(row.prime, part);
        if (!names.length) return;
        html +=
          '<label class="pick-line"><span class="pick-qty" title="Exemplaires nécessaires par set">' +
          esc(quantityLabel(row.prime, part)) +
          '</span><span class="pick-part">' +
          esc(part) +
          '</span><select data-pick="' +
          esc(part) +
          '">' +
          options(
            names.map(function (n) {
              return [n, n];
            }),
            chosenRelic(row, part),
          ) +
          "</select></label>";
      });
      return html ? '<div class="relic-picks">' + html + "</div>" : "";
    }

    function renderPrimes() {
      const box = $("primes");
      box.innerHTML = "";
      const catalog = catalogPrimes(data);
      const used = state.rows.map(function (r) {
        return r.prime;
      });

      state.rows.forEach(function (row, idx) {
        const el = document.createElement("div");
        el.className = "prime-row";

        let opts = "";
        Object.keys(catalog).forEach(function (p) {
          const taken = used.indexOf(p) !== -1 && p !== row.prime;
          opts +=
            '<option value="' +
            esc(p) +
            '"' +
            (p === row.prime ? " selected" : "") +
            (taken ? " disabled" : "") +
            ">" +
            esc(p) +
            "</option>";
        });

        el.innerHTML =
          '<select class="prime-pick">' +
          opts +
          "</select>" +
          '<label><input type="number" class="prime-sets" min="1" step="1" value="' +
          row.sets +
          '"> sets</label>' +
          '<button type="button" class="secondary remove">Retirer</button>' +
          relicPicksHtml(row);

        el.querySelector(".prime-pick").addEventListener(
          "change",
          function (e) {
            row.prime = e.target.value;
            row.parts = defaultParts(row.prime);
            row.choice = {};
            renderPrimes();
            renderRelics();
          },
        );
        el.querySelector(".prime-sets").addEventListener("input", function (e) {
          row.sets = Math.max(1, Math.floor(Number(e.target.value) || 1));
        });
        el.querySelector(".remove").addEventListener("click", function () {
          state.rows.splice(idx, 1);
          renderPrimes();
          renderRelics();
        });
        el.querySelectorAll("select[data-pick]").forEach(function (sel) {
          sel.addEventListener("change", function () {
            row.choice[sel.getAttribute("data-pick")] = sel.value;
            renderRelics();
          });
        });
        box.appendChild(el);
      });

      $("add-set").disabled = state.rows.length >= Object.keys(catalog).length;
    }

    function addSet() {
      const catalog = catalogPrimes(data);
      const used = state.rows.map(function (r) {
        return r.prime;
      });
      const next = Object.keys(catalog).find(function (p) {
        return used.indexOf(p) === -1;
      });
      if (!next) return;
      state.rows.push(newRow(next));
      renderPrimes();
      renderRelics();
    }

    function currentParts() {
      const present = presentKeys(data);
      const out = {};
      state.rows.forEach(function (row) {
        out[row.prime] = Object.keys(row.parts).filter(function (part) {
          return row.parts[part] && present[partKey(row.prime, part)];
        });
      });
      return out;
    }

    function currentTargets() {
      const parts = currentParts();
      const t = {};
      state.rows.forEach(function (row) {
        if (parts[row.prime].length) t[row.prime] = row.sets;
      });
      return t;
    }

    // Relique retenue pour chaque pièce voulue : { "Prime|Pièce": [relique] }.
    function currentSources() {
      const parts = currentParts();
      const out = {};
      state.rows.forEach(function (row) {
        parts[row.prime].forEach(function (part) {
          out[partKey(row.prime, part)] = [chosenRelic(row, part)];
        });
      });
      return out;
    }

    function activeRelicNames() {
      const targets = currentTargets();
      if (!Object.keys(targets).length) return [];
      return planSimulation(data, {
        targets: targets,
        parts: currentParts(),
        sources: currentSources(),
      }).relicNames;
    }

    function renderRelics() {
      const box = $("relics");
      const names = activeRelicNames();
      const fixed = state.mode === "fixed";
      if (!names.length) {
        box.innerHTML =
          '<p class="hint">Choisis au moins un set (et une pièce) pour voir les reliques concernées.</p>';
        return;
      }
      let html =
        '<div class="table-wrap"><table><thead><tr><th>Relique</th><th>Raffinement</th><th>Méthode d\'ouverture</th>' +
        (fixed ? '<th class="num">Reliques à ouvrir</th>' : "") +
        "</tr></thead><tbody>";
      names.forEach(function (n) {
        const relic = data.relics.find(function (r) {
          return r.name === n;
        });
        if (!state.relics[n]) {
          state.relics[n] = {
            method: relic.defaultMethod || Object.keys(data.methods)[0],
            count: 100,
            refinement: data.refinements[relic.defaultRefinement]
              ? relic.defaultRefinement
              : defaultRefinementKey(data),
          };
        }
        const st = state.relics[n];
        html +=
          '<tr data-relic="' +
          esc(n) +
          '"><td><strong>' +
          esc(n) +
          '</strong></td><td><select class="ref-pick">';
        Object.keys(data.refinements).forEach(function (k) {
          const lbl = String(data.refinements[k].label || k).split(" (")[0];
          html +=
            '<option value="' +
            esc(k) +
            '"' +
            (k === st.refinement ? " selected" : "") +
            ">" +
            esc(lbl) +
            "</option>";
        });
        html += '</select></td><td><select class="method-pick">';
        Object.keys(data.methods).forEach(function (m) {
          html +=
            '<option value="' +
            esc(m) +
            '"' +
            (m === st.method ? " selected" : "") +
            ">" +
            esc(m) +
            "</option>";
        });
        html +=
          "</select></td>" +
          (fixed
            ? '<td class="num"><input type="number" min="0" step="1" value="' +
              st.count +
              '"></td>'
            : "") +
          "</tr>";
      });
      html += "</tbody></table></div>";
      box.innerHTML = html;

      box.querySelectorAll("tr[data-relic]").forEach(function (tr) {
        const n = tr.getAttribute("data-relic");
        tr.querySelector(".ref-pick").addEventListener("change", function (e) {
          state.relics[n].refinement = e.target.value;
        });
        tr.querySelector(".method-pick").addEventListener(
          "change",
          function (e) {
            state.relics[n].method = e.target.value;
          },
        );
        const num = tr.querySelector('input[type="number"]');
        if (num)
          num.addEventListener("input", function () {
            state.relics[n].count = Math.max(
              0,
              Math.floor(Number(num.value) || 0),
            );
          });
      });
    }

    // Explications affichées en cliquant sur une colonne marquée d'un "*".
    const COLUMN_HELP = {
      "Marge (95 %)":
        "Dans 95 % des simulations, il a fallu au plus ce nombre de reliques. Pour le total, la marge est calculée sur la somme des reliques de chaque simulation.",
      Objectif:
        "Nombre d'exemplaires voulus pour cette pièce, c'est-à-dire le nombre de sets demandés multiplié par le nombre d'exemplaires de la pièce dans un set.",
      Apparues: "Pièces vues dans toutes les ouvertures de l'équipe.",
      Récupérées:
        "Peut dépasser l'objectif : le surplus est pris quand rien d'autre n'est utile dans l'ouverture.",
    };

    function helpTh(label) {
      return (
        '<th class="num"><button type="button" class="th-help" aria-expanded="false" data-help="' +
        esc(label) +
        '">' +
        esc(label) +
        "*</button></th>"
      );
    }

    function toggleColumnHelp(e) {
      const btn = e.target.closest(".th-help");
      if (!btn) return;
      const box = btn.closest(".table-wrap").nextElementSibling;
      const open = btn.getAttribute("aria-expanded") === "true";
      btn
        .closest("table")
        .querySelectorAll(".th-help")
        .forEach(function (b) {
          b.setAttribute("aria-expanded", "false");
        });
      if (open) {
        box.hidden = true;
        return;
      }
      const label = btn.getAttribute("data-help");
      box.innerHTML =
        "<strong>" + esc(label) + "</strong> : " + esc(COLUMN_HELP[label]);
      box.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }

    function renderResults(res) {
      const fixed = state.mode === "fixed";
      let html = "";
      res.warnings.forEach(function (w) {
        html += '<div class="warn">' + esc(w) + "</div>";
      });

      html +=
        '<h2>Reliques à utiliser</h2><div class="table-wrap"><table><thead><tr>' +
        '<th>Relique</th><th>Raffinement</th><th>Méthode</th><th class="num">' +
        (fixed ? "Reliques" : "Moyenne") +
        "</th>" +
        (fixed ? "" : helpTh("Marge (95 %)")) +
        "</tr></thead><tbody>";
      res.relics.forEach(function (r) {
        html +=
          "<tr><td>" +
          esc(r.name) +
          "</td><td>" +
          esc(
            String(data.refinements[r.refKey].label || r.refKey).split(" (")[0],
          ) +
          "</td><td>" +
          esc(r.methodKey) +
          "</td>" +
          '<td class="num">' +
          fmt(r.relicsMean) +
          "</td>" +
          (fixed ? "" : '<td class="num">' + fmt(r.relicsP95) + "</td>") +
          "</tr>";
      });
      html +=
        '<tr class="total"><td>Total</td><td></td><td></td><td class="num">' +
        fmt(res.totals.relicsMean) +
        "</td>" +
        (fixed
          ? ""
          : '<td class="num">' + fmt(res.totals.relicsP95) + "</td>") +
        "</tr></tbody></table></div>" +
        '<p class="help-box" hidden></p>';

      html +=
        '<h2 style="margin-top:18px">Pièces obtenues</h2><div class="table-wrap"><table><thead><tr>' +
        "<th>Set</th><th>Pièce</th>" +
        helpTh("Objectif") +
        helpTh("Apparues") +
        helpTh("Récupérées") +
        "</tr></thead><tbody>";
      res.parts.forEach(function (p) {
        html +=
          "<tr><td>" +
          esc(p.prime) +
          "</td><td>" +
          esc(p.part) +
          "</td>" +
          '<td class="num">' +
          fmt(p.target) +
          "</td>" +
          '<td class="num">' +
          fmt(p.appeared, 1) +
          "</td>" +
          '<td class="num">' +
          fmt(p.picked, 1) +
          "</td></tr>";
      });
      html += "</tbody></table></div>" + '<p class="help-box" hidden></p>';

      if (res.rares.length) {
        html +=
          '<h2 style="margin-top:18px">Loots or pris hors objectif</h2><div class="table-wrap"><table><thead><tr>' +
          '<th>Relique</th><th>Loot or</th><th class="num">Récupérés</th></tr></thead><tbody>';
        res.rares.forEach(function (x) {
          html +=
            "<tr><td>" +
            esc(x.relic) +
            "</td><td>" +
            esc(x.name) +
            '</td><td class="num">' +
            fmt(x.picked, 1) +
            "</td></tr>";
        });
        html += "</tbody></table></div>";
      }

      $("results-body").innerHTML = html;
      $("results").hidden = false;
    }

    function calculate() {
      const targets = currentTargets();
      if (!Object.keys(targets).length) {
        $("results-body").innerHTML =
          '<div class="warn">Choisis au moins un set.</div>';
        $("results").hidden = false;
        return;
      }
      const runs = 2000;
      const btn = $("run");
      btn.disabled = true;
      btn.textContent = "Calcul en cours…";
      setTimeout(function () {
        try {
          const res = runSimulation(data, {
            mode: state.mode,
            targets: targets,
            parts: currentParts(),
            sources: currentSources(),
            sets: sets,
            takeRare: $("take-rare").checked,
            relics: state.relics,
            runs: runs,
          });
          if (!sets)
            res.warnings.unshift(
              "Composition des sets indisponible (sets.json non chargé) : 1 exemplaire par pièce est supposé.",
            );
          renderResults(res);
        } catch (e) {
          $("results-body").innerHTML =
            '<div class="err">Erreur : ' + esc(e.message) + "</div>";
          $("results").hidden = false;
        }
        btn.disabled = false;
        btn.textContent = "Calculer";
      }, 20);
    }

    /* ---------- Onglets ---------- */

    function showTab(name) {
      document.querySelectorAll(".tab").forEach(function (t) {
        t.setAttribute(
          "aria-selected",
          String(t.getAttribute("data-tab") === name),
        );
      });
      $("tab-calc").hidden = name !== "calc";
      $("tab-data").hidden = name !== "data";
    }

    /* ---------- Éditeur de données ---------- */

    const STORAGE_KEY = "reliques.data";
    const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
    const RARITIES = [
      ["common", "Commun"],
      ["uncommon", "Peu commun"],
      ["rare", "Rare"],
    ];
    // Composition habituelle d'une relique : 3 communs, 2 peu communs, 1 rare.
    const NEW_RELIC_RARITIES = [
      "common",
      "common",
      "common",
      "uncommon",
      "uncommon",
      "rare",
    ];
    // Suggestions proposées dans le champ "Pièce".
    const COMMON_PARTS = [
      "Blueprint",
      "Chassis",
      "Neuroptics",
      "Systems",
      "Barrel",
      "Receiver",
      "Stock",
      "Upper Limb",
      "Lower Limb",
      "String",
      "Grip",
      "Blade",
      "Hilt",
      "Cerebrum",
      "Carapace",
      "Harness",
      "Wings",
      "Handle",
      "Guard",
      "Ornament",
      "Gauntlet",
      "Link",
      "Pouch",
      "Stars",
      "Disc",
      "Boot",
      "Chain",
      "Head",
    ];
    // Pièces dont le nom en jeu se termine par "Blueprint" (ex. "Nidus Prime Chassis Blueprint").
    const BLUEPRINT_PARTS = [
      "Chassis",
      "Neuroptics",
      "Systems",
      "Harness",
      "Wings",
      "Cerebrum",
      "Carapace",
    ];

    let baseData = null; // relics.json ou copie intégrée
    let ed = null; // brouillon de l'éditeur
    let dirty = false;
    let custom = false;

    function clone(o) {
      return JSON.parse(JSON.stringify(o));
    }

    function readStored() {
      try {
        const s = localStorage.getItem(STORAGE_KEY);
        return s ? JSON.parse(s) : null;
      } catch (e) {
        return null;
      }
    }

    function writeStored(d) {
      try {
        if (d) localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
        else localStorage.removeItem(STORAGE_KEY);
        return true;
      } catch (e) {
        return false;
      }
    }

    function autoName(prime, part) {
      prime = (prime || "").trim();
      part = (part || "").trim();
      if (!prime) return "";
      // Sans pièce : objet hors set (ex. "Forma" -> "Forma Blueprint")
      if (!part) return prime + " Blueprint";
      return (
        prime +
        " Prime " +
        part +
        (BLUEPRINT_PARTS.indexOf(part) !== -1 ? " Blueprint" : "")
      );
    }

    function relicName(r) {
      const code = r.code.trim().toUpperCase();
      return r.era ? (r.era + " " + code).trim() : code;
    }

    function refLabel(k) {
      const r = data.refinements[k];
      return r ? String(r.label || k).split(" (")[0] : k;
    }

    function options(list, current) {
      return list
        .map(function (o) {
          return (
            '<option value="' +
            esc(o[0]) +
            '"' +
            (o[0] === current ? " selected" : "") +
            ">" +
            esc(o[1]) +
            "</option>"
          );
        })
        .join("");
    }

    function toEditor(d) {
      return {
        relics: d.relics.map(function (r) {
          const m = /^(\S+)\s+(.+)$/.exec(r.name);
          const known = m && ERAS.indexOf(m[1]) !== -1;
          return {
            era: known ? m[1] : "",
            code: known ? m[2] : r.name,
            defaultMethod: r.defaultMethod || Object.keys(d.methods)[0],
            defaultRefinement: r.defaultRefinement || "",
            items: r.items.map(function (it) {
              const prime = it.prime || "";
              const part = it.part || "";
              return {
                // Nom vide = généré automatiquement
                name: it.name === autoName(prime, part) ? "" : it.name || "",
                rarity: it.rarity,
                prime: prime,
                part: part,
              };
            }),
            open: false,
          };
        }),
      };
    }

    function fromEditor() {
      const errors = [];
      const seen = {};
      const relics = ed.relics.map(function (r, i) {
        const name = relicName(r);
        const label = r.code.trim() ? name : "Relique n°" + (i + 1);
        if (!r.code.trim()) errors.push(label + " : code manquant (ex. S17).");
        else if (seen[name]) errors.push("Relique « " + name + " » en double.");
        seen[name] = true;

        const out = { name: name, defaultMethod: r.defaultMethod };
        if (r.defaultRefinement) out.defaultRefinement = r.defaultRefinement;
        out.items = r.items.map(function (it, j) {
          const prime = it.prime.trim();
          const part = it.part.trim();
          const o = {
            name: it.name.trim() || autoName(prime, part),
            rarity: it.rarity,
          };
          if (prime && part) {
            o.prime = prime;
            o.part = part;
          } else if (part) {
            errors.push(
              label +
                ", ligne " +
                (j + 1) +
                " : indique le set de cette pièce.",
            );
          }
          if (!o.name)
            errors.push(label + ", ligne " + (j + 1) + " : nom manquant.");
          return o;
        });
        return out;
      });

      const d = {};
      if (data._info) d._info = data._info;
      d.refinements = data.refinements;
      d.methods = data.methods;
      d.relics = relics;
      return { data: d, errors: errors };
    }

    function relicSummary(r) {
      const rare = r.items
        .filter(function (it) {
          return it.rarity === "rare";
        })
        .map(function (it) {
          return it.name.trim() || autoName(it.prime, it.part);
        })
        .filter(Boolean);
      return {
        title: r.code.trim() ? relicName(r) : "Nouvelle relique",
        meta: [
          r.defaultMethod,
          r.defaultRefinement ? refLabel(r.defaultRefinement) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        rare: rare.join(", "),
      };
    }

    function renderEdRelics() {
      const box = $("ed-relics");
      if (!ed.relics.length) {
        box.innerHTML =
          '<p class="hint">Aucune relique. Ajoute-en une avec le bouton ci-dessous.</p>';
        return;
      }
      const eraOpts = ERAS.map(function (e) {
        return [e, e];
      }).concat([["", "Autre"]]);
      const methodOpts = Object.keys(data.methods).map(function (m) {
        return [m, m];
      });
      const refOpts = [
        ["", "Par défaut (" + refLabel(defaultRefinementKey(data)) + ")"],
      ].concat(
        Object.keys(data.refinements).map(function (k) {
          return [k, refLabel(k)];
        }),
      );

      let html = "";
      ed.relics.forEach(function (r, ri) {
        const s = relicSummary(r);
        html +=
          '<details class="ed-relic" data-r="' +
          ri +
          '"' +
          (r.open ? " open" : "") +
          ">" +
          '<summary><span class="ed-title">' +
          esc(s.title) +
          '</span><span class="ed-meta">' +
          esc(s.meta) +
          '</span><span class="ed-rare">' +
          esc(s.rare) +
          "</span></summary>" +
          '<div class="ed-body"><div class="ed-grid">' +
          '<label class="field"><span>Ère</span><select data-f="era">' +
          options(eraOpts, r.era) +
          "</select></label>" +
          '<label class="field"><span>Code</span><input type="text" class="ed-code" data-f="code" placeholder="ex. S17" value="' +
          esc(r.code) +
          '"></label>' +
          '<label class="field"><span>Méthode par défaut</span><select data-f="defaultMethod">' +
          options(methodOpts, r.defaultMethod) +
          "</select></label>" +
          '<label class="field"><span>Raffinement par défaut</span><select data-f="defaultRefinement">' +
          options(refOpts, r.defaultRefinement) +
          "</select></label>" +
          "</div>" +
          '<div class="table-wrap"><table class="ed-items"><thead><tr>' +
          "<th>Rareté</th><th>Set</th><th>Pièce</th><th>Nom affiché</th>" +
          "</tr></thead><tbody>";
        r.items.forEach(function (it, ii) {
          html +=
            '<tr data-i="' +
            ii +
            '"><td><select data-f="rarity" class="rarity-' +
            esc(it.rarity) +
            '">' +
            options(RARITIES, it.rarity) +
            "</select></td>" +
            '<td><input type="text" data-f="prime" list="dl-sets" placeholder="—" value="' +
            esc(it.prime) +
            '"></td>' +
            '<td><input type="text" data-f="part" list="dl-parts" placeholder="—" value="' +
            esc(it.part) +
            '"></td>' +
            '<td><input type="text" data-f="name" list="dl-names" placeholder="' +
            esc(autoName(it.prime, it.part) || "ex. Forma Blueprint") +
            '" value="' +
            esc(it.name) +
            '"></td></tr>';
        });
        html +=
          "</tbody></table></div>" +
          '<div class="row"><button type="button" class="secondary remove" data-act="del-relic">Supprimer la relique</button></div>' +
          "</div></details>";
      });
      box.innerHTML = html;
    }

    function refreshDatalists() {
      const sets = { Forma: true, "2x Forma": true };
      const parts = {};
      ed.relics.forEach(function (r) {
        r.items.forEach(function (it) {
          if (it.prime.trim()) sets[it.prime.trim()] = true;
          if (it.part.trim()) parts[it.part.trim()] = true;
        });
      });
      COMMON_PARTS.forEach(function (x) {
        parts[x] = true;
      });
      const toOpts = function (o) {
        return Object.keys(o)
          .sort()
          .map(function (v) {
            return '<option value="' + esc(v) + '">';
          })
          .join("");
      };
      $("dl-sets").innerHTML = toOpts(sets);
      $("dl-parts").innerHTML = toOpts(parts);
    }

    function renderEditor() {
      renderEdRelics();
      refreshDatalists();
    }

    function updateStatus(msg) {
      const el = $("data-status");
      el.classList.toggle("dirty", dirty);
      el.textContent =
        msg ||
        (dirty
          ? "Modifications non enregistrées"
          : custom
            ? "Données personnalisées, enregistrées dans ce navigateur"
            : "Données d'origine");
      $("data-save").disabled = !dirty;
    }

    function markDirty() {
      dirty = true;
      updateStatus();
    }

    function showErrors(list) {
      const box = $("data-errors");
      if (!list.length) {
        box.innerHTML = "";
        return;
      }
      box.innerHTML =
        '<div class="warn"><strong>À corriger :</strong><ul>' +
        list
          .map(function (e) {
            return "<li>" + esc(e) + "</li>";
          })
          .join("") +
        "</ul></div>";
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function onRelicField(e) {
      const el = e.target;
      const f = el.getAttribute("data-f");
      const card = el.closest("[data-r]");
      if (!f || !card) return;
      const r = ed.relics[Number(card.getAttribute("data-r"))];
      const tr = el.closest("[data-i]");
      const target = tr ? r.items[Number(tr.getAttribute("data-i"))] : r;
      target[f] = el.value;
      if (f === "rarity") el.className = "rarity-" + el.value;
      if (tr && (f === "prime" || f === "part")) {
        tr.querySelector('[data-f="name"]').placeholder =
          autoName(target.prime, target.part) || "ex. Forma Blueprint";
      }
      const s = relicSummary(r);
      card.querySelector(".ed-title").textContent = s.title;
      card.querySelector(".ed-meta").textContent = s.meta;
      card.querySelector(".ed-rare").textContent = s.rare;
      markDirty();
      if (e.type === "change") refreshDatalists();
    }

    function onEditorClick(e) {
      const btn = e.target.closest('[data-act="del-relic"]');
      if (!btn) return;
      const ri = Number(btn.closest("[data-r]").getAttribute("data-r"));
      const name = relicSummary(ed.relics[ri]).title;
      if (!confirm("Supprimer la relique « " + name + " » ?")) return;
      ed.relics.splice(ri, 1);
      renderEdRelics();
      markDirty();
      refreshDatalists();
    }

    function addEdRelic() {
      ed.relics.push({
        era: ERAS[0],
        code: "",
        defaultMethod: Object.keys(data.methods)[0],
        defaultRefinement: "",
        items: NEW_RELIC_RARITIES.map(function (rarity) {
          return { name: "", rarity: rarity, prime: "", part: "" };
        }),
        open: true,
      });
      renderEdRelics();
      markDirty();
      const card = $("ed-relics").lastElementChild;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.querySelector(".ed-code").focus({ preventScroll: true });
    }

    function saveEditor() {
      const res = fromEditor();
      showErrors(res.errors);
      if (res.errors.length) return;
      try {
        setData(res.data);
      } catch (e) {
        showErrors([e.message]);
        return;
      }
      dirty = false;
      if (writeStored(data)) {
        custom = true;
        updateStatus("Enregistré ✓");
      } else {
        updateStatus(
          "Appliqué, mais impossible d'enregistrer dans ce navigateur",
        );
      }
    }

    function exportData() {
      const res = fromEditor();
      showErrors(res.errors);
      if (res.errors.length) return;
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "relics.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 1000);
    }

    function importFile(file) {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          setData(JSON.parse(reader.result));
        } catch (e) {
          showErrors(["Fichier invalide : " + e.message]);
          return;
        }
        custom = writeStored(data);
        dirty = false;
        ed = toEditor(data);
        renderEditor();
        showErrors([]);
        updateStatus("Fichier importé ✓");
      };
      reader.readAsText(file);
    }

    function resetData() {
      if (
        !confirm(
          "Revenir aux données d'origine ? Tes modifications seront perdues.",
        )
      )
        return;
      writeStored(null);
      custom = false;
      dirty = false;
      setData(clone(baseData));
      ed = toEditor(data);
      renderEditor();
      showErrors([]);
      updateStatus("Données d'origine restaurées ✓");
    }

    // Données enregistrées dans le navigateur si elles existent, sinon données d'origine.
    function start(base) {
      baseData = clone(base);
      custom = false;
      const stored = readStored();
      if (stored) {
        try {
          setData(stored);
          custom = true;
        } catch (e) {
          writeStored(null);
        }
      }
      if (!custom) setData(clone(baseData));
      ed = toEditor(data);
      renderEditor();
      updateStatus();
    }

    /**
     * Charge la composition des sets depuis sets.json.
     * @returns {Promise<void>} résolue dans tous les cas ; `sets` reste à null en cas d'échec.
     */
    function loadSets() {
      return fetch("sets.json")
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          sets = d && d.sets ? d.sets : null;
        })
        .catch(function () {
          sets = null;
        });
    }

    function init() {
      document.querySelectorAll(".tab").forEach(function (t) {
        t.addEventListener("click", function () {
          showTab(t.getAttribute("data-tab"));
        });
      });

      $("data-save").addEventListener("click", saveEditor);
      $("data-export").addEventListener("click", exportData);
      $("data-import-btn").addEventListener("click", function () {
        $("data-import").click();
      });
      $("data-import").addEventListener("change", function (e) {
        if (e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = "";
      });
      $("data-reset").addEventListener("click", resetData);
      $("ed-add-relic").addEventListener("click", addEdRelic);
      ["input", "change"].forEach(function (type) {
        $("ed-relics").addEventListener(type, onRelicField);
      });
      // "toggle" ne remonte pas : on l'écoute en phase de capture.
      $("ed-relics").addEventListener(
        "toggle",
        function (e) {
          const ri = e.target.getAttribute && e.target.getAttribute("data-r");
          if (ri !== null && ed.relics[Number(ri)])
            ed.relics[Number(ri)].open = e.target.open;
        },
        true,
      );
      $("tab-data").addEventListener("click", onEditorClick);
      window.addEventListener("beforeunload", function (e) {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = "";
      });

      document.querySelectorAll('input[name="mode"]').forEach(function (r) {
        r.addEventListener("change", function () {
          state.mode = r.value;
          renderRelics();
        });
      });
      $("run").addEventListener("click", calculate);
      $("results-body").addEventListener("click", toggleColumnHelp);
      $("add-set").addEventListener("click", addSet);

      // relics.json si la page est servie par un serveur, sinon copie intégrée
      // sets.json est chargé avant, pour afficher les quantités dès le premier rendu.
      const embedded = JSON.parse($("default-data").textContent);
      loadSets()
        .then(function () {
          return fetch("relics.json");
        })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(start)
        .catch(function () {
          start(embedded);
        });
    }

    init();
  })();
}
