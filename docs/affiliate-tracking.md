# Partner links and measurement

The live site and Dubai guide share `assets/partner-links.js`. Existing publisher URLs for Airalo, Kiwitaxi and AirHelp are retained unchanged. No publisher identifier has been invented, and no test purchase has been made.

## Link audit — 6 November 2026

| Provider | Configuration | Limit of verification |
| --- | --- | --- |
| Airalo / Impact | Owner-generated UAE link `airalo.pxf.io/KB66v9` is configured for the Dubai guide and DXB arrivals. HTTP HEAD returned 302 into Impact with the same publisher ID as the existing generic link and an encoded `u` target of `https://www.airalo.com/united-arab-emirates-esim`. Existing generic link is retained for other destinations. | Owner screenshots show the Airalo application as Approved and this link generated for the exact UAE landing page. Completed-sale attribution and payout still require the owner's reports. |
| Kiwitaxi / Travelpayouts | Owner-generated DXB link `kiwitaxi.tpo.mx/RyxrAcPa` is configured for the Dubai guide and DXB flight arrivals. HTTP HEAD returned 302 directly to `kiwitaxi.com/en/uae/dubai-international-airport` with Travelpayouts `utm_source` and `tpo`; the same destination works with a QA SubID. Existing generic link is retained for other airports. | Owner screenshots show Kiwitaxi under Available for Airportguideapp and the link generator. Approved commission and payout completion still require the owner's reports. |
| AirHelp | Existing `a_aid` and `a_bid` retained; automated HTTP HEAD returned 403, so end-to-end verification is incomplete | No eligibility or payout is asserted. Existing cancellation / 180-minute display rule is unchanged. The 403 does not establish what a normal visitor will see. |
| Viator | No publisher PID / MCID was present in the site; no configured partner link was found | The destination search remains an ordinary outbound link, without `rel=sponsored` or affiliate-click reporting. Supply a complete publisher-generated link to enable attribution. |

The former Travelpayouts Drive auto-switching script has now been removed. Its public loader temporarily blanks Travelpayouts URLs and installs link/DOM interception before loading another module. Fixed publisher links are used instead so that the destination and network remain under the site's control. Viator remains an ordinary link until a publisher-generated tracking link is supplied.

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

Offer events include provider, placement (`flight_result` or `dubai_guide`), arrival airport, a configured-affiliate flag and a partner SubID where supported. The flag means the URL has recognized affiliate attribution, not that account approval or commission is confirmed. They do not include boarding-pass files, names, booking references or flight numbers. `flight_search_started` replaces the old `search` event that sent a flight number. It records the entry method (`manual`, `boarding_pass`, `recent` or `shared_link`); `flight_search_failed` records timeout/unavailable. Legacy `click_esim`, `click_taxi` and `click_airhelp` events remain for current reports; do not add them to `affiliate_click` when counting clicks, since they describe the same action.

An affiliate click is not a sale. Revenue and approved commissions must come from partner reports. Analytics blockers may reduce recorded events without affecting navigation or flight lookup.

## Consent and traffic attribution

`assets/analytics.js` is the single loader on the search page, Dubai guide and privacy page. It blocks Google requests until a visitor allows analytics, retains the existing measurement ID `G-YYW1KW4CGN`, and keeps advertising storage/user-data/personalization denied. Declining leaves search, uploads and links functional. The choice is remembered for 180 days; withdrawal clears Analytics cookies and reloads the page. Preview hosts never load the production tag. Consent-aware metrics cover consenting visitors and are not a census of all traffic.

The three changed measurement assets use a release query version in the HTML and service-worker precache. This avoids an observed upgrade issue where an older service worker supplied an old link script alongside new HTML on the first visit. Bump the asset version alongside future changes to these scripts/styles.

Page locations and referrers sent through this loader omit private query strings. Only bounded campaign labels are carried between the flight page and Dubai guide; `flight`, booking data and unique click identifiers are not copied by this code. Google’s own campaign attribution applies within Analytics; unique click identifiers are not sent to affiliate reports.

For the proposed campaign, the ready-to-use landing URL is:

```text
https://airportguideapp.com/guides/dubai/?utm_source=google&utm_medium=cpc&utm_campaign=dubai_arrivals_test&utm_content=arrival_guide
```

This URL is preparation only. No campaign has been activated or budget spent by this change.

