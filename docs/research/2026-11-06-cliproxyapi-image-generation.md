# CLIProxyAPI image-generation 404 investigation

Date: 2026-11-06. Initial public documentation research, followed by a gateway-worker handoff and
Reels generation validation. No proxy configuration or deployment was changed by this session.

## Deployed gateway finding (2026-11-06 follow-up)

The gateway worker reported that the configured hostname fronts the Caddy `gateway` service in
`maneeshv/cliproxyapi-hosting`, not CLIProxyAPI directly. Its `gateway/Caddyfile` allowlist forwards
Responses but excludes `/v1/images/generations`; other paths receive an empty 404 before authentication.
This identifies the intermediate route filter as the cause of the observed Images 404s, superseding
our initial disable-flag hypothesis. These deployment facts are attributed to the gateway worker's
verified handoff; this session did not independently inspect Railway or the Caddy configuration.

The handoff reports backend CLIProxyAPI **v8.0.15**, commit `a4acc9f`, build 2026-10-04, identified
from X-CPA headers, and a successful synthetic image using `POST /v1/responses`, model `gpt-6-astra`,
`tools=[{"type":"image_generation"}]` and `tool_choice={"type":"image_generation"}`. The returned
`image_generation_call.result` is base64 image data. The synthetic image's actual dimensions differed
from the requested dimensions. The underlying image model and honored size/quality settings remain
unverified. Successful image generation rules out globally disabling all image generation.

The owner authorized API fallback and supplied this route to resume the two design deliverables.
No gateway redeploy is necessary for those deliverables. Opening an Images route or upgrading the
backend remains separate work. Do not change the image-disable setting based on the earlier hypothesis.
See the [visual brief](2026-11-06-reels-visual-brief.md) for actual generation and inspection results.

API structure was checked through Context7 against the official
[Responses image-tool guide](https://developers.openai.com/api/docs/guides/tools-image-generation).
The proxy-specific model alias is taken from the working gateway probe, not an assertion about the
underlying image model. Requests use temporary Python HTTP tooling, not the bundled Images CLI.

## Initial public-source finding

CLIProxyAPI supports the standard `POST /v1/images/generations` route in its current source. A separate
image-specific hostname is not generally required. An empty HTTP 404 does not prove the route is absent:
the image handler deliberately returns an empty 404 when image generation is disabled globally.

The configured proxy was previously verified to authenticate, return an image-model list, and accept
the Responses route, while both attempted image generations returned empty 404s. This is consistent
with the documented disable flag, but its deployed version and configuration remain unverified.
An older backend or an intermediate route filter are also possible; public source cannot establish
which case applies to the owner's deployment.

## Documented settings

Current v8-style configuration groups the setting under `multimedia`:

```yaml
multimedia:
  disable-image-generation: "chat"
```

This is a proposed minimal setting for explicit Images API use: it leaves image endpoints enabled
while disabling automatic image-tool injection on non-image endpoints. It is not an applied change.

| Value | Documented behavior |
|---|---|
| `true` | Disable image generation everywhere; image endpoints return 404. |
| `false` | Default; image generation enabled, including automatic injection where supported. |
| `"chat"` | Keep explicit image endpoints enabled; disable image-tool injection on non-image endpoints. |
| `"passthrough"` | Do not inject or strip image tools in non-image payloads; image endpoints remain enabled. |

Older configuration uses the root-level `disable-image-generation` key. Match the deployed version's
schema rather than adding both locations. The current options documentation lists the root key among
the fields moved to `multimedia.*`.

For a custom OpenAI-compatible upstream, current configuration also requires its model entry's
`image: true` to allow Images API routing. That is provider-specific and should not be assumed to apply
to an existing built-in Codex/OAuth model. First check the global disable setting and backend version.

## Community workaround and limits

Issue #2940 reports a missing Images endpoint on v6.9.30. Its author later reports a configuration-only
workaround: a Codex GPT model alias plus `image_generation` tool/tool-choice injection, through the
existing compatible request flow. This is a community report for that older release, not a verified
solution on the owner's proxy. If the global flag is `true`, the documented policy disables image
generation everywhere; using another route should not be assumed to bypass it.

The latest official release returned by GitHub during this research was v8.0.57, published
2026-11-05. That is not the deployed version. Updating the management dashboard alone does not update
the proxy backend; the official dashboard documentation says its updater fetches `management.html` only.

## Sources checked

1. [Official configuration options](https://github.com/router-for-me/CLIProxyAPIDocs/blob/main/docs/en/configuration/options.md),
   fetched through Context7 `/router-for-me/cliproxyapidocs` and directly: `multimedia.disable-image-generation`,
   custom upstream model `image` flag, and legacy-to-v8 field mapping.
2. [Official example configuration](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml),
   lines 1206–1216 in the fetched revision: supported values and explicit 404 behavior.
3. [Images handler](https://github.com/router-for-me/CLIProxyAPI/blob/main/sdk/api/handlers/openai/openai_images_handlers.go),
   lines 738–746 in the fetched revision: `DisableImageGenerationAll` invokes `AbortWithStatus(404)`
   before the generation request body is parsed. The edit handler has the same gate.
4. [Issue #2940](https://github.com/router-for-me/CLIProxyAPI/issues/2940),
   and [the author's reported workaround](https://github.com/router-for-me/CLIProxyAPI/issues/2940#issuecomment-4296121438).
5. [PR #3832](https://github.com/router-for-me/CLIProxyAPI/pull/3832), searched as supporting discussion
   of mode behavior; current official source/docs above are the authority for supported behavior.
6. [Release v8.0.57](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.57).
7. [Official dashboard documentation](https://github.com/router-for-me/CLIProxyAPIDocs/blob/main/docs/en/management/webui.md),
   fetched through Context7: management UI updates do not update the backend executable.

## Next action after gateway diagnosis

Use the verified Responses image tool for the two pending design images; inspect and record the
actual outputs. The earlier recommendation to inspect/change the disable flag is superseded by the
gateway finding above. No new API key or backend update is required for this verified route.
