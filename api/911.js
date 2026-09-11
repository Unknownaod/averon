/*
=========================================================
AVERON 911 API
=========================================================

Vercel route:

GET /api/911
GET /api/911?limit=100
GET /api/911?hours=24
GET /api/911?agency=New%20Orleans%20911

IMPORTANT:
This route does NOT intercept 911 communications.

It only consumes:
- Publicly available emergency-call data
- Authorized recording APIs
- Authorized recording URLs
- Public agency feeds

Actual caller/dispatcher recordings must come from
a source that legally exposes/provides them.

=========================================================
*/

const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

/*
=========================================================
SOURCE CONFIGURATION
=========================================================

You can add additional sources here.

Each source should return:

{
  id,
  agency,
  city,
  state,
  receivedAt,
  endedAt,
  type,
  priority,
  location,
  audioUrl,
  transcript,
  source,
  sourceUrl,
  audioAvailable,
  lat,
  lng
}

Do NOT put private API keys directly in this file.

Use Vercel environment variables.

=========================================================
*/

const SOURCES = [
  {
    name: "authorized_911",

    enabled: Boolean(
      process.env.AUTHORIZED_911_API_URL
    ),

    url:
      process.env.AUTHORIZED_911_API_URL || "",

    apiKey:
      process.env.AUTHORIZED_911_API_KEY || ""
  }

  /*
  -------------------------------------------------------
  ADD MORE SOURCES HERE
  -------------------------------------------------------

  {
    name: "agency_two",

    enabled: Boolean(
      process.env.AGENCY_TWO_911_URL
    ),

    url:
      process.env.AGENCY_TWO_911_URL || "",

    apiKey:
      process.env.AGENCY_TWO_911_KEY || ""
  }

  */
];

/*
=========================================================
HELPERS
=========================================================
*/

function json(res, status, body) {
  return res.status(status).json(body);
}

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isFresh(date, cutoff) {
  if (!date) return false;

  return date.getTime() >= cutoff;
}

