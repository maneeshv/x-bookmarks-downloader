// Hard caps (ADR-0005). File size has an owner-selected KV operating limit, but this
// immutable ceiling still bounds it (ADR-0015); raising the ceiling is a code change.
export const VERSION = "v2";
export const MAX_API_REQUESTS_PER_RUN = 4;          // normal run: ≤1 pending lookup + 1 bookmarks page + ≤2 token refresh attempts; asserted by tests, not enforced at runtime.
export const MAX_DOWNLOADS_PER_RUN = 5;             // rest wait for the next tick (ADR-0008)
export const CRON_INTERVAL_MS = 30 * 60_000;         // must match wrangler.toml `crons = ["*/30 * * * *"]`; /queue download estimates
export const MIN_FILE_BYTES = 1024 ** 2;             // stats-page setting floor: 1 MiB (ADR-0015)
export const DEFAULT_MAX_FILE_BYTES = 1024 ** 3;     // existing deployments remain at 1 GiB until the owner saves a setting
export const MAX_FILE_BYTES = 5 * 1024 ** 3;         // absolute ceiling; owner-selected KV limit cannot exceed 5 GiB (ADR-0017)
export const STORAGE_ALERT_BYTES = 9 * 1024 ** 3;   // alert, keep downloading (owner default Q6)
export const STORAGE_ALERT_STEP_BYTES = 3 * 1024 ** 3; // re-alert once per 3 GiB step crossed (9, 12, 15 …); 2026-08-31, `alerts.storage` had fired once at 14.56 GB and never again — ADR-0005 amendment
export const PAUSE_MS_AUTH = 24 * 3600_000;         // 401/403 → pause 24 h
export const REFRESH_AHEAD_MS = 5 * 60_000;         // refresh when < 5 min left (access token lives 2 h)
export const PAGE_SIZE = 20;                        // per cron run
export const BACKFILL_PAGE_SIZE = 90;               // >90 breaks next_token — devcommunity.x.com/t/257339
export const BACKFILL_MAX_ITEMS = 800;              // X returns at most the 800 most recent bookmarks
export const BACKFILL_MAX_REQUESTS = 10;            // 800/90 = 9 pages
export const BACKFILL_MAX_DOWNLOADS = 30;           // ceiling for /backfill?downloads=N (owner-driven drain, 2026-08-30); cron keeps MAX_DOWNLOADS_PER_RUN
export const TWEET_LOOKUP_BATCH_SIZE = 100;         // GET /2/tweets accepts at most 100 IDs — docs.x.com/x-api/posts/get-posts-by-ids
export const BACKFILL_MAX_POSTERS = 30;             // ceiling for one D1-backed poster migration page (ADR-0018)
export const MAX_POSTER_BYTES = 5 * 1024 ** 2;      // immutable 5 MiB cap for untrusted X CDN image bodies
export const STALE_PARSER_RUNS = 30;                // consecutive runs with results but zero media → alert
export const DOWNLOAD_JITTER_MS: readonly [number, number] = [1000, 2000];
export const VIDEO_KEY_RE = /^\d{5,25}(-\d{1,2})?\.mp4$/;
export const POST_ID_RE = /^\d{5,25}$/;              // route :postId — same digit range as VIDEO_KEY_RE
export const TITLE_MAX = 200;                        // library metadata caps (spec 2026-08-30 §6)
export const DESCRIPTION_MAX = 2000;
export const TAG_MAX = 30;
export const TAGS_MAX = 12;

// X API v2 — docs.x.com/x-api/users/get-bookmarks, docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_API = "https://api.x.com/2";
export const X_SCOPES = "bookmark.read tweet.read users.read offline.access";
// No author_id / user.fields: may bill as $0.01 user reads (docs/research/2026-08-29-x-api-v2.md)
export const BOOKMARK_QUERY =
  "expansions=attachments.media_keys&media.fields=media_key,type,variants,preview_image_url,duration_ms&tweet.fields=created_at,text,attachments";
