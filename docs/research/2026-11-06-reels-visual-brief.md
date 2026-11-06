# Reels mockup and infographic: generation brief

Date: 2026-11-06. Based on the [proposed Reels spec](../superpowers/specs/2026-11-06-reels-view-design.md).

## Delivery state

Generation resumed through the proxy's verified Responses image tool after the owner supplied a
successful gateway-worker handoff. Both assets are generated and visually inspected.
This is a different route from the bundled Images CLI: temporary Python HTTP tooling sends
`POST /v1/responses`, model `gpt-6-astra`, with `image_generation` forced by `tool_choice`, then decodes
`image_generation_call.result`. The underlying image model is **unverified**; `gpt-image-2` was the
original intended Images-CLI model, not a user-imposed requirement and not a verified model for these
Responses outputs. No claim is made that the proxy honors requested dimensions or high quality.

The exact prompts below are retained. The UI request asks for 2048×1536 and the infographic for
2048×1152, both high quality. Images are kept at their actual returned resolution, without upscaling.
Credentials from the named local shell settings are mapped only in the generation subprocess's
memory/environment; they are never printed, stored in repo files, or changed. No product code,
proxy/gateway settings, deployment, commit, push or PR is part of this delivery.

## Reference and accuracy contract

- Current visual tokens from `src/html.ts`: background `#090b0e`, surface `#11151a`, secondary surface
  `#171c22`, line `#272d35`, text `#f4f1ea`, muted `#9299a3`, amber `#e7a83b`.
- Existing implementation reference inspected:
  [mobile Watch](assets/2026-09-11-library-implementation/mobile-watch.png).
  Also available: [desktop Library](assets/2026-09-11-library-implementation/desktop.png).
- Use the reference for typography, palette and restrained styling, not incidental screenshot defects
  or the exact Watch layout. These are proposed Reels compositions, not implementation screenshots.
- Synthetic sample video titles, scenery, counters and timings must be identified as illustrative.
- Preserve Library/Watch. Reels has no inline edit/delete/favourite controls, social comments,
  likes counts, follow actions, ads, recommendation feed, public share button or automatic next-video mode.
- UI shows one active video; the infographic may show previous/next poster previews, clearly inactive.
- A muted initial state uses an Unmute action. A returned-from-Details state is paused.
- Details returns to the same surviving reel and local time; browsing does not overwrite Watch resume.
- Infographic topology: browser → Cloudflare Access → Worker; Worker reads D1 playlist metadata and
  streams private R2 video/posters. Browser has tab-session state. There is no direct public R2 path,
  new streaming service, transcoder or X request during browsing.

## Prompt 1 — UI mockup

Use case: ui-mockup.
Asset type: high-fidelity product review board, landscape 4:3, two proposed responsive layouts for
the existing x-downloader web application. This is a concrete implementable web UI, not a futuristic
concept render. Crisp front-on screens, large readable labels, no tilted devices or decorative desk props.

Primary request: Show how the proposed separate Reels view looks on mobile and desktop while retaining
the existing dark charcoal and warm amber app identity. The mobile view is the dominant composition,
with a larger landscape desktop browser to its right. Label them "Mobile" and "Desktop". Small top
caption: "Reels — proposed view". Footer: "Illustrative content · Design preview".

Palette: page #090b0e, controls #11151a, subtle borders #272d35, warm-white text #f4f1ea, muted grey
#9299a3, selected control and main highlights #e7a83b. Inter-like clean sans-serif, subtle 10–14 px
corner radii, thin simple line icons, restrained spacing and shadows. No neon/glass gradients.

Mobile screen: compact header "← Library" and "Reels". Below it a clearly readable segmented control
"Ordered" (selected) / "Shuffle", with "3 of 24". A dominant vertical video stage shows a realistic
portrait clip of a mountain path at dawn, fit completely within the stage. Keep all controls inside
the screen. In the player's lower edge draw a conventional native-looking video control bar with
Pause icon, seek timeline, "0:12 / 0:45", muted speaker and fullscreen icon. Beneath the stage, title
"Morning on the trail" and labelled "Details →". A compact control row: "Unmute", "1×", then large
"↓ Previous" and "↑ Next" buttons. A small header-level "Start fresh" action may be tucked into a
clearly labelled menu, never shown as a new settings subsystem. Include an external amber annotation
arrow labelled "Swipe up: next" along the mobile screen's right side and a second "Swipe down: previous"
below it. These annotations sit outside the product UI, not over its controls.

