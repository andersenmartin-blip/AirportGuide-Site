const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const guidesHubHtml = readFileSync(join(root, 'guides/index.html'), 'utf8');
const dubaiHtml = readFileSync(join(root, 'guides/dubai/index.html'), 'utf8');
const jfkHtml = readFileSync(join(root, 'guides/jfk/index.html'), 'utf8');
const bangkokHtml = readFileSync(join(root, 'guides/bangkok/index.html'), 'utf8');
const tokyoHtml = readFileSync(join(root, 'guides/tokyo/index.html'), 'utf8');
const istanbulHtml = readFileSync(join(root, 'guides/istanbul/index.html'), 'utf8');
const cancunHtml = readFileSync(join(root, 'guides/cancun/index.html'), 'utf8');
const marrakechHtml = readFileSync(join(root, 'guides/marrakech/index.html'), 'utf8');
const antalyaHtml = readFileSync(join(root, 'guides/antalya/index.html'), 'utf8');
const aboutHtml = readFileSync(join(root, 'about/index.html'), 'utf8');
const privacyHtml = readFileSync(join(root, 'privacy/index.html'), 'utf8');
const sitemapXml = readFileSync(join(root, 'sitemap.xml'), 'utf8');

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        add: (...names) => names.forEach(n => set.add(n)),
        remove: (...names) => names.forEach(n => set.delete(n)),
        toggle: (name, force) => {
            const shouldAdd = force === undefined ? !set.has(name) : Boolean(force);
            if (shouldAdd) set.add(name);
            else set.delete(name);
            return shouldAdd;
        },
        contains: name => set.has(name)
    };
}

function makeElement(id, hidden = false) {
    const children = [];
    return {
        id,
        textContent: '',
        innerHTML: '',
        className: '',
        href: '',
        placeholder: '',
        value: '',
        open: false,
        style: {},
        dataset: {},
        children,
        classList: makeClassList(hidden ? ['hidden'] : []),
        appendChild(child) {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            children.push(child);
            return child;
        },
        setAttribute() {},
        focus() {}
    };
}

function bootPopulateCard() {
    const start = indexHtml.indexOf('        function populateCard(f) {');
    const end = indexHtml.indexOf('        function showToast(', start);
    const code = indexHtml.slice(start, end);

    const hiddenIds = new Set(['weatherContainer', 'cardAirhelp', 'cardEsim', 'cardTaxi', 'cardTours', 'arrivalGuide', 'secondaryTools']);
    const elements = new Map();
    const getEl = id => {
        if (!elements.has(id)) elements.set(id, makeElement(id, hiddenIds.has(id)));
        return elements.get(id);
    };

    const toolkit = getEl('toolkitContainer');
    ['cardAirhelp', 'cardEsim', 'cardTaxi', 'arrivalGuide', 'secondaryTools'].forEach(id => toolkit.appendChild(getEl(id)));

    const document = {
        body: { dataset: {} },
        getElementById: id => getEl(id)
    };

    const populateCard = runInNewContext(`${code}\npopulateCard;`, {
        document,
        airportDb: {
            LHR: { city: 'London', country: 'United Kingdom', lat: 51.47, lng: -0.45 },
            DXB: { city: 'Dubai', country: 'United Arab Emirates', lat: 25.25, lng: 55.36 },
            JFK: { city: 'New York', country: 'United States', lat: 40.64, lng: -73.78 },
            BKK: { city: 'Bangkok', country: 'Thailand', lat: 13.69, lng: 100.75 },
            HND: { city: 'Tokyo', country: 'Japan', lat: 35.55, lng: 139.78 },
            NRT: { city: 'Tokyo', country: 'Japan', lat: 35.76, lng: 140.39 },
            IST: { city: 'Istanbul', country: 'Turkey', lat: 41.27, lng: 28.75 },
            SAW: { city: 'Istanbul', country: 'Turkey', lat: 40.90, lng: 29.31 },
            CUN: { city: 'Cancún', country: 'Mexico', lat: 21.04, lng: -86.88 },
            RAK: { city: 'Marrakech', country: 'Morocco', lat: 31.61, lng: -8.04 },
            AYT: { city: 'Antalya', country: 'Turkey', lat: 36.90, lng: 30.80 },
            CPH: { city: 'Copenhagen', country: 'Denmark', lat: 55.61, lng: 12.65 }
        },
        getWeather() {},
        localAirportTimeToUtc: () => null,
        Intl,
        Date
    });

    return { populateCard, getEl, document, toolkit };
}

