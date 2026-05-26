/**
 * Default configuration for the PictRendererGraph fable service.
 *
 * Every field is overridable via the options bag passed to the constructor.
 * The defaults are tuned for "local development on a workstation": headless
 * Chromium, no sandbox flags (since most retold installs run as the user),
 * one render at a time.
 */

module.exports = ({

	// Puppeteer launch options.  Merged shallow over puppeteer.launch defaults.
	// `headless: 'new'` is the post-2024 puppeteer headless mode; falls back
	// to true on older puppeteer.  --no-sandbox is needed in Docker / CI;
	// safe enough locally.
	"PuppeteerLaunch":
	{
		"headless":      true,
		"args":          [ "--no-sandbox", "--disable-setuid-sandbox" ],
		"defaultViewport": { "width": 1600, "height": 1200 }
	},

	// Where the wrapper bundle + assets live, relative to this module's
	// node_modules.  Override only if you've stashed a custom build
	// somewhere else.
	"VendorBuiltPath":
		require('path').resolve(__dirname, '..', 'node_modules', 'pict-section-excalidraw', 'vendor', 'excalidraw-built'),

	// Asset server (node's built-in http) — port 0 means "random free port"
	// chosen at warm() time.  Hostname stays loopback so we don't expose
	// vendor assets on a routable interface.
	"AssetServer":
	{
		"port":     0,
		"hostname": "127.0.0.1"
	},

	// How long to wait for window.PictSectionExcalidrawVendor to be defined
	// after navigation.  Slow CI machines and cold-start chromium will
	// occasionally need >5s.
	"WarmTimeoutMs":   30000,

	// How long to wait for a single exportToSvg / exportToBlob call to
	// resolve in-page.  Includes Excalidraw's text-measurement passes.
	"RenderTimeoutMs": 30000,

	// If true, the service auto-warms on the first render() call instead
	// of requiring an explicit initialize().  Convenient for one-off use
	// from a script; turn off in production so the warm latency happens
	// at startup rather than on the first request.
	"AutoWarmOnRender": true,

	// On unrecoverable browser-side errors (chromium crash, page closed),
	// re-warm transparently for the next render up to this many times in
	// a row before giving up.
	"MaxConsecutiveWarmRetries": 3,

	// ----- Phase 2: concurrency + caching + backpressure ----------------

	// Page pool size.  N pages live in one Chromium process.  Each handles
	// one render at a time; the pool runs N renders truly in parallel.
	// Default 4 is workstation-sane (~600MB resident).
	"PageCount": 4,

	// Cap the queue of pending render requests.  When the count of in-flight
	// renders + waiters reaches this number, new requests fail immediately
	// with a RendererBusyError (HTTP layer translates to 503 + Retry-After).
	// Stops a misbehaving client / load spike from OOMing the process.
	"MaxQueueDepth": 32,

	// What value to put in the 503 Retry-After header (also on the
	// RendererBusyError instance) when backpressure fires.
	"QueueRetryAfterSeconds": 1,

	// ----- In-memory cache ----------------------------------------------

	// Master switch for the cache layer.  When false, every render() hits
	// the browser regardless.
	"CacheEnabled": true,

	// LRU capacity in entries (not bytes).  Each entry holds an SVG string
	// or PNG buffer + scene + source metadata — typically 10-50KB.
	"CacheCapacity": 50,

	// ----- Disk-backed cache (second tier) -------------------------------

	// Persist cache entries to disk.  Survives process restart.
	"DiskCacheEnabled": true,

	// Where to put the disk cache.  null → resolves at warm() time to
	// $XDG_CACHE_HOME/pict-renderer-graph/ or ~/.cache/pict-renderer-graph/.
	"DiskCacheDirectory": null,

	// Max disk cache entries.  Opportunistic LRU-by-mtime sweep on set()
	// when the count exceeds this.
	"DiskCacheMaxEntries": 500
});
