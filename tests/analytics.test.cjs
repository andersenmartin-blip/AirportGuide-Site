const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const script = readFileSync(join(__dirname, '../assets/analytics.js'), 'utf8');

function boot({ saved, hostname = 'airportguideapp.com', guide, brokenStorage = false, loadPartners = false } = {}) {
    const handlers = {};
    const externalScripts = [];
    const documentListeners = {};
    const cookieWrites = [];
    const storage = new Map();
    if (saved !== undefined) storage.set('airportguide_analytics_consent_v1', JSON.stringify(saved));
    let reloads = 0;
    let banner;
    const buttons = Object.fromEntries(['[data-allow]', '[data-decline]'].map(name => [name, { addEventListener: (event, fn) => { handlers[name] = fn; }, focus() {} }]));
    const internal = { href: '/guides/dubai/', getAttribute() { return '/guides/dubai/'; } };
    const external = { href: 'https://www.airalo.com/', getAttribute() { return this.href; } };
    const partner = { href: 'https://airalo.pxf.io/2RKYkg', dataset: { provider: 'airalo', placement: 'dubai_guide' },
        getAttribute() { return this.href; }, hasAttribute() { return false; } };
    const location = { hostname, origin: `https://${hostname}`, pathname: '/',
        href: `https://${hostname}/?flight=EK32&booking_ref=PRIVATE-BOOKING&utm_source=google&utm_medium=cpc&utm_campaign=dubai_arrivals_test&gclid=PRIVATE-CLICK-ID&email=person@example.com`, reload() { reloads++; } };
    const document = {
        body: { dataset: { guide, arrivalAirport: 'DXB' }, appendChild: element => { banner = element; } },
        head: { appendChild: element => externalScripts.push(element.src) },
        referrer: 'https://example.com/ref?booking_ref=PRIVATE-REFERRER',
        activeElement: { focus() {} },
        querySelectorAll: selector => selector === 'a[href]' ? [internal, external, partner] : selector === 'a[data-provider]' ? [partner] : [],
        createElement: tag => ({ tag, hidden: false, setAttribute() {}, querySelector: selector => buttons[selector] || buttons['[data-allow]'] }),
        addEventListener: (type, listener) => { (documentListeners[type] ||= []).push(listener); },
        dispatchEvent: event => { (documentListeners[event.type] || []).forEach(listener => listener(event)); }
    };
    Object.defineProperty(document, 'cookie', { get: () => '_ga=one; _ga_YYW1KW4CGN=two; preference=keep', set: value => cookieWrites.push(value) });
    const window = {};
    const localStorage = { getItem(key) { if (brokenStorage) throw Error('storage blocked'); return storage.get(key) || null; }, setItem(key, value) { if (brokenStorage) throw Error('storage blocked'); storage.set(key, value); } };
    const context = { window, document, location, localStorage, URL, Date, Event };
    runInNewContext(script, context);
    if (loadPartners) runInNewContext(readFileSync(join(__dirname, '../assets/partner-links.js'), 'utf8'), context);
    return { window, banner, handlers, externalScripts, storage, internal, external, cookieWrites,
        events: () => (window.dataLayer || []).map(args => Array.from(args)).filter(args => args[0] === 'event'),
        commands: () => (window.dataLayer || []).map(args => Array.from(args)),
        reloads: () => reloads, partner, clickPartner() { document.dispatchEvent({ type: 'click', target: { closest: () => partner } }); } };
}

test('no Analytics request or event is queued before analytics consent', () => {
    const app = boot();
    app.window.gtag('event', 'affiliate_click', { provider: 'airalo' });
    assert.equal(app.externalScripts.length, 0);
    assert.equal(app.commands().length, 0);
    assert.equal(app.banner.hidden, false);
});

test('accepting consent loads the existing measurement ID and keeps advertising denied', () => {
    const app = boot();
    app.handlers['[data-allow]']();
    assert.equal(app.externalScripts.length, 1);
    assert.match(app.externalScripts[0], /G-YYW1KW4CGN/);
    const consent = app.commands().filter(command => command[0] === 'consent');
    assert.equal(consent[0][2].analytics_storage, 'denied');
    assert.equal(consent[1][2].analytics_storage, 'granted');
    for (const command of consent) {
        assert.equal(command[2].ad_storage, 'denied');
        assert.equal(command[2].ad_user_data, 'denied');
        assert.equal(command[2].ad_personalization, 'denied');
    }
    assert.equal(app.banner.hidden, true);
});