Desktop screen: same Reels route with "← Library", "Reels", segmented "Ordered" / "Shuffle" with
Shuffle selected, "3 of 24", and a visible "Reshuffle" action. A large wide stage centers a portrait
video of the same mountain path with intentional black side gutters; do not crop or stretch to fill.
Native-looking timeline controls along the video bottom. Below: "Morning on the trail", "Details →",
"Unmute", "1×", "↓ Previous", "↑ Next". Include discreet "Start fresh" in the header. No Library grid
inside the Reels route and no social-network action rail.

Three short explanatory captions on the board outside screens: "One video at a time", "Ordered or shuffled",
"Details, then back to your place". Use clear hierarchy and ample spacing. Avoid tiny text, extra features,
unreadable paragraphs, floating cards covering the clip, multiple playing videos, a portrait video cropped
to landscape, or an auto-advance toggle. All UI text must be spelled exactly as quoted. Annotations and
the illustrative 24-item count are design explanations, not claims about live data.

## Prompt 2 — experience and implementation infographic

Use case: infographic-diagram.
Asset type: polished product-and-architecture infographic, landscape 16:9, crisp vector-like raster,
designed so a nontechnical owner can understand the proposed Reels experience in one glance.
Title: "Reels: browse without losing your place". Small subtitle: "Proposed design · Existing Library stays".

Composition: upper two-thirds is the human experience, lower third is a simpler implementation lane.
Warm off-white canvas, charcoal miniature app screens, restrained amber highlights matching x-downloader,
muted blue internal connections, consistent large line icons and readable sans-serif typography. Generous
white space; no paragraphs in boxes, 3D rendering, gradients or decorative technical components.

Upper lane, left: a miniature dark Library poster grid with a search field and small tag chips. Caption
"1  Find your selection". A single right-pointing amber arrow labelled "Open Reels" goes to the central
large portrait Reels player. Caption "2  Swipe through videos". Above/below this central player, show
small inactive poster previews for the preceding and next clip, each clearly labelled "Poster only".
Next to the player show arrows and exact short labels "Up: next" and "Down: previous". Inside its header
show "Ordered | Shuffle" and "3 of 24". The central player alone has a play symbol and a progress bar.
Below it two concise labels: "Loops until you swipe" and "Starts muted".

Upper lane, right: one miniature existing Details page, with a video thumbnail, title and simple owner
edit-field shapes. Caption "3  Open Details". Connect the active Reels player to Details with a rightward
arrow labelled "Details"; below that draw a distinct leftward return arrow labelled "Back to Reels".
Place the note "Same reel + position · Paused on return" beside the return arrow. A thin separate arrow
from Reels back to Library is labelled "Original filters + page". Do not imply Details editing exists
inside Reels. Under this upper lane a short line: "Reel progress stays separate from Watch progress".

Lower lane, heading "How it works". Left: prominent browser icon labelled "Your browser", with a small
attached tab icon labelled "Session order + position". To its right, a large light-tinted boundary
labelled "Cloudflare" contains a shield labelled "Access", then a compute icon labelled "Worker",
then two separate storage symbols at far right: database cylinder "D1" with caption "Playlist metadata",
and private bucket icon "R2" with caption "Videos + posters". Show a solid request arrow from browser
to Access to Worker labelled "Authenticated requests". Show blue dashed read arrows from Worker to
D1 and Worker to R2. Place a return arrow from Worker to browser labelled "One active video".
Never draw a browser-to-R2 arrow bypassing Access/Worker. Do not draw a private network boundary;
the Cloudflare boundary is provider grouping, while the R2 lock denotes private media access.

