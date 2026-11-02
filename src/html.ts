import { CRON_INTERVAL_MS, MAX_DOWNLOADS_PER_RUN, MAX_FILE_BYTES } from "#src/limits";
import { DEFAULT_LIBRARY_PAGE_SIZE, LIBRARY_PAGE_SIZES, type BookmarkRow, type LibraryQuery, type StatRow, type Status, type TagOption } from "#src/store";

const esc = (s: string | null) => (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const js = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");
const mb = (b: number | null) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : "Size unavailable");
const duration = (ms: number | null) => {
  if (ms === null) return "Duration unavailable";
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};
const bytes = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
// Only https URLs are ever emitted into src/href (spec §7); anything else renders empty.
const url = (u: string | null) => (u && u.startsWith("https://") ? esc(u) : "");
const title = (r: BookmarkRow) => r.title ?? ((r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || r.post_id);
const day = (r: BookmarkRow) => (r.posted_at ?? r.first_seen_at).slice(0, 10);
const tags = (r: BookmarkRow): string[] => {
  try { const value = JSON.parse(r.tags ?? "[]"); return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : []; }
  catch { return []; }
};

const libraryParams = (q: LibraryQuery = {}) => {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.fav) p.set("fav", "1");
  for (const tag of q.tags ?? []) p.append("tag", tag);
  if (q.sort && q.sort !== "newest") p.set("sort", q.sort);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  if (q.perPage && q.perPage !== DEFAULT_LIBRARY_PAGE_SIZE) p.set("perPage", String(q.perPage));
  return p;
};
const libraryHref = (q: LibraryQuery = {}, anchor = "") => {
  const s = libraryParams(q).toString();
  return `${s ? `/?${s}` : "/"}${anchor}`;
};
const watchHref = (postId: string, q: LibraryQuery) => {
  const s = libraryParams(q).toString();
  return `/watch/${postId}${s ? `?${s}` : ""}`;
};

