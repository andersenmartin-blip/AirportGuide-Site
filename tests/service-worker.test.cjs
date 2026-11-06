const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const source = readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8');

function worker() {
    const handlers = {};
    const cached = new Map();
    let offline = false;
    const origin = 'https://airportguideapp.com';
    const key = input => new URL(typeof input === 'string' ? input : input.url, origin + '/').href;
    const caches = {
        open: async () => ({ put: async (request, response) => cached.set(key(request), response) }),
        match: async request => cached.get(key(request))
    };
    const self = { location: { origin }, addEventListener: (name, handler) => { handlers[name] = handler; } };
    const fetch = async request => {
        if (offline) throw new Error('Offline');
        return new Response(new URL(request.url).pathname === '/guides/dubai/' ? 'Dubai guide' : 'Flight search');
    };
    runInNewContext(source, { self, caches, fetch, URL, Response });
    return {
        offline: () => { offline = true; },
        async request(path, mode = 'navigate') {
            let response;
            const pending = [];
            handlers.fetch({
                request: { url: new URL(path, origin + '/').href, method: 'GET', mode },
                respondWith: promise => { response = promise; },
                waitUntil: promise => pending.push(promise)
            });
            if (!response) return null;
            const result = await response;
            await Promise.all(pending);
            return result;
        }
    };
}

test('the Dubai guide cannot overwrite the flight-search page in the offline cache', async () => {
    const sw = worker();
    await sw.request('/?flight=SK943');
    await sw.request('/guides/dubai/');
    sw.offline();
    assert.equal(await (await sw.request('/?flight=EK152')).text(), 'Flight search');
    assert.equal(await (await sw.request('/guides/dubai/')).text(), 'Dubai guide');
});

test('an unknown offline URL does not silently show the wrong guide', async () => {
    const sw = worker();
    sw.offline();
    const response = await sw.request('/guides/unknown/');
    assert.equal(response.type, 'error');
});

test('flight API requests are never fulfilled from this service-worker cache', async () => {
    const sw = worker();
    assert.equal(await sw.request('https://flightcard-api.andersen-martin.workers.dev/?flight=SK943', 'cors'), null);
});
