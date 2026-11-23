// Paste this complete file into Cloudflare's flightcard-api Worker editor.
// Keep AIRLABS_KEY and AERO_API_KEY in the existing Worker secrets.
const VERSION = 'quota-saver-2026-11-23';
const DEFAULT_ALLOW_ORIGIN = 'https://airportguideapp.com';
const ALLOWED_ORIGIN_RE = /^(?:https:\/\/(?:www\.)?airportguideapp\.com|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/i;
const MEMORY_CACHE = new Map();
const MAX_CACHE_ENTRIES = 200;

function resolveOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return { allowed: true, headerOrigin: DEFAULT_ALLOW_ORIGIN };
  if (ALLOWED_ORIGIN_RE.test(origin)) return { allowed: true, headerOrigin: origin };
  return { allowed: false, headerOrigin: DEFAULT_ALLOW_ORIGIN };
}

function buildHeaders(allowOrigin = DEFAULT_ALLOW_ORIGIN, cacheControl = 'no-store', extraHeaders = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
    'Vary': 'Origin',
    'Cache-Control': cacheControl,
    ...extraHeaders
  };
}

function json(data, status = 200, { allowOrigin = DEFAULT_ALLOW_ORIGIN, cacheControl = 'no-store', extraHeaders = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildHeaders(allowOrigin, cacheControl, extraHeaders)
  });
}

function value(...values) {
  for (const item of values) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const text = String(item).trim();
    if (text && !/^(?:N\/A|NULL|UNDEFINED|TBA|TBD|UNKNOWN|--?)$/i.test(text)) return text;
  }
  return 'N/A';
}

function normalizeFlight(input) {
  const query = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  const parts = query.match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])(\d+[A-Z]?)$/);
  if (!parts) return null;
  const number = parts[1] + parts[2].replace(/^0+(?=\d)/, '');
  return number.length <= 8 ? { number, icao: parts[1].length === 3 } : null;
}

// Compare local times at the SAME departure airport. Airlabs omits the UTC
// offset whereas AeroDataBox includes it; parsing one as UTC mixes time zones.
function localMillis(input) {
  const parts = String(input || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return parts ? Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +(parts[6] || 0)) : NaN;
}

async function readProvider(url, options, configured) {
  if (!configured) return { state: 'missing_key', data: null };
  const controller = new AbortController();
  // Two sequential requests stay within the frontend's 12-second timeout.
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.status === 204 || response.status === 404) return { state: 'empty', data: null };
    if (!response.ok) return { state: `http_${response.status}`, data: null };
    const data = await response.json();
    if (data?.error) return { state: 'api_error', data: null };
    return { state: 'ok', data };
  } catch (error) {
    // Raw exception messages and response bodies may contain API credentials.
    return { state: error?.name === 'AbortError' ? 'timeout' : 'unavailable', data: null };
  } finally {
    clearTimeout(timer);
  }
}

function selectAeroFlight(data, airlabsFlight, localDate) {
  if (!Array.isArray(data)) return null;
  const candidates = data.filter(flight => {
    if (!flight || (!flight.departure && !flight.arrival)) return false;
    const date = flight.departure?.scheduledTime?.local?.slice(0, 10);
    // The dated API can return flights ARRIVING on that date, too.
    if (date && date !== localDate) return false;
    for (const [expected, actual] of [
      [airlabsFlight?.dep_iata, flight.departure?.airport?.iata],
      [airlabsFlight?.arr_iata, flight.arrival?.airport?.iata]
    ]) {
      if (value(expected) !== 'N/A' && value(actual) !== 'N/A' && expected !== actual) return false;
    }
    return true;
  });
  if (candidates.length === 1) return candidates[0];
  const scheduled = localMillis(airlabsFlight?.dep_time || airlabsFlight?.scheduled_dep_time);
  const exact = candidates.filter(flight => localMillis(flight.departure?.scheduledTime?.local) === scheduled);
  // Never combine a gate from an arbitrary occurrence of the same flight.
  return exact.length === 1 ? exact[0] : null;
}

function flightStatus(airlabsStatus, aeroStatus) {
  if (value(airlabsStatus) !== 'N/A') return airlabsStatus;
  const status = value(aeroStatus, 'scheduled').toLowerCase();
  if (/^(?:enroute|en-route|departed|airborne)$/.test(status)) return 'en-route';
  if (/^(?:arrived|landed)$/.test(status)) return 'landed';
  if (status.includes('cancel')) return 'cancelled';
  return status;
}

// Protect AeroDataBox's tight 600-unit monthly RapidAPI cap (300 lookups max):
// skip the secondary API call whenever AirLabs already supplies gate,
// terminal, and (for en-route/landed arrivals) arrival gate or baggage info.
function needsAeroFallback(airlabsFlight) {
  if (!airlabsFlight) return true;
  if (value(airlabsFlight.dep_gate) === 'N/A' || value(airlabsFlight.dep_terminal) === 'N/A') return true;
  const status = flightStatus(airlabsFlight.status, null);
  if (['en-route', 'landed'].includes(status)) {
    return value(airlabsFlight.arr_gate) === 'N/A' && value(airlabsFlight.arr_baggage) === 'N/A';
  }
  return false;
}

