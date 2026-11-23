const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('        function normalizeFlightNumber(');
const end = html.indexOf('        function extractFlightNumber(', start);
const normalization = html.slice(start, end);
const normalize = runInNewContext(normalization + '\nnormalizeFlightQuery;');

test('airport-padded flight numbers resolve to the same lookup', () => {
    for (const input of ['EK032', 'EK0032', 'ek 032', 'EK32']) {
        assert.equal(normalize(input), 'EK32', input);
    }
    assert.equal(normalize('BA0007'), 'BA7');
    assert.equal(normalize('SK0943'), 'SK943');
});

test('carrier digits, flight suffixes and internal zeros are preserved', () => {
    assert.equal(normalize('U20032'), 'U232');
    assert.equal(normalize('3U0032'), '3U32');
    assert.equal(normalize('EK0032A'), 'EK32A');
    assert.equal(normalize('UAE0032'), 'UAE32');
    assert.equal(normalize('EK203'), 'EK203');
    assert.equal(normalize('SK943'), 'SK943');
    assert.equal(normalize('EK000'), 'EK0');
});

test('invalid input remains available to the existing validation', () => {
    assert.equal(normalize(''), '');
    assert.equal(normalize(null), '');
    assert.equal(normalize('EK'), 'EK');
    assert.equal(normalize('EK/032'), 'EK/032');
});

test('the common search entry point sends the canonical number to the API', async () => {
    const searchStart = html.indexOf('        async function searchFlight(');
    const searchEnd = html.indexOf('        function populateCard(', searchStart);
    const calls = [];
    const element = () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, value: '', innerHTML: '' });
    const flightInput = element();
    const searchFlight = runInNewContext(normalization + html.slice(searchStart, searchEnd) + '\nsearchFlight;', {
        flightInput,
        searchView: element(), errorMsg: element(), loadingView: element(), resultView: element(), searchButton: element(),
        defaultSearchIcon: '', WORKER_URL: 'https://flight-service.invalid',
        AbortController, setTimeout, clearTimeout,
        fetch: async url => {
            calls.push(url);
            // Stop before rendering; this test checks the actual API request.
            return { ok: false, status: 404 };
        },
        showError() {}
    });
    await searchFlight('EK032');
    assert.equal(new URL(calls[0]).searchParams.get('flight'), 'EK32');
    assert.equal(flightInput.value, 'EK32');
});

test('repeated flight lookups reuse the short-lived sessionStorage cache without another API request', async () => {
    const searchStart = html.indexOf('        async function searchFlight(');
    const searchEnd = html.indexOf('        function populateCard(', searchStart);
    const store = new Map();
    const calls = [];
    const rendered = [];
    const element = () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, value: '', innerHTML: '' });
    const sessionStorage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v))
    };
    const searchFlight = runInNewContext(normalization + html.slice(searchStart, searchEnd) + '\nsearchFlight;', {
        URL, Date, JSON, sessionStorage,
        flightInput: element(),
        searchView: element(), errorMsg: element(), loadingView: element(), resultView: element(), searchButton: element(),
        defaultSearchIcon: '', WORKER_URL: 'https://flight-service.invalid',
        AbortController, setTimeout, clearTimeout,
        airportDbReady: Promise.resolve(),
        populateCard: data => rendered.push(data),
        updateRecentSearches() {},
        location: { href: 'https://airportguideapp.com/' },
        history: { replaceState() {} },
        window: { matchMedia: () => ({ matches: true }), scrollTo() {} },
        fetch: async url => {
            calls.push(url);
            return {
                ok: true,
                status: 200,
                json: async () => ({ flight_number: 'EK32', dep_iata: 'LHR', arr_iata: 'DXB', status: 'en-route' })
            };
        },
        showError() { throw new Error('unexpected error'); }
    });

    await searchFlight('EK032');
    await searchFlight('ek 32');
    assert.equal(calls.length, 1);
    assert.equal(rendered.length, 2);
    assert.equal(rendered[1].arr_iata, 'DXB');
    const cachedMap = JSON.parse(store.get('airportguide_flight_cache_v1'));
    assert.ok(cachedMap.EK32.expiresAt > Date.now() + 120000);
});
