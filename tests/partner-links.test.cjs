const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const script = readFileSync(require('node:path').join(__dirname, '../assets/partner-links.js'), 'utf8');

function boot({ gtag, cards = [], anchors = [] } = {}) {
    const handlers = {};
    let intersection;
    const window = { gtag };
    const document = {
        body: { dataset: { arrivalAirport: 'DXB' } },
        querySelectorAll: selector => selector === 'a[data-provider]' ? anchors : cards,
        addEventListener: (name, handler) => { handlers[name] = handler; }
    };
    class IntersectionObserver {
        constructor(callback) { intersection = callback; }
        observe() {}
        disconnect() {}
    }
    runInNewContext(script, { window, document, URL, IntersectionObserver });
    return { api: window.AirportGuidePartners, handlers, intersect: entries => intersection(entries) };
}

test('existing publisher attribution is preserved', () => {
    const { api } = boot();
    for (const provider of ['airalo', 'kiwitaxi', 'airhelp']) {
        const result = api.resolve(provider);
        assert.equal(result.url, api.links[provider]);
        assert.equal(result.affiliate, true);
    }
    assert.equal(new URL(api.resolve('airhelp').url).searchParams.get('a_aid'), '69d37834e54fa');
});

test('an unconfigured tour link is useful but never reported as commissionable', () => {
    const { api } = boot();
    const result = api.resolve('viator', 'São Paulo & coast');
    assert.equal(result.affiliate, false);
    const url = new URL(result.url);
    assert.equal(url.hostname, 'www.viator.com');
    assert.equal(url.searchParams.get('text'), 'São Paulo & coast');
    assert.equal(url.searchParams.has('pid'), false);
});

test('a future Viator link retains partner parameters when its city changes', () => {
    const { api } = boot();
    // Synthetic test fixture only, never used as a live publisher ID.
    const configured = { viator: 'https://www.viator.com/searchResults/all?pid=TEST-PUBLISHER&mcid=TEST-MCID&medium=link&campaign=guide' };
    const result = api.resolve('viator', 'Dubai', configured);
    const url = new URL(result.url);
    assert.equal(result.affiliate, true);
    assert.equal(url.searchParams.get('pid'), 'TEST-PUBLISHER');
    assert.equal(url.searchParams.get('mcid'), 'TEST-MCID');
    assert.equal(url.searchParams.get('medium'), 'link');
    assert.equal(url.searchParams.get('campaign'), 'guide');
    assert.equal(url.searchParams.get('text'), 'Dubai');
});

test('invalid partner configuration cannot send a visitor to an unsafe scheme', () => {
    const { api } = boot();
    assert.equal(api.resolve('airalo', '', { airalo: 'javascript:alert(1)' }), null);
    assert.equal(api.resolve('viator', 'Dubai', { viator: 'https://unrelated.invalid/' }).affiliate, false);
});

test('organic clicks and affiliate clicks are distinct, including middle clicks', () => {
    const events = [];
    const { handlers } = boot({ gtag: (...event) => events.push(event) });
    const link = { dataset: { provider: 'viator', affiliate: 'false', placement: 'flight_result' }, hasAttribute: () => false };
    const target = { closest: () => link };
    handlers.click({ type: 'click', target });
    assert.equal(events[0][1], 'outbound_click');
    assert.equal(events.length, 1);
    link.dataset.provider = 'airalo';
    link.dataset.affiliate = 'true';
    handlers.auxclick({ type: 'auxclick', button: 1, target });
    assert.equal(events[1][1], 'affiliate_click');
    assert.equal(events[1][2].arrival_airport, 'DXB');
    assert.equal(events[2][1], 'click_esim');
    const count = events.length;
    handlers.auxclick({ type: 'auxclick', button: 2, target });
    assert.equal(events.length, count);
    assert.equal('flight_number' in events[1][2], false);
});

test('only sufficiently visible offers count once per result', () => {
    const events = [];
    const link = { dataset: { provider: 'airalo', placement: 'dubai_guide', affiliate: 'true' } };
    const card = { querySelector: () => link };
    const { api, intersect } = boot({ gtag: (...event) => events.push(event), cards: [card] });
    intersect([{ target: card, isIntersecting: false, intersectionRatio: 0 }]);
    intersect([{ target: card, isIntersecting: true, intersectionRatio: 0.2 }]);
    assert.equal(events.length, 0);
    intersect([{ target: card, isIntersecting: true, intersectionRatio: 0.8 }]);
    intersect([{ target: card, isIntersecting: true, intersectionRatio: 0.8 }]);
    assert.equal(events.length, 1);
    assert.equal(events[0][1], 'offer_impression');
    api.refresh({ airport: 'ORD' });
    intersect([{ target: card, isIntersecting: true, intersectionRatio: 0.8 }]);
    assert.equal(events.length, 2);
    assert.equal(events[1][2].arrival_airport, 'ORD');
});

test('an unavailable analytics service cannot break link handling', () => {
    const { handlers } = boot({ gtag: () => { throw new Error('blocked'); } });
    const link = { dataset: { provider: 'airalo', affiliate: 'true' }, hasAttribute: () => false };
    assert.doesNotThrow(() => handlers.click({ type: 'click', target: { closest: () => link } }));
});
