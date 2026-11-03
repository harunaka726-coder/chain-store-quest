/**
 * チェーン店クエスト — メインアプリケーション
 * 実店舗取得・複数ルート重ね描き・半径円・範囲集計
 */
(function () {
  const CC = window.ChainConstellation;
  const brands = CC.brandCatalog;

  /** @type {Array<{id:string,brandId:string,name:string,lat:number,lng:number,source?:string}>} */
  let stores = [];
  const activeBrands = new Set(Object.keys(brands));
  let pathIds = [];
  let isClosed = false;
  /** @type {Array<{id:string,pathIds:string[],label:string,meta:object}>} */
  let savedRoutes = [];
  let selectedStoreId = null;
  let radiusMeters = 300;
  let showRadius = true;
  /** @type {'none'|'rect'|'circle'} */
  let selectMode = "none";
  let isFetching = false;

  /** @type {L.Map} */
  let map;
  const markers = new Map();
  let searchMarker = null;
  let edgeLayer;
  let fillLayer;
  let radiusLayer;
  let selectLayer;
  let svgRenderer;
  let gradientSeq = 0;
  let searchDebounce = null;
  let selectStart = null;
  let selectPreview = null;
  let mapWasDragging = true;

  const el = {
    vertices: document.getElementById("stat-vertices"),
    edges: document.getElementById("stat-edges"),
    area: document.getElementById("stat-area"),
    closed: document.getElementById("stat-closed"),
    saved: document.getElementById("stat-saved"),
    lastDist: document.getElementById("stat-last-dist"),
    totalDist: document.getElementById("stat-total-dist"),
    edgeDistList: document.getElementById("edge-dist-list"),
    routeSummary: document.getElementById("route-summary"),
    shareFb: document.getElementById("share-feedback"),
    toast: document.getElementById("toast"),
    brandFilters: document.getElementById("brand-filters"),
    filterCount: document.getElementById("filter-count"),
    dataStatus: document.getElementById("data-status"),
    searchInput: document.getElementById("search-input"),
    searchForm: document.getElementById("search-form"),
    searchResults: document.getElementById("search-results"),
    panel: document.getElementById("control-panel"),
    panelToggle: document.getElementById("panel-toggle"),
    radiusInput: document.getElementById("radius-input"),
    chkRadius: document.getElementById("chk-radius"),
    selectModeLabel: document.getElementById("select-mode-label"),
    areaReport: document.getElementById("area-report"),
    areaTotal: document.getElementById("area-total"),
    areaBrandSummary: document.getElementById("area-brand-summary"),
    areaStoreList: document.getElementById("area-store-list"),
    savedList: document.getElementById("saved-list"),
    btnNext: document.getElementById("btn-next"),
    loading: document.getElementById("loading-badge"),
    skeleton: document.getElementById("skeleton"),
    app: document.getElementById("app"),
    addBrandForm: document.getElementById("add-brand-form"),
    addBrandName: document.getElementById("add-brand-name"),
    addBrandColor: document.getElementById("add-brand-color")
  };

  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function polygonAreaSqM(points) {
    if (points.length < 3) return 0;
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const x1 = points[i].lng * mPerDegLng;
      const y1 = points[i].lat * mPerDegLat;
      const x2 = points[j].lng * mPerDegLng;
      const y2 = points[j].lat * mPerDegLat;
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  function formatArea(sqm) {
    if (!sqm) return "—";
    if (sqm >= 1e6) return (sqm / 1e6).toFixed(2) + " km²";
    if (sqm >= 10000) return (sqm / 10000).toFixed(2) + " ha";
    return Math.round(sqm).toLocaleString("ja-JP") + " m²";
  }

  function formatDistance(meters) {
    if (meters == null || Number.isNaN(meters)) return "—";
    if (meters >= 1000) return (meters / 1000).toFixed(2) + " km";
    return Math.round(meters).toLocaleString("ja-JP") + " m";
  }

  function pathDistances(ids) {
    const edges = [];
    let total = 0;
    for (let i = 0; i < ids.length - 1; i++) {
      const a = getStore(ids[i]);
      const b = getStore(ids[i + 1]);
      if (!a || !b) continue;
      const d = haversineMeters(a, b);
      total += d;
      edges.push({
        from: a.name,
        to: b.name,
        meters: d
      });
    }
    return {
      edges,
      total,
      last: edges.length ? edges[edges.length - 1].meters : null
    };
  }

  function getStore(id) {
    return stores.find((s) => s.id === id);
  }

  function getBrand(store) {
    return brands[store.brandId] || {
      name: "不明",
      shortName: "不明",
      color: "#ffffff",
      pitchBase: 330
    };
  }

  function isStoreVisible(store) {
    return activeBrands.has(store.brandId);
  }

  function getVisibleStores() {
    return stores.filter(isStoreVisible);
  }

  function showToast(message, ms = 2400) {
    el.toast.hidden = false;
    el.toast.textContent = message;
    requestAnimationFrame(() => el.toast.classList.add("is-visible"));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.toast.classList.remove("is-visible");
      setTimeout(() => {
        el.toast.hidden = true;
      }, 300);
    }, ms);
  }

  function setLoading(on) {
    isFetching = on;
    el.loading.hidden = !on;
    document.getElementById("btn-fetch-stores").disabled = on;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- ルート情報 ---
  function metaFromPath(pathIdsArg, closed) {
    const uniquePath = closed ? pathIdsArg.slice(0, -1) : pathIdsArg.slice();
    const vertexCount = uniquePath.length;
    const edgeCount = Math.max(0, pathIdsArg.length - 1);
    const points = uniquePath.map(getStore).filter(Boolean);
    const area = closed ? polygonAreaSqM(points) : 0;
    const dists = pathDistances(pathIdsArg);
    const parts = [];
    if (vertexCount) parts.push(`頂点 ${vertexCount}`);
    if (edgeCount) parts.push(`線 ${edgeCount}`);
    if (dists.total) parts.push(`距離 ${formatDistance(dists.total)}`);
    if (closed && area) parts.push(`面積 ${formatArea(area)}`);
    if (closed) parts.push("閉じた図形");
    return {
      summary: parts.length ? parts.join(" / ") : "未作成",
      label: closed ? `ルート（${vertexCount}頂点）` : vertexCount ? `描画中（${vertexCount}点）` : "未作成",
      vertexCount,
      edgeCount,
      area,
      dists
    };
  }

  function updateStats() {
    const meta = metaFromPath(pathIds, isClosed);
    const dist = pathDistances(pathIds);
    el.vertices.textContent = String(meta.vertexCount);
    el.edges.textContent = String(meta.edgeCount);
    el.area.textContent = isClosed ? formatArea(meta.area) : "—";
    el.closed.textContent = isClosed ? "完成" : "未完成";
    el.saved.textContent = String(savedRoutes.length);
    el.lastDist.textContent = formatDistance(dist.last);
    el.totalDist.textContent = dist.edges.length ? formatDistance(dist.total) : "—";
    el.edgeDistList.innerHTML = dist.edges
      .map(
        (e, i) =>
          `<li>${i + 1}. ${escapeHtml(e.from)} → ${escapeHtml(e.to)}　<strong>${formatDistance(e.meters)}</strong></li>`
      )
      .join("");
    el.routeSummary.textContent = meta.summary;
    el.btnNext.hidden = !isClosed;
    renderSavedList();
    return meta;
  }

  function renderSavedList() {
    if (!savedRoutes.length) {
      el.savedList.innerHTML = "";
      return;
    }
    el.savedList.innerHTML = savedRoutes
      .map(
        (c, i) =>
          `<li><span class="saved-name">${i + 1}. ${escapeHtml(c.label)}</span> — 頂点 ${c.meta.vertexCount}</li>`
      )
      .join("");
  }

  // --- マーカー ---
  function createIcon(store, state) {
    const brand = getBrand(store);
    const classes = ["store-marker"];
    if (state.selected) classes.push("is-selected");
    if (state.inPath) classes.push("is-in-path");
    if (state.isStart) classes.push("is-path-start");
    return L.divIcon({
      className: "",
      html: `<div class="${classes.join(" ")}" style="--brand:${brand.color}">
        <span class="pin-ring"></span><span class="pin-core"></span>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });
  }

  function pathIdSet() {
    const set = new Set(isClosed ? pathIds.slice(0, -1) : pathIds);
    savedRoutes.forEach((c) => {
      c.pathIds.slice(0, -1).forEach((id) => set.add(id));
    });
    return set;
  }

  function refreshMarkerStyles() {
    const startId = pathIds[0];
    const inPath = pathIdSet();
    stores.forEach((store) => {
      const marker = markers.get(store.id);
      if (!marker) return;
      const visible = isStoreVisible(store);
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
      if (!visible) return;
      marker.setIcon(
        createIcon(store, {
          selected:
            selectedStoreId === store.id ||
            (pathIds.length && pathIds[pathIds.length - 1] === store.id && !isClosed),
          inPath: inPath.has(store.id),
          isStart: !isClosed && pathIds.length > 0 && store.id === startId
        })
      );
    });
    updateFilterCount();
  }

  function addMarker(store) {
    if (markers.has(store.id)) return;
    const brand = getBrand(store);
    const marker = L.marker([store.lat, store.lng], {
      icon: createIcon(store, {}),
      riseOnHover: true,
      title: store.name
    });
    const src = store.source === "osm" ? "OSM実データ" : store.source === "dummy" ? "ダミー" : "";
    marker.bindPopup(
      `<strong>${escapeHtml(store.name)}</strong><br/>
       <span style="color:${brand.color}">●</span> ${escapeHtml(brand.name)}
       ${src ? `<br/><small style="opacity:.7">${src}</small>` : ""}`
    );
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      onStoreClick(store.id);
    });
    markers.set(store.id, marker);
    if (isStoreVisible(store)) marker.addTo(map);
  }

  function mergeStores(list) {
    let added = 0;
    list.forEach((s) => {
      if (stores.some((x) => x.id === s.id)) return;
      stores.push(s);
      addMarker(s);
      added++;
    });
    updateFilterCount();
    return added;
  }

  function updateFilterCount() {
    const n = getVisibleStores().length;
    const brandN = activeBrands.size;
    el.filterCount.textContent =
      brandN === 0
        ? "表示中: ブランド未選択"
        : `表示中: ${n} 店舗 / ${brandN} ブランド`;
  }

  // --- 半径円 ---
  function updateRadiusCircle() {
    radiusLayer.clearLayers();
    if (!showRadius || !selectedStoreId) return;
    const store = getStore(selectedStoreId);
    if (!store) return;
    const brand = getBrand(store);
    L.circle([store.lat, store.lng], {
      radius: radiusMeters,
      color: brand.color,
      weight: 2,
      fillColor: brand.color,
      fillOpacity: 0.08,
      interactive: false,
      className: "radius-circle"
    }).addTo(radiusLayer);
  }

  // --- 描画 ---
  function ensureSvgDefs() {
    const root =
      (svgRenderer && svgRenderer._container) ||
      map.getPanes().overlayPane.querySelector("svg");
    if (!root) return null;
    let defs = root.querySelector("defs#cc-gradients");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.id = "cc-gradients";
      root.insertBefore(defs, root.firstChild);
    }
    return defs;
  }

  function createGradientId(colorA, colorB) {
    const defs = ensureSvgDefs();
    const id = "cc-grad-" + ++gradientSeq;
    if (!defs) return null;
    const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    grad.setAttribute("id", id);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    const s0 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    s0.setAttribute("offset", "0%");
    s0.setAttribute("stop-color", colorA);
    const s1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    s1.setAttribute("offset", "100%");
    s1.setAttribute("stop-color", colorB);
    grad.appendChild(s0);
    grad.appendChild(s1);
    defs.appendChild(grad);
    return id;
  }

  function updateGradientEndpoints(gradId, latlngs) {
    const defs = ensureSvgDefs();
    if (!defs || !gradId) return;
    const grad = defs.querySelector("#" + gradId);
    if (!grad || latlngs.length < 2) return;
    const p0 = map.latLngToLayerPoint(latlngs[0]);
    const p1 = map.latLngToLayerPoint(latlngs[1]);
    grad.setAttribute("x1", p0.x);
    grad.setAttribute("y1", p0.y);
    grad.setAttribute("x2", p1.x);
    grad.setAttribute("y2", p1.y);
  }

  /** グラデーション同期用に全エッジの端点を保持 */
  let edgeRefs = [];

  function drawOnePath(ids, closed, options = {}) {
    const { flash = false, weight = 3.5, fillOpacity = 0.2 } = options;
    for (let i = 0; i < ids.length - 1; i++) {
      const a = getStore(ids[i]);
      const b = getStore(ids[i + 1]);
      if (!a || !b) continue;
      const brandA = getBrand(a);
      const brandB = getBrand(b);
      const latlngs = [
        [a.lat, a.lng],
        [b.lat, b.lng]
      ];
      const gradId = createGradientId(brandA.color, brandB.color);
      const poly = L.polyline(latlngs, {
        className: "neon-edge",
        color: brandA.color,
        weight,
        opacity: 0.95,
        interactive: false,
        renderer: svgRenderer
      });
      poly.on("add", () => {
        const path = poly.getElement();
        if (path && gradId) {
          path.setAttribute("stroke", `url(#${gradId})`);
          path.style.color = brandA.color;
          updateGradientEndpoints(gradId, [L.latLng(a.lat, a.lng), L.latLng(b.lat, b.lng)]);
        }
      });
      poly.addTo(edgeLayer);
      edgeRefs.push({
        gradId,
        a: L.latLng(a.lat, a.lng),
        b: L.latLng(b.lat, b.lng),
        layer: poly
      });
    }

    const unique = closed ? ids.slice(0, -1) : ids;
    if (closed && unique.length >= 3) {
      const ring = unique.map((id) => {
        const s = getStore(id);
        return [s.lat, s.lng];
      });
      const fillColor = getBrand(getStore(unique[0])).color || "#7ec8ff";
      const polygon = L.polygon(ring, {
        className: "neon-fill",
        color: fillColor,
        weight: 0,
        fillColor,
        fillOpacity,
        interactive: false,
        renderer: svgRenderer
      });
      polygon.addTo(fillLayer);
      if (flash) {
        requestAnimationFrame(() => {
          const path = polygon.getElement();
          if (path) {
            path.classList.add("is-flash");
            setTimeout(() => path.classList.remove("is-flash"), 1300);
          }
        });
      }
    }
  }

  function redrawArt(options = {}) {
    edgeLayer.clearLayers();
    fillLayer.clearLayers();
    edgeRefs = [];
    const defs = ensureSvgDefs();
    if (defs) defs.innerHTML = "";
    gradientSeq = 0;

    savedRoutes.forEach((c) => {
      drawOnePath(c.pathIds, true, { flash: false, weight: 3, fillOpacity: 0.16 });
    });
    drawOnePath(pathIds, isClosed, {
      flash: !!options.flash && isClosed,
      weight: 3.5,
      fillOpacity: 0.22
    });

    map.off("zoom move", syncGradients);
    map.on("zoom move", syncGradients);
    refreshMarkerStyles();
    updateRadiusCircle();
    updateStats();
  }

  function syncGradients() {
    edgeRefs.forEach((ref) => {
      const path = ref.layer.getElement();
      if (!path || !ref.gradId) return;
      updateGradientEndpoints(ref.gradId, [ref.a, ref.b]);
    });
  }

  // --- 複数ルート ---
  function archiveCurrentIfClosed() {
    if (!isClosed || pathIds.length < 4) return null;
    const meta = metaFromPath(pathIds, true);
    const item = {
      id: CC.generateId("route"),
      pathIds: [...pathIds],
      label: meta.label,
      meta
    };
    savedRoutes.push(item);
    pathIds = [];
    isClosed = false;
    return item;
  }

  function startNextRoute() {
    const archived = archiveCurrentIfClosed();
    selectedStoreId = null;
    redrawArt();
    if (archived) showToast(`${archived.label} を保存`);
  }

  // --- 店舗クリック ---
  async function onStoreClick(storeId) {
    await CC.synth.unlock();
    const store = getStore(storeId);
    if (!store || !isStoreVisible(store)) return;

    if (isClosed) {
      archiveCurrentIfClosed();
      pathIds = [storeId];
      isClosed = false;
      selectedStoreId = storeId;
      CC.synth.playTone(getBrand(store).pitchBase * 0.75, 0.4);
      redrawArt();
      showToast("次のルートを開始");
      return;
    }

    // 閉じる（最初の点に戻る）は解除より優先
    if (pathIds.length >= 3 && pathIds[0] === storeId) {
      pathIds.push(storeId);
      isClosed = true;
      selectedStoreId = storeId;
      redrawArt({ flash: true });
      const unique = pathIds.slice(0, -1).map(getStore);
      CC.synth.playChord(CC.chordFromPath(unique.map(getBrand)));
      showToast("ルート完成");
      return;
    }

    // 末尾の点 / いま選択中の点をもう一度 → 解除
    const isLast = pathIds.length && pathIds[pathIds.length - 1] === storeId;
    if (isLast || selectedStoreId === storeId) {
      if (isLast) pathIds.pop();
      selectedStoreId = pathIds.length ? pathIds[pathIds.length - 1] : null;
      redrawArt();
      showToast("選択を解除しました");
      return;
    }

    if (pathIds.includes(storeId)) {
      showToast("結済みの点です。末尾をもう一度押すと解除できます");
      return;
    }

    const prev = pathIds.length ? getStore(pathIds[pathIds.length - 1]) : null;
    pathIds.push(storeId);
    selectedStoreId = storeId;
    if (prev) {
      const dist = haversineMeters(prev, store);
      CC.synth.playTone(CC.pitchFromConnection(getBrand(prev), getBrand(store), dist));
      showToast(`距離 ${formatDistance(dist)}`);
    } else {
      CC.synth.playTone(getBrand(store).pitchBase * 0.75, 0.4);
    }
    redrawArt();
  }

  function clearCurrent() {
    pathIds = [];
    isClosed = false;
    selectedStoreId = null;
    redrawArt();
    showToast("クリアしました");
  }

  function clearAllRoutes() {
    pathIds = [];
    isClosed = false;
    selectedStoreId = null;
    savedRoutes = [];
    redrawArt();
    showToast("すべて消去しました");
  }

  async function onAddBrand(e) {
    e.preventDefault();
    const name = el.addBrandName.value.trim();
    const color = el.addBrandColor.value;
    if (!name) return;
    try {
      const brand = CC.registerBrand({ name, color });
      activeBrands.add(brand.id);
      buildBrandFilters();
      updateFilterCount();
      el.addBrandName.value = "";
      showToast(`${brand.name} を追加 — 取得中`);
      setLoading(true);
      try {
        let bounds = map.getBounds();
        const c = map.getCenter();
        if (bounds.getNorth() - bounds.getSouth() > 0.07 || bounds.getEast() - bounds.getWest() > 0.07) {
          const d = 0.03;
          bounds = L.latLngBounds([c.lat - d, c.lng - d], [c.lat + d, c.lng + d]);
        }
        const list = await CC.fetchStoresInBBox(boundsPayload(bounds), { brandIds: [brand.id] });
        const added = mergeStores(list);
        showToast(added ? `${brand.name} ${added} 店` : `${brand.name}: この範囲に見つかりません`);
        refreshMarkerStyles();
      } finally {
        setLoading(false);
      }
    } catch (err) {
      showToast(err.message || "追加に失敗しました");
    }
  }

  function finishBoot() {
    if (!el.skeleton || el.skeleton.classList.contains("is-done")) return;
    el.skeleton.classList.add("is-done");
    el.app.classList.remove("is-booting");
    el.app.classList.add("is-ready");
    setTimeout(() => {
      el.skeleton.remove();
    }, 600);
  }

  async function autoConnect() {
    await CC.synth.unlock();
    const visible = getVisibleStores();
    if (visible.length < 3) {
      showToast("自動結線には表示中の店舗が3つ以上必要です");
      return;
    }
    if (isClosed) archiveCurrentIfClosed();
    pathIds = [];
    isClosed = false;

    const center = map.getCenter();
    const sorted = [...visible].sort(
      (a, b) =>
        haversineMeters(a, { lat: center.lat, lng: center.lng }) -
        haversineMeters(b, { lat: center.lat, lng: center.lng })
    );
    const used = new Set();
    const tour = [];
    let current = sorted[0];
    while (tour.length < Math.min(7, visible.length)) {
      tour.push(current.id);
      used.add(current.id);
      let best = null;
      let bestD = Infinity;
      for (const s of visible) {
        if (used.has(s.id)) continue;
        const d = haversineMeters(current, s);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (!best) break;
      current = best;
    }

    for (let i = 0; i < tour.length; i++) {
      pathIds.push(tour[i]);
      if (i > 0) {
        const a = getStore(tour[i - 1]);
        const b = getStore(tour[i]);
        CC.synth.playTone(CC.pitchFromConnection(getBrand(a), getBrand(b), haversineMeters(a, b)), 0.35);
        await wait(100);
      }
      redrawArt();
    }
    if (pathIds.length >= 3) {
      await wait(150);
      pathIds.push(pathIds[0]);
      isClosed = true;
      redrawArt({ flash: true });
      const unique = pathIds.slice(0, -1).map(getStore);
      CC.synth.playChord(CC.chordFromPath(unique.map(getBrand)));
      showToast(`自動結線: ${metaFromPath(pathIds, true).label}`);
    }
  }

  // --- 実店舗取得 ---
  function boundsPayload(bounds) {
    return {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };
  }

  async function fetchStoresForCurrentView() {
    if (isFetching) return Promise.resolve();
    if (!activeBrands.size) {
      showToast("先にチェーン店を選んでください");
      return;
    }
    const zoom = map.getZoom();
    if (zoom < 13) {
      showToast("もう少しズームインしてから取得してください（目安: 13以上）");
      return;
    }

    // ビューが広すぎる場合は中心付近にクリップ
    let bounds = map.getBounds();
    const c = map.getCenter();
    if (bounds.getNorth() - bounds.getSouth() > 0.07 || bounds.getEast() - bounds.getWest() > 0.07) {
      const d = 0.03;
      bounds = L.latLngBounds([c.lat - d, c.lng - d], [c.lat + d, c.lng + d]);
    }

    setLoading(true);
    el.dataStatus.textContent = "取得中…（OSM / しばらくお待ちください）";
    try {
      // 選択ブランドが多すぎると Nominatim フォールバックが遅いので上限
      const brandIds = [...activeBrands].slice(0, 5);
      const list = await CC.fetchStoresInBBox(boundsPayload(bounds), {
        brandIds
      });
      const added = mergeStores(list);
      const osmCount = stores.filter((s) => s.source === "osm").length;
      el.dataStatus.textContent = `OSM実データ ${osmCount} 店（今回 +${added}）`;
      if (!osmCount && !added) {
        mergeStores(CC.initialStores.map((s) => ({ ...s })));
        el.dataStatus.textContent = "該当なし → ダミー表示";
        showToast("この範囲に該当ブランドが見つかりません。ダミーを表示します", 3200);
      } else {
        showToast(added ? `実店舗を ${added} 件追加しました` : "新しい店舗はありませんでした");
      }
      refreshMarkerStyles();
    } catch (err) {
      console.error(err);
      el.dataStatus.textContent = "取得失敗";
      showToast(err.message || "店舗の取得に失敗しました");
      if (!stores.length) {
        mergeStores(CC.initialStores.map((s) => ({ ...s })));
        el.dataStatus.textContent = "ダミーデータを表示中";
        showToast("通信に失敗したためダミー店舗を表示しています", 3200);
      }
    } finally {
      setLoading(false);
    }
  }

  function applyBrandFilter() {
    const broken = pathIds.some((id) => {
      const s = getStore(id);
      return !s || !isStoreVisible(s);
    });
    const savedBroken = savedRoutes.some((c) =>
      c.pathIds.some((id) => {
        const s = getStore(id);
        return !s || !isStoreVisible(s);
      })
    );
    if (broken) {
      pathIds = [];
      isClosed = false;
    }
    if (savedBroken) {
      savedRoutes = savedRoutes.filter((c) =>
        c.pathIds.every((id) => {
          const s = getStore(id);
          return s && isStoreVisible(s);
        })
      );
    }
    buildBrandFilters();
    redrawArt();
  }

  function setAllBrands(on) {
    activeBrands.clear();
    if (on) Object.keys(brands).forEach((id) => activeBrands.add(id));
    applyBrandFilter();
    showToast(on ? "すべてのチェーンを表示" : "表示をクリア");
  }

  function toggleBrand(brandId) {
    if (activeBrands.has(brandId)) activeBrands.delete(brandId);
    else activeBrands.add(brandId);
    applyBrandFilter();
  }

  function buildBrandFilters() {
    el.brandFilters.innerHTML = Object.values(brands)
      .map((b) => {
        const active = activeBrands.has(b.id);
        return `<button type="button" class="brand-chip${active ? " is-active" : ""}" data-brand="${b.id}" style="--brand:${b.color}" aria-pressed="${active}">
          <span class="chip-dot" aria-hidden="true"></span>${b.name}
        </button>`;
      })
      .join("");
  }

  // --- 範囲選択 ---
  function setSelectMode(mode) {
    selectMode = mode;
    document.getElementById("btn-select-rect").classList.toggle("is-active", mode === "rect");
    document.getElementById("btn-select-circle").classList.toggle("is-active", mode === "circle");
    map.getContainer().classList.toggle("selecting", mode !== "none");

    if (mode === "none") {
      el.selectModeLabel.hidden = true;
      if (!mapWasDragging) map.dragging.enable();
      else map.dragging.enable();
    } else {
      mapWasDragging = map.dragging.enabled();
      map.dragging.disable();
      el.selectModeLabel.hidden = false;
      el.selectModeLabel.textContent =
        mode === "rect"
          ? "四角形モード: 地図をドラッグして範囲を指定"
          : `円モード: 地図をクリックして中心を指定（半径 ${radiusMeters} m）`;
    }
  }

  function clearSelectionGraphics() {
    selectLayer.clearLayers();
    selectPreview = null;
    selectStart = null;
  }

  function clearAreaSelection() {
    setSelectMode("none");
    clearSelectionGraphics();
    el.areaReport.hidden = true;
    el.areaBrandSummary.innerHTML = "";
    el.areaStoreList.innerHTML = "";
  }

  function summarizeStores(list) {
    const byBrand = {};
    list.forEach((s) => {
      if (!byBrand[s.brandId]) byBrand[s.brandId] = [];
      byBrand[s.brandId].push(s);
    });
    const rows = Object.entries(byBrand)
      .map(([brandId, arr]) => ({ brand: brands[brandId], stores: arr }))
      .filter((r) => r.brand)
      .sort((a, b) => b.stores.length - a.stores.length);

    el.areaTotal.textContent = `合計 ${list.length} 店`;
    el.areaBrandSummary.innerHTML = rows
      .map(
        (r) => `<li>
          <span class="brand-left">
            <span class="chip-dot" style="background:${r.brand.color};box-shadow:0 0 8px ${r.brand.color};width:9px;height:9px;border-radius:50%;display:inline-block"></span>
            ${escapeHtml(r.brand.name)}
          </span>
          <strong>${r.stores.length} 店</strong>
        </li>`
      )
      .join("");

    el.areaStoreList.innerHTML = list
      .slice()
      .sort((a, b) => a.brandId.localeCompare(b.brandId) || a.name.localeCompare(b.name, "ja"))
      .map((s) => {
        const b = getBrand(s);
        return `<li data-store-id="${s.id}">
          <span style="color:${b.color}">●</span> ${escapeHtml(s.name)}
        </li>`;
      })
      .join("");

    el.areaReport.hidden = false;
  }

  async function analyzeBounds(bounds) {
    setLoading(true);
    try {
      let list = await CC.fetchStoresInBBox(boundsPayload(bounds), {
        brandIds: activeBrands.size ? [...activeBrands] : Object.keys(brands)
      });
      mergeStores(list);
      // フィルタ後（選択ブランドのみ表示集計）
      if (activeBrands.size) list = list.filter((s) => activeBrands.has(s.brandId));
      summarizeStores(list);
      showToast(`範囲内: ${list.length} 店`);
    } catch (err) {
      console.error(err);
      // 既読込み分からフォールバック集計
      const fallback = getVisibleStores().filter((s) => bounds.contains([s.lat, s.lng]));
      summarizeStores(fallback);
      showToast(err.message || "取得に失敗したため、表示中の店舗で集計しました", 3200);
    } finally {
      setLoading(false);
      setSelectMode("none");
    }
  }

  async function analyzeCircle(lat, lng, radius) {
    setLoading(true);
    try {
      let list = await CC.fetchStoresInCircle(lat, lng, radius, {
        brandIds: activeBrands.size ? [...activeBrands] : Object.keys(brands)
      });
      mergeStores(list);
      if (activeBrands.size) list = list.filter((s) => activeBrands.has(s.brandId));
      summarizeStores(list);
      showToast(`円内: ${list.length} 店`);
    } catch (err) {
      console.error(err);
      const fallback = getVisibleStores().filter(
        (s) => haversineMeters(s, { lat, lng }) <= radius
      );
      summarizeStores(fallback);
      showToast(err.message || "取得に失敗したため、表示中の店舗で集計しました", 3200);
    } finally {
      setLoading(false);
      setSelectMode("none");
    }
  }

  function onSelectMouseDown(e) {
    if (selectMode !== "rect") return;
    selectStart = e.latlng;
    if (selectPreview) selectLayer.removeLayer(selectPreview);
    selectPreview = L.rectangle(L.latLngBounds(selectStart, selectStart), {
      color: "#7ec8ff",
      weight: 2,
      fillOpacity: 0.12,
      dashArray: "6 4",
      interactive: false
    }).addTo(selectLayer);
    L.DomEvent.stop(e);
  }

  function onSelectMouseMove(e) {
    if (selectMode !== "rect" || !selectStart || !selectPreview) return;
    selectPreview.setBounds(L.latLngBounds(selectStart, e.latlng));
  }

  async function onSelectMouseUp(e) {
    if (selectMode !== "rect" || !selectStart) return;
    const bounds = L.latLngBounds(selectStart, e.latlng);
    selectStart = null;
    if (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest()) {
      return;
    }
    if (selectPreview) {
      /* keep rectangle on map */
    }
    await analyzeBounds(bounds.pad(0.001));
  }

  async function onSelectClick(e) {
    if (selectMode !== "circle") return;
    clearSelectionGraphics();
    L.circle(e.latlng, {
      radius: radiusMeters,
      color: "#7ec8ff",
      weight: 2,
      fillOpacity: 0.12,
      dashArray: "6 4",
      interactive: false
    }).addTo(selectLayer);
    await analyzeCircle(e.latlng.lat, e.latlng.lng, radiusMeters);
  }

  // --- 検索 ---
  async function geocode(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        format: "json",
        q: query,
        limit: "6",
        addressdetails: "1",
        countrycodes: "jp",
        "accept-language": "ja"
      });
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "ja" }
    });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    return (data || []).map((item) => {
      const display = item.display_name || query;
      const parts = display.split(",").map((s) => s.trim());
      return {
        lat: Number(item.lat),
        lng: Number(item.lon),
        title: parts[0] || query,
        sub: parts.slice(1, 4).join(" · "),
        label: display
      };
    });
  }

  function renderSearchResults(results) {
    if (!results.length) {
      el.searchResults.hidden = true;
      el.searchResults.innerHTML = "";
      return;
    }
    el.searchResults.hidden = false;
    el.searchResults.innerHTML = results
      .map(
        (r, i) => `<li role="option"><button type="button" data-index="${i}">
          <span class="result-title">${escapeHtml(r.title)}</span>
          ${r.sub ? `<span class="result-sub">${escapeHtml(r.sub)}</span>` : ""}
        </button></li>`
      )
      .join("");
    el.searchResults.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => goToSearchResult(results[Number(btn.dataset.index)]));
    });
  }

  function placeSearchMarker(lat, lng, title) {
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: '<div class="search-pin"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 18]
      }),
      zIndexOffset: 1000,
      title
    }).addTo(map);
    searchMarker.bindPopup(`<strong>${escapeHtml(title)}</strong>`).openPopup();
  }

  function goToSearchResult(item) {
    el.searchResults.hidden = true;
    el.searchInput.value = item.title;
    map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 15), { duration: 1.4 });
    placeSearchMarker(item.lat, item.lng, item.label);
    map.once("moveend", () => {
      showToast(`${item.title} へ移動 — 「実店舗を取得」でピンを表示できます`);
    });
  }

  async function runSearch(query, options = {}) {
    const q = query.trim();
    if (!q) {
      renderSearchResults([]);
      return;
    }
    try {
      const results = await geocode(q);
      if (!results.length) {
        showToast("見つかりませんでした");
        renderSearchResults([]);
        return;
      }
      renderSearchResults(results);
      if (options.autoSelectSingle && results.length === 1) goToSearchResult(results[0]);
    } catch (err) {
      console.error(err);
      showToast("検索に失敗しました");
    }
  }

  async function copyShareText() {
    const current = metaFromPath(pathIds, isClosed);
    const lines = [
      "チェーン店クエスト",
      current.summary,
      `保存ルート: ${savedRoutes.length}`,
      ...savedRoutes.map((c, i) => `  ${i + 1}. ${c.label}`),
      "",
      "#チェーン店クエスト"
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      el.shareFb.hidden = false;
      setTimeout(() => {
        el.shareFb.hidden = true;
      }, 2500);
      showToast("コピーしました");
    } catch {
      window.prompt("コピーしてください", text);
    }
  }

  // --- 初期化 ---
  function init() {
    map = L.map("map", {
      center: [35.6595, 139.7005],
      zoom: 15,
      zoomControl: true
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          'Tiles &copy; Esri — Data &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        maxZoom: 16
      }
    ).addTo(map);

    svgRenderer = L.svg({ padding: 1 });
    svgRenderer.addTo(map);
    edgeLayer = L.layerGroup().addTo(map);
    fillLayer = L.layerGroup().addTo(map);
    radiusLayer = L.layerGroup().addTo(map);
    selectLayer = L.layerGroup().addTo(map);

    buildBrandFilters();
    updateFilterCount();
    updateStats();
    el.dataStatus.textContent = "取得待機";

    fetchStoresForCurrentView().finally(() => finishBoot());
    setTimeout(finishBoot, 4500);

    map.on("click", (e) => {
      if (!el.searchResults.hidden) el.searchResults.hidden = true;
      if (selectMode === "circle") {
        onSelectClick(e);
        return;
      }
    });
    map.on("mousedown", onSelectMouseDown);
    map.on("mousemove", onSelectMouseMove);
    map.on("mouseup", onSelectMouseUp);

    document.getElementById("btn-fetch-stores").addEventListener("click", fetchStoresForCurrentView);
    document.getElementById("btn-clear").addEventListener("click", clearCurrent);
    document.getElementById("btn-clear-all").addEventListener("click", clearAllRoutes);
    document.getElementById("btn-auto").addEventListener("click", () => autoConnect());
    document.getElementById("btn-next").addEventListener("click", startNextRoute);
    document.getElementById("btn-share").addEventListener("click", copyShareText);
    document.getElementById("btn-brands-all").addEventListener("click", () => setAllBrands(true));
    document.getElementById("btn-brands-none").addEventListener("click", () => setAllBrands(false));
    document.getElementById("btn-select-rect").addEventListener("click", () => {
      setSelectMode(selectMode === "rect" ? "none" : "rect");
    });
    document.getElementById("btn-select-circle").addEventListener("click", () => {
      setSelectMode(selectMode === "circle" ? "none" : "circle");
    });
    document.getElementById("btn-select-clear").addEventListener("click", clearAreaSelection);

    el.addBrandForm.addEventListener("submit", onAddBrand);

    el.brandFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-brand]");
      if (btn) toggleBrand(btn.dataset.brand);
    });

    el.radiusInput.addEventListener("change", () => {
      radiusMeters = Math.max(50, Math.min(5000, Number(el.radiusInput.value) || 300));
      el.radiusInput.value = String(radiusMeters);
      updateRadiusCircle();
      if (selectMode === "circle") {
        el.selectModeLabel.textContent = `円モード: 地図をクリック（半径 ${radiusMeters} m）`;
      }
    });
    el.chkRadius.addEventListener("change", () => {
      showRadius = el.chkRadius.checked;
      updateRadiusCircle();
    });

    el.areaStoreList.addEventListener("click", (e) => {
      const li = e.target.closest("[data-store-id]");
      if (!li) return;
      const store = getStore(li.dataset.storeId);
      if (!store) return;
      selectedStoreId = store.id;
      map.panTo([store.lat, store.lng]);
      updateRadiusCircle();
      markers.get(store.id)?.openPopup();
      refreshMarkerStyles();
    });

    el.searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch(el.searchInput.value, { autoSelectSingle: true });
    });
    el.searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      const q = el.searchInput.value.trim();
      if (q.length < 2) {
        renderSearchResults([]);
        return;
      }
      searchDebounce = setTimeout(() => runSearch(q), 380);
    });

    el.panelToggle.addEventListener("click", () => {
      const collapsed = el.panel.classList.toggle("is-collapsed");
      el.panelToggle.setAttribute("aria-expanded", String(!collapsed));
    });

    ["pointerdown", "keydown"].forEach((evt) => {
      window.addEventListener(evt, () => CC.synth.unlock(), { once: true });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