Small legend: solid arrow "Browser request / response"; dashed blue arrow "Internal read".
Small bottom note: "Sound and swipe controls require phone testing". Keep all text large enough for
presentation viewing. Emphasize the journey and one-active-player design over technical detail. Avoid
API jargon in the upper lane, a public sharing path, X ingestion arrows, hidden preloading of future
video bodies, new cloud services, or a claim that audio autoplay is guaranteed. Render quoted text
verbatim with correct spelling and uncrossed directional arrows.

## Inspection checklist

Verify Reels actions and labels against spec sections 2/6/7; verify shuffle has Reshuffle, portrait media
is fitted, mute state matches Unmute, timelines are readable, and captions are outside the product UI.
Verify infographic arrows and trust path, only one active player, Details return marked paused, no
extra service/feature, legible text at presentation size, and no sample count presented as production data.

## Delivered assets and inspection

| Asset | Requested pixels | Actual PNG pixels | Responses attempts |
|---|---|---|---|
| [UI mockup](assets/2026-11-06-reels-preview/reels-ui-mockup.png) | 2048×1536 | 1448×1086 | 1 |
| [Experience infographic](assets/2026-11-06-reels-preview/reels-experience-infographic.png) | 2048×1152 | 1536×1024 | 2 |

All three Responses calls succeeded. Infographic attempt 1 returned 1672×941; it was rejected for
an invented Details field. The two earlier Images-CLI 404s are separate from these three Responses
attempts. A [nonsecret generation record](assets/2026-11-06-reels-preview/generation-record.json)
records returned dimensions, bytes, request options and selection; no raw response or credential is saved.

Visual QA:
- UI: mobile Ordered and desktop Shuffle with Reshuffle, fitted portrait media and desktop side
  gutters, readable native-looking timelines, muted icons consistent with Unmute, Details/Library
  links, Previous/Next, speed and external swipe annotations. Illustrative footer is present.
- Infographic: Library selection → Reels → Details, distinct paused return to the same reel/time,
  original Library filters/page return, separate Watch progress, and inactive neighbouring posters.
  Details has Title/Tags fields only. Browser requests pass through Access and Worker, with internal
  reads to D1 and private R2 and no direct browser-to-R2 path. Labels, arrow directions, legend and
  footer are legible and unclipped. No new service, social action or auto-next mode is depicted.
- Parent visual inspection and an independent read-only reviewer checked the candidates. No material
  accuracy defect remains in the selected assets.

Limitations: generated native controls and miniature Library/Details layouts are schematic; Details
edit fields represent the owner view. Sample titles, imagery, times and counts are illustrative.
The infographic returned landscape 3:2, not requested 16:9; no crop or upscale was applied. High
quality was requested but proxy compliance and the underlying image model remain unverified. These
images demonstrate design intent, not a working implementation or phone-test evidence. Sound/swipe
validation and spec approval remain outstanding. No image-generation blocker remains for this delivery.

## Correction record

UI attempt 1 passed visual inspection with no regeneration. Infographic attempt 1 had correct
navigation and architecture, but invented an editable `Owner` field with value `me`. It was rejected.
Attempt 2 uses the original infographic prompt plus this exact correction:

> Accuracy correction for the Details miniature: do not invent an editable Owner, identity, account, author, or user field. The two existing edit-field shapes must be labelled "Title" (value "Sunset by the Lake") and "Tags" (value "travel"). These are metadata fields in the existing Details page. There is no Owner field. Preserve all specified arrows and labels, correct request path, single active player and poster-only neighbours. Include the exact small readable footer "Illustrative content · Design preview" to identify sample titles, scenery, counts and timings. Make sufficient vertical space for the legend, phone-testing note and this footer; none may clip or overlap.

## Earlier blocked attempts (historical)

The built-in image tool was unavailable. The owner authorized API fallback and directed use of the
proxy configured in `~/.zshrc`. Authenticated model listing succeeded, but two bundled Images-CLI
requests returned empty 404s. The owner initially chose to skip generation, then requested research.
Public CLIProxyAPI source showed that a global disable flag can produce this response; that was a
hypothesis, not the deployed diagnosis. The gateway-worker handoff subsequently identified Caddy's
route allowlist as the actual barrier and verified Responses image tools. See the corrected
[proxy research](2026-11-06-cliproxyapi-image-generation.md). No gateway change was needed.