test('normal flights show eSIM and Taxi at the top while keeping AirHelp hidden', () => {
    const { populateCard, getEl, toolkit } = bootPopulateCard();
    populateCard({
        flight_number: 'SK943',
        airline_iata: 'SK',
        dep_iata: 'CPH',
        arr_iata: 'LHR',
        departure_time: '2026-11-14 10:00',
        arrival_time: '2026-11-14 11:10',
        terminal: '2',
        gate: 'C32',
        arr_gate: 'B12',
        baggage_belt: '4',
        status: 'scheduled',
        delay_mins: 45
    });

    assert.equal(getEl('cardAirhelp').classList.contains('hidden'), true);
    assert.equal(getEl('cardEsim').classList.contains('hidden'), false);
    assert.equal(getEl('cardTaxi').classList.contains('hidden'), false);
    assert.equal(toolkit.children[0].id, 'cardEsim');
    assert.equal(toolkit.children[1].id, 'cardTaxi');
});

test('flights delayed 3+ hours or cancelled prioritize AirHelp at #1 above eSIM and Taxi', () => {
    const { populateCard, getEl, toolkit } = bootPopulateCard();
    populateCard({
        flight_number: 'EK2',
        airline_iata: 'EK',
        dep_iata: 'LHR',
        arr_iata: 'DXB',
        departure_time: '2026-11-14 14:00',
        arrival_time: '2026-11-15 01:00',
        terminal: '3',
        gate: 'A10',
        arr_gate: 'B4',
        baggage_belt: '7',
        status: 'scheduled',
        delay_mins: 185
    });

    assert.equal(getEl('cardAirhelp').classList.contains('hidden'), false);
    assert.equal(getEl('cardEsim').classList.contains('hidden'), false);
    assert.equal(getEl('cardTaxi').classList.contains('hidden'), false);
    assert.equal(toolkit.children[0].id, 'cardAirhelp');
    assert.equal(toolkit.children[1].id, 'cardEsim');
    assert.equal(toolkit.children[2].id, 'cardTaxi');
});

test('DXB arrivals get concrete arrival copy and softer CTA labels, and non-DXB flights reset cleanly', () => {
    const { populateCard, getEl } = bootPopulateCard();
    populateCard({
        flight_number: 'BA107',
        airline_iata: 'BA',
        dep_iata: 'LHR',
        arr_iata: 'DXB',
        departure_time: '2026-11-14 12:45',
        arrival_time: '2026-11-14 23:50',
        terminal: '5',
        gate: 'B36',
        arr_gate: 'D8',
        baggage_belt: '3',
        status: 'en-route',
        delay_mins: 0
    });

    assert.equal(getEl('esimTitle').textContent, 'UAE eSIM for Dubai Arrival');
    assert.equal(getEl('esimCtaText').textContent, 'Check UAE eSIM plans');
    assert.equal(getEl('taxiTitle').textContent, 'DXB Transfer to Your Hotel');
    assert.equal(getEl('taxiCtaText').textContent, 'See fixed DXB taxi prices');
    assert.equal(getEl('arrivalGuide').classList.contains('hidden'), false);

    // Subsequent non-DXB flight resets back to generic copy
    populateCard({
        flight_number: 'SK501',
        airline_iata: 'SK',
        dep_iata: 'CPH',
        arr_iata: 'LHR',
        departure_time: '2026-11-14 08:00',
        arrival_time: '2026-11-14 09:10',
        terminal: '3',
        gate: 'C10',
        arr_gate: 'A4',
        baggage_belt: '2',
        status: 'scheduled',
        delay_mins: 0
    });

    assert.match(getEl('esimTitle').textContent, /United Kingdom/);
    assert.equal(getEl('esimCtaText').textContent, 'Compare eSIM plans');
    assert.match(getEl('taxiTitle').textContent, /London/);
    assert.equal(getEl('taxiCtaText').textContent, 'Pre-Book Taxi');
    assert.equal(getEl('arrivalGuide').classList.contains('hidden'), true);
});

