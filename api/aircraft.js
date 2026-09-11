const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

function setCors(req, res) {
  const origin = req.headers.origin;

  if (origin) {
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      origin.startsWith("file://") ||
      origin.includes("averon")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );
}

function clean(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeAircraft(ac) {
  if (!ac || typeof ac !== "object") {
    return null;
  }

  const dbFlags =
    Number.isFinite(Number(ac.dbFlags))
      ? Number(ac.dbFlags)
      : 0;

  return {
    hex: ac.hex || null,

    registration:
      ac.r ||
      ac.registration ||
      null,

    callsign:
      typeof ac.flight === "string"
        ? ac.flight.trim()
        : ac.callsign || null,

    type:
      ac.t ||
      ac.type ||
      null,

    description:
      ac.desc ||
      ac.description ||
      null,

    category:
      ac.category ||
      null,

    country:
      ac.ctry ||
      ac.country ||
      null,

    lat:
      ac.lat ?? null,

    lon:
      ac.lon ?? null,

    altitude:
      ac.alt_baro ??
      ac.altitude ??
      null,

    geometricAltitude:
      ac.alt_geom ??
      ac.geo_altitude ??
      null,

    groundSpeed:
      ac.gs ??
      ac.speed ??
      null,

    track:
      ac.track ??
      null,

    verticalRate:
      ac.baro_rate ??
      ac.vertical_rate ??
      null,

    squawk:
      ac.squawk ||
      null,

    emergency:
      ac.emergency ||
      null,

    navAltitude:
      ac.nav_altitude_mcp ??
      null,

    navQnh:
      ac.nav_qnh ??
      null,

    navHeading:
      ac.nav_heading ??
      null,

    navModes:
      Array.isArray(ac.nav_modes)
        ? ac.nav_modes
        : [],

    nic:
      ac.nic ??
      null,

    nicBaro:
      ac.nic_baro ??
      null,

    nacP:
      ac.nac_p ??
      null,

    nacV:
      ac.nac_v ??
      null,

    sil:
      ac.sil ??
      null,

    silType:
      ac.sil_type ??
      null,

    gva:
      ac.gva ??
      null,

    sda:
      ac.sda ??
      null,

    messages:
      ac.messages ??
      null,

    seen:
      ac.seen ??
      null,

    seenPosition:
      ac.seen_pos ??
      null,

    rssi:
      ac.rssi ??
      null,

    mach:
      ac.mach ??
      null,

    trueAirSpeed:
      ac.tas ??
      null,

    magneticHeading:
      ac.mag_heading ??
      null,

    trackRate:
      ac.track_rate ??
      null,

    roll:
      ac.roll ??
      null,

    navModesRaw:
      ac.nav_modes || null,

    mlat:
      Array.isArray(ac.mlat)
        ? ac.mlat
        : [],

    tisb:
      Array.isArray(ac.tisb)
        ? ac.tisb
        : [],

    dbFlags,

    flags: {
      military:
        Boolean(dbFlags & 1),

      interesting:
        Boolean(dbFlags & 2),

      pia:
        Boolean(dbFlags & 4),

      ladd:
        Boolean(dbFlags & 8)
    },

    raw: ac
  };
}

function extractAircraft(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.ac)) {
    return data.ac
      .map(normalizeAircraft)
      .filter(Boolean);
  }

  if (Array.isArray(data.aircraft)) {
    return data.aircraft
      .map(normalizeAircraft)
      .filter(Boolean);
  }

  if (Array.isArray(data)) {
    return data
      .map(normalizeAircraft)
      .filter(Boolean);
  }

  if (typeof data === "object") {
    const normalized = normalizeAircraft(data);

    return normalized
      ? [normalized]
      : [];
  }

  return [];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Averon-Public-Safety-Centre/1.0"
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Upstream returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   SEARCH URL
========================================================= */

