/* app.js — Votes, poverty and MBG kitchens.
   Vanilla ES6. Depends on Leaflet, Chart.js, PapaParse, html2canvas, Stats. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     1. Constants: candidate colors, ramps, variables
     ------------------------------------------------------------------ */
  const PAIRS = ["01", "02", "03"];
  const PAIR_NAME = { "01": "Anies–Muhaimin", "02": "Prabowo–Gibran", "03": "Ganjar–Mahfud" };
  const PAIR_COLOR = { "01": "#2F8F5B", "02": "#2F6DB5", "03": "#C23A3A" };
  // Hand-picked 5-step light→dark ramps; step 4 equals the base hue.
  const PAIR_RAMP = {
    "01": ["#D5E9DB", "#A3CFB1", "#68AF84", "#2F8F5B", "#1A5C39"],
    "02": ["#D6E3F3", "#A2C0E5", "#6B98D0", "#2F6DB5", "#1B4479"],
    "03": ["#F2D7D4", "#E3A6A1", "#D26E68", "#C23A3A", "#7C2222"],
  };
  const RAMP_POV = ["#EBE3D5", "#D3C1A6", "#B09676", "#85704F", "#56452F"];
  const RAMP_EDU = ["#DFE9E7", "#B2CBC6", "#82A8A2", "#547E79", "#2E5450"];
  const RAMP_SPPG = ["#E8E3D6", "#CBC2AC", "#A49A82", "#77705C", "#4A4538"];
  // Bivariate 3×3: index [y][x], y = 0 low. Neutral → teal (x) / green (y).
  const BIV = [
    ["#E8E8E8", "#B5C0DA", "#6C83B5"],
    ["#B8D6BE", "#90B2B3", "#567994"],
    ["#73AE80", "#5A9178", "#2A5A5B"],
  ];
  const MARGIN_BREAKS = [10, 20, 30, 40];
  const SHARE_BREAKS = [20, 40, 60, 80];
  const NEUTRAL_FILL = "#E2DCCF";

  const VARS = {
    miskin: { label: "Poverty rate", long: "Poverty rate (%)", unit: "%", d: 2 },
    rls: { label: "Mean schooling", long: "Mean years of schooling", unit: " yrs", d: 2 },
    sppg: { label: "MBG kitchens (SPPG)", long: "Number of SPPG", unit: "", d: 0 },
    sppg100k: { label: "SPPG per 100k poor", long: "SPPG per 100k people in poverty", unit: "", d: 1 },
    jumlah_miskin: { label: "Population in poverty", long: "Population in poverty (k)", unit: "k", d: 2 },
    margin: { label: "Margin", long: "Winning margin", unit: "", d: 1 },
    pct_01: { label: "01 vote %", long: "01 Anies–Muhaimin vote share", unit: "%", d: 2 },
    pct_02: { label: "02 vote %", long: "02 Prabowo–Gibran vote share", unit: "%", d: 2 },
    pct_03: { label: "03 vote %", long: "03 Ganjar–Mahfud vote share", unit: "%", d: 2 },
  };
  const TABS = ["pemenang", "perolehan", "kemiskinan", "pendidikan", "mbg", "bivariat"];

  /* ------------------------------------------------------------------
     2. State
     ------------------------------------------------------------------ */
  const state = {
    tab: "pemenang", pair: "02", multi: false, mbgMode: "jumlah",
    bivPair: "02", bivVar: "miskin", scatterPair: "02",
    sel: null, cmp: null, hover: null,
  };
  let rows = [];          // joined province records
  let byKey = {};         // key -> record
  let geo = null;
  let map, geoLayer, circleLayer, miniMaps = [];
  let charts = [];
  const centroids = {};
  const breaksCache = {};

  /* ------------------------------------------------------------------
     3. Helpers
     ------------------------------------------------------------------ */
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = (v, d = 0) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtVar = (k, v) => fmt(v, VARS[k].d) + VARS[k].unit;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /** Normalize a province name to a join key. */
  function normalize(name) {
    let s = String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
    s = s.replace(/^provinsi /, "").replace(/sumatra/g, "sumatera");
    const alias = {
      "jakarta": "dki jakarta", "daerah khusus jakarta": "dki jakarta", "dki jakarta": "dki jakarta",
      "yogyakarta": "di yogyakarta", "daerah istimewa yogyakarta": "di yogyakarta", "di yogyakarta": "di yogyakarta",
      "kep. riau": "kepulauan riau", "kepulauan riau": "kepulauan riau",
      "bangka belitung": "kepulauan bangka belitung", "kep. bangka belitung": "kepulauan bangka belitung",
      "kepulauan bangka belitung": "kepulauan bangka belitung",
    };
    return alias[s] || s;
  }
  const slug = (key) => key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /** Quantile breaks (k classes → k-1 inner breaks). */
  function quantileBreaks(values, k) {
    const s = values.slice().sort((a, b) => a - b);
    const out = [];
    for (let i = 1; i < k; i++) {
      const pos = (s.length - 1) * (i / k);
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      out.push(s[lo] + (s[hi] - s[lo]) * (pos - lo));
    }
    return out;
  }
  const classOf = (v, breaks) => breaks.filter((b) => v >= b).length;
  function qBreaks(key, k = 5) {
    const id = key + k;
    if (!breaksCache[id]) breaksCache[id] = quantileBreaks(rows.map((r) => r[key]), k);
    return breaksCache[id];
  }

  /** Rank 1..38 with 1 = highest value. */
  function addRanks() {
    Object.keys(VARS).forEach((k) => {
      const r = Stats.rank(rows.map((x) => -x[k]));
      rows.forEach((x, i) => { x.rank = x.rank || {}; x.rank[k] = r[i]; });
    });
  }

  /* ------------------------------------------------------------------
     4. Data loading & join
     ------------------------------------------------------------------ */
  async function loadData() {
    const [csvText, gj] = await Promise.all([
      fetch("data/data_day3_provinsi.csv").then((r) => r.text()),
      fetch("data/provinsi_38.geojson").then((r) => r.json()),
    ]);
    const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
    geo = gj;

    rows = parsed.data.map((d) => {
      const pct = { "01": d.pct_01, "02": d.pct_02, "03": d.pct_03 };
      const sorted = PAIRS.slice().sort((a, b) => pct[b] - pct[a]);
      const r = {
        name: d.provinsi, key: normalize(d.provinsi),
        suara: { "01": d.suara_01, "02": d.suara_02, "03": d.suara_03 },
        total: d.total_sah, pct, menang: String(d.menang).padStart(2, "0"),
        pct_01: d.pct_01, pct_02: d.pct_02, pct_03: d.pct_03,
        miskin: d.miskin_mar2026, jumlah_miskin: d.jumlah_miskin_ribu_mar2026,
        rls: d.rls, sppg: d.sppg_jun2026,
      };
      r.runnerUp = sorted[1];
      r.margin = pct[sorted[0]] - pct[sorted[1]];
      r.sppg100k = r.sppg / (r.jumlah_miskin * 1000) * 100000;
      return r;
    });
    rows.forEach((r) => (byKey[r.key] = r));
    addRanks();

    // Join report
    const geoKeys = geo.features.map((f) => normalize(f.properties.PROVINSI));
    const report = rows.map((r) => ({ csv: r.name, key: r.key, geojson: geoKeys.includes(r.key) ? "ok" : "NO MATCH" }));
    console.table(report);
    const unmatched = [
      ...rows.filter((r) => !geoKeys.includes(r.key)).map((r) => "CSV: " + r.name),
      ...geo.features.filter((f) => !byKey[normalize(f.properties.PROVINSI)]).map((f) => "GeoJSON: " + f.properties.PROVINSI),
    ];
    if (unmatched.length) {
      const w = $("#join-warning");
      w.hidden = false;
      w.textContent = "Unjoined provinces: " + unmatched.join(", ");
    }
    geo.features.forEach((f) => (f.properties._key = normalize(f.properties.PROVINSI)));
  }

  /* ------------------------------------------------------------------
     5. Fill logic per view
     ------------------------------------------------------------------ */
  function fillFor(r, tab = state.tab, pair = state.pair) {
    if (!r) return NEUTRAL_FILL;
    switch (tab) {
      case "pemenang": return PAIR_RAMP[r.menang][classOf(r.margin, MARGIN_BREAKS)];
      case "perolehan": return PAIR_RAMP[pair][classOf(r.pct[pair], SHARE_BREAKS)];
      case "kemiskinan": return RAMP_POV[classOf(r.miskin, qBreaks("miskin"))];
      case "pendidikan": return RAMP_EDU[classOf(r.rls, qBreaks("rls"))];
      case "mbg": return state.mbgMode === "jumlah" ? NEUTRAL_FILL : RAMP_SPPG[classOf(r.sppg100k, qBreaks("sppg100k"))];
      case "bivariat": {
        const x = classOf(r["pct_" + state.bivPair], qBreaks("pct_" + state.bivPair, 3));
        const y = classOf(r[state.bivVar], qBreaks(state.bivVar, 3));
        return BIV[y][x];
      }
    }
    return NEUTRAL_FILL;
  }

  /** Short tooltip value line for the current view. */
  function tooltipValue(r) {
    switch (state.tab) {
      case "pemenang": return `${r.menang} ${PAIR_NAME[r.menang]}`;
      case "perolehan": return `${state.pair} ${PAIR_NAME[state.pair]}: ${fmt(r.pct[state.pair], 2)}%`;
      case "kemiskinan": return `Poverty ${fmt(r.miskin, 2)}%`;
      case "pendidikan": return `Schooling ${fmt(r.rls, 2)} yrs`;
      case "mbg": return state.mbgMode === "jumlah" ? `${fmt(r.sppg)} SPPG` : `${fmt(r.sppg100k, 1)} SPPG per 100k poor`;
      case "bivariat": return `${state.bivPair}: ${fmt(r["pct_" + state.bivPair], 2)}% · ${VARS[state.bivVar].label}: ${fmtVar(state.bivVar, r[state.bivVar])}`;
    }
    return "";
  }

  function styleFor(feature) {
    const r = byKey[feature.properties._key];
    const selected = r && (r.key === state.sel || r.key === state.cmp);
    if (!r) return { fillOpacity: 0, opacity: 0, weight: 0 };
    return {
      fillColor: fillFor(r), fillOpacity: 1,
      color: selected ? css("--ink") : css("--paper"),
      weight: selected ? 2.5 : 0.6, opacity: 1,
    };
  }

  /* ------------------------------------------------------------------
     6. Map setup
     ------------------------------------------------------------------ */
  function graticule() {
    const lines = [];
    for (let lon = 90; lon <= 145; lon += 5) lines.push([[-15, lon], [10, lon]]);
    for (let lat = -15; lat <= 10; lat += 5) lines.push([[lat, 90], [lat, 145]]);
    return L.polyline(lines, { color: css("--rule"), weight: 0.6, interactive: false });
  }

  /** Centroid of the largest ring — used for proportional circles. */
  function centroidOf(feature) {
    const g = feature.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let best = null, bestA = 0;
    polys.forEach((p) => {
      const ring = p[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
      }
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cy / (3 * a), cx / (3 * a)]; }
    });
    return best;
  }

  function idnBounds() {
    let b = null;
    geoLayer.eachLayer((l) => { if (l.feature.properties._key && byKey[l.feature.properties._key]) b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
    return b || geoLayer.getBounds();
  }

  function initMap() {
    map = L.map("map", { preferCanvas: true, zoomSnap: 0.25, attributionControl: true, scrollWheelZoom: true });
    map.attributionControl.setPrefix(false);
    // Keyless raster basemaps (work on GitHub Pages). Labels sit above the choropleth.
    map.createPane("labels"); map.getPane("labels").style.zIndex = 450; map.getPane("labels").style.pointerEvents = "none";
    const esri = (id) => `https://server.arcgisonline.com/ArcGIS/rest/services/${id}/MapServer/tile/{z}/{y}/{x}`;
    const opt = { crossOrigin: "anonymous", maxZoom: 16 };
    const eAttr = "Tiles &copy; Esri";
    const bases = {
      "Light": L.tileLayer(esri("Canvas/World_Light_Gray_Base"), { ...opt, attribution: eAttr }),
      "Streets (OSM)": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { ...opt, maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }),
      "Terrain": L.tileLayer(esri("World_Topo_Map"), { ...opt, attribution: eAttr }),
      "Satellite": L.tileLayer(esri("World_Imagery"), { ...opt, attribution: eAttr + ", Maxar, Earthstar" }),
      "Dark": L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), { ...opt, attribution: eAttr }),
    };
    const labels = L.tileLayer(esri("Canvas/World_Light_Gray_Reference"), { ...opt, pane: "labels" });
    bases["Light"].addTo(map); labels.addTo(map);
    L.control.layers(bases, { "Place labels": labels }, { position: "topright", collapsed: true }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    const Full = L.Control.extend({ options: { position: "topleft" }, onAdd() {
      const b = L.DomUtil.create("a", "leaflet-bar leaflet-fs"); b.href = "#"; b.title = "Full screen"; b.innerHTML = "⛶";
      L.DomEvent.on(b, "click", (e) => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e);
        const fig = document.getElementById("figure");
        if (document.fullscreenElement) document.exitFullscreen();
        else if (fig.requestFullscreen) fig.requestFullscreen(); else fig.classList.toggle("is-full");
      });
      return b;
    } });
    new Full().addTo(map);
    document.addEventListener("fullscreenchange", () => setTimeout(() => map.invalidateSize(), 150));
    geo.features.forEach((f) => { if (f.properties._key) centroids[f.properties._key] = centroidOf(f); });
    geoLayer = L.geoJSON(geo, { style: styleFor, onEachFeature: bindFeature }).addTo(map);
    circleLayer = L.layerGroup();
    const b = idnBounds();
    map.fitBounds(b, { padding: [8, 8] });
    map.setView(b.getCenter(), Math.round(map.getZoom()), { animate: false });
    map.setMinZoom(map.getZoom() - 0.5);
    map.setMaxBounds(b.pad(0.25));
  }

  function bindFeature(feature, layer) {
    const r = byKey[feature.properties._key];
    if (!r) return;
    layer.bindTooltip(() => `<b>${esc(r.name)}</b><br><span class="mono">${esc(tooltipValue(r))}</span>`, { sticky: true, direction: "top", offset: [0, -8] });
    layer.on({
      mouseover: () => { layer.setStyle({ color: css("--ink"), weight: 2 }); layer.bringToFront(); },
      mouseout: () => geoLayer.resetStyle(layer),
      click: (e) => select(r.key, e.latlng),
    });
  }

  function buildCircles() {
    circleLayer.clearLayers();
    const max = Math.max(...rows.map((r) => r.sppg));
    const feats = geo.features.slice().sort((a, b) => (byKey[b.properties._key]?.sppg || 0) - (byKey[a.properties._key]?.sppg || 0));
    feats.forEach((f) => {
      const r = byKey[f.properties._key];
      if (!r) return;
      const c = L.circleMarker(centroidOf(f), {
        radius: Math.sqrt(r.sppg / max) * 30, color: css("--ink"), weight: 0.8,
        fillColor: css("--ink"), fillOpacity: 0.12,
      });
      c.bindTooltip(() => `<b>${esc(r.name)}</b><br><span class="mono">${fmt(r.sppg)} SPPG</span>`, { sticky: true, direction: "top" });
      c.on("click", (e) => select(r.key, e.latlng));
      c.addTo(circleLayer);
    });
  }

  /** Three synced small maps for "Show all three". */
  function buildMiniMaps() {
    if (miniMaps.length) return;
    PAIRS.forEach((p) => {
      const m = L.map("m" + p, { preferCanvas: true, zoomControl: false, attributionControl: false, zoomSnap: 0.25 });
      const layer = L.geoJSON(geo, {
        style: (f) => ({ fillColor: fillFor(byKey[f.properties._key], "perolehan", p), fillOpacity: 1, color: css("--paper"), weight: 0.4 }),
        onEachFeature: (f, l) => {
          const r = byKey[f.properties._key];
          if (!r) return;
          l.bindTooltip(`<b>${esc(r.name)}</b><br><span class="mono">${p}: ${fmt(r.pct[p], 2)}%</span>`, { sticky: true });
          l.on("click", () => { select(r.key, null, { noPopup: true }); openDetail(r.key); });
        },
      }).addTo(m);
      miniMaps.push({ m, layer, p });
    });
    let syncing = false;
    miniMaps.forEach(({ m }) => {
      m.on("move", () => {
        if (syncing) return;
        syncing = true;
        miniMaps.forEach((o) => o.m !== m && o.m.setView(m.getCenter(), m.getZoom(), { animate: false }));
        syncing = false;
      });
    });
  }

  function fitMinis() {
    miniMaps.forEach(({ m, layer }) => { m.invalidateSize(); m.fitBounds(layer.getBounds(), { padding: [2, 2] }); });
  }

  /* ------------------------------------------------------------------
     7. Rendering: tabs, subcontrols, legend
     ------------------------------------------------------------------ */
  function pairButtons(cur, attr) {
    return `<span class="seg">${PAIRS.map((p) => `<button data-${attr}="${p}" aria-pressed="${cur === p}">${p}</button>`).join("")}</span>`;
  }

  function renderSubcontrols() {
    const el = $("#subcontrols");
    let h = "";
    if (state.tab === "perolehan") {
      h = `<span class="label">Ticket</span>${pairButtons(state.pair, "pair")}
           <button class="pill" id="btn-multi" aria-pressed="${state.multi}">Show all three</button>`;
    } else if (state.tab === "mbg") {
      h = `<span class="seg"><button data-mbg="jumlah" aria-pressed="${state.mbgMode === "jumlah"}">Count</button>
           <button data-mbg="per100k" aria-pressed="${state.mbgMode === "per100k"}">Per 100k poor</button></span>`;
    } else if (state.tab === "bivariat") {
      h = `<span class="label">Vote</span>${pairButtons(state.bivPair, "bivpair")}
           <label class="label" for="bivvar">vs</label>
           <select id="bivvar">
             <option value="miskin">Poverty</option><option value="rls">Schooling</option><option value="sppg100k">SPPG per 100k</option>
           </select>`;
    }
    el.innerHTML = h;
    const sv = $("#bivvar");
    if (sv) sv.value = state.bivVar;
  }

  function rampHTML(colors, ticks, name) {
    return `<div class="ramp">${name ? `<span class="ramp-name">${name}</span>` : ""}
      <div><div class="swatches">${colors.map((c) => `<span style="background:${c}"></span>`).join("")}</div>
      <div class="ticks">${ticks.map((t) => `<span>${t}</span>`).join("")}</div></div></div>`;
  }
  const dirHTML = () => `<div class="dir"><span>← lower</span><span>higher →</span></div>`;
  /** Class range labels from inner breaks. */
  function rangeTicks(breaks, d) {
    const vals = rows.length ? breaks : [];
    const out = [];
    for (let i = 0; i <= vals.length; i++) {
      if (i === 0) out.push("< " + fmt(vals[0], d));
      else if (i === vals.length) out.push("≥ " + fmt(vals[i - 1], d));
      else out.push(fmt(vals[i - 1], d) + "–" + fmt(vals[i], d));
    }
    return out;
  }

  function figureTitle() {
    return {
      pemenang: "2024 presidential winner by province, shaded by margin",
      perolehan: state.multi ? "Vote share for each ticket, 2024" : `Vote share for ${state.pair} ${PAIR_NAME[state.pair]}, 2024`,
      kemiskinan: "Poverty rate, March 2026",
      pendidikan: "Mean years of schooling, age 15+",
      mbg: state.mbgMode === "jumlah" ? "MBG kitchens (SPPG), 8 June 2026" : "MBG kitchens per 100k people in poverty",
      bivariat: `${state.bivPair} ${PAIR_NAME[state.bivPair]} vote share vs ${VARS[state.bivVar].long.toLowerCase()}`,
    }[state.tab];
  }

  function renderLegend() {
    const el = $("#legend");
    let h = "";
    if (state.tab === "pemenang") {
      const counts = {};
      PAIRS.forEach((p) => (counts[p] = rows.filter((r) => r.menang === p).length));
      h = `<div><p class="legend-title">Winner, shaded by margin</p>
        ${PAIRS.map((p) => rampHTML(PAIR_RAMP[p], ["<10", "10–20", "20–30", "30–40", "≥40"], `${p} ${PAIR_NAME[p]} <span class="count">· ${counts[p]} provinces</span>`)).join("")}
        <p class="legend-note">Darker = wider margin</p></div>`;
    } else if (state.tab === "perolehan") {
      const list = state.multi ? PAIRS : [state.pair];
      h = `<div><p class="legend-title">Share of valid votes (%)</p>
        ${list.map((p) => rampHTML(PAIR_RAMP[p], ["<20", "20–40", "40–60", "60–80", "≥80"], `${p} ${PAIR_NAME[p]}`)).join("")}${dirHTML()}</div>`;
    } else if (state.tab === "kemiskinan") {
      h = `<div><p class="legend-title">Poverty rate (%), quintiles</p>${rampHTML(RAMP_POV, rangeTicks(qBreaks("miskin"), 1))}${dirHTML()}</div>`;
    } else if (state.tab === "pendidikan") {
      h = `<div><p class="legend-title">Mean years of schooling, quintiles</p>${rampHTML(RAMP_EDU, rangeTicks(qBreaks("rls"), 1))}${dirHTML()}</div>`;
    } else if (state.tab === "mbg") {
      if (state.mbgMode === "jumlah") {
        const max = Math.max(...rows.map((r) => r.sppg));
        const ex = [100, 1000, 4000].filter((v) => v <= max);
        const sz = (v) => Math.sqrt(v / max) * 30;
        const R = sz(ex[ex.length - 1]);
        h = `<div><p class="legend-title">Number of SPPG kitchens</p><svg width="${R * 2 + 70}" height="${R * 2 + 6}" aria-hidden="true" style="color:var(--ink)">
          ${ex.map((v) => `<circle cx="${R + 2}" cy="${R * 2 + 2 - sz(v)}" r="${sz(v)}" fill="none" stroke="currentColor" stroke-width="1"/>
            <line x1="${R + 2}" x2="${R * 2 + 8}" y1="${R * 2 + 2 - sz(v) * 2}" y2="${R * 2 + 2 - sz(v) * 2}" stroke="currentColor" stroke-width=".5" stroke-dasharray="2 2"/>
            <text x="${R * 2 + 12}" y="${R * 2 + 6 - sz(v) * 2}" font-family="Plus Jakarta Sans" font-weight="600" font-size="11" fill="currentColor">${fmt(v)}</text>`).join("")}
        </svg><p class="legend-note">Circle area = kitchen count</p></div>`;
      } else {
        h = `<div><p class="legend-title">SPPG per 100k people in poverty, quintiles</p>${rampHTML(RAMP_SPPG, rangeTicks(qBreaks("sppg100k"), 0))}${dirHTML()}</div>`;
      }
    } else if (state.tab === "bivariat") {
      const cells = [];
      for (let y = 2; y >= 0; y--) for (let x = 0; x < 3; x++) cells.push(`<span style="background:${BIV[y][x]}"></span>`);
      h = `<div><p class="legend-title">Bivariate, terciles (3 × 3)</p><div class="biv">
        <div class="biv-wrap"><span class="biv-y">${esc(VARS[state.bivVar].label)} →</span><div class="biv-grid">${cells.join("")}</div>
        <span class="biv-x">${state.bivPair} vote % →</span></div>
        <div class="biv-axis">Up: higher ${esc(VARS[state.bivVar].label.toLowerCase())}<br>Right: higher ${state.bivPair} vote share<br>Top right: high on both</div></div></div>`;
    }
    el.innerHTML = h;
    $("#figure-title").textContent = figureTitle();
  }

  function renderTabs() {
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  }

  /** Refresh everything that depends on the view. */
  function renderMap() {
    const multi = state.tab === "perolehan" && state.multi;
    $("#figure").classList.toggle("is-multi", multi);
    $("#map").hidden = multi;
    $("#multi").hidden = !multi;
    if (multi) {
      map.closePopup();
      buildMiniMaps();
      requestAnimationFrame(fitMinis);
    } else {
      map.invalidateSize();
    }
    geoLayer.setStyle(styleFor);
    const showCircles = state.tab === "mbg" && state.mbgMode === "jumlah";
    if (showCircles && !map.hasLayer(circleLayer)) circleLayer.addTo(map);
    if (!showCircles && map.hasLayer(circleLayer)) map.removeLayer(circleLayer);
    miniMaps.forEach(({ layer, p }) => layer.setStyle((f) => {
      const r = byKey[f.properties._key];
      const s = r && r.key === state.sel;
      return { fillColor: fillFor(r, "perolehan", p), fillOpacity: 1, color: s ? css("--ink") : css("--paper"), weight: s ? 2 : 0.4 };
    }));
  }

  function renderAll() {
    renderTabs();
    renderSubcontrols();
    renderLegend();
    renderMap();
    renderPanel();
    writeURL();
  }

  /* ------------------------------------------------------------------
     8. Side panel (always national)
     ------------------------------------------------------------------ */
  function nationalShares() {
    const tot = { "01": 0, "02": 0, "03": 0 };
    rows.forEach((r) => PAIRS.forEach((p) => (tot[p] += r.suara[p])));
    const all = tot["01"] + tot["02"] + tot["03"];
    return PAIRS.map((p) => ({ p, votes: tot[p], pct: tot[p] / all * 100 }));
  }

  function winnerCounts() {
    return `<div class="counts">${PAIRS.map((p) => {
      const n = rows.filter((r) => r.menang === p).length;
      return `<div class="count-card"><b style="color:${PAIR_COLOR[p]}">${n}</b><span>${p} ${PAIR_NAME[p]}</span></div>`;
    }).join("")}</div><p class="hint" style="margin-top:8px">Provinces won, out of 38</p>`;
  }

  function stackedBar() {
    const s = nationalShares();
    return `<div class="stack" role="img" aria-label="National result">${s.map((x) =>
      `<span style="width:${x.pct}%;background:${PAIR_COLOR[x.p]}" title="${x.p}: ${fmt(x.votes)} votes"></span>`).join("")}</div>
      <div class="stack-legend">${s.map((x) => `<div><b style="color:${PAIR_COLOR[x.p]}">${x.p}</b> ${PAIR_NAME[x.p]} <b class="num">${fmt(x.pct, 2)}%</b></div>`).join("")}</div>`;
  }

  function scatterDefs() {
    const p = state.scatterPair;
    return [
      { x: "miskin", y: "pct_" + p, title: `Poverty vs ${p} vote`, xl: "Poverty %", yl: `${p} vote %` },
      { x: "rls", y: "pct_" + p, title: `Schooling vs ${p} vote`, xl: "Schooling (yrs)", yl: `${p} vote %` },
      { x: "miskin", y: "sppg100k", title: "Poverty vs SPPG per 100k poor", xl: "Poverty %", yl: "SPPG/100k" },
      { x: "rls", y: "miskin", title: "Schooling vs poverty", xl: "Schooling (yrs)", yl: "Poverty %" },
    ];
  }

  function scattersHTML() {
    return `<div class="section">
      <p class="section-head"><span>How the numbers relate</span>
        <span><label for="scatter-pair" class="sr">Ticket</label>
        <select id="scatter-pair">${PAIRS.map((p) => `<option value="${p}" ${p === state.scatterPair ? "selected" : ""}>${p} ${PAIR_NAME[p]}</option>`).join("")}</select></span></p>
      <div class="scatters">${scatterDefs().map((d, i) => {
        const s = Stats.spearman(rows.map((r) => r[d.x]), rows.map((r) => r[d.y]));
        const pTxt = s.p < 0.001 ? "< 0.001" : "≈ " + fmt(s.p, 3);
        return `<div><p class="scatter-title">${d.title}</p><div class="scatter-box"><canvas id="sc${i}"></canvas></div>
          <p class="rho">Spearman ρ ${fmt(s.rho, 2)} · p ${pTxt} · n ${s.n}</p></div>`;
      }).join("")}</div></div>`;
  }

  function strip(key, r) {
    const vals = rows.map((x) => x[key]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const X = (v) => ((v - min) / (max - min || 1) * 100).toFixed(2);
    return `<div class="stat-strip" aria-hidden="true">${vals.map((v) => `<i style="left:${X(v)}%"></i>`).join("")}<b style="left:${X(r[key])}%"></b></div>`;
  }

  function voteBars(r, compact, cls = "") {
    return `<div class="bars ${cls}">${PAIRS.map((p) => `<div class="bar-row" title="${p}: ${fmt(r.suara[p])} votes">
        <span>${p}${compact ? "" : " " + PAIR_NAME[p]}</span>
        <span class="bar-track"><span class="bar" style="width:${r.pct[p] * 0.7}%;background:${PAIR_COLOR[p]}"></span>
        <span class="bar-val">${fmt(r.pct[p], 1)}%</span>${compact ? "" : `<span class="bar-votes">${fmt(r.suara[p])}</span>`}</span></div>`).join("")}</div>`;
  }

  function provinceBlock(r, compact) {
    const stats = ["miskin", "jumlah_miskin", "rls", "sppg", "sppg100k"].map((k) => `<div class="stat-row">
        <span class="stat-label">${VARS[k].label}</span><span class="stat-val">${fmtVar(k, r[k])}</span>
        <span class="stat-rank">Rank ${fmt(r.rank[k])} of 38</span><span></span>${strip(k, r)}</div>`).join("");
    return `<div>
      <h3 class="prov-name">${esc(r.name)}</h3>
      <p class="winner" style="color:${PAIR_COLOR[r.menang]}">${r.menang} ${PAIR_NAME[r.menang]} <span class="muted">· won by ${fmt(r.margin, 1)}</span></p>
      ${voteBars(r, compact)}
      <p class="total">Total valid votes <b>${fmt(r.total)}</b></p>
      <div>${stats}</div>
      <p class="insight-text">${provinceInsight(r)}</p></div>`;
  }

  /** Plain-language takeaway for one province, based on terciles. */
  function provinceInsight(r) {
    const level = (key) => ["relatively low", "about average", "relatively high"][classOf(r[key], qBreaks(key, 3))];
    const pov = level("miskin"), edu = level("rls"), cov = level("sppg100k");
    const s1 = `${esc(r.name)} has ${edu} schooling (${fmt(r.rls, 1)} yrs) and ${pov} poverty (${fmt(r.miskin, 1)}%) compared with other provinces.`;
    const s2 = `MBG kitchen coverage is ${cov} (${fmt(r.sppg100k, 1)} per 100k people in poverty).`;
    let s3;
    if (r.menang === "02") {
      s3 = (pov === "relatively high" || edu === "relatively low")
        ? "Prabowo–Gibran won here — fitting the national pattern of ticket 02 winning poorer provinces with shorter schooling."
        : "Prabowo–Gibran won here, as in most provinces.";
    } else {
      const n = rows.filter((x) => x.menang !== "02").length;
      s3 = `${r.menang} ${PAIR_NAME[r.menang]} won here — one of only ${n} provinces Prabowo–Gibran did not win.`;
    }
    return s1 + " " + s2 + " " + s3;
  }

  function popupHTML(r) {
    return `<p class="pop-name">${esc(r.name)}</p>
      <p class="pop-win" style="color:${PAIR_COLOR[r.menang]}">${r.menang} ${PAIR_NAME[r.menang]} <span class="muted">· +${fmt(r.margin, 1)}</span></p>
      ${voteBars(r, true, "pop-bars")}
      <div class="pop-stats"><span>Poverty rate</span><span>${fmt(r.miskin, 2)}%</span>
        <span>Mean schooling</span><span>${fmt(r.rls, 2)} yrs</span>
        <span>MBG kitchens</span><span>${fmt(r.sppg)}</span></div>
      <p class="pop-insight">${provinceInsight(r)}</p>
      <button class="pill solid pop-btn" data-detail="${r.key}">See details</button>`;
  }

  /** Narrative insight cards, computed live from the data. */
  function insightsHTML() {
    const won02 = rows.filter((r) => r.menang === "02");
    const rest = rows.filter((r) => r.menang !== "02");
    const avg = (list, k) => list.reduce((a, r) => a + r[k], 0) / list.length;
    const cEduPov = Stats.spearman(rows.map((r) => r.rls), rows.map((r) => r.miskin));
    const cPov02 = Stats.spearman(rows.map((r) => r.miskin), rows.map((r) => r.pct_02));
    const pTxt = (p) => (p < 0.001 ? "< 0.001" : "≈ " + fmt(p, 3));
    return `<div class="section"><p class="section-head"><span>What the numbers suggest</span></p>
      <div class="insights">
        <div class="insight"><p class="insight-head">Less schooling, more poverty</p>
          <p>Provinces with shorter schooling tend to be poorer — Spearman ρ ${fmt(cEduPov.rho, 2)} (p ${pTxt(cEduPov.p)}) across 38 provinces.</p></div>
        <div class="insight"><p class="insight-head">Prabowo–Gibran won ${won02.length} of 38 provinces</p>
          <p>Where ticket 02 won, poverty averages <b>${fmt(avg(won02, "miskin"), 1)}%</b> (vs ${fmt(avg(rest, "miskin"), 1)}% elsewhere) and mean schooling <b>${fmt(avg(won02, "rls"), 1)} yrs</b> (vs ${fmt(avg(rest, "rls"), 1)}). Higher poverty leans toward a higher 02 vote share (ρ ${fmt(cPov02.rho, 2)}, p ${pTxt(cPov02.p)}).</p></div>
        <div class="insight"><p class="insight-head">MBG kitchens where 02 won</p>
          <p>SPPG coverage averages <b>${fmt(avg(won02, "sppg100k"), 1)}</b> per 100k people in poverty in provinces 02 won, vs ${fmt(avg(rest, "sppg100k"), 1)} in the rest.</p></div>
      </div>
      <p class="hint">Patterns across 38 provinces are hints, not proof — they say nothing about individual voters.</p></div>`;
  }

  function renderPanel() {
    const el = $("#panel");
    charts.forEach((c) => c.destroy());
    charts = [];
    const r = state.sel && byKey[state.sel];
    el.innerHTML = `<div class="section"><p class="section-head"><span>Provinces won</span></p>${winnerCounts()}</div>
      <div class="section"><p class="section-head"><span>National result, valid votes</span></p>${stackedBar()}</div>
      ${insightsHTML()}
      ${scattersHTML()}
      <div class="section">${r ? `<span class="sel-chip">Highlighted: ${esc(r.name)} <button id="clear-sel" aria-label="Clear selection">×</button></span>`
        : `<p class="hint">Click a province to see its numbers.</p>`}</div>`;
    drawScatters();
  }

  /** Chart.js scatter, winner-colored dots, selected province ringed. */
  function drawScatters() {
    const ink = css("--ink"), ink2 = css("--ink-2"), rule = css("--rule");
    const hi = [state.sel].filter(Boolean);
    const labelPlugin = {
      id: "selLabel",
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = "700 11px 'Plus Jakarta Sans'";
        ctx.fillStyle = ink;
        meta.data.forEach((pt, i) => {
          if (!hi.includes(rows[i].key)) return;
          const right = pt.x > chart.chartArea.right - 70;
          ctx.textAlign = right ? "right" : "left";
          ctx.fillText(rows[i].name, pt.x + (right ? -10 : 10), pt.y + 4);
        });
        ctx.restore();
      },
    };
    scatterDefs().forEach((d, i) => {
      const cv = document.getElementById("sc" + i);
      if (!cv) return;
      const axis = (title) => ({
        title: { display: true, text: title, color: ink2, font: { family: "Plus Jakarta Sans", size: 11, weight: "600" } },
        grid: { color: rule + "66" }, border: { display: false },
        ticks: { color: ink2, font: { family: "Plus Jakarta Sans", size: 10 }, maxTicksLimit: 4, callback: (v) => fmt(v, 0) },
      });
      const order = rows.map((r) => (hi.includes(r.key) ? 1 : 0));
      charts.push(new Chart(cv, {
        type: "scatter",
        data: { datasets: [{
          data: rows.map((r) => ({ x: r[d.x], y: r[d.y] })),
          backgroundColor: rows.map((r) => PAIR_COLOR[r.menang] + (hi.length && !hi.includes(r.key) ? "88" : "")),
          borderColor: rows.map((r) => (hi.includes(r.key) ? ink : "transparent")),
          borderWidth: rows.map((r) => (hi.includes(r.key) ? 2 : 0)),
          pointRadius: order.map((o) => (o ? 7 : 3.5)),
          pointHoverRadius: 7,
        }] },
        options: {
          animation: false, maintainAspectRatio: false, responsive: true,
          layout: { padding: { right: 4, top: 4 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: css("--paper"), titleColor: ink, bodyColor: ink, borderColor: rule, borderWidth: 1,
              cornerRadius: 10, padding: 8, displayColors: false, titleFont: { family: "Plus Jakarta Sans", weight: "700" },
              bodyFont: { family: "Plus Jakarta Sans", size: 11 },
              callbacks: {
                title: (items) => rows[items[0].dataIndex].name,
                label: (it) => `${d.xl}: ${fmt(it.parsed.x, 2)} · ${d.yl}: ${fmt(it.parsed.y, 2)}`,
              },
            },
          },
          scales: { x: axis(d.xl), y: axis(d.yl) },
          onClick: (e, els) => { if (els.length) select(rows[els[0].index].key); },
        },
        plugins: [labelPlugin],
      }));
    });
  }

  /* Details modal with optional comparison */
  function renderDetail() {
    const r = byKey[state.detail];
    if (!r) return;
    const c = state.cmp && byKey[state.cmp];
    const options = rows.filter((x) => x.key !== r.key).sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((x) => `<option value="${x.key}" ${x.key === state.cmp ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    $("#d-title").textContent = c ? "Compare provinces" : "Province details";
    $("#detail-body").innerHTML = `<div class="compare-bar"><label class="label" for="cmp">Compare with</label>
        <select id="cmp"><option value="">None</option>${options}</select></div>
      ${c ? `<div class="compare-cols">${provinceBlock(r, true)}${provinceBlock(c, true)}</div>` : provinceBlock(r, false)}`;
  }
  function openDetail(key) {
    state.detail = key;
    if (state.cmp === key) state.cmp = null;
    renderDetail();
    openOverlay("#ov-detail");
  }

  /* ------------------------------------------------------------------
     9. Selection, search, URL
     ------------------------------------------------------------------ */
  function select(key, latlng, opts = {}) {
    const r = byKey[key];
    if (!r) return;
    state.sel = key;
    renderMap();
    renderPanel();
    writeURL();
    if (opts.noPopup) return;
    if (state.tab === "perolehan" && state.multi) { openDetail(key); return; }
    const at = latlng || centroids[key];
    if (!latlng) {
      const lyr = geoLayer.getLayers().find((l) => l.feature.properties._key === key);
      if (lyr) map.fitBounds(lyr.getBounds(), { maxZoom: 6, padding: [40, 40], animate: false });
    }
    L.popup({ maxWidth: 300, autoPanPadding: [16, 16], className: "prov-pop" }).setLatLng(at).setContent(popupHTML(r)).openOn(map);
  }

  function writeURL() {
    const q = new URLSearchParams();
    q.set("tab", state.tab);
    if (state.tab === "perolehan") q.set("paslon", state.pair);
    if (state.sel) q.set("prov", slug(state.sel));
    history.replaceState(null, "", "?" + q.toString());
  }

  function readURL() {
    const q = new URLSearchParams(location.search);
    const t = q.get("tab");
    if (TABS.includes(t)) state.tab = t;
    const p = q.get("paslon");
    if (PAIRS.includes(p)) state.pair = p;
    const prov = q.get("prov");
    if (prov) {
      const r = rows.find((x) => slug(x.key) === prov);
      if (r) state.sel = r.key;
    }
  }

  function initSearch() {
    const input = $("#search"), list = $("#search-list");
    let items = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const paint = () => {
      list.innerHTML = items.map((r, i) => `<li role="option" data-key="${r.key}" aria-selected="${i === active}">${esc(r.name)}</li>`).join("");
    };
    input.addEventListener("input", () => {
      const q = normalize(input.value);
      if (!q) return close();
      items = rows.filter((r) => r.key.includes(q) || r.name.toLowerCase().includes(q)).slice(0, 8);
      active = items.length ? 0 : -1;
      paint();
      list.hidden = !items.length;
      input.setAttribute("aria-expanded", String(!list.hidden));
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === "Enter" && items[active]) { select(items[active].key); input.value = items[active].name; close(); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      select(li.dataset.key);
      input.value = byKey[li.dataset.key].name;
      close();
    });
    input.addEventListener("blur", close);
  }

  function initProvList() {
    $("#provlist").innerHTML = rows.slice().sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((r) => `<li><button data-key="${r.key}">${esc(r.name)}</button></li>`).join("");
    $("#provlist").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { select(b.dataset.key); $("#figure").scrollIntoView({ block: "start", behavior: "smooth" }); }
    });
  }

  /* ------------------------------------------------------------------
     10. Table, CSV, PNG, overlays
     ------------------------------------------------------------------ */
  const TABLE_COLS = [
    ["name", "Province"], ["menang", "Winner"], ["pct_01", "01 %"], ["pct_02", "02 %"], ["pct_03", "03 %"],
    ["margin", "Margin"], ["total", "Valid votes"], ["miskin", "Poverty %"], ["jumlah_miskin", "Poor (k)"],
    ["rls", "Schooling (yrs)"], ["sppg", "SPPG"], ["sppg100k", "SPPG/100k poor"],
  ];
  const tableState = { key: "name", dir: 1, filter: "" };

  function cellText(r, k) {
    if (k === "name") return esc(r.name);
    if (k === "menang") return `<span style="color:${PAIR_COLOR[r.menang]};font-weight:600">${r.menang}</span>`;
    if (k === "total") return fmt(r.total);
    return fmt(r[k], VARS[k].d);
  }

  function renderTable() {
    const f = tableState.filter.toLowerCase();
    const list = rows.filter((r) => r.name.toLowerCase().includes(f)).sort((a, b) => {
      const A = a[tableState.key], B = b[tableState.key];
      return (typeof A === "string" ? A.localeCompare(B, "en") : A - B) * tableState.dir;
    });
    $("#table").innerHTML = `<thead><tr>${TABLE_COLS.map(([k, l]) =>
      `<th data-k="${k}" aria-sort="${tableState.key === k ? (tableState.dir > 0 ? "ascending" : "descending") : "none"}">${l}${tableState.key === k ? (tableState.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
      <tbody>${list.map((r) => `<tr>${TABLE_COLS.map(([k]) => `<td>${cellText(r, k)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  function downloadCSV() {
    const out = rows.map((r) => ({
      province: r.name, votes_01: r.suara["01"], votes_02: r.suara["02"], votes_03: r.suara["03"], valid_votes: r.total,
      pct_01: r.pct_01, pct_02: r.pct_02, pct_03: r.pct_03, winner: r.menang, margin: +r.margin.toFixed(2),
      poverty_rate_mar2026: r.miskin, poor_population_k_mar2026: r.jumlah_miskin, mean_years_schooling: r.rls, sppg_jun2026: r.sppg,
      sppg_per_100k_poor: +r.sppg100k.toFixed(3),
    }));
    const blob = new Blob([Papa.unparse(out)], { type: "text/csv;charset=utf-8" });
    triggerDownload(URL.createObjectURL(blob), "votes_poverty_mbg.csv");
  }

  function triggerDownload(href, name) {
    const a = document.createElement("a");
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function downloadPNG() {
    const fig = $("#figure");
    await document.fonts.ready;
    const canvas = await html2canvas(fig, { backgroundColor: css("--paper"), scale: 2, useCORS: true, logging: false,
      ignoreElements: (el) => el.classList && (el.classList.contains("leaflet-control-container") || el.classList.contains("leaflet-popup-pane")) });
    // Compose with a masthead above the figure.
    const pad = 48, headH = 150;
    const out = document.createElement("canvas");
    out.width = canvas.width + pad * 2; out.height = canvas.height + headH + pad;
    const ctx = out.getContext("2d");
    ctx.fillStyle = css("--paper"); ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = css("--ink-2"); ctx.font = "600 24px 'Plus Jakarta Sans'";
    ctx.fillText("#30DayMapChallenge · Day 3 · Polygons", pad, pad + 10);
    ctx.fillStyle = css("--ink"); ctx.font = "800 64px 'Plus Jakarta Sans'";
    ctx.fillText("Votes, poverty and MBG kitchens", pad, pad + 84);
    ctx.drawImage(canvas, pad, headH);
    triggerDownload(out.toDataURL("image/png"), `map_${state.tab}.png`);
  }

  function openOverlay(id) {
    const ov = $(id);
    ov.hidden = false;
    const btn = ov.querySelector("[data-close]");
    btn.focus();
  }

  /* ------------------------------------------------------------------
     11. Events
     ------------------------------------------------------------------ */
  function bindEvents() {
    $("#tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.tab = b.dataset.tab;
      renderAll();
    });
    $("#subcontrols").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.pair) state.pair = b.dataset.pair;
      if (b.dataset.bivpair) state.bivPair = b.dataset.bivpair;
      if (b.dataset.mbg) state.mbgMode = b.dataset.mbg;
      if (b.id === "btn-multi") state.multi = !state.multi;
      renderAll();
    });
    $("#subcontrols").addEventListener("change", (e) => {
      if (e.target.id === "bivvar") { state.bivVar = e.target.value; renderAll(); }
    });
    $("#panel").addEventListener("click", (e) => {
      if (e.target.id === "clear-sel") { state.sel = null; map.closePopup(); renderMap(); renderPanel(); writeURL(); }
    });
    $("#panel").addEventListener("change", (e) => {
      if (e.target.id === "scatter-pair") { state.scatterPair = e.target.value; renderPanel(); }
    });
    $("#detail-body").addEventListener("change", (e) => {
      if (e.target.id === "cmp") { state.cmp = e.target.value || null; renderDetail(); renderMap(); }
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-detail]");
      if (b) openDetail(b.dataset.detail);
    });
    $("#reset").addEventListener("click", () => {
      Object.assign(state, { tab: "pemenang", pair: "02", multi: false, mbgMode: "jumlah", bivPair: "02", bivVar: "miskin", sel: null, cmp: null });
      map.closePopup();
      $("#search").value = "";
      map.fitBounds(idnBounds(), { padding: [8, 8] }); map.setView(idnBounds().getCenter(), Math.round(map.getZoom()));
      renderAll();
    });
    $("#btn-table").addEventListener("click", () => { renderTable(); openOverlay("#ov-table"); });
    $("#btn-method").addEventListener("click", () => openOverlay("#ov-method"));
    $("#btn-csv").addEventListener("click", downloadCSV);
    $("#btn-png").addEventListener("click", downloadPNG);
    $("#table").addEventListener("click", (e) => {
      const th = e.target.closest("th");
      if (!th) return;
      const k = th.dataset.k;
      tableState.dir = tableState.key === k ? -tableState.dir : (k === "name" ? 1 : -1);
      tableState.key = k;
      renderTable();
    });
    $("#table-filter").addEventListener("input", (e) => { tableState.filter = e.target.value; renderTable(); });
    document.querySelectorAll(".overlay").forEach((ov) => {
      ov.addEventListener("click", (e) => { if (e.target === ov || e.target.hasAttribute("data-close")) ov.hidden = true; });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".overlay").forEach((ov) => (ov.hidden = true));
    });
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { map.invalidateSize(); miniMaps.forEach(({ m }) => m.invalidateSize()); }, 150); });
  }

  /* ------------------------------------------------------------------
     12. Boot
     ------------------------------------------------------------------ */
  async function init() {
    try {
      await loadData();
    } catch (err) {
      const w = $("#join-warning");
      w.hidden = false;
      w.textContent = "Data failed to load. Serve the folder locally (python -m http.server).";
      return;
    }
    if (window.Chart) {
      Chart.defaults.font.family = "Plus Jakarta Sans";
      Chart.defaults.color = css("--ink-2");
    }
    readURL();
    initMap();
    buildCircles();
    initSearch();
    initProvList();
    bindEvents();
    renderAll();
    if (state.sel) select(state.sel);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
