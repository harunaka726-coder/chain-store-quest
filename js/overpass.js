/**
 * OpenStreetMap Overpass API から実在店舗を取得（APIキー不要）
 * 戻り値: { id, brandId, name, lat, lng, source: "osm" }
 */
(function (global) {
  const CC = (global.ChainConstellation = global.ChainConstellation || {});

  const ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter"
  ];
  const OVERPASS_TIMEOUT_MS = 10000;

  CC.brandMatchPatterns = {
    seven: [/セブン/, /7[\s\-]?eleven/i, /seven[\s\-]?eleven/i],
    familymart: [/ファミリーマート/, /familymart/i, /family\s*mart/i, /ファミマ/],
    lawson: [/ローソン/, /lawson/i],
    starbucks: [/スターバックス/, /starbucks/i, /スタバ/],
    mcdonalds: [/マクドナルド/, /mcdonald'?s?/i, /マック(?!ス)/],
    yoshinoya: [/吉野家/, /yoshinoya/i]
  };

  CC.matchBrandId = function matchBrandId(tags) {
    const text = [tags.brand, tags["brand:en"], tags["brand:ja"], tags.name, tags["name:en"], tags["name:ja"]]
      .filter(Boolean)
      .join(" ");
    if (!text) return null;
    for (const [brandId, patterns] of Object.entries(CC.brandMatchPatterns)) {
      if (patterns.some((re) => re.test(text))) return brandId;
    }
    return null;
  };

  function elementToLatLng(el) {
    if (el.type === "node" && el.lat != null) return { lat: el.lat, lng: el.lon };
    if (el.center) return { lat: el.center.lat, lng: el.center.lon };
    return null;
  }

  function buildOverpassQuery(south, west, north, east) {
    const bbox = `${south},${west},${north},${east}`;
    // 対象を絞ってタイムアウトを避ける
    return `[out:json][timeout:40];
(
  node["shop"="convenience"](${bbox});
  way["shop"="convenience"](${bbox});
  node["amenity"="cafe"](${bbox});
  node["amenity"="fast_food"](${bbox});
  node["amenity"="restaurant"](${bbox});
  node["shop"="clothes"](${bbox});
);
out center tags;`;
  }

  function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  async function postOverpass(query) {
    let lastErr;
    for (const endpoint of ENDPOINTS) {
      try {
        // GET の方がブラウザ CORS で安定しやすい
        const getUrl = endpoint + "?data=" + encodeURIComponent(query);
        let res = await fetchWithTimeout(
          getUrl,
          { method: "GET", headers: { Accept: "application/json" } },
          OVERPASS_TIMEOUT_MS
        );
        if (!res.ok) {
          res = await fetchWithTimeout(
            endpoint,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
              },
              body: "data=" + encodeURIComponent(query)
            },
            OVERPASS_TIMEOUT_MS
          );
        }
        if (!res.ok) {
          lastErr = new Error("Overpass HTTP " + res.status);
          continue;
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.elements)) {
          lastErr = new Error("Unexpected Overpass response");
          continue;
        }
        return data;
      } catch (err) {
        lastErr = err.name === "AbortError" ? new Error("Overpass がタイムアウトしました") : err;
      }
    }
    throw lastErr || new Error("Overpass failed");
  }

  function parseOverpassElements(elements, brandFilter) {
    const seen = new Set();
    const stores = [];
    for (const el of elements || []) {
      const tags = el.tags || {};
      const brandId = CC.matchBrandId(tags);
      if (!brandId) continue;
      if (brandFilter && !brandFilter.has(brandId)) continue;
      const ll = elementToLatLng(el);
      if (!ll) continue;
      const id = "osm_" + el.type + "_" + el.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const brand = (CC.brandCatalog && CC.brandCatalog[brandId]) || {};
      stores.push({
        id,
        brandId,
        name: tags.name || tags["name:ja"] || tags.brand || brand.name || id,
        lat: ll.lat,
        lng: ll.lng,
        source: "osm"
      });
    }
    return stores;
  }

  /**
   * Overpass 不通時のフォールバック: Nominatim でブランド名＋viewbox 検索
   * （実在POI。レート制限があるためブランドごとに間隔を空ける）
   */
  async function fetchViaNominatim(bbox, brandIds) {
    const { south, west, north, east } = bbox;
    // Nominatim viewbox: left,top,right,bottom
    const viewbox = [west, north, east, south].join(",");
    const stores = [];
    const seen = new Set();

    for (const brandId of brandIds) {
      const brand = CC.brandCatalog[brandId];
      if (!brand) continue;
      const url =
        "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({
          format: "json",
          q: brand.name,
          limit: "30",
          viewbox,
          bounded: "1",
          countrycodes: "jp",
          "accept-language": "ja"
        });
      try {
        const res = await fetchWithTimeout(
          url,
          { headers: { Accept: "application/json", "Accept-Language": "ja" } },
          20000
        );
        if (!res.ok) continue;
        const data = await res.json();
        for (const item of data || []) {
          const matched = CC.matchBrandId({ name: item.display_name, brand: brand.name });
          if (matched && matched !== brandId) continue;
          const id = "nom_" + (item.osm_type || "n") + "_" + (item.osm_id || item.place_id);
          if (seen.has(id)) continue;
          seen.add(id);
          const name = (item.display_name || "").split(",")[0].trim() || brand.name;
          stores.push({
            id,
            brandId,
            name,
            lat: Number(item.lat),
            lng: Number(item.lon),
            source: "osm"
          });
        }
      } catch (_) {
        /* next brand */
      }
      // Nominatim 利用ポリシー: 約1 req/sec
      await new Promise((r) => setTimeout(r, 1100));
    }
    return stores;
  }

  CC.fetchStoresInBBox = async function fetchStoresInBBox(bbox, options = {}) {
    const { south, west, north, east } = bbox;
    const latSpan = north - south;
    const lngSpan = east - west;
    if (latSpan > 0.08 || lngSpan > 0.08) {
      throw new Error("範囲が広すぎます。ズームインしてから再取得してください");
    }

    const brandIds = options.brandIds || Object.keys(CC.brandCatalog || {});
    const brandFilter = options.brandIds ? new Set(options.brandIds) : null;

    // 1) Nominatim を主系に（安定・実在POI）。ブランド数が多いと遅いので呼び出し側で絞る
    let stores = [];
    try {
      stores = await fetchViaNominatim(bbox, brandIds);
    } catch (err) {
      console.warn("Nominatim fetch failed", err);
    }

    // 2) Overpass が通ればマージ（より多くのOSMノードを補完）
    try {
      const data = await postOverpass(buildOverpassQuery(south, west, north, east));
      const extra = parseOverpassElements(data.elements, brandFilter);
      const seen = new Set(stores.map((s) => s.id));
      // Nominatim の nom_ と Overpass の osm_ は ID が違うので座標近傍で重複排除
      extra.forEach((s) => {
        const dup = stores.some(
          (x) => x.brandId === s.brandId && Math.abs(x.lat - s.lat) < 0.00015 && Math.abs(x.lng - s.lng) < 0.00015
        );
        if (!dup && !seen.has(s.id)) {
          seen.add(s.id);
          stores.push(s);
        }
      });
    } catch (err) {
      console.warn("Overpass skipped", err);
    }

    if (!stores.length) {
      throw new Error("この範囲で店舗を取得できませんでした");
    }
    return stores;
  };

  CC.fetchStoresInCircle = async function fetchStoresInCircle(lat, lng, radiusMeters, options = {}) {
    const pad = radiusMeters * 1.3;
    const dLat = pad / 111320;
    const dLng = pad / (111320 * Math.cos((lat * Math.PI) / 180));
    const list = await CC.fetchStoresInBBox(
      {
        south: lat - dLat,
        west: lng - dLng,
        north: lat + dLat,
        east: lng + dLng
      },
      options
    );
    return list.filter((s) => {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat2 = toRad(s.lat - lat);
      const dLng2 = toRad(s.lng - lng);
      const a =
        Math.sin(dLat2 / 2) ** 2 +
        Math.cos(toRad(lat)) * Math.cos(toRad(s.lat)) * Math.sin(dLng2 / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a)) <= radiusMeters;
    });
  };
})(window);