function buildAdsbFiUrl(mode, value, lat, lon, dist) {
  const base =
    "https://opendata.adsb.fi/api";

  switch (mode) {
    case "radius":
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        throw new Error(
          "Latitude and longitude are required for radius search"
        );
      }

      return (
        `${base}/v3/lat/${lat}` +
        `/lon/${lon}` +
        `/dist/${dist}`
      );

    case "registration":
      return (
        `${base}/v2/registration/` +
        encodeURIComponent(value)
      );

    case "callsign":
      return (
        `${base}/v2/callsign/` +
        encodeURIComponent(value)
      );

    case "icao":
      return (
        `${base}/v2/icao/` +
        encodeURIComponent(value)
      );

    case "squawk":
      return (
        `${base}/v2/sqk/` +
        encodeURIComponent(value)
      );

    case "military":
      return `${base}/v2/mil`;

    default:
      throw new Error(
        "Unsupported search mode"
      );
  }
}

/* =========================================================
   VERCEL FUNCTION
========================================================= */

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const mode =
      clean(req.query?.mode)
        .toLowerCase() ||
      "radius";

    const value =
      clean(req.query?.q);

    const latRaw =
      clean(req.query?.lat);

    const lonRaw =
      clean(req.query?.lon);

    const distRaw =
      clean(req.query?.dist) ||
      "50";

    const lat =
      Number(latRaw);

    const lon =
      Number(lonRaw);

    let dist =
      Number(distRaw);

    if (
      !Number.isFinite(dist) ||
      dist <= 0
    ) {
      dist = 50;
    }

    /*
     * Keep the public endpoint sensible.
     * ADS-B radius distance is in nautical miles.
     */
    dist =
      Math.min(
        Math.max(dist, 1),
        250
      );

    if (
      ![
        "radius",
        "registration",
        "callsign",
        "icao",
        "squawk",
        "military"
      ].includes(mode)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid search mode",
        allowedModes: [
          "radius",
          "registration",
          "callsign",
          "icao",
          "squawk",
          "military"
        ]
      });
    }

    if (
      mode !== "radius" &&
      mode !== "military" &&
      !value
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Search value is required"
      });
    }

    const url =
      buildAdsbFiUrl(
        mode,
        value,
        lat,
        lon,
        dist
      );

    console.log(
      `[AIRCRAFT] ${mode} ${value || `${lat},${lon}/${dist}nm`}`
    );

    const data =
      await fetchJson(url);

    const aircraft =
      extractAircraft(data);

    const airborne =
      aircraft.filter(
        (a) =>
          a.raw?.alt_baro !== "ground" &&
          a.raw?.alt_baro != null
      );

    const ground =
      aircraft.filter(
        (a) =>
          a.raw?.alt_baro === "ground"
      );

    const military =
      aircraft.filter(
        (a) => a.flags.military
      );

    return res.status(200).json({
      success: true,

      source: "ADSB.FI",

      sourceUrl: url,

      search: {
        mode,
        value: value || null,
        latitude:
          Number.isFinite(lat)
            ? lat
            : null,
        longitude:
          Number.isFinite(lon)
            ? lon
            : null,
        distanceNm: dist
      },

      count: aircraft.length,

      statistics: {
        tracked: aircraft.length,
        airborne: airborne.length,
        ground: ground.length,
        military: military.length,
        alerts: aircraft.filter(
          (a) =>
            a.emergency &&
            a.emergency !== "none"
        ).length
      },

      fetchedAt:
        new Date().toISOString(),

      aircraft,

      /*
       * Original upstream response is retained
       * so Averon can expose additional fields
       * without requiring another backend change.
       */
      upstream: data
    });

  } catch (error) {
    console.error(
      "[AIRCRAFT ERROR]",
      error
    );

    return res.status(502).json({
      success: false,

      source: "ADSB.FI",

      error:
        error?.message ||
        "Aircraft data source unavailable",

      fetchedAt:
        new Date().toISOString(),

      aircraft: [],

      statistics: {
        tracked: 0,
        airborne: 0,
        ground: 0,
        military: 0,
        alerts: 0
      }
    });
  }
}