test('page and event data exclude flight, booking and click identifiers', () => {
    const app = boot();
    app.handlers['[data-allow]']();
    app.window.gtag('event', 'flight_search_success', { arrival_airport: 'DXB', flight_number: 'EK32', booking_reference: 'PRIVATE-BOOKING' });
    app.window.gtag('event', 'search', { search_term: 'EK32' });
    const serialized = JSON.stringify(app.commands());
    for (const privateValue of ['EK32', 'PRIVATE-BOOKING', 'PRIVATE-CLICK-ID', 'person@example.com', 'PRIVATE-REFERRER']) assert.equal(serialized.includes(privateValue), false);
    const config = app.commands().find(command => command[0] === 'config')[2];
    assert.equal(new URL(config.page_location).searchParams.get('utm_campaign'), 'dubai_arrivals_test');
    assert.equal(config.page_referrer, 'https://example.com/ref');
    assert.equal(app.events().find(event => event[1] === 'flight_search_success')[2].arrival_airport, 'DXB');
});

test('internal navigation retains campaign labels without copying flight or unique IDs', () => {
    const app = boot();
    const url = new URL(app.internal.href);
    assert.equal(url.searchParams.get('utm_campaign'), 'dubai_arrivals_test');
    assert.equal(url.searchParams.get('utm_source'), 'google');
    assert.equal(url.searchParams.has('flight'), false);
    assert.equal(url.searchParams.has('gclid'), false);
    assert.equal(app.external.href, 'https://www.airalo.com/');
});

test('declining analytics preserves site use without loading Google', () => {
    const app = boot();
    app.handlers['[data-decline]']();
    assert.equal(app.externalScripts.length, 0);
    assert.equal(app.banner.hidden, true);
    assert.equal(JSON.parse(app.storage.get('airportguide_analytics_consent_v1')).allowed, false);
    app.window.AirportGuideAnalytics.showSettings();
    assert.equal(app.banner.hidden, false);
});

test('returning consenting visitors get one Dubai guide view', () => {
    const app = boot({ saved: { allowed: true, at: Date.now() }, guide: 'dubai' });
    assert.equal(app.externalScripts.length, 1);
    assert.equal(app.events().filter(event => event[1] === 'destination_guide_view').length, 1);
    assert.equal(app.banner.hidden, true);
});

test('expired consent does not start analytics', () => {
    const app = boot({ saved: { allowed: true, at: Date.now() - 181 * 86400000 } });
    assert.equal(app.externalScripts.length, 0);
    assert.equal(app.banner.hidden, false);
});

test('withdrawal deletes analytics cookies and reloads to stop the loaded tag', () => {
    const app = boot({ saved: { allowed: true, at: Date.now() } });
    app.handlers['[data-decline]']();
    assert.equal(app.reloads(), 1);
    assert.ok(app.cookieWrites.some(value => value.startsWith('_ga=;')));
    assert.equal(app.cookieWrites.some(value => value.startsWith('preference=')), false);
    assert.equal(JSON.parse(app.storage.get('airportguide_analytics_consent_v1')).allowed, false);
});

test('preview visits never load the production Google tag or pollute reports', () => {
    const app = boot({ hostname: 'preview.invalid' });
    app.handlers['[data-allow]']();
    app.window.gtag('event', 'affiliate_click', { provider: 'airalo' });
    assert.equal(app.externalScripts.length, 0);
    assert.equal(app.events().length, 0);
});

test('blocked browser storage cannot break consent choices', () => {
    const app = boot({ brokenStorage: true });
    assert.doesNotThrow(() => app.handlers['[data-allow]']());
    assert.equal(app.externalScripts.length, 1);
});

test('partner clicks cannot masquerade as purchases or revenue', () => {
    const app = boot({ saved: { allowed: true, at: Date.now() } });
    assert.equal(app.window.AirportGuideAnalytics.track('purchase', { revenue: 100 }), false);
    assert.equal(app.events().length, 0);
});

test('all public pages use the same loader without an unconditional Google or Drive tag', () => {
    for (const path of ['index.html', 'guides/dubai/index.html', 'privacy/index.html']) {
        const html = readFileSync(join(__dirname, '..', path), 'utf8');
        assert.match(html, /src="\/assets\/analytics\.js(?:\?v=[a-z0-9-]+)?"/);
        assert.doesNotMatch(html, /<script[^>]+src="https:\/\/www\.googletagmanager/);
        assert.doesNotMatch(html, /tp-em\.com/);
        assert.match(html, /data-cookie-settings/);
    }
});

test('the actual partner click handler reaches the Google queue only after consent', () => {
    const app = boot({ guide: 'dubai', loadPartners: true });
    app.clickPartner();
    assert.equal(app.events().length, 0);
    assert.match(app.partner.href, /subId1=ag_dubai_guide_dxb_dubai_test/);
    app.handlers['[data-allow]']();
    app.clickPartner();
    const affiliate = app.events().filter(event => event[1] === 'affiliate_click');
    assert.equal(affiliate.length, 1);
    assert.equal(affiliate[0][2].provider, 'airalo');
    assert.equal(affiliate[0][2].partner_sub_id, 'ag_dubai_guide_dxb_dubai_test');
    assert.equal(affiliate[0][2].arrival_airport, 'DXB');
    assert.equal(app.events().filter(event => event[1] === 'destination_guide_view').length, 1);
    assert.equal(app.events().filter(event => event[1] === 'click_esim').length, 1);
});