test('dest=DXB context and resetSearch preserve campaign parameters while clearing flight', () => {
    const start = indexHtml.indexOf('        function applyDestinationContext(');
    const end = indexHtml.indexOf('        searchForm.addEventListener(', start);
    const code = indexHtml.slice(start, end);

    const elements = new Map();
    const getEl = id => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };
    const location = {
        href: 'https://airportguideapp.com/?flight=EK2&dest=DXB&utm_source=google&utm_medium=cpc&utm_campaign=dubai_arrivals_test',
        pathname: '/'
    };
    let replacedUrl = '';
    const window = {};
    const document = {
        body: { dataset: {} },
        getElementById: id => getEl(id)
    };

    runInNewContext(`${code}\nwindow.applyDestinationContext = applyDestinationContext;`, {
        window,
        document,
        location,
        history: { replaceState: (_s, _t, url) => { replacedUrl = url; } },
        URL,
        resultView: getEl('resultView'),
        searchView: getEl('searchView'),
        flightInput: getEl('flightInput'),
        errorMsg: getEl('errorMsg'),
        clearUploadedBoardingPass() {},
        hideBoardingPassStatus() {}
    });

    window.resetSearch();
    assert.equal(replacedUrl, '/?dest=DXB&utm_source=google&utm_medium=cpc&utm_campaign=dubai_arrivals_test');
    assert.equal(document.body.dataset.arrivalAirport, 'DXB');
    assert.match(getEl('searchSubtitle').textContent, /Dubai \(DXB\)/);

    window.applyDestinationContext('JFK');
    assert.equal(document.body.dataset.arrivalAirport, 'JFK');
    assert.match(getEl('searchSubtitle').textContent, /New York \(JFK\)/);

    window.applyDestinationContext('BKK');
    assert.equal(document.body.dataset.arrivalAirport, 'BKK');
    assert.match(getEl('searchSubtitle').textContent, /Bangkok \(BKK\)/);

    window.applyDestinationContext('TYO');
    assert.equal(document.body.dataset.arrivalAirport, 'TYO');
    assert.match(getEl('searchSubtitle').textContent, /Tokyo/);

    window.applyDestinationContext('IST');
    assert.equal(document.body.dataset.arrivalAirport, 'IST');
    assert.match(getEl('searchSubtitle').textContent, /Istanbul Airport \(IST\)/);

    window.applyDestinationContext('SAW');
    assert.equal(document.body.dataset.arrivalAirport, 'SAW');
    assert.match(getEl('searchSubtitle').textContent, /Sabiha Gökçen \(SAW\)/);

    window.applyDestinationContext('CUN');
    assert.equal(document.body.dataset.arrivalAirport, 'CUN');
    assert.match(getEl('searchSubtitle').textContent, /Cancún \(CUN\)/);

    window.applyDestinationContext('RAK');
    assert.equal(document.body.dataset.arrivalAirport, 'RAK');
    assert.match(getEl('searchSubtitle').textContent, /Marrakech Menara \(RAK\)/);

    window.applyDestinationContext('AYT');
    assert.equal(document.body.dataset.arrivalAirport, 'AYT');
    assert.match(getEl('searchSubtitle').textContent, /Antalya \(AYT\)/);
});

