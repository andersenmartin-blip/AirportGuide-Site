/* Optional analytics. Flight lookup and partner navigation never depend on it. */
(function () {
    'use strict';
    const MEASUREMENT_ID = 'G-YYW1KW4CGN';
    const CONSENT_KEY = 'airportguide_analytics_consent_v1';
    const CONSENT_AGE = 180 * 24 * 60 * 60 * 1000;
    const production = ['airportguideapp.com', 'www.airportguideapp.com'].includes(location.hostname);
    const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    const eventNames = new Set(['flight_search_started', 'flight_search_success', 'flight_search_failed', 'boarding_pass_read', 'share_flight', 'destination_guide_view', 'destination_guide_click', 'offer_impression', 'affiliate_click', 'outbound_click', 'click_esim', 'click_taxi', 'click_airhelp', 'click_tours']);
    const campaign = {};
    new URL(location.href).searchParams.forEach((value, key) => {
        // Do not copy arbitrary query strings, click IDs, boarding-pass data or
        // flight numbers into partner reports or internal navigation.
        if (campaignKeys.includes(key) && /^[a-z0-9_-]{1,80}$/i.test(value)) campaign[key] = value.toLowerCase();
    });
    let choice = null;
    let loaded = false;
    let banner;
    let previousFocus;
    try {
        const saved = JSON.parse(localStorage.getItem(CONSENT_KEY));
        if (saved && typeof saved.allowed === 'boolean' && saved.at <= Date.now() && Date.now() - saved.at < CONSENT_AGE) choice = saved.allowed;
    } catch (_) {}

    function command() { window.dataLayer.push(arguments); }

    function pageLocation() {
        const url = new URL(location.origin + location.pathname);
        Object.entries(campaign).forEach(([key, value]) => url.searchParams.set(key, value));
        return url.href;
    }

    function track(name, parameters = {}) {
        if (choice !== true || !production || !loaded || !eventNames.has(name)) return false;
        // These events are deliberately aggregate. Never send a flight number,
        // a name, a booking reference, a file name or a boarding pass.
        const allowed = ['provider', 'placement', 'arrival_airport', 'monetized', 'guide', 'method', 'file_type', 'reason', 'partner_sub_id', 'event_category'];
        const safe = {};
        Object.entries(parameters).forEach(([key, value]) => {
            if (allowed.includes(key) && (typeof value === 'boolean' || (typeof value === 'string' && /^[a-z0-9_-]{1,100}$/i.test(value)))) safe[key] = value;
        });
        command('event', name, safe);
        return true;
    }

    function start() {
        if (loaded || choice !== true || !production) return;
        loaded = true;
        window.dataLayer = window.dataLayer || [];
        command('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
        command('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
        command('js', new Date());
        const config = { page_location: pageLocation(), allow_google_signals: false, allow_ad_personalization_signals: false };
        try {
            const referrer = new URL(document.referrer);
            config.page_referrer = referrer.origin + referrer.pathname;
        } catch (_) { config.page_referrer = ''; }
        command('config', MEASUREMENT_ID, config);
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
        document.head.appendChild(script);
        if (document.body.dataset.guide === 'dubai') track('destination_guide_view', { guide: 'dubai', arrival_airport: 'DXB' });
        document.dispatchEvent(new Event('airportguide:analytics-ready'));
    }

    function deleteAnalyticsCookies() {
        const names = document.cookie.split(';').map(part => part.split('=')[0].trim()).filter(name => /^_ga(?:_|$)|^_gid$|^_gat/.test(name));
        for (const name of names) {
            for (const domain of ['', location.hostname, '.' + location.hostname, 'airportguideapp.com', '.airportguideapp.com']) {
                document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ' domain=' + domain + ';' : ''} SameSite=Lax`;
            }
        }
    }

    function choose(allowed) {
        const wasLoaded = loaded;
        choice = allowed;
        try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ allowed, at: Date.now() })); } catch (_) {}
        if (banner) banner.hidden = true;
        previousFocus?.focus();
        if (allowed) start();
        else {
            deleteAnalyticsCookies();
            // Reload after withdrawal to remove Google's already loaded code.
            if (wasLoaded) location.reload();
        }
    }

    function showSettings() {
        if (!banner) return;
        previousFocus = document.activeElement;
        banner.hidden = false;
        banner.querySelector('button').focus();
    }

    function boot() {
        banner = document.createElement('section');
        banner.className = 'ag-consent';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-labelledby', 'ag-consent-title');
        banner.innerHTML = '<div><h2 id="ag-consent-title">Help us improve Airport Guide</h2><p>May we use Google Analytics to measure visits and travel-link clicks? Your flight search works either way. <a href="/privacy/">Privacy &amp; cookies</a></p></div><div class="ag-consent-actions"><button type="button" data-allow>Allow analytics</button><button type="button" data-decline>Use without analytics</button></div>';
        banner.hidden = choice !== null;
        banner.querySelector('[data-allow]').addEventListener('click', () => choose(true));
        banner.querySelector('[data-decline]').addEventListener('click', () => choose(false));
        document.body.appendChild(banner);
        document.querySelectorAll('[data-cookie-settings]').forEach(button => button.addEventListener('click', showSettings));
        start();
    }

    function decorateInternalLinks() {
        document.querySelectorAll('a[href]').forEach(link => {
            try {
                const url = new URL(link.getAttribute('href'), location.href);
                if (url.origin !== location.origin || !['/', '/guides/dubai/'].includes(url.pathname)) return;
                if ((link.getAttribute('href') || '').startsWith('#')) return;
                Object.entries(campaign).forEach(([key, value]) => url.searchParams.set(key, value));
                link.href = url.href;
            } catch (_) {}
        });
    }

    window.AirportGuideAnalytics = Object.freeze({ track, campaign: Object.freeze(campaign), showSettings });
    // Backwards-compatible entry point for the existing app events. Commands
    // other than aggregate events are private to this consent-aware loader.
    window.gtag = function (type, name, parameters) {
        if (type !== 'event') return;
        if (name === 'search') return track('flight_search_started', { method: 'manual' });
        return track(name, parameters);
    };
    decorateInternalLinks();
    boot();
})();
