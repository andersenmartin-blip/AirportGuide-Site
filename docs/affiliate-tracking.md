# Partner links and measurement

The live site and Dubai guide share `assets/partner-links.js`. Existing publisher URLs for Airalo, Kiwitaxi and AirHelp are retained unchanged. No publisher identifier has been invented, and no test purchase has been made.

## Link audit — 6 November 2026

| Provider | Configuration | Limit of verification |
| --- | --- | --- |
| Airalo / Impact | Existing `airalo.pxf.io/2RKYkg` link retained; HTTP HEAD returned 302 into the Impact redirect chain | Publisher account status, final landing and sale attribution require the owner's Impact reports. This is a generic link: users select their destination on Airalo. |
| Kiwitaxi / Travelpayouts | Existing `kiwitaxi.tpo.mx/dUq07Ia1` link retained; HTTP HEAD returned 302 to `kiwitaxi.com` with `utm_source` and `tpo` | Publisher account status and commission require the owner's Travelpayouts reports. Users enter their airport and destination with the provider. |
| AirHelp | Existing `a_aid` and `a_bid` retained; automated HTTP HEAD returned 403, so end-to-end verification is incomplete | No eligibility or payout is asserted. Existing cancellation / 180-minute display rule is unchanged. The 403 does not establish what a normal visitor will see. |
| Viator | No publisher PID / MCID was present in the site; no configured partner link was found | The destination search remains an ordinary outbound link, without `rel=sponsored` or affiliate-click reporting. Supply a complete publisher-generated link to enable attribution. |

The existing Travelpayouts script is retained, but the site does not assume that a third-party script will make an unconfigured Viator link commissionable.

## Analytics

The existing GA4 property is retained. These events compare the flight result and destination guide:

| Event | Meaning |
| --- | --- |
| `flight_search_success` | The flight request succeeded and the result was rendered. |
| `destination_guide_click` | A visitor selected the Dubai guide from the search or result view. |
| `destination_guide_view` | The Dubai guide loaded. |
| `offer_impression` | At least half of an offer card entered the viewport; counted once per result render. Collapsed offers do not count until visible. |
| `affiliate_click` | A visitor clicked a configured partner link. |
| `outbound_click` | A visitor clicked the ordinary Viator destination link. |

Offer events include provider, placement (`flight_result` or `dubai_guide`), arrival airport and a monetized flag. They do not include boarding-pass files, names, booking references or flight numbers. The pre-existing search event is unchanged. Legacy `click_esim`, `click_taxi` and `click_airhelp` events remain for current reports; do not add them to `affiliate_click` when counting clicks, since they describe the same action.

An affiliate click is not a sale. Revenue and approved commissions must come from partner reports. Analytics blockers may reduce recorded events without affecting navigation or flight lookup.

## Completing Viator setup

Create a link in the owner's Viator partner account and paste the full URL into the `viator` entry in `assets/partner-links.js`. Keep the provider-generated PID, MCID and medium parameters. A search-results link can be reused for the flight's destination without discarding its attribution. Verify the account and link in the provider's reports before relying on revenue.

Official reference: https://partnerresources.viator.com/travel-content/links/create-links/

## Validation

Run `node --test tests/*.test.cjs`. The checks cover publisher attribution, destination encoding, organic versus affiliate events, viewport impressions, unavailable analytics and separate offline page caches. Browser checks covered SK943, the overnight EK152 arrival, PDF boarding-pass extraction with a synthetic document, and the result and guide at mobile width. Local preview events are not sent to the production GA4 property.

The Dubai guide is a static HTML page with an independent title, canonical URL, internal links, source links and a sitemap entry. Search indexing is not guaranteed. Check Search Console after publication for discovery and indexing.