test('Dubai guide embedded flight form normalizes flight numbers and preserves Google Ads campaign params', () => {
    const scriptStart = dubaiHtml.lastIndexOf('<script>');
    const scriptEnd = dubaiHtml.lastIndexOf('</script>');
    const inlineJs = dubaiHtml.slice(scriptStart + '<script>'.length, scriptEnd);

    let submitHandler;
    const input = { value: ' ek 002 ', focus() {} };
    const error = { hidden: true, textContent: '' };
    const form = { addEventListener: (type, fn) => { if (type === 'submit') submitHandler = fn; } };
    const location = { origin: 'https://airportguideapp.com', href: 'https://airportguideapp.com/guides/dubai/' };
    const window = {
        AirportGuideAnalytics: {
            campaign: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'dubai_arrivals_test' }
        }
    };
    const document = {
        getElementById: id => id === 'dxbFlightForm' ? form : id === 'dxbFlightInput' ? input : id === 'dxbFlightError' ? error : null
    };

    runInNewContext(inlineJs, { window, document, location, URL });
    submitHandler({ preventDefault() {} });

    const redirected = new URL(location.href);
    assert.equal(redirected.pathname, '/');
    assert.equal(redirected.searchParams.get('flight'), 'EK2');
    assert.equal(redirected.searchParams.get('dest'), 'DXB');
    assert.equal(redirected.searchParams.get('utm_campaign'), 'dubai_arrivals_test');
});

test('Dubai guide, front page, footer, boarding pass copy and sitemap meet Google Ads & affiliate rules', () => {
    // Partner links & softer CTAs on Dubai guide
    assert.match(dubaiHtml, /href="https:\/\/airalo\.pxf\.io\/KB66v9"[^>]*data-provider="airalo"[^>]*data-placement="dubai_guide"/);
    assert.match(dubaiHtml, /href="https:\/\/kiwitaxi\.tpo\.mx\/RyxrAcPa"[^>]*data-provider="kiwitaxi"[^>]*data-placement="dubai_guide"/);
    assert.match(dubaiHtml, /Check UAE eSIM plans →/);
    assert.match(dubaiHtml, /See fixed DXB taxi prices →/);

    // Taxi card is placed in transport section before mobile-data section
    assert.ok(dubaiHtml.indexOf('kiwitaxi.tpo.mx/RyxrAcPa') < dubaiHtml.indexOf('id="mobile-data"'));

    // Front page live examples, visible Dubai guide link, and 100% local browser boarding-pass statement
    for (const example of ['EK002', 'BA107', 'EK032']) {
        assert.match(indexHtml, new RegExp(`data-example-flight="${example}"`));
    }
    assert.match(indexHtml, /id="frontDubaiGuide"[^>]*href="\/guides\/dubai\/"[^>]*data-guide-link[^>]*data-placement="search"/);
    assert.match(indexHtml, /Processed 100% locally in your browser/);

    // Footer links (Arrival Guides + About + Privacy) across all 12 public pages
    for (const html of [
        indexHtml,
        guidesHubHtml,
        dubaiHtml,
        jfkHtml,
        bangkokHtml,
        tokyoHtml,
        istanbulHtml,
        cancunHtml,
        marrakechHtml,
        antalyaHtml,
        aboutHtml,
        privacyHtml
    ]) {
        assert.match(html, /href="\/guides\/"/);
        assert.match(html, /href="\/about\/"/);
        assert.match(html, /href="\/privacy\/"/);
    }

    // Sitemap includes all canonical public URLs
    for (const url of [
        'https://airportguideapp.com/',
        'https://airportguideapp.com/guides/',
        'https://airportguideapp.com/guides/dubai/',
        'https://airportguideapp.com/guides/jfk/',
        'https://airportguideapp.com/guides/bangkok/',
        'https://airportguideapp.com/guides/tokyo/',
        'https://airportguideapp.com/guides/istanbul/',
        'https://airportguideapp.com/guides/cancun/',
        'https://airportguideapp.com/guides/marrakech/',
        'https://airportguideapp.com/guides/antalya/',
        'https://airportguideapp.com/about/',
        'https://airportguideapp.com/privacy/'
    ]) {
        assert.ok(sitemapXml.includes(`<loc>${url}</loc>`), url);
    }
});

