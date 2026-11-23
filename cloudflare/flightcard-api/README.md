# flightcard-api Cloudflare Worker

`worker.js` powers `https://flightcard-api.andersen-martin.workers.dev` and combines AirLabs and AeroDataBox data while keeping both free-tier API quotas safe (`quota-saver-2026-11-23`).

## Quota-saver design (`quota-saver-2026-11-23`)

Measured live usage on 23 November 2026 showed why quota protection is critical:
- **RapidAPI / AeroDataBox (`BASIC` plan):** `600` API Units/month where `/flights/number/{flight}/{date}` consumes `2` API Units per call = **`300` real AeroDataBox lookups/month**.
- **AirLabs (`Free` plan):** `1,000` API requests/month.

To stretch both free tiers roughly 3–10× without degrading live gate accuracy:
1. **Smart AeroDataBox fallback (`needsAeroFallback`):** AirLabs runs first (`~227 ms` avg). AeroDataBox is called **only** when AirLabs fails/is empty, is missing `dep_gate` or `dep_terminal`, or shows an `en-route`/`landed` flight missing both `arr_gate` and `arr_baggage`. When AirLabs already supplies complete fields, AeroDataBox is skipped (`aerodatabox.state: "skipped_sufficient"`). AeroDataBox retains priority for usable fields whenever it is called, and placeholder values never erase AirLabs data.
2. **Isolate memory cache + HTTP `Cache-Control` + optional Custom Domain edge cache:** Repeats for the same canonical flight share a bounded 200-entry Worker memory cache (`X-Cache: HIT`) plus HTTP `Cache-Control`: `180 s` (3 min) for active/scheduled flights, `1800 s` (30 min) for `landed`/`cancelled`, and `120 s` (2 min) for clean `404`s. `502`/`500` errors use `Cache-Control: no-store` and are never cached. `caches.default` is also attempted automatically (becomes globally shared across Cloudflare PoPs if the Worker is later bound to a Custom Domain such as `api.airportguideapp.com`; safely no-ops on `*.workers.dev`).
3. **Origin allowlist (`resolveOrigin`):** Rejects unknown `Origin` headers with HTTP `403` before making any paid upstream API call. Allows `https://airportguideapp.com`, `https://www.airportguideapp.com`, and `http://localhost` / `127.0.0.1` (optional port) with `Vary: Origin`. Direct curl/API calls without an `Origin` header remain testable.
4. **Redacted `debug=1` on errors too:** Opening `?flight=BA107&debug=1` exposes `airlabs` and `aerodatabox` states (`ok`, `empty`, `timeout`, `http_429`, `skipped_sufficient`, `cache`) even on `404`/`502` responses without ever leaking secrets.
5. **Frontend `sessionStorage` cache (`index.html`):** Caches valid flight cards per browser session (`3` min live / `30` min landed or cancelled) so back/forward clicks and repeated lookups avoid hitting the Worker at all.

## Deploy to the EXISTING Cloudflare Worker

1. Open **Workers & Pages → flightcard-api → Edit code** in Cloudflare (`https://dash.cloudflare.com/`).
2. Keep a backup copy of the current Worker script for rollback. Replace the editor contents with all of `worker.js`.
3. Keep the existing `AIRLABS_KEY` and `AERO_API_KEY` secret bindings. Their values belong in Cloudflare, never in this repository.
4. Click **Deploy** (a GitHub Pages deploy updates `index.html`, not the Cloudflare Worker).
5. Verify live:
   - `https://flightcard-api.andersen-martin.workers.dev/?flight=EK002&debug=1` (`X-Cache: MISS` then `X-Cache: HIT`, `version: "quota-saver-2026-11-23"`).

## Validation

Run `node --test tests/*.test.cjs` from the repository root. Tests use synthetic fixtures and never call paid APIs.

Official API references:
- https://airlabs.co/docs/flight
- https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json