function cacheTtlSeconds(status, body) {
  if (status === 200) return ['landed', 'cancelled'].includes(body?.status) ? 1800 : 180;
  if (status === 404) return 120;
  return 0;
}

function setMemoryCache(key, entry) {
  if (MEMORY_CACHE.has(key)) MEMORY_CACHE.delete(key);
  while (MEMORY_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldest = MEMORY_CACHE.keys().next().value;
    MEMORY_CACHE.delete(oldest);
  }
  MEMORY_CACHE.set(key, entry);
}

function edgeCacheRequest(requestUrl, flightNumber) {
  const keyUrl = new URL('/', requestUrl.origin);
  keyUrl.searchParams.set('flight', flightNumber);
  return new Request(keyUrl.href, { method: 'GET' });
}

async function readCachedLookup(requestUrl, flightNumber) {
  const now = Date.now();
  const mem = MEMORY_CACHE.get(flightNumber);
  if (mem) {
    if (mem.expiresAt > now) return { entry: mem, cacheState: 'hit_memory' };
    MEMORY_CACHE.delete(flightNumber);
  }
  try {
    const edgeCache = globalThis.caches?.default;
    if (!edgeCache) return null;
    const hit = await edgeCache.match(edgeCacheRequest(requestUrl, flightNumber));
    if (!hit) return null;
    const parsed = await hit.json();
    if (!parsed || typeof parsed.status !== 'number' || !parsed.body) return null;
    if (parsed.expiresAt && parsed.expiresAt <= now) return null;
    const entry = {
      ...parsed,
      expiresAt: parsed.expiresAt || now + (parsed.ttlSeconds || 180) * 1000
    };
    setMemoryCache(flightNumber, entry);
    return { entry, cacheState: 'hit_edge' };
  } catch {
    return null;
  }
}