test('all destination airport arrivals surface the matching arrival guide and tailored card copy', () => {
    const { populateCard, getEl } = bootPopulateCard();
    for (const [arrIata, expectedHref, expectedGuide, expectedTitle, expectedEsim, expectedTaxi] of [
        ['JFK', '/guides/jfk/', 'jfk', 'Arriving at New York (JFK)?', 'US eSIM for New York Arrival', 'JFK Transfer to Manhattan'],
        ['BKK', '/guides/bangkok/', 'bangkok', 'Arriving at Bangkok (BKK)?', 'Thailand eSIM for Bangkok Arrival', 'BKK Transfer to Your Hotel'],
        ['HND', '/guides/tokyo/', 'tokyo', 'Arriving at Tokyo Haneda (HND)?', 'Japan eSIM for Tokyo Arrival', 'Haneda (HND) Hotel Transfer'],
        ['NRT', '/guides/tokyo/', 'tokyo', 'Arriving at Tokyo Narita (NRT)?', 'Japan eSIM for Tokyo Arrival', 'Narita (NRT) Transfer to Tokyo'],
        ['IST', '/guides/istanbul/', 'istanbul', 'Arriving at Istanbul (IST)?', 'Turkey eSIM for Istanbul Arrival', 'IST Transfer to Central Istanbul'],
        ['SAW', '/guides/istanbul/', 'istanbul', 'Arriving at Istanbul Sabiha Gökçen (SAW)?', 'Turkey eSIM for Istanbul Arrival', 'SAW Transfer to Central Istanbul'],
        ['CUN', '/guides/cancun/', 'cancun', 'Arriving at Cancún (CUN)?', 'Mexico eSIM for Cancún Arrival', 'CUN Transfer to Your Resort'],
        ['RAK', '/guides/marrakech/', 'marrakech', 'Arriving at Marrakech (RAK)?', 'Morocco eSIM for Marrakech Arrival', 'RAK Transfer to Your Riad or Hotel'],
        ['AYT', '/guides/antalya/', 'antalya', 'Arriving at Antalya (AYT)?', 'Turkey eSIM for Antalya Arrival', 'AYT Resort Transfer (Lara/Belek/Side)']
    ]) {
        populateCard({
            flight_number: 'BA99',
            airline_iata: 'BA',
            dep_iata: 'LHR',
            arr_iata: arrIata,
            departure_time: '2026-11-22 10:00',
            arrival_time: '2026-11-22 16:00',
            terminal: '5',
            gate: 'B1',
            arr_gate: '12',
            baggage_belt: '3',
            status: 'scheduled',
            delay_mins: 0
        });
        assert.equal(getEl('arrivalGuide').classList.contains('hidden'), false);
        assert.equal(getEl('arrivalGuide').href, expectedHref);
        assert.equal(getEl('arrivalGuide').dataset.guide, expectedGuide);
        assert.equal(getEl('arrivalGuideTitle').textContent, expectedTitle);
        assert.equal(getEl('esimTitle').textContent, expectedEsim);
        assert.equal(getEl('taxiTitle').textContent, expectedTaxi);
    }

    // Non-guide airport resets cleanly
    populateCard({
        flight_number: 'SK501',
        airline_iata: 'SK',
        dep_iata: 'CPH',
        arr_iata: 'LHR',
        departure_time: '2026-11-22 08:00',
        arrival_time: '2026-11-22 09:10',
        terminal: '3',
        gate: 'C10',
        arr_gate: 'A4',
        baggage_belt: '2',
        status: 'scheduled',
        delay_mins: 0
    });
    assert.equal(getEl('arrivalGuide').classList.contains('hidden'), true);
});

