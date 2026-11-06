const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const script = readFileSync(join(__dirname, '../cloudflare/flightcard-api/worker.js'), 'utf8');
const secrets = { AIRLABS_KEY: 'TEST-AIRLABS-SECRET', AERO_API_KEY: 'TEST-AERO-SECRET' };

// Synthetic fixtures; A7 here is a regression example, NOT a live IB720 result.
const airlabsFlight = {
  flight_iata: 'IB720', dep_iata: 'LHR', arr_iata: 'MAD', airline_iata: 'IB',
  dep_time: '2026-11-06 15:45', arr_time: '2026-11-06 19:10',
  dep_gate: 'A7', dep_terminal: '5', arr_gate: 'K10', arr_baggage: '12', status: 'scheduled'
};
const aeroFlight = {
  departure: { airport: { iata: 'LHR' }, scheduledTime: { local: '2026-11-06 15:45+00:00' }, terminal: '5', gate: null },
  arrival: { airport: { iata: 'MAD' }, scheduledTime: { local: '2026-11-06 19:10+01:00' }, gate: null, baggageBelt: null },
  airline: { iata: 'IB' }, status: 'Expected'
};

async function lookup({ airlabs = { response: airlabsFlight }, aero = [aeroFlight], query = 'IB720', env = secrets, method = 'GET', fail, timeout } = {}) {
  const calls = [];
  const timers = [];
  const worker = runInNewContext(script.replace('export default', 'const worker =') + '\nworker;', {
    URL, Response, AbortController, Date,
    setTimeout: timeout ? callback => { timers.push(callback); return timers.length; } : setTimeout,
    clearTimeout: timeout ? () => {} : clearTimeout,
    fetch: async (input, options) => {
      const url = new URL(String(input));
      const provider = url.hostname === 'airlabs.co' ? 'airlabs' : 'aero';
      calls.push({ url, options });
      if (timeout === provider) {
        timers.at(-1)();
        throw options.signal.reason;
      }
      if (fail === provider) throw new Error(`request failed with ${secrets.AIRLABS_KEY} ${secrets.AERO_API_KEY}`);
      const data = provider === 'airlabs' ? airlabs : aero;
      return data instanceof Response ? data : new Response(JSON.stringify(data));
    }
  });
  const res = await worker.fetch(new Request(`https://worker.invalid/?flight=${encodeURIComponent(query)}&debug=1`, { method }), env);
  const text = await res.text();
  assert.equal(text.includes(secrets.AIRLABS_KEY), false);
  assert.equal(text.includes(secrets.AERO_API_KEY), false);
  return { res, card: text ? JSON.parse(text) : null, calls };
}

test('Airlabs gate A7 survives a missing AeroDataBox gate', async () => {
  const { res, card, calls } = await lookup();
  assert.equal(res.status, 200);
  assert.equal(card.gate, 'A7');
  assert.equal(card.gate_source, 'Airlabs');
  assert.equal(card.arr_gate, 'K10');
  assert.equal(card.baggage_belt, '12');
  assert.equal(card.debug.airlabs.gate, 'A7');
  assert.equal(card.debug.aerodatabox.gate, 'N/A');
  assert.equal(calls.length, 2);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('usable AeroDataBox values keep priority for the same flight', async () => {
  const { card } = await lookup({ aero: [{ ...aeroFlight,
    departure: { ...aeroFlight.departure, gate: ' B12 ', terminal: '3' },
    arrival: { ...aeroFlight.arrival, gate: 'H20', baggageBelt: '8' }
  }] });
  assert.equal(card.gate, 'B12');
  assert.equal(card.terminal, '3');
  assert.equal(card.arr_gate, 'H20');
  assert.equal(card.baggage_belt, '8');
  assert.equal(card.gate_source, 'AeroDataBox');
});

test('empty or placeholder fields cannot erase Airlabs gate and terminal', async () => {
  for (const missing of [null, undefined, '', ' ', 'N/A', 'TBA', '-']) {
    const { card } = await lookup({ aero: [{ ...aeroFlight, departure: { ...aeroFlight.departure, gate: missing, terminal: missing } }] });
    assert.equal(card.gate, 'A7', String(missing));
    assert.equal(card.terminal, '5', String(missing));
  }
});

test('a missing gate in both providers remains unknown', async () => {
  const { card } = await lookup({ airlabs: { response: { ...airlabsFlight, dep_gate: null } } });
  assert.equal(card.gate, 'N/A');
  assert.equal(card.gate_source, null);
});

test('AeroDataBox HTTP and transport failures preserve Airlabs data', async () => {
  for (const options of [{ fail: 'aero' }, { aero: new Response('', { status: 429 }) }, { aero: new Response('invalid-json') }, { timeout: 'aero' }]) {
    const { res, card } = await lookup(options);
    assert.equal(res.status, 200);
    assert.equal(card.gate, 'A7');
    assert.equal(card.source, 'Airlabs');
    assert.notEqual(card.debug.aerodatabox.state, 'ok');
  }
});

test('AeroDataBox alone can supply the route and gate when Airlabs fails', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { res, card } = await lookup({ fail: 'airlabs', aero: [{ ...aeroFlight,
    departure: { ...aeroFlight.departure, scheduledTime: { local: `${today} 15:45+00:00` }, gate: 'A7' }
  }] });
  assert.equal(res.status, 200);
  assert.equal(card.gate, 'A7');
  assert.equal(card.dep_iata, 'LHR');
  assert.equal(card.arr_iata, 'MAD');
  assert.equal(card.airline_iata, 'IB');
  assert.equal(card.source, 'AeroDataBox');
});

test('API-level errors are treated as failure even with HTTP 200', async () => {
  const { res, card } = await lookup({ airlabs: { error: { message: secrets.AIRLABS_KEY } }, aero: [] });
  assert.equal(res.status, 502);
  assert.ok(card.error);
});

test('no data returns 404 instead of a card of invented defaults', async () => {
  for (const response of [null, {}, [], 'not-a-flight']) {
    const { res, card } = await lookup({ airlabs: { response }, aero: new Response(null, { status: 204 }) });
    assert.equal(res.status, 404);
    assert.ok(card.error);
    assert.equal(card.status, undefined);
  }
});

test('AeroDataBox-only live and cancelled statuses match the existing frontend', async () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [status, expected] of [['EnRoute', 'en-route'], ['Arrived', 'landed'], ['Canceled', 'cancelled']]) {
    const { card } = await lookup({ fail: 'airlabs', aero: [{ ...aeroFlight, status,
      departure: { ...aeroFlight.departure, scheduledTime: { local: `${today} 15:45+00:00` } }
    }] });
    assert.equal(card.status, expected);
  }
});

