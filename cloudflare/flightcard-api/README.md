# flightcard-api Cloudflare Worker

`worker.js` is a complete replacement for the Worker source supplied by the owner on 6 November 2026. It uses the existing Airlabs and AeroDataBox subscriptions and the existing JSON fields consumed by `index.html`.

## Gate fix

The previous Worker ignored Airlabs `dep_gate`, `dep_terminal`, `arr_gate` and `arr_baggage`. The replacement uses those fields when the corresponding AeroDataBox field is missing or a placeholder. AeroDataBox retains priority when it supplies a usable value for the same departure. A gate is never inferred from the terminal or hardcoded.

Provider failures are isolated. A timeout, quota error or invalid JSON from one provider does not discard the other provider's data. No-data responses return an error instead of an apparently scheduled flight. The existing limit of one request per provider per lookup is retained; there is no background polling or new subscription.

The AeroDataBox result is matched to the departure date, route where available, and scheduled time if needed. The dated endpoint can also contain flights arriving on that date, so taking the first item can attach the previous day's gate. Ambiguous matches are not merged. Departure time comparison uses the local wall clock at the same airport rather than mixing timezone-naive Airlabs strings with offset-bearing AeroDataBox strings.

## Deploy to the EXISTING Cloudflare Worker

1. Open **Workers & Pages → flightcard-api → Edit code** in Cloudflare.
2. Keep a copy of the current code for rollback. Replace the editor contents with all of `worker.js`.
3. Keep the existing `AIRLABS_KEY` and `AERO_API_KEY` secret bindings. Their values belong in Cloudflare, never in this repository.
4. Select **Deploy**. A GitHub Pages deployment does **not** deploy this Worker.
5. Open `https://flightcard-api.andersen-martin.workers.dev/?flight=IB720&debug=1`, then search IB720 again on the website. Compare the same date and departure with Heathrow's official result. Gates can change; A7 was the owner's observation, not a verified current value.

The optional `debug=1` response contains the version, retrieval time, departure date, provider availability and gate/terminal values from each matched provider. `retrieved_at` means when this Worker answered, not when an upstream provider last updated its data. It contains neither API keys nor raw upstream errors. `gate_source` identifies the chosen source; `null` means neither supplied a gate. An AeroDataBox state of `ok` with `matched: false` means no unambiguous matching occurrence was selected.

If both matched providers return no gate while Heathrow publishes one for the same departure, the remaining issue is upstream data coverage or freshness. This patch cannot supply a gate absent from both APIs. Returning `Cache-Control: no-store` prevents storage of new responses in ordinary HTTP caches, but the frontend still needs an explicit new search to fetch new data; this change does not add automatic refresh.

## Validation

Run `node --test tests/*.test.cjs` from the repository root. The Worker tests use synthetic responses and never call paid APIs. They cover the missing-gate regression, field precedence, placeholders, timeouts, quota/network/JSON errors, secret redaction, single-provider fallback, no-data errors, local dates, route/date/occurrence matching, flight-number normalization and summer time formatting. Live IB720 gate coverage has not been verified with the owner's credentials.

Official API field references checked on 6 November 2026:

- https://airlabs.co/docs/flight
- https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json