// Feather 4.29.2, unchanged shapes: https://github.com/feathericons/feather/tree/v4.29.2/icons
// MIT license and attribution: THIRD_PARTY_NOTICES.md. Static strings only, never user input.
const ICONS = {
  library: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  stats: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg class="icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const CSS = `:root{color-scheme:dark;--bg:#090b0e;--surface:#11151a;--surface-2:#171c22;--line:#272d35;--line-strong:#3a424c;--text:#f4f1ea;--muted:#9299a3;--accent:#e7a83b;--accent-soft:#2b2316;--danger:#ff766d;--radius:14px;--shadow:0 18px 60px rgba(0,0,0,.28)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit}button,a,input,select,textarea{-webkit-tap-highlight-color:transparent}
.skip{position:fixed;left:1rem;top:-4rem;z-index:50;background:var(--text);color:var(--bg);padding:.65rem 1rem;border-radius:8px}.skip:focus{top:1rem}.app-bar{position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(9,11,14,.86);backdrop-filter:blur(18px)}.app-bar-inner{width:min(1480px,100%);min-height:68px;margin:auto;padding:0 clamp(1rem,3vw,2.5rem);display:flex;align-items:center;gap:1rem}.brand{font-size:1rem;font-weight:760;letter-spacing:-.02em;white-space:nowrap}.brand span{color:var(--accent)}.header-context{color:var(--muted);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.header-actions{margin-left:auto;display:flex;align-items:center;gap:.4rem}.view-only{border:1px solid #6e5428;border-radius:999px;background:var(--accent-soft);color:#f3c878;padding:.3rem .55rem;font-size:.68rem;font-weight:760;letter-spacing:.04em;white-space:nowrap}.nav-link,.button,.filter-toggle,.page-link{min-height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:10px;padding:.55rem .82rem;font-weight:650;line-height:1;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease}.nav-link{color:var(--muted)}.nav-link:hover{color:var(--text);background:var(--surface-2)}
main{animation:page-in .34s ease}@keyframes page-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.library-shell,.stats-shell{width:min(1480px,100%);margin:auto;padding:clamp(1.6rem,4vw,3.5rem) clamp(1rem,3vw,2.5rem) 3rem}.library-intro{display:flex;align-items:end;justify-content:space-between;gap:2rem;margin-bottom:1.5rem}.eyebrow{margin:0 0 .35rem;color:var(--accent);font-size:.72rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.library-intro h1,.watch-heading h1,.stats-heading h1{margin:0;font-size:clamp(2rem,5vw,3.9rem);line-height:.96;letter-spacing:-.055em;font-weight:760}.library-summary{margin:.65rem 0 0;color:var(--muted);max-width:48rem}.result-total{font-variant-numeric:tabular-nums;color:var(--text)}
.library-controls{display:grid;grid-template-columns:minmax(240px,1fr) auto auto auto auto;gap:.65rem;align-items:end;padding:1rem 0 1.15rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:1.5rem}.field{display:grid;gap:.35rem}.field-label{color:var(--muted);font-size:.72rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.control,input,select,textarea{width:100%;min-height:42px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);padding:.62rem .75rem;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}input::placeholder,textarea::placeholder{color:#6f7782}input:hover,select:hover,textarea:hover{border-color:var(--line-strong)}input:focus-visible,select:focus-visible,textarea:focus-visible,.button:focus-visible,.nav-link:focus-visible,.filter-toggle:focus-visible,.page-link:focus-visible,.video-card:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(231,168,59,.18)}.search-field{position:relative}.search-field input{padding-right:5.5rem}.search-button{position:absolute;right:.3rem;bottom:.3rem;min-height:34px;border:0;border-radius:8px;background:var(--text);color:var(--bg);padding:.35rem .75rem;font-weight:760;cursor:pointer}.filter-toggle{min-height:42px;border-color:var(--line);background:var(--surface);color:var(--muted)}.filter-toggle:hover{border-color:var(--line-strong);color:var(--text)}.filter-toggle.on{border-color:#6e5428;background:var(--accent-soft);color:#f3c878}
.tag-filter{position:relative}.tag-trigger{gap:.45rem;white-space:nowrap}.tag-count{display:inline-grid;place-items:center;min-width:1.35rem;height:1.35rem;border-radius:999px;background:var(--line);font-size:.7rem}.tag-trigger.on .tag-count{background:var(--accent);color:#171109}.tag-popover{position:absolute;z-index:30;top:calc(100% + .5rem);right:0;width:min(390px,calc(100vw - 2rem));padding:1rem;border:1px solid var(--line-strong);border-radius:13px;background:#15191e;box-shadow:0 24px 70px rgba(0,0,0,.55)}.tag-popover h2{margin:0 0 .8rem;font-size:1.05rem}.tag-search{margin-bottom:.85rem}.picker-section-label{display:flex;justify-content:space-between;align-items:center;margin:0 0 .45rem;color:var(--muted);font-size:.72rem;font-weight:750;letter-spacing:.04em;text-transform:uppercase}.picker-chips{display:flex;gap:.4rem;flex-wrap:wrap;min-height:0;margin-bottom:.85rem}.picker-chips:empty{display:none}.picker-chip{display:inline-flex;align-items:center;gap:.35rem;border:1px solid #6e5428;border-radius:999px;background:var(--accent-soft);color:#f3c878;padding:.3rem .38rem .3rem .62rem;font-size:.77rem}.picker-chip button{min-height:1.1rem;padding:0 .24rem;border:0;border-radius:4px;background:transparent;color:inherit;font-size:.66rem;cursor:pointer}.picker-chip button:hover{background:rgba(255,255,255,.1)}.new-tag{padding:.12rem .28rem;border-radius:4px;background:var(--accent);color:#171109;font-size:.58rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.tag-options{max-height:270px;overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.tag-option,.create-tag{width:100%;min-height:42px;display:flex;align-items:center;gap:.6rem;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);padding:.55rem .2rem;text-align:left;cursor:pointer}.tag-option:last-child,.create-tag:last-child{border-bottom:0}.tag-option:hover:not(:disabled),.tag-option.active,.create-tag:hover,.create-tag.active{background:var(--surface-2)}.tag-option:disabled{cursor:default;color:var(--muted)}.tag-option-name{overflow:hidden;text-overflow:ellipsis}.tag-option-count{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums}.tag-option-state{color:#f3c878;font-size:.72rem}.tag-popover-hint{margin:.75rem 0;color:var(--muted);font-size:.76rem}.tag-popover-actions{display:flex;justify-content:flex-end;gap:.5rem}.tag-empty{padding:1rem .25rem;color:var(--muted);font-size:.82rem}.clear-tags-link{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.video-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:clamp(1rem,2vw,1.6rem)}.video-card{display:block;min-width:0;border-radius:var(--radius);scroll-margin-top:92px;outline:none}.poster{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-2);box-shadow:0 0 0 rgba(0,0,0,0);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}.poster img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .32s cubic-bezier(.2,.7,.2,1),filter .2s ease}.video-card:hover .poster,.video-card:focus-visible .poster{transform:translateY(-3px);border-color:var(--line-strong);box-shadow:var(--shadow)}.video-card:hover .poster img,.video-card:focus-visible .poster img{transform:scale(1.035);filter:brightness(1.04)}.favorite-badge{position:absolute;top:.7rem;right:.7rem;border:1px solid rgba(255,224,169,.28);border-radius:999px;background:rgba(24,18,10,.88);color:#f4ca80;padding:.28rem .55rem;font-size:.68rem;font-weight:760;letter-spacing:.04em}.card-meta{padding:.78rem .15rem .1rem}.video-title{display:-webkit-box;min-height:2.8em;margin:0 0 .35rem;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--text);font-size:.98rem;font-weight:680;line-height:1.38;letter-spacing:-.015em}.video-details{display:flex;align-items:center;gap:.45rem;color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums}.tag-list{display:flex;gap:.35rem;flex-wrap:wrap;margin:.55rem 0 0}.tag{border:1px solid var(--line);border-radius:999px;background:var(--surface);color:#bac0c8;padding:.18rem .48rem;font-size:.68rem;line-height:1.25}.separator{color:#525a64}.empty{grid-column:1/-1;text-align:center;padding:7rem 1rem;border-bottom:1px solid var(--line)}.empty h2{margin:0 0 .4rem;font-size:1.35rem}.empty p{margin:0;color:var(--muted)}.empty a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.library-footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:2rem;padding-top:1.25rem;border-top:1px solid var(--line)}.range{margin:0;color:var(--muted);font-size:.84rem;font-variant-numeric:tabular-nums}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:.35rem;flex-wrap:wrap}.page-link{min-width:40px;border-color:var(--line);background:transparent;color:var(--muted)}.page-link:hover{border-color:var(--line-strong);color:var(--text);transform:translateY(-1px)}.page-link[aria-current=page]{border-color:var(--accent);background:var(--accent);color:#171109}.page-link.disabled{cursor:default;opacity:.38}.page-gap{color:var(--muted);padding:.4rem .2rem}
.watch-shell{width:min(1220px,100%);margin:auto;padding:clamp(1rem,3vw,2.5rem)}.watch-layout{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(290px,.72fr);gap:clamp(1.3rem,3vw,2.8rem);align-items:start}.player-wrap{position:sticky;top:92px}.player-wrap video{display:block;width:100%;max-height:calc(100vh - 124px);border:1px solid var(--line);border-radius:var(--radius);background:#000;box-shadow:var(--shadow)}.player-bar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-top:.6rem;color:var(--muted);font-size:.78rem}.player-bar label{display:flex;align-items:center;gap:.45rem}.player-bar select{width:auto;min-height:36px;padding:.35rem .6rem}.key-hint{font-variant-numeric:tabular-nums}.watch-panel{padding-top:.15rem}.watch-heading{padding-bottom:1.35rem;border-bottom:1px solid var(--line)}.watch-heading h1{font-size:clamp(1.8rem,3vw,2.75rem);line-height:1.04}.watch-byline{margin:.7rem 0 0;color:var(--muted);font-size:.84rem}.meta-form{display:grid;gap:1rem;padding:1.35rem 0;border-bottom:1px solid var(--line)}textarea{min-height:112px;resize:vertical}.form-actions{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}.button{border-color:var(--line);background:var(--surface);color:var(--text)}.button:hover{border-color:var(--line-strong);background:var(--surface-2);transform:translateY(-1px)}.button.primary{border-color:var(--accent);background:var(--accent);color:#171109}.button.on{border-color:#6e5428;background:var(--accent-soft);color:#f3c878}.button.danger{margin-left:auto;border-color:#5b302f;background:transparent;color:var(--danger)}.button.danger:hover{background:#251514}.save-message{min-height:1.5em;color:var(--muted);font-size:.8rem}.source-copy{white-space:pre-wrap;color:#c4c8ce;margin:1.2rem 0;font-size:.92rem}.source-links{display:flex;gap:.5rem;flex-wrap:wrap;color:var(--muted);font-size:.8rem}.source-links a{color:var(--text);text-decoration:underline;text-underline-offset:3px}
.video-tag-picker{position:relative}.video-tag-control{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;min-height:46px;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:.35rem .45rem;transition:border-color .16s ease,box-shadow .16s ease}.video-tag-control:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(231,168,59,.18)}.video-tag-control .picker-chips{display:contents}.video-tag-control input{flex:1 1 120px;width:auto;min-width:100px;min-height:32px;border:0;background:transparent;padding:.25rem;box-shadow:none}.video-tag-options{position:absolute;z-index:25;top:calc(100% - 1.35rem);left:0;right:0;max-height:280px;overflow:auto;border:1px solid var(--line-strong);border-radius:10px;background:#15191e;box-shadow:var(--shadow)}.video-tag-options .tag-option,.video-tag-options .create-tag{padding:.62rem .75rem}.picker-help{margin:.35rem 0 0;color:var(--muted);font-size:.76rem}.picker-error{color:var(--danger)}.picker-chip.flash{animation:chip-flash .35s ease}@keyframes chip-flash{50%{background:#54401e}}
.tiles.four{grid-template-columns:repeat(4,minmax(0,1fr))}.tile b.time{font-size:clamp(1rem,1.6vw,1.3rem);letter-spacing:-.02em;line-height:1.25}.queue-stalled{margin:0 0 1.2rem;padding:.85rem 1rem;border:1px solid #6e5428;border-radius:10px;background:var(--accent-soft);color:#f3c878}.queue-stalled a{text-decoration:underline;text-underline-offset:3px}.rail-count{margin-left:auto;min-width:1.6rem;padding:.1rem .45rem;border-radius:999px;background:var(--accent-soft);color:#f3c878;font-size:.75rem;font-weight:760;text-align:center}.stats-shell{width:min(1180px,100%)}.stats-heading{margin-bottom:1.8rem}.stats-heading h1{font-size:clamp(2rem,4vw,3.4rem)}.stats-heading p{margin:.65rem 0 0;color:var(--muted)}.tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--line)}.tile{min-width:0;background:var(--surface);padding:1.2rem}.tile .l{display:block;color:var(--muted);font-size:.73rem;font-weight:720;letter-spacing:.04em;text-transform:uppercase}.tile b{display:block;margin-top:.35rem;font-size:clamp(1.35rem,2.5vw,2rem);font-weight:730;letter-spacing:-.04em}.bad{color:var(--danger)}.stats-section{margin-top:2.3rem}.stats-section h2{margin:0 0 .8rem;font-size:1rem}.stats-section>.d{margin:-.4rem 0 .9rem}.limit-form{display:grid;grid-template-columns:minmax(220px,360px) auto minmax(12rem,1fr);gap:.65rem;align-items:end;max-width:760px}.limit-form .save-message{align-self:center}.table-wrap{overflow-x:auto;border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.72rem .65rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:.72rem;font-weight:720;letter-spacing:.04em;text-transform:uppercase}td{font-size:.86rem}.d{color:var(--muted);font-size:.82rem}.err{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem}.snip{color:#d9dce0}.snip:hover{text-decoration:underline;text-underline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:900px){.library-controls{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.watch-layout{grid-template-columns:1fr}.player-wrap{position:static}.player-wrap video{max-height:72vh}.tiles{grid-template-columns:repeat(3,1fr)}}
@media(max-width:620px){.app-bar-inner{min-height:60px}.header-context,.desktop-only{display:none}.library-shell,.stats-shell{padding-top:1.5rem}.library-intro{display:block}.library-intro h1{font-size:2.55rem}.library-controls{grid-template-columns:1fr 1fr}.filter-toggle{grid-column:1/-1}.tag-filter{position:static}.tag-popover{position:fixed;inset:auto 0 0;width:100%;max-height:82vh;overflow:auto;border-radius:16px 16px 0 0;padding:1.1rem}.tag-options{max-height:38vh}.video-grid{grid-template-columns:1fr}.library-footer{align-items:flex-start;flex-direction:column}.pagination{justify-content:flex-start}.watch-shell{padding:1rem}.key-hint{display:none}.form-actions{align-items:stretch}.button.danger{margin-left:0}.tiles,.tiles.four{grid-template-columns:repeat(2,1fr)}.limit-form{grid-template-columns:1fr}.limit-form .button{justify-self:start}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
.library-page{font-size:16px}.icon{width:22px;height:22px;flex:none}.library-rail{position:fixed;inset:0 auto 0 0;width:200px;padding:32px 10px 24px;overflow-y:auto;border-right:1px solid var(--line);background:#0d1013;display:flex;flex-direction:column;z-index:20}.library-rail .brand{padding:0 17px;font-size:1.375rem;letter-spacing:-.04em}.rail-nav{display:grid;gap:8px;margin-top:36px}.rail-link{display:flex;align-items:center;gap:18px;min-height:48px;padding:12px 18px;border:1px solid transparent;border-radius:8px;color:#cdd1d6;font-weight:500;line-height:1.25}.rail-link:hover{background:var(--surface-2);color:var(--text)}.rail-link[aria-current=page]{border-left-color:var(--accent);background:var(--accent-soft);color:#f4be59}.rail-link:focus-visible,.search-button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.rail-footer{margin-top:auto;padding:20px 10px 0}.rail-footer .view-only{display:inline-block;margin-bottom:12px}.sync-label{display:block;color:var(--muted);font-size:.8rem;line-height:1.65;overflow-wrap:anywhere}.sync-label time{display:block}.rail-footer .rail-link{padding-left:6px;padding-right:6px}.rail-logout{margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.library-page .library-shell{width:auto;max-width:none;min-height:100vh;margin-left:200px;padding:56px 28px 40px}.library-page .library-intro{margin-bottom:20px}.library-page .library-intro h1{font-size:3.3rem;line-height:1.08;letter-spacing:-.04em}.library-page .library-summary{margin:.4rem 0 0;font-size:.94rem}.library-page .library-controls{grid-template-columns:minmax(200px,1fr) 116px 156px 156px;gap:16px;border:0;padding:0;margin-bottom:36px;align-items:start}.library-page .library-controls>.field>.field-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.library-page .library-controls input,.library-page .library-controls select,.library-page .tag-trigger{min-height:48px;border-radius:8px;font-size:1rem}.library-page .tag-trigger{width:100%;color:var(--accent);border-color:#705520;background:#211b10}.library-page .tag-trigger:disabled{color:var(--muted);background:var(--surface);border-color:var(--line);cursor:default}.library-page .search-field input{padding-left:44px;padding-right:98px}.library-page .search-field>.icon{position:absolute;left:16px;top:14px;width:20px;height:20px;color:var(--muted);pointer-events:none}.library-page .search-button{right:5px;bottom:5px;min-height:38px;border-radius:6px;padding:0 18px}
.library-page .video-grid{grid-template-columns:repeat(5,minmax(0,1fr));column-gap:20px;row-gap:48px}.library-page .poster{aspect-ratio:1.3;border-radius:10px}.library-page .card-meta{padding:12px 0 0}.library-page .video-title{font-size:1rem;line-height:1.35;min-height:0;font-weight:650;overflow-wrap:anywhere}.library-page .video-details{font-size:.875rem;flex-wrap:wrap}.library-page .tag-list{gap:6px;margin-top:10px}.library-page .tag{font-size:.75rem;padding:3px 9px;max-width:100%;overflow-wrap:anywhere}.library-page .favorite-badge{top:8px;left:8px;right:auto;display:flex;align-items:center;gap:5px;border-radius:6px;letter-spacing:0;padding:5px 8px;font-size:.72rem}.favorite-badge .icon{width:15px;height:15px;fill:currentColor}.duration-badge{position:absolute;right:8px;bottom:8px;background:rgba(9,11,14,.87);color:#f4f1ea;border:1px solid rgba(255,255,255,.12);border-radius:5px;padding:3px 6px;font-size:.82rem;font-variant-numeric:tabular-nums}.library-page .library-footer{margin-top:56px;padding-top:20px}.library-page .page-link{border-radius:7px}.library-page .tag-popover{right:0}.library-page .empty{padding:5rem 1rem}.library-page .video-card{scroll-margin-top:24px}
@media(min-width:1000px) and (max-width:1279px){.library-page .video-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.library-page .library-controls{grid-template-columns:minmax(160px,1fr) 90px 120px 125px;gap:10px}.library-page .library-shell{padding-left:24px;padding-right:24px}}
@media(max-width:999px){.library-rail{position:sticky;inset:auto;top:0;width:auto;min-height:64px;padding:14px 20px;display:flex;flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--line)}.library-rail .brand{padding:0;margin-right:auto;font-size:1.12rem}.rail-nav{display:flex;gap:4px;margin:0;order:3;width:100%;flex-wrap:wrap}.rail-link{gap:8px;padding:10px 12px;min-height:42px}.rail-link .icon{width:18px;height:18px}.rail-footer{margin:0;padding:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rail-footer .view-only{margin:0}.rail-footer .sync-label{font-size:.72rem;line-height:1.4}.rail-logout{border:0;margin:0;padding:0}.rail-footer .rail-link{font-size:.8rem}.library-page .library-shell{margin-left:0;min-height:0;padding:30px 24px}.library-page .library-intro h1{font-size:2.65rem}.library-page .library-controls{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:28px}.library-page .search-field{grid-column:1/-1}.library-page .video-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:28px 18px}.library-page .video-card{scroll-margin-top:150px}.library-page .tag-popover{left:0;right:auto}}
@media(max-width:699px){.library-page .video-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.library-page .library-footer{margin-top:36px;align-items:flex-start;flex-direction:column}.library-page .pagination{justify-content:flex-start}}
@media(max-width:620px){.rail-footer .sync-label{display:none}.library-page .tag-popover{inset:auto 0 0;max-height:82dvh;display:flex;flex-direction:column;padding-bottom:max(1.1rem,env(safe-area-inset-bottom))}.library-page .tag-popover[hidden]{display:none}.library-page .tag-options{min-height:44px;flex:1 1 auto;max-height:38dvh}.library-page .tag-popover .picker-chips{max-height:18dvh;overflow:auto}.library-page .tag-popover-actions{flex-shrink:0}}
@media(max-width:499px){.library-rail{padding:12px 16px}.rail-nav{justify-content:space-between;gap:0}.rail-nav .rail-link{padding:10px 12px}.rail-footer .rail-link .icon{display:none}.library-page .library-shell{padding:28px 16px}.library-page .library-intro h1{font-size:2.4rem}.library-page .library-controls{grid-template-columns:90px minmax(0,1fr) minmax(0,1fr);gap:8px}.library-page .library-controls select{padding-left:10px;padding-right:4px;font-size:.82rem}.library-page .video-grid{grid-template-columns:1fr;row-gap:30px}.library-page .poster{aspect-ratio:16/10}.library-page .video-title{min-height:0;font-size:1.05rem}.library-page .video-details{font-size:.86rem}.library-page .tag{font-size:.76rem}.library-page .page-link{min-width:36px;padding:.55rem .65rem}}
`;

const page = (t: string, body: string, bodyClass = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090b0e"><title>${esc(t)} · x-downloader</title><style>${CSS}</style></head><body class="${bodyClass}"><a class="skip" href="#content">Skip to content</a>${body}</body></html>`;

const appHeader = (context: string, actions: string, isOwner = true) => `<header class="app-bar"><div class="app-bar-inner">
  <a class="brand" href="/">x<span>-</span>downloader</a>
  <span class="header-context">${context}</span>
  <nav class="header-actions" aria-label="Account and application">${isOwner ? "" : '<span class="view-only">View only</span>'}${actions}<a class="nav-link" href="/cdn-cgi/access/logout">Log out</a></nav>
</div></header>`;

const pageNumbers = (current: number, total: number): Array<number | "gap"> => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const values: Array<number | "gap"> = [1];
  const start = Math.max(2, current - 1), end = Math.min(total - 1, current + 1);
  if (start > 2) values.push("gap");
  for (let n = start; n <= end; n++) values.push(n);
  if (end < total - 1) values.push("gap");
  values.push(total);
  return values;
};

export function renderIndex(rows: BookmarkRow[], status: Status, q: LibraryQuery = {}, total = rows.length, isOwner = true, availableTags: TagOption[] = [], queueCount = 0): string {
  const pageNumber = q.page ?? 1, perPage = q.perPage ?? DEFAULT_LIBRARY_PAGE_SIZE;
  const selectedTags = q.tags ?? [], selectedKeys = new Set(selectedTags.map((tag) => tag.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const link = (over: Partial<LibraryQuery>) => libraryHref({ ...q, ...over });
  // ponytail: multi-video posts show the first video only; the others are in R2 as <id>-n.mp4 (rclone gets them).
  const cards = rows.map((r) => `<a class="video-card" id="video-${esc(r.post_id)}" href="${esc(watchHref(r.post_id, q))}" aria-label="Play ${esc(title(r))}">
  <div class="poster">${r.preview_url ? `<img loading="lazy" src="/p/${esc(r.post_id)}" alt="${esc(title(r))}">` : ""}${r.favorite ? `<span class="favorite-badge">${icon("heart")}Favourite</span>` : ""}<span class="duration-badge" aria-label="Duration: ${duration(r.duration_ms)}">${duration(r.duration_ms)}</span></div>
  <div class="card-meta"><h2 class="video-title">${esc(title(r))}</h2><div class="video-details"><time datetime="${esc(day(r))}">${esc(day(r))}</time><span class="separator">·</span><span>${mb(r.bytes)}</span></div>${tags(r).length ? `<div class="tag-list">${tags(r).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>` : ""}</div>
</a>`).join("\n");
  const sorts = (["newest", "oldest", "title", "largest", "smallest", "longest", "shortest"] as const).map((s) => `<option value="${s}"${(q.sort ?? "newest") === s ? " selected" : ""}>${s[0]!.toUpperCase()}${s.slice(1)}</option>`).join("");
  const sizes = LIBRARY_PAGE_SIZES.map((n) => `<option value="${n}"${perPage === n ? " selected" : ""}>${n} per page</option>`).join("");
  const tagRows = availableTags.map(({ tag, count }) => {
    const selected = selectedKeys.has(tag.toLowerCase());
    return `<button class="tag-option" type="button" role="option" data-tag="${esc(tag)}" data-tag-count="${count}" aria-selected="${selected}"${selected ? " disabled" : ""}><span class="tag-option-name">${esc(tag)}</span><span class="tag-option-count">${count}</span>${selected ? '<span class="tag-option-state">Selected</span>' : ""}</button>`;
  }).join("");
  const tagChips = selectedTags.map((tag) => `<span class="picker-chip" data-selected-tag="${esc(tag)}"><span>${esc(tag)}</span><button type="button" aria-label="Remove ${esc(tag)}">Remove</button></span>`).join("");
  const tagHidden = selectedTags.map((tag) => `<input type="hidden" name="tag" value="${esc(tag)}" data-tag-hidden>`).join("");
  const start = total ? (pageNumber - 1) * perPage + 1 : 0, end = total ? start + rows.length - 1 : 0;
  const pagination = totalPages > 1 ? `<nav class="pagination" aria-label="Library pages">
    ${pageNumber > 1 ? `<a class="page-link" href="${esc(link({ page: pageNumber - 1 }))}" aria-label="Previous page">Previous</a>` : '<span class="page-link disabled" aria-hidden="true">Previous</span>'}
    ${pageNumbers(pageNumber, totalPages).map((n) => n === "gap" ? '<span class="page-gap" aria-hidden="true">…</span>' : `<a class="page-link" href="${esc(link({ page: n }))}"${n === pageNumber ? ' aria-current="page"' : ""}>${n}</a>`).join("")}
    ${pageNumber < totalPages ? `<a class="page-link" href="${esc(link({ page: pageNumber + 1 }))}" aria-label="Next page">Next</a>` : '<span class="page-link disabled" aria-hidden="true">Next</span>'}
  </nav>` : "";
  const tagSummary = selectedTags.length ? ` tagged ${selectedTags.map(esc).join(" + ")}` : "";
  const clearTagHref = link({ tags: undefined, page: 1 });
  return page("Library", `<aside class="library-rail" aria-label="Application">
  <a class="brand" href="/"><span>x</span>-downloader</a>
  <nav class="rail-nav" aria-label="Library navigation">
    <a class="rail-link" data-library-view="library" href="${esc(link({ fav: false, page: 1 }))}"${!q.fav ? ' aria-current="page"' : ""}>${icon("library")}<span>Library</span></a>
    <a class="rail-link" data-library-view="favourites" href="${esc(link({ fav: true, page: 1 }))}"${q.fav ? ' aria-current="page"' : ""}>${icon("heart")}<span>Favourites</span></a>
    ${isOwner ? `<a class="rail-link" href="/stats">${icon("stats")}<span>Stats</span></a>` : ""}
    ${isOwner ? `<a class="rail-link" href="/queue">${icon("clock")}<span>Queue</span>${queueCount ? `<span class="rail-count" aria-label="${queueCount} waiting">${queueCount}</span>` : ""}</a>` : ""}
  </nav>
  <div class="rail-footer">${isOwner ? "" : '<span class="view-only">View only</span>'}
    <span class="sync-label">Last sync ${status.lastRun ? `<time datetime="${esc(status.lastRun)}" title="${esc(status.lastRun)}">${esc(status.lastRun.replace("T", " ").slice(0, 16))} UTC</time>` : "unavailable"}</span>
    ${isOwner && status.auth === "needs_reauth" ? '<a class="rail-link" href="/oauth/start">Re-authorize</a>' : ""}
    <div class="rail-logout"><a class="rail-link" href="/cdn-cgi/access/logout">${icon("logout")}<span>Log out</span></a></div>
  </div>
</aside>
<main id="content" class="library-shell">
  <section class="library-intro" aria-labelledby="library-title"><div><h1 id="library-title">Video library</h1><p class="library-summary"><span class="result-total">${total} ${total === 1 ? "video" : "videos"}</span>${q.q ? ` matching “${esc(q.q)}”` : ""}${tagSummary}${q.fav ? ", favourites only" : ""}</p></div></section>
  <form class="library-controls" method="get" action="/">
    <label class="field search-field"><span class="field-label">Search library</span>${icon("search")}<input type="search" name="q" placeholder="Search title, description, tags, or post text" value="${esc(q.q ?? "")}"><button class="search-button" type="submit">Search</button></label>
    ${q.fav ? '<input type="hidden" name="fav" value="1">' : ""}
    ${tagHidden}
    <div class="field tag-filter" id="tag-filter"><span class="field-label">Tags</span>
      <button id="tag-trigger" class="filter-toggle tag-trigger${selectedTags.length ? " on" : ""}" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="tag-popover" aria-label="Filter by tags, ${selectedTags.length} selected"${!availableTags.length && !selectedTags.length ? ' disabled aria-describedby="no-tags-description"' : ""}>Tags${selectedTags.length ? ` <span class="tag-count">${selectedTags.length}</span>` : ""}</button>
      ${!availableTags.length && !selectedTags.length ? '<span id="no-tags-description" class="sr-only">No tags yet</span>' : ""}
      <section id="tag-popover" class="tag-popover" aria-labelledby="tag-popover-title" hidden>
        <h2 id="tag-popover-title">Filter by tags</h2>
        <input id="tag-search" class="tag-search" type="search" placeholder="Find a tag" role="combobox" aria-expanded="true" aria-controls="tag-options" aria-autocomplete="list">
        <p class="picker-section-label"><span>Selected (<span id="tag-selected-count">${selectedTags.length}</span>)</span></p>
        <div id="tag-selected" class="picker-chips">${tagChips}</div>
        <div id="tag-options" class="tag-options" role="listbox" aria-multiselectable="true">${tagRows || '<p class="tag-empty">No tags yet.</p>'}</div>
        <p class="tag-popover-hint">Results must contain all selected tags.</p>
        <div class="tag-popover-actions"><button id="tag-clear" class="button" type="button">Clear</button><button id="tag-apply" class="button primary" type="button">Apply filters</button></div>
      </section>
    </div>
    <label class="field"><span class="field-label">Sort by</span><select name="sort" onchange="this.form.submit()">${sorts}</select></label>
    <label class="field"><span class="field-label">Videos per page</span><select name="perPage" onchange="this.form.submit()">${sizes}</select></label>
  </form>
  <section class="video-grid" aria-label="Videos">${cards || `<div class="empty"><h2>No matching videos</h2><p>${selectedTags.length ? `Try removing a tag or <a class="clear-tags-link" href="${esc(clearTagHref)}">clear tag filters</a>.` : 'Try another search or <a href="/">clear the current filters</a>.'}</p></div>`}</section>
  ${total ? `<footer class="library-footer"><p class="range">${start}–${end} of ${total} videos</p>${pagination}</footer>` : ""}
</main>
<script>
(()=>{const root=document.getElementById("tag-filter"),trigger=document.getElementById("tag-trigger");if(!root||!trigger||trigger.disabled)return;const form=trigger.closest("form"),popover=document.getElementById("tag-popover"),search=document.getElementById("tag-search"),selectedBox=document.getElementById("tag-selected"),count=document.getElementById("tag-selected-count"),optionsBox=document.getElementById("tag-options"),clear=document.getElementById("tag-clear"),apply=document.getElementById("tag-apply"),available=JSON.parse(${js(JSON.stringify(availableTags))}),committed=JSON.parse(${js(JSON.stringify(selectedTags))});let draft=committed.slice(),active=-1;
const key=t=>t.toLowerCase(),has=t=>draft.some(x=>key(x)===key(t)),remove=t=>{draft=draft.filter(x=>key(x)!==key(t));render()};
function chip(t){const c=document.createElement("span"),label=document.createElement("span"),b=document.createElement("button");c.className="picker-chip";c.dataset.selectedTag=t;label.textContent=t;b.type="button";b.textContent="Remove";b.setAttribute("aria-label","Remove "+t);b.onclick=()=>remove(t);c.append(label,b);return c}
function option(o){const b=document.createElement("button"),name=document.createElement("span"),n=document.createElement("span");b.type="button";b.className="tag-option";b.dataset.tag=o.tag;b.dataset.tagCount=String(o.count);b.setAttribute("role","option");b.setAttribute("aria-selected",String(has(o.tag)));b.disabled=has(o.tag);name.className="tag-option-name";name.textContent=o.tag;n.className="tag-option-count";n.textContent=String(o.count);b.append(name,n);if(b.disabled){const state=document.createElement("span");state.className="tag-option-state";state.textContent="Selected";b.append(state)}else b.onclick=()=>{draft.push(o.tag);render()};return b}
function visible(){return [...optionsBox.querySelectorAll("button:not(:disabled)")].filter(b=>!b.hidden)}
function setActive(i){const rows=visible();rows.forEach(b=>{b.classList.remove("active");b.removeAttribute("id")});if(!rows.length){active=-1;search.removeAttribute("aria-activedescendant");return}active=(i+rows.length)%rows.length;const b=rows[active];b.id="tag-active-option";b.classList.add("active");search.setAttribute("aria-activedescendant",b.id);b.scrollIntoView({block:"nearest"})}
function render(){selectedBox.replaceChildren(...draft.map(chip));count.textContent=String(draft.length);const query=search.value.trim().toLowerCase();const rows=available.filter(o=>o.tag.toLowerCase().includes(query)).map(option);optionsBox.replaceChildren(...(rows.length?rows:[Object.assign(document.createElement("p"),{className:"tag-empty",textContent:"No matching tags."})]));active=-1;search.removeAttribute("aria-activedescendant")}
function close(restoreFocus=true){popover.hidden=true;trigger.setAttribute("aria-expanded","false");draft=committed.slice();search.value="";render();if(restoreFocus)trigger.focus()}
function open(){draft=committed.slice();search.value="";render();popover.hidden=false;trigger.setAttribute("aria-expanded","true");search.focus()}
trigger.onclick=()=>popover.hidden?open():close();search.oninput=render;search.onkeydown=e=>{if(e.key==="ArrowDown"){e.preventDefault();setActive(active+1)}else if(e.key==="ArrowUp"){e.preventDefault();setActive(active-1)}else if(e.key==="Enter"&&active>=0){e.preventDefault();visible()[active]?.click()}else if(e.key==="Escape"){e.preventDefault();close()}};clear.onclick=()=>{draft=[];render()};apply.onclick=()=>{const params=new URLSearchParams(),query=form.elements.q.value.trim(),sort=form.elements.sort.value,perPage=form.elements.perPage.value;if(query)params.set("q",query);if(form.elements.fav)params.set("fav","1");for(const tag of draft)params.append("tag",tag);if(sort!=="newest")params.set("sort",sort);if(perPage!=="10")params.set("perPage",perPage);location.assign(params.size?"/?"+params:"/")};document.addEventListener("pointerdown",e=>{if(!popover.hidden&&!root.contains(e.target))close(false)});render()})();
</script>`, "library-page");
}

export function renderWatch(r: BookmarkRow, q: LibraryQuery = {}, isOwner = true, availableTags: TagOption[] = []): string {
  const backToLibrary = libraryHref(q, `#video-${r.post_id}`), deleteReturn = libraryHref(q);
  const initialTags = tags(r), initialKeys = new Set(initialTags.map((tag) => tag.toLowerCase()));
  const initialChips = initialTags.map((tag) => `<span class="picker-chip"><span>${esc(tag)}</span><button type="button" aria-label="Remove ${esc(tag)}">Remove</button></span>`).join("");
  const initialOptions = availableTags.map(({ tag, count }) => {
    const selected = initialKeys.has(tag.toLowerCase());
    return `<button class="tag-option" type="button" role="option" data-tag="${esc(tag)}" data-tag-count="${count}" aria-selected="${selected}"${selected ? " disabled" : ""}><span class="tag-option-name">${esc(tag)}</span><span class="tag-option-count">${count}</span>${selected ? '<span class="tag-option-state">Added</span>' : ""}</button>`;
  }).join("");
  const ownerControls = isOwner ? `<form id="meta" class="meta-form">
        <label class="field"><span class="field-label">Title</span><input name="title" maxlength="200" placeholder="Add a title" value="${esc(r.title)}"></label>
        <label class="field"><span class="field-label">Description</span><textarea name="description" maxlength="2000" placeholder="Add a description">${esc(r.description)}</textarea></label>
        <div class="field video-tag-picker" id="video-tag-picker" data-initial-tags="${esc(JSON.stringify(initialTags))}"><label class="field-label" for="video-tag-input">Tags</label>
          <div class="video-tag-control"><div id="video-tag-chips" class="picker-chips">${initialChips}</div><input id="video-tag-input" type="text" placeholder="Add a tag" role="combobox" aria-expanded="false" aria-controls="video-tag-options" aria-autocomplete="list"></div>
          <div id="video-tag-options" class="video-tag-options" role="listbox" aria-multiselectable="true" hidden>${initialOptions || '<p class="tag-empty">Type to create your first tag.</p>'}</div>
          <p id="video-tag-help" class="picker-help">Choose an existing tag or type a new one and press Enter.</p>
        </div>
        <div class="form-actions"><button class="button primary" type="submit">Save details</button><button type="button" id="fav" class="button${r.favorite ? " on" : ""}">${r.favorite ? "Favourited" : "Add to favourites"}</button><button type="button" id="del" class="button danger">Delete video</button></div>
        <span id="msg" class="save-message" role="status" aria-live="polite"></span>
      </form>` : r.description ? `<p class="source-copy">${esc(r.description)}</p>` : "";
  const ownerScript = isOwner ? `<script>
const api="/api/videos/${esc(r.post_id)}",msg=document.getElementById("msg"),backToLibrary=${js(deleteReturn)},availableTags=JSON.parse(${js(JSON.stringify(availableTags))});let fav=${r.favorite ? "true" : "false"},stagedTags=JSON.parse(${js(JSON.stringify(initialTags))}),newTagKeys=new Set(),tagActive=-1;
const tagRoot=document.getElementById("video-tag-picker"),tagInput=document.getElementById("video-tag-input"),tagChips=document.getElementById("video-tag-chips"),tagOptions=document.getElementById("video-tag-options"),tagHelp=document.getElementById("video-tag-help"),tagKey=t=>t.toLowerCase(),hasTag=t=>stagedTags.some(x=>tagKey(x)===tagKey(t));
function makeChip(t){const c=document.createElement("span"),label=document.createElement("span"),remove=document.createElement("button");c.className="picker-chip";c.dataset.tagKey=tagKey(t);label.textContent=t;if(newTagKeys.has(tagKey(t))){const marker=document.createElement("span");marker.className="new-tag";marker.textContent="New";c.append(label,marker)}else c.append(label);remove.type="button";remove.textContent="Remove";remove.setAttribute("aria-label","Remove "+t);remove.onclick=()=>{stagedTags=stagedTags.filter(x=>tagKey(x)!==tagKey(t));newTagKeys.delete(tagKey(t));renderVideoTags()};c.append(remove);return c}
function makeOption(o){const b=document.createElement("button"),name=document.createElement("span"),n=document.createElement("span"),selected=hasTag(o.tag);b.type="button";b.className="tag-option";b.dataset.tag=o.tag;b.dataset.tagCount=String(o.count);b.setAttribute("role","option");b.setAttribute("aria-selected",String(selected));b.disabled=selected||stagedTags.length>=12;name.className="tag-option-name";name.textContent=o.tag;n.className="tag-option-count";n.textContent=String(o.count);b.append(name,n);if(selected){const state=document.createElement("span");state.className="tag-option-state";state.textContent="Added";b.append(state)}else if(!b.disabled)b.onclick=()=>addTag(o.tag,false);b.onpointerdown=e=>e.preventDefault();return b}
function makeCreate(raw){const b=document.createElement("button");b.type="button";b.className="create-tag";b.textContent='Create “'+raw+'” · Enter';b.onclick=()=>addTag(raw,true);b.onpointerdown=e=>e.preventDefault();return b}
function actionable(){return [...tagOptions.querySelectorAll("button:not(:disabled)")]}
function setTagActive(i){const rows=actionable();rows.forEach(b=>{b.classList.remove("active");b.removeAttribute("id")});if(!rows.length){tagActive=-1;tagInput.removeAttribute("aria-activedescendant");return}tagActive=(i+rows.length)%rows.length;const b=rows[tagActive];b.id="video-tag-active";b.classList.add("active");tagInput.setAttribute("aria-activedescendant",b.id);b.scrollIntoView({block:"nearest"})}
function renderVideoTags(){tagChips.replaceChildren(...stagedTags.map(makeChip));const raw=tagInput.value.trim(),query=raw.toLowerCase(),matching=availableTags.filter(o=>o.tag.toLowerCase().includes(query)),exact=availableTags.find(o=>tagKey(o.tag)===query);const rows=matching.map(makeOption);if(raw&&!exact&&!hasTag(raw)&&raw.length<=30&&stagedTags.length<12)rows.unshift(makeCreate(raw));if(!rows.length){const p=document.createElement("p");p.className="tag-empty";p.textContent=raw.length>30?"Tags can be at most 30 characters.":"No matching tags.";rows.push(p)}tagOptions.replaceChildren(...rows);tagHelp.textContent=stagedTags.length>=12?"Maximum 12 tags.":"Choose an existing tag or type a new one and press Enter.";tagHelp.classList.toggle("picker-error",raw.length>30);tagActive=-1;tagInput.removeAttribute("aria-activedescendant")}
function addTag(raw,isNew){const tag=raw.trim();if(!tag||tag.length>30||stagedTags.length>=12)return;const existing=availableTags.find(o=>tagKey(o.tag)===tagKey(tag)),value=existing?.tag??tag;if(hasTag(value)){const chip=tagChips.querySelector('[data-tag-key="'+CSS.escape(tagKey(value))+'"]');chip?.classList.add("flash");setTimeout(()=>chip?.classList.remove("flash"),400);return}stagedTags.push(value);if(isNew&&!existing)newTagKeys.add(tagKey(value));tagInput.value="";renderVideoTags();tagOptions.hidden=false}
function closeTagOptions(){tagOptions.hidden=true;tagInput.setAttribute("aria-expanded","false");tagInput.value="";renderVideoTags()}
tagInput.onfocus=()=>{renderVideoTags();tagOptions.hidden=false;tagInput.setAttribute("aria-expanded","true")};tagInput.oninput=()=>{renderVideoTags();tagOptions.hidden=false};tagInput.onkeydown=e=>{if(e.key==="ArrowDown"){e.preventDefault();setTagActive(tagActive+1)}else if(e.key==="ArrowUp"){e.preventDefault();setTagActive(tagActive-1)}else if(e.key==="Enter"){e.preventDefault();const row=actionable()[tagActive];if(row)row.click();else{const raw=tagInput.value.trim(),existing=availableTags.find(o=>tagKey(o.tag)===tagKey(raw));if(existing)addTag(existing.tag,false);else addTag(raw,true)}}else if(e.key==="Escape"){e.preventDefault();closeTagOptions()}else if(e.key==="Backspace"&&!tagInput.value&&stagedTags.length){const last=stagedTags.at(-1);stagedTags.pop();if(last)newTagKeys.delete(tagKey(last));renderVideoTags()}};tagRoot.addEventListener("focusout",()=>setTimeout(()=>{if(!tagRoot.contains(document.activeElement))closeTagOptions()}));document.addEventListener("pointerdown",e=>{if(!tagRoot.contains(e.target))closeTagOptions()});renderVideoTags();
async function send(method,body){const res=await fetch(api,{method,headers:body?{"content-type":"application/json"}:{},body:body&&JSON.stringify(body)});if(!res.ok){msg.textContent="Action failed ("+res.status+"). Your changes are still here.";return false}return true}
document.getElementById("meta").onsubmit=async e=>{e.preventDefault();const f=e.target;if(await send("POST",{title:f.title.value,description:f.description.value,tags:stagedTags})){newTagKeys.clear();renderVideoTags();msg.textContent="Saved";setTimeout(()=>msg.textContent="",1800)}};
document.getElementById("fav").onclick=async()=>{if(await send("POST",{favorite:!fav})){fav=!fav;const b=document.getElementById("fav");b.classList.toggle("on",fav);b.textContent=fav?"Favourited":"Add to favourites"}};
document.getElementById("del").onclick=async()=>{if(confirm("Delete this video from storage? This cannot be undone.")&&await send("DELETE"))location.href=backToLibrary};
</script>` : "";
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}\xD7</option>`).join("");
  const playerScript = `<script>
(()=>{const v=document.querySelector("video"),speed=document.getElementById("speed"),resumeMs=${isOwner ? r.resume_ms ?? 0 : 0},save=${isOwner ? `ms=>fetch(${js(`/api/videos/${r.post_id}`)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resume_ms:ms}),keepalive:true}).catch(()=>{})` : "null"};
const restore=()=>{if(resumeMs>5000&&resumeMs<v.duration*1000-10000)v.currentTime=resumeMs/1000};if(v.readyState>=1)restore();else v.addEventListener("loadedmetadata",restore,{once:true});
if(save){let last=-1;const mark=()=>{const ms=v.ended?0:Math.round(v.currentTime*1000);if(ms!==last){last=ms;save(ms)}};v.addEventListener("pause",mark);v.addEventListener("ended",mark);addEventListener("pagehide",mark)}
speed.onchange=()=>{v.playbackRate=Number(speed.value)};const stepSpeed=d=>{const i=speed.selectedIndex+d;if(i>=0&&i<speed.options.length){speed.selectedIndex=i;speed.onchange()}};
const seek=s=>{v.currentTime=Math.min(Math.max(0,v.currentTime+s),v.duration||0)},toggle=()=>v.paused?v.play():v.pause();
document.addEventListener("keydown",e=>{if(e.metaKey||e.ctrlKey||e.altKey||e.target===v||e.target.closest?.("input,textarea,select,button,a"))return;const act={" ":toggle,k:toggle,j:()=>seek(-10),l:()=>seek(10),arrowleft:()=>seek(-5),arrowright:()=>seek(5),m:()=>{v.muted=!v.muted},f:()=>v.requestFullscreen?v.requestFullscreen():v.webkitEnterFullscreen(),"<":()=>stepSpeed(-1),">":()=>stepSpeed(1)}[e.key.toLowerCase()];if(act){e.preventDefault();act()}})})();
<\/script>`;
  return page(title(r), `${appHeader("Watching from your library", `<a class="nav-link" href="${esc(backToLibrary)}">Back to library</a><a class="nav-link desktop-only" href="/v/${esc(r.r2_key)}" download="${esc(r.post_id)}.mp4">Download</a>`, isOwner)}
<main id="content" class="watch-shell">
  <div class="watch-layout">
    <div class="player-wrap"><video controls playsinline preload="metadata" src="/v/${esc(r.r2_key)}"${r.preview_url ? ` poster="/p/${esc(r.post_id)}"` : ""}></video>
      <div class="player-bar"><label><span>Speed</span><select id="speed" aria-label="Playback speed">${speeds}</select></label><span class="key-hint">Space play \xB7 J/L \xB110s \xB7 \u2190/\u2192 \xB15s \xB7 M mute \xB7 F fullscreen \xB7 &lt; &gt; speed</span></div></div>
    <section class="watch-panel" aria-labelledby="watch-title">
      <header class="watch-heading"><p class="eyebrow">Library video</p><h1 id="watch-title">${esc(title(r))}</h1><p class="watch-byline">Saved ${esc(day(r))} · ${mb(r.bytes)}</p></header>
      ${ownerControls}
      <p class="source-copy">${esc(r.text)}</p>
      <p class="source-links"><a href="${url(r.post_url)}">Original post</a><span>·</span><a href="/v/${esc(r.r2_key)}" download>Download file</a><span>·</span><span>${mb(r.bytes)}</span></p>
    </section>
  </div>
</main>
${playerScript}${ownerScript}`);
}

// Stat tiles + tables, no charts: there is no time series to plot, only current counts.
export function renderStats(stats: StatRow[], status: Status, pausedUntil: number, maxFileBytes: number): string {
  const live = stats.filter((r) => !r.deleted);
  const n = (st: string) => live.filter((r) => r.status === st).reduce((a, r) => a + r.n, 0);
  const tile = (key: string, label: string, value: string | number, cls = "") => `<div class="tile"><span class="l">${label}</span><b class="${cls}" data-stat="${key}">${value}</b></div>`;
  const reasons = live.filter((r) => r.status === "failed").sort((a, b) => b.n - a.n)
    .map((r) => `<tr><td class="err">${esc(r.error ?? "?")}</td><td>${r.n}</td></tr>`).join("");
  const c = status.counts ?? {};
  const alerts = Object.entries(status.alerts ?? {}).map(([k, t]) => `${esc(k)} ${esc(t)}`).join(", ");
  return page("Stats", `${appHeader(`Last synced ${esc(status.lastRun ?? "never")}`, '<a class="nav-link desktop-only" href="/">Library</a><a class="nav-link" href="/queue">Queue</a><a class="nav-link desktop-only" href="/backfill">Run backfill</a>')}
<main id="content" class="stats-shell">
  <header class="stats-heading"><p class="eyebrow">Operations</p><h1>Library health</h1><p>Current storage, download status, and recovery actions.</p></header>
  <div class="tiles">
    ${tile("downloaded", "Downloaded", n("downloaded"))}${tile("pending", "Pending", n("pending"))}${tile("failed", "Failed", n("failed"), n("failed") ? "bad" : "")}
    ${tile("no_video", "No video", n("no_video"))}${tile("deleted", "Deleted", stats.filter((r) => r.deleted).reduce((a, r) => a + r.n, 0))}
    ${tile("bytes", "Stored", bytes(live.filter((r) => r.status === "downloaded").reduce((a, r) => a + r.bytes, 0)))}
  </div>
  <section class="stats-section"><h2>Download limit</h2>
    <form id="max-file-limit" class="limit-form">
      <label class="field"><span class="field-label">Maximum file size (MB)</span><input id="max-file-mb" name="maxFileMb" type="number" min="1" max="${MAX_FILE_BYTES / 1024 ** 2}" step="1" value="${maxFileBytes / 1024 ** 2}" required></label>
      <button class="button primary" type="submit">Save limit</button><span id="limit-msg" class="save-message" role="status" aria-live="polite"></span>
    </form>
    <p class="d">1–${MAX_FILE_BYTES / 1024 ** 2} MB (${MAX_FILE_BYTES / 1024 ** 3} GB hard maximum). A saved change applies to the next cron or backfill run; retrying failed posts remains a separate action.</p>
  </section>
  <section class="stats-section"><h2>Health</h2><div class="table-wrap"><table>
    <tr><th>Last run</th><td>${esc(status.lastRun ?? "never")}</td></tr>
    <tr><th>Auth</th><td>${status.auth === "needs_reauth" ? '<span class="bad">needs re-auth</span> · <a href="/oauth/start">re-authorize</a>' : esc(status.auth ?? "unknown")}</td></tr>
    <tr><th>Last error</th><td class="err">${status.lastError ? `<span class="bad">${esc(status.lastError)}</span>` : "none"}</td></tr>
    <tr><th>Paused</th><td>${pausedUntil > Date.now() ? `<span class="bad">until ${esc(new Date(pausedUntil).toISOString())}</span>` : "no"}</td></tr>
    <tr><th>Last run counts</th><td>${status.counts ? `seen ${c.seen ?? 0} · downloaded ${c.downloaded ?? 0} · failed ${c.failed ?? 0} · pages ${c.pages ?? 0}` : "—"}</td></tr>
    <tr><th>Active alerts</th><td>${alerts || "none"}</td></tr>
  </table></div></section>
  <section class="stats-section"><h2>Failures by reason</h2>${reasons ? `<div class="table-wrap"><table><tr><th>Error</th><th>Posts</th></tr>${reasons}</table></div>` : '<p class="d">None.</p>'}</section>
</main>
<script>
document.getElementById("max-file-limit").onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector("button"),m=document.getElementById("limit-msg"),mb=Number(f.maxFileMb.value);b.disabled=true;m.textContent="Saving…";const r=await fetch("/api/settings/max-file-bytes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({maxFileBytes:mb*1024**2})});b.disabled=false;m.textContent=r.ok?"Saved. Applies to the next run.":"Save failed: "+r.status};
</script>`);
}

// Next */30 cron tick strictly after `now` (wrangler.toml crons; CRON_INTERVAL_MS).
export const nextTick = (now: number) => (Math.floor(now / CRON_INTERVAL_MS) + 1) * CRON_INTERVAL_MS;
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

// Approximate: one post may hold several videos, and new bookmarks on the cron's newest page can join ahead (spec 2026-10-31).
export function renderQueue(queue: { pending: BookmarkRow[]; failed: BookmarkRow[] }, status: Status, pausedUntil: number, now = Date.now()): string {
  const { pending, failed } = queue, first = nextTick(now);
  const eta = (position: number) => first + (Math.ceil(position / MAX_DOWNLOADS_PER_RUN) - 1) * CRON_INTERVAL_MS;
  const stalled = pausedUntil > now
    ? `Downloads are paused until ${esc(new Date(pausedUntil).toISOString())}; the queue resumes after that.`
    : status.auth === "needs_reauth" ? 'X authorization has expired, so nothing downloads until you <a href="/oauth/start">re-authorize</a>.' : "";
  const snippet = (r: BookmarkRow) => (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || r.post_id;
  const tile = (key: string, label: string, value: string | number, cls = "") => `<div class="tile"><span class="l">${label}</span><b class="${cls}" data-stat="${key}">${value}</b></div>`;
  const pendingRows = pending.map((r, i) => `<tr>
  <td class="d">${i + 1}</td><td><a class="snip" href="${url(r.post_url)}">${esc(snippet(r))}</a></td><td class="d desktop-only">${esc(r.first_seen_at.slice(0, 10))}</td>
  <td class="d desktop-only">${esc(r.updated_at.slice(0, 16).replace("T", " "))}</td><td class="err">${esc(r.error)}</td><td>${stalled ? "—" : `≈ ${utc(eta(i + 1))}`}</td>
</tr>`).join("");
  const failedRows = failed.map((r) => `<tr>
  <td><a class="snip" href="${url(r.post_url)}">${esc(snippet(r))}</a></td><td class="err">${esc(r.error)}</td><td class="d desktop-only">${esc(r.updated_at.slice(0, 16).replace("T", " "))}</td>
  <td>${r.bytes ? mb(r.bytes) : ""}</td><td><button type="button" data-retry="${esc(r.post_id)}" class="button">Retry</button></td>
</tr>`).join("");
  const empty = !pending.length && !failed.length;
  return page("Queue", `${appHeader(`Last synced ${esc(status.lastRun ?? "never")}`, '<a class="nav-link desktop-only" href="/">Library</a><a class="nav-link" href="/stats">Stats</a><a class="nav-link desktop-only" href="/backfill">Run backfill</a>')}
<main id="content" class="stats-shell">
  <header class="stats-heading"><p class="eyebrow">Operations</p><h1>Download queue</h1><p>Bookmarks already captured and waiting to download (${MAX_DOWNLOADS_PER_RUN} every ${CRON_INTERVAL_MS / 60_000} minutes), plus posts that cannot download.</p></header>
  ${stalled ? `<p class="queue-stalled" role="status">${stalled}</p>` : ""}
  <div class="tiles four">
    ${tile("queue-pending", "Pending", pending.length)}${tile("queue-failed", "Failed", failed.length, failed.length ? "bad" : "")}
    ${tile("queue-next", "Next run", stalled ? "—" : utc(first), "time")}${tile("queue-drain", "Queue empty by", stalled || !pending.length ? "—" : `≈ ${utc(eta(pending.length))}`, "time")}
  </div>
  ${empty ? `<section class="stats-section"><p class="d">Nothing waiting. Every captured bookmark is downloaded.</p></section>` : `
  <section class="stats-section"><h2>Pending</h2><p class="d">In download order. Times are estimates; a post with several videos uses several downloads.</p>${pending.length ? `<div class="table-wrap"><table><tr><th>#</th><th>Post</th><th class="desktop-only">First seen</th><th class="desktop-only">Last attempt</th><th>Error</th><th>Expected</th></tr>${pendingRows}</table></div>` : '<p class="d">None.</p>'}</section>
  <section class="stats-section"><h2>Failed</h2><p class="d">Retry resets a post to pending; it is re-attempted the next time a sync sees it. <code>too_large</code> fails again unless the size limit on Stats changes.</p>${failed.length ? `<p><button class="button" type="button" id="retry-all">Retry all failed (${failed.length})</button></p><div class="table-wrap"><table><tr><th>Post</th><th>Error</th><th class="desktop-only">Updated</th><th>Size</th><th></th></tr>${failedRows}</table></div>` : '<p class="d">None.</p>'}</section>`}
</main>
<script>
document.querySelectorAll("[data-retry]").forEach(b=>b.onclick=async()=>{b.disabled=true;const r=await fetch("/api/videos/"+b.dataset.retry+"/retry",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(r.ok)location.reload();else{alert("retry failed: "+r.status);b.disabled=false}});
const ra=document.getElementById("retry-all");if(ra)ra.onclick=async()=>{ra.disabled=true;const r=await fetch("/api/videos/retry-all",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(r.ok)location.reload();else{alert("retry all failed: "+r.status);ra.disabled=false}};
</script>`);
}