test('an unconfigured provider is skipped without putting secrets in the result', async () => {
  const { card, calls } = await lookup({ env: { AIRLABS_KEY: secrets.AIRLABS_KEY } });
  assert.equal(calls.length, 1);
  assert.equal(card.gate, 'A7');
  assert.equal(card.debug.aerodatabox.state, 'missing_key');
});

test('the second request uses the local departure date, including ISO T input', async () => {
  const { calls } = await lookup({ airlabs: { response: { ...airlabsFlight, dep_time: '2026-11-07T00:15:00+04:00' } } });
  assert.equal(calls[1].url.pathname, '/flights/number/IB720/2026-11-07');
});

test('other dates or airport pairs cannot provide this flight gate', async () => {
  const wrongDate = { ...aeroFlight, departure: { ...aeroFlight.departure, scheduledTime: { local: '2026-11-05 15:45+00:00' }, gate: 'WRONG-DATE' } };
  const wrongAirport = { ...aeroFlight, departure: { ...aeroFlight.departure, airport: { iata: 'MAD' }, gate: 'WRONG-AIRPORT' } };
  const correct = { ...aeroFlight, departure: { ...aeroFlight.departure, gate: 'A8' } };
  const { card } = await lookup({ aero: [wrongDate, wrongAirport, correct] });
  assert.equal(card.gate, 'A8');
});

test('multiple occurrences match the scheduled time instead of the first result', async () => {
  const other = { ...aeroFlight, departure: { ...aeroFlight.departure, scheduledTime: { local: '2026-11-06 06:00+00:00' }, gate: 'WRONG' } };
  const { card } = await lookup({ aero: [other, aeroFlight] });
  assert.equal(card.debug.aerodatabox.matched, true);
  assert.equal(card.gate, 'A7');
  const ambiguous = await lookup({ aero: [other, other] });
  assert.equal(ambiguous.card.debug.aerodatabox.matched, false);
  assert.equal(ambiguous.card.gate, 'A7');
});

test('padded flight numbers preserve carrier digits and reach both APIs normalized', async () => {
  for (const [input, canonical, parameter] of [['ek 032', 'EK32', 'flight_iata'], ['U20032', 'U232', 'flight_iata'], ['3U0032', '3U32', 'flight_iata'], ['UAE0032', 'UAE32', 'flight_icao']]) {
    const { calls, card } = await lookup({ query: input });
    assert.equal(calls[0].url.searchParams.get(parameter), canonical);
    assert.equal(calls[1].url.pathname.includes(`/${canonical}/`), true);
    assert.equal(card.flight_number, canonical);
  }
});

test('input validation and CORS preflight never call a paid provider', async () => {
  const invalid = await lookup({ query: 'IB720&api_key=injected' });
  assert.equal(invalid.res.status, 400);
  assert.equal(invalid.calls.length, 0);
  const preflight = await lookup({ method: 'OPTIONS' });
  assert.equal(preflight.res.status, 204);
  assert.equal(preflight.calls.length, 0);
});

test('equivalent local time formats do not create a false delay in summer', async () => {
  const { card } = await lookup({ airlabs: { response: { ...airlabsFlight, dep_time: '2026-07-06 15:45' } },
    aero: [{ ...aeroFlight, departure: { ...aeroFlight.departure, scheduledTime: { local: '2026-07-06 15:45+01:00' }, revisedTime: { local: '2026-07-06 16:05+01:00' } } }]
  });
  assert.equal(card.departure_time, '2026-07-06 16:05+01:00');
  assert.equal(card.delay_mins, 20);
});