function cleanString(value, fallback = "") {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim();
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizePriority(value) {
  const priority = cleanString(
    value,
    "UNKNOWN"
  ).toUpperCase();

  if (
    priority.includes("CRITICAL") ||
    priority.includes("HIGH") ||
    priority === "1"
  ) {
    return "HIGH";
  }

  if (
    priority.includes("MEDIUM") ||
    priority.includes("MODERATE") ||
    priority === "2"
  ) {
    return "MEDIUM";
  }

  if (
    priority.includes("LOW") ||
    priority === "3"
  ) {
    return "LOW";
  }

  return priority || "UNKNOWN";
}

/*
=========================================================
NORMALIZE A CALL
=========================================================
*/

function normalizeCall(raw, sourceName) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const receivedAt =
    raw.receivedAt ||
    raw.received_at ||
    raw.callReceivedAt ||
    raw.call_received_at ||
    raw.createdAt ||
    raw.created_at ||
    raw.timestamp;

  const endedAt =
    raw.endedAt ||
    raw.ended_at ||
    raw.callEndedAt ||
    raw.call_ended_at ||
    raw.completedAt ||
    raw.completed_at;

  const audioUrl =
    raw.audioUrl ||
    raw.audio_url ||
    raw.recordingUrl ||
    raw.recording_url ||
    raw.audio ||
    raw.recording ||
    null;

  const transcript =
    raw.transcript ||
    raw.transcription ||
    raw.text ||
    "";

  const id =
    raw.id ||
    raw.callId ||
    raw.call_id ||
    raw.incidentId ||
    raw.incident_id ||
    `${sourceName}-${receivedAt || Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

  return {
    id: cleanString(id),

    agency: cleanString(
      raw.agency ||
      raw.agencyName ||
      raw.department ||
      raw.psap ||
      raw.psapName,
      "Unknown 911 Center"
    ),

    city: cleanString(
      raw.city ||
      raw.municipality
    ),

    state: cleanString(
      raw.state ||
      raw.stateCode
    ),

    receivedAt:
      parseDate(receivedAt)?.toISOString() ||
      null,

    endedAt:
      parseDate(endedAt)?.toISOString() ||
      null,

    type: cleanString(
      raw.type ||
      raw.callType ||
      raw.call_type ||
      raw.incidentType ||
      raw.incident_type,
      "911 Call"
    ),

    priority: normalizePriority(
      raw.priority ||
      raw.priorityCode ||
      raw.priority_code
    ),

    location: cleanString(
      raw.location ||
      raw.address ||
      raw.fullAddress ||
      raw.crossStreet ||
      raw.cross_street,
      "Location unavailable"
    ),

    audioUrl:
      typeof audioUrl === "string" &&
      audioUrl.trim()
        ? audioUrl.trim()
        : null,

    transcript:
      typeof transcript === "string"
        ? transcript.trim()
        : "",

    source: cleanString(
      raw.source ||
      raw.sourceName,
      sourceName
    ),

    sourceUrl: cleanString(
      raw.sourceUrl ||
      raw.source_url ||
      raw.url
    ) || null,

    audioAvailable:
      Boolean(
        raw.audioAvailable ??
        raw.audio_available ??
        audioUrl
      ),

    lat: numberOrNull(
      raw.lat ||
      raw.latitude
    ),

    lng: numberOrNull(
      raw.lng ||
      raw.lon ||
      raw.longitude
    )
  };
}

/*
=========================================================
EXTRACT ARRAY

Allows APIs to return:

[
  ...
]

or:

{
  calls: [...]
}

or:

{
  data: [...]
}

or:

{
  incidents: [...]
}

or:

{
  results: [...]
}

=========================================================
*/

function extractArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const possibleKeys = [
    "calls",
    "data",
    "incidents",
    "results",
    "records",
    "items"
  ];

  for (const key of possibleKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

/*
=========================================================
FETCH ONE AUTHORIZED SOURCE
=========================================================
*/

async function fetchSource(source, cutoff) {
  if (!source.enabled || !source.url) {
    return [];
  }

  try {
    const headers = {
      Accept: "application/json"
    };

    if (source.apiKey) {
      headers.Authorization =
        `Bearer ${source.apiKey}`;
    }

    const response = await fetch(
      source.url,
      {
        method: "GET",
        headers,
        cache: "no-store"
      }
    );

    if (!response.ok) {
      console.error(
        `[911] ${source.name} returned ${response.status}`
      );

      return [];
    }

    const payload =
      await response.json();

    const records =
      extractArray(payload);

    return records
      .map((record) =>
        normalizeCall(
          record,
          source.name
        )
      )
      .filter(Boolean)
      .filter((call) => {
        const received =
          parseDate(call.receivedAt);

        return isFresh(
          received,
          cutoff
        );
      });

  } catch (error) {
    console.error(
      `[911] ${source.name} failed:`,
      error?.message || error
    );

    return [];
  }
}

/*
=========================================================
DEDUPLICATION
=========================================================
*/

function deduplicate(calls) {
  const map = new Map();

  for (const call of calls) {
    const key =
      call.id ||
      [
        call.agency,
        call.receivedAt,
        call.location,
        call.type
      ].join("|");

    const existing =
      map.get(key);

    if (!existing) {
      map.set(key, call);
      continue;
    }

    /*
    Prefer the version containing audio.
    */

    if (
      call.audioAvailable &&
      !existing.audioAvailable
    ) {
      map.set(key, call);
      continue;
    }

    /*
    Prefer the version containing a
    transcript.
    */

    if (
      call.transcript &&
      !existing.transcript
    ) {
      map.set(key, {
        ...existing,
        ...call
      });
    }
  }

  return [...map.values()];
}

/*
=========================================================
SORT NEWEST FIRST
=========================================================
*/

function sortNewest(calls) {
  return calls.sort((a, b) => {
    const aTime =
      parseDate(a.receivedAt)?.getTime() ||
      0;

    const bTime =
      parseDate(b.receivedAt)?.getTime() ||
      0;

    return bTime - aTime;
  });
}

/*
=========================================================
CACHE CONTROL

We explicitly prevent Vercel/CDN from serving
old 911 information as if it were current.

=========================================================
*/

function setNoCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );
}

/*
=========================================================
CORS
=========================================================
*/

function setCors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

/*
=========================================================
MAIN HANDLER
=========================================================
*/

export default async function handler(req, res) {
  setCors(res);
  setNoCache(res);

  /*
  -------------------------------------------------------
  OPTIONS
  -------------------------------------------------------
  */

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  /*
  -------------------------------------------------------
  ONLY GET
  -------------------------------------------------------
  */

  if (req.method !== "GET") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed"
    });
  }

  /*
  -------------------------------------------------------
  QUERY
  -------------------------------------------------------
  */

  const requestedHours =
    Number(req.query?.hours);

  const requestedLimit =
    Number(req.query?.limit);

  const hours =
    Number.isFinite(requestedHours) &&
    requestedHours > 0
      ? Math.min(
          requestedHours,
          MAX_HOURS
        )
      : DEFAULT_HOURS;

  const limit =
    Number.isFinite(requestedLimit) &&
    requestedLimit > 0
      ? Math.min(
          Math.floor(requestedLimit),
          MAX_LIMIT
        )
      : DEFAULT_LIMIT;

  const agencyFilter =
    cleanString(
      req.query?.agency
    ).toLowerCase();

  /*
  -------------------------------------------------------
  FRESHNESS CUTOFF
  -------------------------------------------------------
  */

  const cutoff =
    Date.now() -
    hours * 60 * 60 * 1000;

  /*
  -------------------------------------------------------
  FETCH ALL ENABLED SOURCES
  -------------------------------------------------------
  */

  const enabledSources =
    SOURCES.filter(
      (source) => source.enabled
    );

  const sourceResults =
    await Promise.all(
      enabledSources.map(
        (source) =>
          fetchSource(
            source,
            cutoff
          )
      )
    );

  let calls =
    sourceResults.flat();

  /*
  -------------------------------------------------------
  DEDUP
  -------------------------------------------------------
  */

  calls =
    deduplicate(calls);

  /*
  -------------------------------------------------------
  AGENCY FILTER
  -------------------------------------------------------
  */

  if (agencyFilter) {
    calls = calls.filter(
      (call) =>
        call.agency
          .toLowerCase()
          .includes(agencyFilter)
    );
  }

  /*
  -------------------------------------------------------
  SORT
  -------------------------------------------------------
  */

  calls =
    sortNewest(calls);

  /*
  -------------------------------------------------------
  LIMIT
  -------------------------------------------------------
  */

  calls =
    calls.slice(0, limit);

  /*
  -------------------------------------------------------
  RESPONSE
  -------------------------------------------------------
  */

  return json(res, 200, {
    success: true,

    generatedAt:
      new Date().toISOString(),

    freshness: {
      hours,
      cutoff:
        new Date(cutoff).toISOString()
    },

    count: calls.length,

    sources: enabledSources.map(
      (source) => source.name
    ),

    audioCount:
      calls.filter(
        (call) =>
          call.audioAvailable
      ).length,

    calls
  });
}