function storeCachedLookup(requestUrl, flightNumber, entry, ctx) {
  setMemoryCache(flightNumber, entry);
  try {
    const edgeCache = globalThis.caches?.default;
    if (!edgeCache || entry.ttlSeconds <= 0) return;
    const record = new Response(JSON.stringify(entry), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${entry.ttlSeconds}`
      }
    });
    const writePromise = edgeCache.put(edgeCacheRequest(requestUrl, flightNumber), record);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writePromise);
  } catch {
    // Ignore cache API failures; in-memory isolate cache still serves hits.
  }
}

export default {
  async fetch(request, env, ctx) {
    const originCheck = resolveOrigin(request);
    if (!originCheck.allowed) {
      return json({ error: 'Origin not allowed.' }, 403, { allowOrigin: originCheck.headerOrigin });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildHeaders(originCheck.headerOrigin, 'no-store') });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Brug GET til flyopslag.' }, 405, { allowOrigin: originCheck.headerOrigin });
    }

    const url = new URL(request.url);
    const flight = normalizeFlight(url.searchParams.get('flight'));
    if (!flight) {
      return json({ error: 'Angiv et gyldigt flynummer, f.eks. IB720 eller EK032.' }, 400, {
        allowOrigin: originCheck.headerOrigin
      });
    }
    const isDebug = url.searchParams.get('debug') === '1';

    try {
      const cached = await readCachedLookup(url, flight.number);
      if (cached) {
        const { entry, cacheState } = cached;
        const payload = isDebug
          ? { ...entry.body, debug: { ...entry.debugMeta, cache: cacheState } }
          : entry.body;
        return json(payload, entry.status, {
          allowOrigin: originCheck.headerOrigin,
          cacheControl: `public, max-age=${entry.ttlSeconds}`,
          extraHeaders: { 'X-Cache': 'HIT' }
        });
      }

      // Preserve the departure airport's LOCAL calendar date for the second API.
      const airlabsUrl = new URL('https://airlabs.co/api/v9/flight');
      airlabsUrl.searchParams.set(flight.icao ? 'flight_icao' : 'flight_iata', flight.number);
      airlabsUrl.searchParams.set('api_key', env?.AIRLABS_KEY || '');
      const airlabs = await readProvider(airlabsUrl, {}, env?.AIRLABS_KEY);
      const response = airlabs.data?.response;
      const candidate = (Array.isArray(response) ? response[0] : response) || null;
      const airlabsFlight = candidate && typeof candidate === 'object' &&
        [candidate.dep_iata, candidate.arr_iata, candidate.dep_time, candidate.scheduled_dep_time]
          .some(item => value(item) !== 'N/A') ? candidate : null;
      const scheduled = value(airlabsFlight?.dep_time, airlabsFlight?.scheduled_dep_time);
      const localDate = scheduled.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10);

      let aero = { state: 'skipped_sufficient', data: null };
      if (needsAeroFallback(airlabsFlight)) {
        aero = await readProvider(
          `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight.number)}/${localDate}`,
          { headers: { 'x-rapidapi-key': env?.AERO_API_KEY || '', 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com' } },
          env?.AERO_API_KEY
        );
      }
      const aeroFlight = selectAeroFlight(aero.data, airlabsFlight, localDate);
      const departure = aeroFlight?.departure;
      const arrival = aeroFlight?.arrival;

      const buildDebugMeta = ttlSeconds => ({
        version: VERSION,
        retrieved_at: new Date().toISOString(),
        departure_date: localDate,
        cache: 'miss',
        ttl_seconds: ttlSeconds,
        airlabs: { state: airlabs.state, gate: value(airlabsFlight?.dep_gate), terminal: value(airlabsFlight?.dep_terminal) },
        aerodatabox: { state: aero.state, matched: Boolean(aeroFlight), gate: value(departure?.gate), terminal: value(departure?.terminal) }
      });

      if (!airlabsFlight && !aeroFlight) {
        const aeroUpOrSkipped = aero.state === 'ok' || aero.state === 'empty' || aero.state === 'skipped_sufficient';
        const failed = (airlabs.state !== 'ok' && airlabs.state !== 'empty') || !aeroUpOrSkipped;
        const status = failed ? 502 : 404;
        const body = { error: failed ? 'Flytjenesterne kunne ikke levere data. Prøv igen.' : 'Flyvningen blev ikke fundet.' };
        const ttlSeconds = cacheTtlSeconds(status, body);
        const debugMeta = buildDebugMeta(ttlSeconds);
        if (ttlSeconds > 0) {
          storeCachedLookup(url, flight.number, {
            status,
            body,
            debugMeta,
            ttlSeconds,
            expiresAt: Date.now() + ttlSeconds * 1000
          }, ctx);
        }
        return json(isDebug ? { ...body, debug: debugMeta } : body, status, {
          allowOrigin: originCheck.headerOrigin,
          cacheControl: ttlSeconds > 0 ? `public, max-age=${ttlSeconds}` : 'no-store',
          extraHeaders: { 'X-Cache': 'MISS' }
        });
      }

      // AeroDataBox retains priority for gate/terminal, but an empty field must
      // NOT erase a usable value from Airlabs. Never invent a gate.
      const gate = value(departure?.gate, airlabsFlight?.dep_gate);
      const terminal = value(departure?.terminal, airlabsFlight?.dep_terminal);
      const arrGate = value(arrival?.gate, airlabsFlight?.arr_gate);
      const baggageBelt = value(arrival?.baggageBelt, airlabsFlight?.arr_baggage);
      const gateSource = value(departure?.gate) !== 'N/A' ? 'AeroDataBox'
        : value(airlabsFlight?.dep_gate) !== 'N/A' ? 'Airlabs' : null;

      const scheduledTime = value(scheduled, departure?.scheduledTime?.local);
      let finalTime = value(airlabsFlight?.dep_estimated, scheduledTime);
      const aeroTime = value(departure?.revisedTime?.local, departure?.scheduledTime?.local);
      if (aeroTime !== 'N/A' && (finalTime === 'N/A' || localMillis(aeroTime) >= localMillis(finalTime))) {
        finalTime = aeroTime;
      }
      const delay = (localMillis(finalTime) - localMillis(scheduledTime)) / 60000;
      const sources = [airlabsFlight && 'Airlabs', aeroFlight && 'AeroDataBox'].filter(Boolean);
      const card = {
        flight_number: flight.number,
        departure_time: finalTime,
        arrival_time: value(airlabsFlight?.arr_estimated, airlabsFlight?.arr_time,
          airlabsFlight?.scheduled_arr_time, arrival?.revisedTime?.local, arrival?.scheduledTime?.local),
        gate,
        arr_gate: arrGate,
        terminal,
        baggage_belt: baggageBelt,
        dep_iata: value(airlabsFlight?.dep_iata, departure?.airport?.iata),
        arr_iata: value(airlabsFlight?.arr_iata, arrival?.airport?.iata),
        airline_iata: value(airlabsFlight?.airline_iata, aeroFlight?.airline?.iata),
        status: flightStatus(airlabsFlight?.status, aeroFlight?.status),
        delay_mins: Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : 0,
        source: sources.join(' + '),
        gate_source: gateSource
      };

      const ttlSeconds = cacheTtlSeconds(200, card);
      const debugMeta = buildDebugMeta(ttlSeconds);
      storeCachedLookup(url, flight.number, {
        status: 200,
        body: card,
        debugMeta,
        ttlSeconds,
        expiresAt: Date.now() + ttlSeconds * 1000
      }, ctx);

      // Optional, redacted troubleshooting: ?flight=IB720&debug=1.
      // These are values returned by the APIs, not a Heathrow website scrape.
      return json(isDebug ? { ...card, debug: debugMeta } : card, 200, {
        allowOrigin: originCheck.headerOrigin,
        cacheControl: `public, max-age=${ttlSeconds}`,
        extraHeaders: { 'X-Cache': 'MISS' }
      });
    } catch {
      return json({ error: 'Kunne ikke behandle flyoplysningerne. Prøv igen.' }, 500, {
        allowOrigin: originCheck.headerOrigin
      });
    }
  }
};
