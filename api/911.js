const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

/*
=========================================================
PUBLIC CAD SOURCE
=========================================================
*/

const NOLA_API =
  "https://data.nola.gov/resource/es9j-6y5d.json";

const NOLA_PAGE =
  "https://data.nola.gov/Public-Safety-and-Preparedness/Calls-for-Service-2026/es9j-6y5d";

/*
=========================================================
PUBLIC 911 AUDIO ARCHIVE
=========================================================

These recordings are publicly published by NCDSV.

The archive page is used as the catalog source.

We discover actual audio links from the page instead
of inventing filenames or URLs.

=========================================================
*/

const NCDSV_PAGE =
  "https://www.ncdsv.org/911-audio-recordings.html";

/*
=========================================================
OPTIONAL AUTHORIZED AUDIO SOURCE
=========================================================

Vercel:

AUTHORIZED_911_API_URL
AUTHORIZED_911_API_KEY

=========================================================
*/

const AUTHORIZED_SOURCE = {
  name: "authorized_911",

  enabled:
    Boolean(
      process.env.AUTHORIZED_911_API_URL
    ),

  url:
    process.env.AUTHORIZED_911_API_URL ||
    "",

  apiKey:
    process.env.AUTHORIZED_911_API_KEY ||
    ""
};

/*
=========================================================
HELPERS
=========================================================
*/

function json(
  res,
  status,
  body
) {
  return res
    .status(status)
    .json(body);
}

