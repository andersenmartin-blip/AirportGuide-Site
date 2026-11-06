// Paste this complete file into Cloudflare's flightcard-api Worker editor.
// Keep AIRLABS_KEY and AERO_API_KEY in the existing Worker secrets.
const VERSION = 'gate-fallback-2026-11-06';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'GET') return json({ error: 'Brug GET til flyopslag.' }, 405);
    const url = new URL(request.url);
    const flight = normalizeFlight(url.searchParams.get('flight'));
    if (!flight) return json({ error: 'Angiv et gyldigt flynummer, f.eks. IB720 eller EK032.' }, 400);

    try {
      // Preserve the departure airport's LOCAL calendar date for the second API.
      const airlabsUrl = new URL('https://airlabs.co/api/v9/flight');
      airlabsUrl.searchParams.set(flight.icao ? 'flight_icao' : 'flight_iata', flight.number);
      airlabsUrl.searchParams.set('api_key', env.AIRLABS_KEY || '');
      const airlabs = await readProvider(airlabsUrl, {}, env.AIRLABS_KEY);
      const response = airlabs.data?.response;
      const candidate = (Array.isArray(response) ? response[0] : response) || null;
      const airlabsFlight = candidate && typeof candidate === 'object' &&
        [candidate.dep_iata, candidate.arr_iata, candidate.dep_time, candidate.scheduled_dep_time]
          .some(item => value(item) !== 'N/A') ? candidate : null;
      const scheduled = value(airlabsFlight?.dep_time, airlabsFlight?.scheduled_dep_time);
      const localDate = scheduled.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().slice(0, 10);

      const aero = await readProvider(
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight.number)}/${localDate}`,
        { headers: { 'x-rapidapi-key': env.AERO_API_KEY || '', 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com' } },
        env.AERO_API_KEY
      );
      const aeroFlight = selectAeroFlight(aero.data, airlabsFlight, localDate);
      const departure = aeroFlight?.departure;
      const arrival = aeroFlight?.arrival;

      if (!airlabsFlight && !aeroFlight) {
        const failed = [airlabs.state, aero.state].some(state => state !== 'ok' && state !== 'empty');
        return json({ error: failed ? 'Flytjenesterne kunne ikke levere data. Prøv igen.' : 'Flyvningen blev ikke fundet.' }, failed ? 502 : 404);
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

      // Optional, redacted troubleshooting: ?flight=IB720&debug=1.
      // These are values returned by the APIs, not a Heathrow website scrape.
      if (url.searchParams.get('debug') === '1') {
        card.debug = {
          version: VERSION,
          retrieved_at: new Date().toISOString(),
          departure_date: localDate,
          airlabs: { state: airlabs.state, gate: value(airlabsFlight?.dep_gate), terminal: value(airlabsFlight?.dep_terminal) },
          aerodatabox: { state: aero.state, matched: Boolean(aeroFlight), gate: value(departure?.gate), terminal: value(departure?.terminal) }
        };
      }
      return json(card);
    } catch {
      return json({ error: 'Kunne ikke behandle flyoplysningerne. Prøv igen.' }, 500);
    }
  }
};