Airalo gets the documented Impact `subId1` parameter; Kiwitaxi gets Travelpayouts `sub_id`. Example: `ag_dubai_guide_dxb_dubai_test` versus `ag_flight_result_dxb_dubai_test`. Other traffic uses `_other`, which must not be interpreted as definitely organic. These are shared placement/campaign labels, not visitor IDs. Existing publisher attribution and other query parameters are retained. AirHelp parameters are unchanged; no undocumented per-click parameter is invented.

Official network references:

- https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/tracking/tracking-links/link-parameters/sub-id-and-shared-id-parameters-explained-for-partners
- https://support.travelpayouts.com/hc/en-us/articles/12729746524050-How-to-dynamically-change-SubID-in-short-affiliate-links
- https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic

## Remaining account checks before paid traffic

The public Airalo and Kiwitaxi links still issue redirects, but this does not prove program approval, payout readiness or completed-sale attribution. The owner needs to open the relevant account and confirm that airportguideapp.com is an approved property/project and that the existing links belong to that account. No passwords or private API keys are needed in the frontend.

The owner supplied the Kiwitaxi DXB partner link on 6 November 2026 after using the generator in the Airportguideapp project. It is configured in `dubaiLinks` in `assets/partner-links.js` and in the guide's static fallback anchor. It is used for DXB arrivals, not DWC or other airports. Existing SubID decoration distinguishes guide versus flight-result clicks and the named Dubai campaign. No purchase was made to test commission.

The owner also supplied a screenshot of Impact's generated Airalo tracking link on 6 November 2026. The UAE link `https://airalo.pxf.io/KB66v9` is configured in `dubaiLinks` and in the guide's static fallback anchor. It uses the documented `subId1` placement/campaign marker. The owner's screenshot shows the application approved and the correct UAE landing page; no media-property identifier, publisher identifier or deep-link target was invented. No purchase was made to test commission.

Both initial Dubai offers now have owner-generated destination links. Deep links are not guessed: Impact explicitly requires the brand to permit the target domain/path. Viator is optional for the initial two-offer guide and remains unmonetized until configured.

The owner has connected GA4, and account discovery exposes the property `airportguide-f0899` (517717939). The reporting query is blocked by the expired Supermetrics trial (`TRIAL_EXPIRED`); it did not return event data. Code-level event generation and consent are tested, but receipt in the owner's property, custom dimensions and key-event configuration have not been verified. Once report access is available:

1. Check the property's web data stream uses `G-YYW1KW4CGN` and points to airportguideapp.com.
2. Confirm `destination_guide_view`, `flight_search_started`, `flight_search_success`, `flight_search_failed`, `offer_impression` and `affiliate_click` in Realtime/DebugView using a real consenting visit.
3. Register event-scoped dimensions `provider`, `placement`, `arrival_airport` and `partner_sub_id` if not already present. Configure `affiliate_click` as a key event for outbound intent; never call it a purchase or use it as confirmed revenue.
4. Report sessions by session source/medium/campaign and landing page, successful searches, affiliate clicks by provider/placement, and provider-approved commission by SubID. Do not sum legacy click events with `affiliate_click`.
5. Confirm a deliberate test click in Impact/Travelpayouts click reports. A test booking/purchase is separate and has not been made. Join approved commission to the campaign/placement SubIDs when actual sales arrive.

## Completing Viator setup

Create a link in the owner's Viator partner account and paste the full URL into the `viator` entry in `assets/partner-links.js`. Keep the provider-generated PID, MCID and medium parameters. A search-results link can be reused for the flight's destination without discarding its attribution. Verify the account and link in the provider's reports before relying on revenue.

Official reference: https://partnerresources.viator.com/travel-content/links/create-links/

## Validation

Run `node --test tests/*.test.cjs`. The checks cover publisher attribution, destination encoding, organic versus affiliate events, viewport impressions, unavailable analytics, SubID preservation, consent accept/reject/withdrawal/expiry, private-field exclusion, campaign navigation, preview isolation and separate offline page caches. Earlier browser checks covered SK943, the overnight EK152 arrival, PDF boarding-pass extraction with a synthetic document, and the result and guide at mobile width. Local preview events are not sent to the production GA4 property.

The Dubai guide is a static HTML page with an independent title, canonical URL, internal links, source links and a sitemap entry. Search indexing is not guaranteed. Check Search Console after publication for discovery and indexing.