function cleanString(
  value,
  fallback = ""
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const result =
    String(value).trim();

  return result || fallback;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

/*
=========================================================
PRIORITY
=========================================================
*/

function normalizePriority(value) {
  const raw =
    cleanString(
      value,
      "UNKNOWN"
    ).toUpperCase();

  if (
    raw === "1" ||
    raw.startsWith("1")
  ) {
    return "HIGH";
  }

  if (
    raw === "2" ||
    raw.startsWith("2")
  ) {
    return "MEDIUM";
  }

  if (
    raw === "3" ||
    raw.startsWith("3")
  ) {
    return "LOW";
  }

  if (
    raw.includes("CRITICAL") ||
    raw.includes("HIGH")
  ) {
    return "HIGH";
  }

  if (
    raw.includes("MEDIUM") ||
    raw.includes("MODERATE")
  ) {
    return "MEDIUM";
  }

  if (
    raw.includes("LOW")
  ) {
    return "LOW";
  }

  return raw;
}

/*
=========================================================
POINT PARSER
=========================================================
*/

function parsePoint(
  value
) {
  if (!value) {
    return {
      lat: null,
      lng: null
    };
  }

  const match =
    String(value).match(
      /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i
    );

  if (!match) {
    return {
      lat: null,
      lng: null
    };
  }

  return {
    lng:
      Number(match[1]),

    lat:
      Number(match[2])
  };
}

/*
=========================================================
NOLA CAD NORMALIZATION
=========================================================
*/

function normalizeNolaCall(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const receivedAt =
    raw.timecreate ||
    raw.time_create ||
    null;

  const dispatchedAt =
    raw.timedispatch ||
    raw.time_dispatch ||
    null;

  const arrivedAt =
    raw.timearrive ||
    raw.time_arrive ||
    null;

  const closedAt =
    raw.timeclosed ||
    raw.time_closed ||
    null;

  const point =
    parsePoint(
      raw.location
    );

  const id =
    cleanString(
      raw.nopd_item ||
      raw.id,
      `NOLA-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
    );

  return {
    id,

    agency:
      "New Orleans 911 / NOPD",

    city:
      "New Orleans",

    state:
      "LA",

    receivedAt:
      parseDate(
        receivedAt
      )?.toISOString() ||
      null,

    endedAt:
      parseDate(
        closedAt
      )?.toISOString() ||
      null,

    dispatchedAt:
      parseDate(
        dispatchedAt
      )?.toISOString() ||
      null,

    arrivedAt:
      parseDate(
        arrivedAt
      )?.toISOString() ||
      null,

    type:
      cleanString(
        raw.typetext ||
        raw.initialtypetext ||
        raw.type_,
        "911 Call"
      ),

    priority:
      normalizePriority(
        raw.priority ||
        raw.initialpriority
      ),

    location:
      cleanString(
        raw.block_address ||
        raw.blockaddress ||
        raw.address,
        "Location unavailable"
      ),

    audioUrl:
      null,

    transcript:
      "",

    audioAvailable:
      false,

    audioType:
      null,

    audioSource:
      null,

    isLive:
      true,

    isSimulated:
      false,

    source:
      "New Orleans Calls for Service 2026",

    sourceUrl:
      NOLA_PAGE,

    disposition:
      cleanString(
        raw.dispositiontext ||
        raw.disposition
      ) || null,

    beat:
      cleanString(
        raw.beat
      ) || null,

    policeDistrict:
      cleanString(
        raw.policedistrict ||
        raw.police_district
      ) || null,

    zip:
      cleanString(
        raw.zip
      ) || null,

    initialType:
      cleanString(
        raw.initialtypetext ||
        raw.initialtype
      ) || null,

    initialPriority:
      cleanString(
        raw.initialpriority
      ) || null,

    lat:
      point.lat,

    lng:
      point.lng
  };
}

/*
=========================================================
FETCH NEW ORLEANS CAD
=========================================================
*/

async function fetchNewOrleans(
  cutoff,
  limit
) {
  try {
    const cutoffDate =
      new Date(
        cutoff
      ).toISOString();

    const params =
      new URLSearchParams();

    params.set(
      "$limit",
      String(
        Math.min(
          limit,
          MAX_LIMIT
        )
      )
    );

    params.set(
      "$order",
      "timecreate DESC"
    );

    params.set(
      "$where",
      `timecreate >= '${cutoffDate}'`
    );

    const url =
      `${NOLA_API}?${params.toString()}`;

    console.log(
      `[911] NOLA request: ${url}`
    );

    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            Accept:
              "application/json"
          },

          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      const errorText =
        await response
          .text()
          .catch(
            () => ""
          );

      console.error(
        `[911] NOLA HTTP ${response.status}`,
        errorText.slice(
          0,
          500
        )
      );

      return [];
    }

    const data =
      await response.json();

    if (
      !Array.isArray(data)
    ) {
      return [];
    }

    console.log(
      `[911] NOLA records: ${data.length}`
    );

    return data
      .map(
        normalizeNolaCall
      )
      .filter(Boolean);

  } catch (
    error
  ) {
    console.error(
      "[911] NOLA failed:",
      error?.message ||
        error
    );

    return [];
  }
}

/*
=========================================================
NCDSV AUDIO ARCHIVE
=========================================================

The page contains links to publicly posted recordings.

We parse those links dynamically.

We ONLY accept actual audio extensions:

.mp3
.wav
.m4a
.ogg
.aac

No simulated source is added.

=========================================================
*/

function absoluteUrl(
  href,
  base
) {
  try {
    return new URL(
      href,
      base
    ).toString();
  } catch {
    return null;
  }
}

function decodeHtml(
  value
) {
  return String(value)
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    );
}

function stripHtml(
  value
) {
  return decodeHtml(
    String(value)
      .replace(
        /<[^>]*>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}

function audioExtension(
  url
) {
  try {
    const pathname =
      new URL(
        url
      ).pathname
        .toLowerCase();

    const match =
      pathname.match(
        /\.(mp3|wav|m4a|ogg|aac)$/
      );

    return match
      ? match[1]
      : null;
  } catch {
    return null;
  }
}

function makeArchiveId(
  url
) {
  return `NCDSV-${Buffer
    .from(url)
    .toString("base64")
    .replace(
      /[^a-zA-Z0-9]/g,
      ""
    )
    .slice(0, 32)}`;
}

/*
=========================================================
PARSE NCDSV PAGE
=========================================================
*/

async function fetchNcdsvAudio() {
  try {
    const response =
      await fetch(
        NCDSV_PAGE,
        {
          method: "GET",

          headers: {
            Accept:
              "text/html,application/xhtml+xml",
            "User-Agent":
              "Averon Public Safety Centre"
          },

          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      console.error(
        `[911] NCDSV HTTP ${response.status}`
      );

      return [];
    }

    const html =
      await response.text();

    /*
    -----------------------------------------------------
    Find links.

    This handles normal:

    <a href="file.mp3">Name</a>

    -----------------------------------------------------
    */

    const linkRegex =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    const results = [];

    let match;

    while (
      (match =
        linkRegex.exec(
          html
        )) !== null
    ) {
      const href =
        match[1];

      const text =
        stripHtml(
          match[2]
        );

      const url =
        absoluteUrl(
          href,
          NCDSV_PAGE
        );

      if (!url) {
        continue;
      }

      const extension =
        audioExtension(
          url
        );

      if (!extension) {
        continue;
      }

      results.push({
        id:
          makeArchiveId(
            url
          ),

        agency:
          "Public 911 Audio Archive",

        city:
          "",

        state:
          "",

        receivedAt:
          null,

        endedAt:
          null,

        dispatchedAt:
          null,

        arrivedAt:
          null,

        type:
          text ||
          "Archived 911 Recording",

        priority:
          "UNKNOWN",

        location:
          "Historical recording",

        audioUrl:
          url,

        transcript:
          "",

        audioAvailable:
          true,

        audioType:
          extension
            .toUpperCase(),

        audioSource:
          "NCDSV",

        isLive:
          false,

        isSimulated:
          false,

        source:
          "National Center on Domestic and Sexual Violence",

        sourceUrl:
          NCDSV_PAGE,

        lat:
          null,

        lng:
          null
      });
    }

    /*
    -----------------------------------------------------
    Remove duplicate URLs
    -----------------------------------------------------
    */

    const seen =
      new Set();

    const unique = [];

    for (
      const item of results
    ) {
      if (
        seen.has(
          item.audioUrl
        )
      ) {
        continue;
      }

      seen.add(
        item.audioUrl
      );

      unique.push(
        item
      );
    }

    console.log(
      `[911] NCDSV audio records: ${unique.length}`
    );

    return unique;

  } catch (
    error
  ) {
    console.error(
      "[911] NCDSV failed:",
      error?.message ||
        error
    );

    return [];
  }
}

/*
=========================================================
AUTHORIZED SOURCE
=========================================================
*/

function extractArray(
  payload
) {
  if (
    Array.isArray(
      payload
    )
  ) {
    return payload;
  }

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return [];
  }

  const keys = [
    "calls",
    "data",
    "incidents",
    "results",
    "records",
    "items"
  ];

  for (
    const key of keys
  ) {
    if (
      Array.isArray(
        payload[key]
      )
    ) {
      return payload[key];
    }
  }

  return [];
}

function normalizeAuthorized(
  raw
) {
  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
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

  const id =
    cleanString(
      raw.id ||
      raw.callId ||
      raw.call_id ||
      raw.incidentId ||
      raw.incident_id,
      `AUTHORIZED-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
    );

  return {
    id,

    agency:
      cleanString(
        raw.agency ||
        raw.agencyName ||
        raw.department ||
        raw.psap ||
        raw.psapName,
        "Authorized 911 Center"
      ),

    city:
      cleanString(
        raw.city ||
        raw.municipality
      ),

    state:
      cleanString(
        raw.state ||
        raw.stateCode
      ),

    receivedAt:
      parseDate(
        receivedAt
      )?.toISOString() ||
      null,

    endedAt:
      parseDate(
        endedAt
      )?.toISOString() ||
      null,

    dispatchedAt:
      parseDate(
        raw.dispatchedAt ||
        raw.dispatch_at
      )?.toISOString() ||
      null,

    arrivedAt:
      parseDate(
        raw.arrivedAt ||
        raw.arrived_at
      )?.toISOString() ||
      null,

    type:
      cleanString(
        raw.type ||
        raw.callType ||
        raw.call_type ||
        raw.incidentType ||
        raw.incident_type,
        "911 Call"
      ),

    priority:
      normalizePriority(
        raw.priority ||
        raw.priorityCode ||
        raw.priority_code
      ),

    location:
      cleanString(
        raw.location ||
        raw.address ||
        raw.fullAddress ||
        raw.crossStreet ||
        raw.cross_street,
        "Location unavailable"
      ),

    audioUrl:
      typeof audioUrl ===
        "string" &&
      audioUrl.trim()
        ? audioUrl.trim()
        : null,

    transcript:
      typeof raw.transcript ===
        "string"
        ? raw.transcript.trim()
        : "",

    audioAvailable:
      Boolean(
        raw.audioAvailable ??
        raw.audio_available ??
        audioUrl
      ),

    audioType:
      cleanString(
        raw.audioType ||
        raw.audio_type ||
        "AUTHORIZED"
      ),

    audioSource:
      cleanString(
        raw.audioSource ||
        raw.audio_source ||
        "Authorized provider"
      ),

    isLive:
      raw.isLive ??
      raw.is_live ??
      true,

    isSimulated:
      false,

    source:
      cleanString(
        raw.source ||
        raw.sourceName,
        "Authorized 911 Source"
      ),

    sourceUrl:
      cleanString(
        raw.sourceUrl ||
        raw.source_url ||
        raw.url
      ) || null,

    lat:
      numberOrNull(
        raw.lat ??
        raw.latitude
      ),

    lng:
      numberOrNull(
        raw.lng ??
        raw.lon ??
        raw.longitude
      )
  };
}

async function fetchAuthorized(
  cutoff
) {
  if (
    !AUTHORIZED_SOURCE.enabled ||
    !AUTHORIZED_SOURCE.url
  ) {
    return [];
  }

  try {
    const headers = {
      Accept:
        "application/json"
    };

    if (
      AUTHORIZED_SOURCE.apiKey
    ) {
      headers.Authorization =
        `Bearer ${AUTHORIZED_SOURCE.apiKey}`;
    }

    const response =
      await fetch(
        AUTHORIZED_SOURCE.url,
        {
          method: "GET",

          headers,

          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      console.error(
        `[911] Authorized source HTTP ${response.status}`
      );

      return [];
    }

    const payload =
      await response.json();

    const records =
      extractArray(
        payload
      );

    return records
      .map(
        normalizeAuthorized
      )
      .filter(Boolean)
      .filter(
        (call) => {

          /*
          Never allow a provider to
          accidentally mark a simulated
          record as real.
          */

          if (
            call.isSimulated
          ) {
            return false;
          }

          /*
          Audio records without dates
          are allowed because historical
          archives may not have timestamps.
          */

          if (
            call.receivedAt
          ) {
            const date =
              parseDate(
                call.receivedAt
              );

            if (
              date &&
              date.getTime() <
                cutoff
            ) {
              return false;
            }
          }

          return true;
        }
      );

  } catch (
    error
  ) {
    console.error(
      "[911] Authorized source failed:",
      error?.message ||
        error
    );

    return [];
  }
}

/*
=========================================================
DEDUPLICATION
=========================================================
*/

function deduplicate(
  calls
) {
  const map =
    new Map();

  for (
    const call of calls
  ) {
    const key =
      call.audioUrl ||
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
      map.set(
        key,
        call
      );

      continue;
    }

    map.set(
      key,
      {
        ...existing,
        ...call,

        audioUrl:
          call.audioUrl ||
          existing.audioUrl ||
          null,

        audioAvailable:
          call.audioAvailable ||
          existing.audioAvailable,

        transcript:
          call.transcript ||
          existing.transcript ||
          "",

        lat:
          call.lat ??
          existing.lat ??
          null,

        lng:
          call.lng ??
          existing.lng ??
          null
      }
    );
  }

  return [
    ...map.values()
  ];
}

/*
=========================================================
SORT
=========================================================

Historical archive items may not have
a timestamp.

Those remain after timestamped records.

=========================================================
*/

function sortCalls(
  calls
) {
  return calls.sort(
    (a, b) => {

      const aTime =
        parseDate(
          a.receivedAt
        )?.getTime() || 0;

      const bTime =
        parseDate(
          b.receivedAt
        )?.getTime() || 0;

      return (
        bTime -
        aTime
      );
    }
  );
}

/*
=========================================================
CACHE
=========================================================
*/

function setNoCache(
  res
) {
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

function setCors(
  res
) {
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

export default async function handler(
  req,
  res
) {
  setCors(res);
  setNoCache(res);

  /*
  -------------------------------------------------------
  OPTIONS
  -------------------------------------------------------
  */

  if (
    req.method ===
    "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  /*
  -------------------------------------------------------
  GET ONLY
  -------------------------------------------------------
  */

  if (
    req.method !==
    "GET"
  ) {
    return json(
      res,
      405,
      {
        success: false,
        error:
          "Method not allowed"
      }
    );
  }

  /*
  -------------------------------------------------------
  QUERY
  -------------------------------------------------------
  */

  const requestedHours =
    Number(
      req.query?.hours
    );

  const requestedLimit =
    Number(
      req.query?.limit
    );

  const hours =
    Number.isFinite(
      requestedHours
    ) &&
    requestedHours > 0
      ? Math.min(
          requestedHours,
          MAX_HOURS
        )
      : DEFAULT_HOURS;

  const limit =
    Number.isFinite(
      requestedLimit
    ) &&
    requestedLimit > 0
      ? Math.min(
          Math.floor(
            requestedLimit
          ),
          MAX_LIMIT
        )
      : DEFAULT_LIMIT;

  const agency =
    cleanString(
      req.query?.agency
    ).toLowerCase();

  const typeFilter =
    cleanString(
      req.query?.type
    ).toLowerCase();

  /*
  -------------------------------------------------------
  CUTOFF
  -------------------------------------------------------
  */

  const cutoff =
    Date.now() -
    hours *
      60 *
      60 *
      1000;

  /*
  -------------------------------------------------------
  FETCH EVERYTHING
  -------------------------------------------------------

  NOLA:
  current CAD

  NCDSV:
  historical public audio

  AUTHORIZED:
  optional authorized recordings

  -------------------------------------------------------
  */

  const [
    nolaCalls,
    ncdsvAudio,
    authorizedCalls
  ] =
    await Promise.all([
      fetchNewOrleans(
        cutoff,
        limit
      ),

      fetchNcdsvAudio(),

      fetchAuthorized(
        cutoff
      )
    ]);

  /*
  -------------------------------------------------------
  COMBINE
  -------------------------------------------------------
  */

  let calls = [
    ...nolaCalls,
    ...ncdsvAudio,
    ...authorizedCalls
  ];

  /*
  -------------------------------------------------------
  HARD SAFETY FILTER
  -------------------------------------------------------

  Even if an external provider sends:

  isSimulated: true

  it is rejected.

  -------------------------------------------------------
  */

  calls =
    calls.filter(
      (call) =>
        call &&
        call.isSimulated !==
          true
    );

  /*
  -------------------------------------------------------
  DEDUP
  -------------------------------------------------------
  */

  calls =
    deduplicate(
      calls
    );

  /*
  -------------------------------------------------------
  AGENCY FILTER
  -------------------------------------------------------
  */

  if (agency) {
    calls =
      calls.filter(
        (call) =>
          call.agency
            .toLowerCase()
            .includes(
              agency
            )
      );
  }

  /*
  -------------------------------------------------------
  AUDIO FILTER
  -------------------------------------------------------
  */

  if (
    typeFilter ===
      "audio" ||
    typeFilter ===
      "recordings"
  ) {
    calls =
      calls.filter(
        (call) =>
          call.audioAvailable &&
          call.audioUrl
      );
  }

  /*
  -------------------------------------------------------
  LIVE FILTER
  -------------------------------------------------------
  */

  if (
    typeFilter ===
    "live"
  ) {
    calls =
      calls.filter(
        (call) =>
          call.isLive
      );
  }

  /*
  -------------------------------------------------------
  ARCHIVE FILTER
  -------------------------------------------------------
  */

  if (
    typeFilter ===
    "archive"
  ) {
    calls =
      calls.filter(
        (call) =>
          !call.isLive &&
          call.audioAvailable
      );
  }

  /*
  -------------------------------------------------------
  SORT
  -------------------------------------------------------
  */

  calls =
    sortCalls(
      calls
    );

  /*
  -------------------------------------------------------
  LIMIT
  -------------------------------------------------------
  */

  calls =
    calls.slice(
      0,
      limit
    );

  /*
  -------------------------------------------------------
  STATISTICS
  -------------------------------------------------------
  */

  const audioCalls =
    calls.filter(
      (call) =>
        call.audioAvailable &&
        call.audioUrl
    );

  const liveCalls =
    calls.filter(
      (call) =>
        call.isLive
    );

  const archivedCalls =
    calls.filter(
      (call) =>
        !call.isLive &&
        call.audioAvailable
    );

  const activeCalls =
    calls.filter(
      (call) =>
        call.isLive &&
        !call.endedAt
    );

  const highPriority =
    calls.filter(
      (call) =>
        call.priority ===
        "HIGH"
    );

  /*
  -------------------------------------------------------
  SOURCES
  -------------------------------------------------------
  */

  const sources = [
    {
      name:
        "New Orleans Calls for Service 2026",

      type:
        "PUBLIC_CAD",

      enabled:
        true,

      records:
        nolaCalls.length,

      audio:
        0,

      live:
        true,

      simulated:
        false
    },

    {
      name:
        "National Center on Domestic and Sexual Violence",

      type:
        "PUBLIC_911_AUDIO_ARCHIVE",

      enabled:
        true,

      records:
        ncdsvAudio.length,

      audio:
        ncdsvAudio.length,

      live:
        false,

      simulated:
        false
    }
  ];

  if (
    AUTHORIZED_SOURCE.enabled
  ) {
    sources.push({
      name:
        AUTHORIZED_SOURCE.name,

      type:
        "AUTHORIZED",

      enabled:
        true,

      records:
        authorizedCalls.length,

      audio:
        authorizedCalls.filter(
          (call) =>
            call.audioAvailable
        ).length,

      live:
        true,

      simulated:
        false
    });
  }

  /*
  -------------------------------------------------------
  FINAL RESPONSE
  -------------------------------------------------------
  */

  return json(
    res,
    200,
    {
      success:
        true,

      generatedAt:
        new Date()
          .toISOString(),

      freshness: {
        hours,

        cutoff:
          new Date(
            cutoff
          ).toISOString()
      },

      count:
        calls.length,

      stats: {
        total:
          calls.length,

        live:
          liveCalls.length,

        active:
          activeCalls.length,

        archived:
          archivedCalls.length,

        audio:
          audioCalls.length,

        highPriority:
          highPriority.length
      },

      audioCount:
        audioCalls.length,

      sources,

      simulatedExcluded:
        true,

      calls
    }
  );
}