test('guides hub and destination guides keep valid canonicals, verified deep links and flight forms', () => {
    for (const [html, canonical, formId, inputId, errorId, sampleInput, normalizedFlight, expectedDest, airaloPath, kiwitaxiPath, placement] of [
        [jfkHtml, 'https://airportguideapp.com/guides/jfk/', 'jfkFlightForm', 'jfkFlightInput', 'jfkFlightError', ' ba 0175 ', 'BA175', 'JFK', 'Jknr97', '1hDpZYlL', 'jfk_guide'],
        [bangkokHtml, 'https://airportguideapp.com/guides/bangkok/', 'bkkFlightForm', 'bkkFlightInput', 'bkkFlightError', ' tg 0911 ', 'TG911', 'BKK', 'B5gXNW', 'yBxchSrN', 'bangkok_guide'],
        [tokyoHtml, 'https://airportguideapp.com/guides/tokyo/', 'tokyoFlightForm', 'tokyoFlightInput', 'tokyoFlightError', ' ba 007 ', 'BA7', 'TYO', '0GqJgE', 'tjgnYPpx', 'tokyo_guide'],
        [istanbulHtml, 'https://airportguideapp.com/guides/istanbul/', 'istanbulFlightForm', 'istanbulFlightInput', 'istanbulFlightError', ' tk 01980 ', 'TK1980', 'IST', 'n4M1q9', 'Rz0XEDHl', 'istanbul_guide'],
        [cancunHtml, 'https://airportguideapp.com/guides/cancun/', 'cancunFlightForm', 'cancunFlightInput', 'cancunFlightError', ' ba 02203 ', 'BA2203', 'CUN', 'GbWjP9', 'egoulI9f', 'cancun_guide'],
        [marrakechHtml, 'https://airportguideapp.com/guides/marrakech/', 'marrakechFlightForm', 'marrakechFlightInput', 'marrakechFlightError', ' ba 02662 ', 'BA2662', 'RAK', 'Jknre7', '48Erupjb', 'marrakech_guide'],
        [antalyaHtml, 'https://airportguideapp.com/guides/antalya/', 'antalyaFlightForm', 'antalyaFlightInput', 'antalyaFlightError', ' ba 02774 ', 'BA2774', 'AYT', 'n4M1q9', 'PIKhZZGL', 'antalya_guide']
    ]) {
        assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`), canonical);
        assert.match(html, new RegExp(`href="https://airalo\\.pxf\\.io/${airaloPath}"[^>]*data-provider="airalo"[^>]*data-placement="${placement}"`));
        assert.match(html, new RegExp(`href="https://kiwitaxi\\.tpo\\.mx/${kiwitaxiPath}"[^>]*data-provider="kiwitaxi"[^>]*data-placement="${placement}"`));

        const scriptStart = html.lastIndexOf('<script>');
        const scriptEnd = html.lastIndexOf('</script>');
        const inlineJs = html.slice(scriptStart + '<script>'.length, scriptEnd);
        let submitHandler;
        const input = { value: sampleInput, focus() {} };
        const error = { hidden: true, textContent: '' };
        const form = { addEventListener: (type, fn) => { if (type === 'submit') submitHandler = fn; } };
        const location = { origin: 'https://airportguideapp.com', href: canonical };
        const window = { AirportGuideAnalytics: { campaign: { utm_source: 'organic', utm_medium: 'test' } } };
        const document = {
            getElementById: id => id === formId ? form : id === inputId ? input : id === errorId ? error : null
        };
        runInNewContext(inlineJs, { window, document, location, URL });
        submitHandler({ preventDefault() {} });
        const redirected = new URL(location.href);
        assert.equal(redirected.pathname, '/');
        assert.equal(redirected.searchParams.get('flight'), normalizedFlight);
        assert.equal(redirected.searchParams.get('dest'), expectedDest);
        assert.equal(redirected.searchParams.get('utm_source'), 'organic');
    }

    assert.ok(guidesHubHtml.includes('<link rel="canonical" href="https://airportguideapp.com/guides/">'));
    for (const path of [
        '/guides/dubai/',
        '/guides/jfk/',
        '/guides/bangkok/',
        '/guides/tokyo/',
        '/guides/istanbul/',
        '/guides/cancun/',
        '/guides/marrakech/',
        '/guides/antalya/'
    ]) {
        assert.ok(guidesHubHtml.includes(`href="${path}"`), path);
    }
});
