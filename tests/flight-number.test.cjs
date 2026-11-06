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
