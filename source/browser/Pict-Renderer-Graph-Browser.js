/**
 * Pict-Renderer-Graph-Browser.js
 *
 * Long-lived puppeteer wrapper backing the renderer service.  Drives one
 * headless Chromium with N pages pre-loaded with the pict-section-excalidraw
 * wrapper bundle.  All renders go through `page.evaluate(scene => exportToSvg(...))`
 * — exportToSvg is pure-functional per the Excalidraw source, so any number
 * of renders share a page without state pollution.
 *
 * Lifecycle:
 *
 *     let browser = new PictRendererGraphBrowser(opts);
 *     browser.warm(callback);          // launch chromium + asset server + open N pages
 *     browser.render(scene, opts, cb); // ANY idle page handles it (real parallelism)
 *     ...repeat many times...
 *     browser.close(callback);         // tear it all down
 *
 * Concurrency model (Phase 2):
 *   - Pool of N pages (`PageCount`, default 4) opened in parallel at warm() time.
 *   - render() acquires the first idle page; if all are busy, the job FIFO-waits
 *     for one to become free.  This means N concurrent renders truly run in
 *     parallel inside Chromium.
 *   - When `_pageWaiters.length + _busyCount >= MaxQueueDepth`, render() rejects
 *     synchronously with `RendererBusyError` carrying QueueRetryAfterSeconds.
 *     The HTTP layer translates that to a 503 + Retry-After header.
 *
 * Resilience:
 *   - Per-page crash recovery: if a single page dies during render(), only that
 *     page is rewarmed.  The remaining pages keep serving traffic.
 *   - Whole-browser crash: detected when ALL pages fail in quick succession; the
 *     entire browser is rewarmed.
 *
 * Asset server:
 *   The wrapper bundle fetches font + locale chunks at runtime from
 *   window.EXCALIDRAW_ASSET_PATH.  We boot a tiny node `http` server on a random
 *   free port that serves the vendor-built directory.  Loopback-only.
 */

const libFs   = require('fs');
const libPath = require('path');
const libHttp = require('http');
const libUrl  = require('url');
const libPuppeteer = require('puppeteer');

const _DefaultConfiguration = require('../Pict-Renderer-Graph-DefaultConfiguration.js');
const { RendererBusyError } = require('../Pict-Renderer-Graph-Errors.js');

class PictRendererGraphBrowser
{
	constructor(pOptions, pFable)
	{
		this.options = Object.assign({}, _DefaultConfiguration, pOptions || {});
		this.fable   = pFable || null;
		this.log     = (pFable && pFable.log) || console;

		this._browser     = null;
		this._assetServer = null;
		this._assetURL    = null;

		// Page pool — array of PoolEntry: { page, busy, warmedAt, lastUsedAt }
		this._pages       = [];

		this._warming = false;
		this._closing = false;
		this._consecutiveWarmFailures = 0;

		// FIFO queue of jobs waiting for an idle page.  Each entry:
		//   { scene, opts, callback }
		this._queue       = [];
		// Number of pages currently rendering — read by backpressure check.
		this._busyCount   = 0;
	}

	// --------------------------------------------------------------------
	// Public lifecycle
	// --------------------------------------------------------------------

	/**
	 * Launch chromium, boot the asset server, open N pages and wait for the
	 * wrapper bundle to finish booting in each.  Idempotent — calling warm()
	 * on an already-warm browser is a no-op.
	 *
	 * @param {Function} fCallback - (pErr) => void
	 */
	warm(fCallback)
	{
		let tmpCb = (typeof fCallback === 'function') ? fCallback : () => {};
		if (this.isWarm()) return tmpCb(null);
		if (this._warming)
		{
			let tmpStart = Date.now();
			let tmpPoll = () =>
			{
				if (!this._warming) return tmpCb(this.isWarm() ? null : new Error('warm-in-progress completed without ready browser'));
				if (Date.now() - tmpStart > this.options.WarmTimeoutMs) return tmpCb(new Error('warm timed out (waiting on concurrent warm)'));
				setTimeout(tmpPoll, 50);
			};
			return tmpPoll();
		}

		this._warming = true;
		this._warmInternal((pErr) =>
		{
			this._warming = false;
			if (pErr)
			{
				this._consecutiveWarmFailures++;
				return tmpCb(pErr);
			}
			this._consecutiveWarmFailures = 0;
			return tmpCb(null);
		});
	}

	/**
	 * Render an Excalidraw scene into an SVG (or PNG) buffer.  Acquires an
	 * idle page from the pool; if none are idle, FIFO-waits.  If the queue is
	 * full (depth + busy >= MaxQueueDepth), fails synchronously with
	 * RendererBusyError.
	 *
	 * @param {object}   pScene  - { elements, appState, files }
	 * @param {object}   pOpts   - { format: 'svg'|'png', exportEmbedScene?, ... }
	 * @param {Function} fCallback - (pErr, pResult: { svg|png, mime })
	 */
	render(pScene, pOpts, fCallback)
	{
		let tmpCb = (typeof fCallback === 'function') ? fCallback : () => {};
		let tmpOpts = pOpts || {};

		// Backpressure: total pending = queue length + currently-running.
		let tmpMaxDepth = this.options.MaxQueueDepth || 32;
		let tmpDepth = this._queue.length + this._busyCount;
		if (tmpDepth >= tmpMaxDepth)
		{
			// Fire on next tick so the callback can never run synchronously
			// before render() returns.  Mirrors normal async semantics.
			let tmpRetry = this.options.QueueRetryAfterSeconds || 1;
			let tmpErr = new RendererBusyError(tmpRetry, tmpDepth);
			setImmediate(() => tmpCb(tmpErr));
			return;
		}

		this._queue.push({ scene: pScene, opts: tmpOpts, callback: tmpCb });
		this._drainQueue();
	}

	/**
	 * Close all pool pages + chromium + asset server.  Idempotent.
	 */
	close(fCallback)
	{
		let tmpCb = (typeof fCallback === 'function') ? fCallback : () => {};
		this._closing = true;

		let tmpFirstErr = null;
		let tmpDoneCount = 0;
		let tmpExpected  = 0;
		let tmpAfterAll = () =>
		{
			tmpDoneCount++;
			if (tmpDoneCount < tmpExpected) return;
			this._browser     = null;
			this._pages       = [];
			this._assetServer = null;
			this._assetURL    = null;
			this._closing     = false;
			return tmpCb(tmpFirstErr);
		};

		if (this._browser)
		{
			tmpExpected++;
			this._browser.close().then(() => tmpAfterAll())
				.catch((pErr) => { tmpFirstErr = tmpFirstErr || pErr; tmpAfterAll(); });
		}
		if (this._assetServer)
		{
			tmpExpected++;
			this._assetServer.close((pErr) => { if (pErr) tmpFirstErr = tmpFirstErr || pErr; tmpAfterAll(); });
		}
		if (tmpExpected === 0) return tmpCb(null);
	}

	isWarm()
	{
		return !!(this._browser && this._pages.length > 0 && this._assetServer && this._assetURL);
	}

	/** Current page-pool size (number of warm pages). */
	pageCount()  { return this._pages.length; }
	/** Number of pages currently busy. */
	busyCount()  { return this._busyCount; }
	/** Pending queue length (jobs waiting for an idle page). */
	queueDepth() { return this._queue.length; }
	/** Total in-flight + queued — what backpressure measures against. */
	totalDepth() { return this._queue.length + this._busyCount; }

	/** Loopback URL the asset server is bound to.  Test/diagnostic only. */
	getAssetURL() { return this._assetURL; }

	/**
	 * Run an arbitrary function inside one of the pool's pages.  Used by
	 * diagram handlers that need browser-side helpers (e.g. mermaid calling
	 * `parseMermaidToExcalidraw` which is async and runs in-page).
	 *
	 * Goes through the same queue + page-pool + backpressure path as
	 * render(), so concurrent evaluations don't trample each other and
	 * MaxQueueDepth applies uniformly.
	 *
	 * @param {Function} pFn       - async/sync function to evaluate in-page
	 * @param {object}   pArg      - serializable argument forwarded to pFn
	 * @param {Function} fCallback - (err, result) => void
	 */
	evaluateInPage(pFn, pArg, fCallback)
	{
		let tmpCb = (typeof fCallback === 'function') ? fCallback : () => {};

		// Same backpressure as render().
		let tmpMaxDepth = this.options.MaxQueueDepth || 32;
		let tmpDepth = this._queue.length + this._busyCount;
		if (tmpDepth >= tmpMaxDepth)
		{
			let tmpRetry = this.options.QueueRetryAfterSeconds || 1;
			let tmpErr = new RendererBusyError(tmpRetry, tmpDepth);
			setImmediate(() => tmpCb(tmpErr));
			return;
		}

		// Custom "job": instead of calling _renderInPage, we run the
		// supplied function via page.evaluate.  Reuse the queue/pool
		// machinery by sticking a marker on the job + branching in
		// _executeOnPage.
		this._queue.push({ __evaluate: true, fn: pFn, arg: pArg, callback: tmpCb });
		this._drainQueue();
	}

	// --------------------------------------------------------------------
	// Internal: warm
	// --------------------------------------------------------------------

	_warmInternal(fCallback)
	{
		let tmpVendor = this.options.VendorBuiltPath;
		if (!libFs.existsSync(tmpVendor))
		{
			return fCallback(new Error(
				'VendorBuiltPath does not exist: ' + tmpVendor + '\n' +
				'Did you `npm install` the module so that pict-section-excalidraw is in node_modules?'
			));
		}

		// 1. Boot the embedded http server serving the vendor-built dir.
		this._startAssetServer(tmpVendor, (pSrvErr, pAssetURL) =>
		{
			if (pSrvErr) return fCallback(pSrvErr);

			// 2. Launch chromium.
			libPuppeteer.launch(this.options.PuppeteerLaunch).then(async (pBrowser) =>
			{
				try
				{
					this._browser = pBrowser;
					this._assetURL = pAssetURL;

					// 3. Open N pages in parallel.
					let tmpCount = this.options.PageCount || _DefaultConfiguration.PageCount || 4;
					let tmpOpenPromises = [];
					for (let i = 0; i < tmpCount; i++)
					{
						tmpOpenPromises.push(this._openOnePage(pBrowser, pAssetURL));
					}
					let tmpResults = await Promise.all(tmpOpenPromises);
					this._pages = tmpResults;
					fCallback(null);
				}
				catch (pInnerErr)
				{
					try { await pBrowser.close(); } catch (pCloseErr) { /* ignore */ }
					this._browser = null;
					this._pages   = [];
					fCallback(pInnerErr);
				}
			}).catch((pErr) =>
			{
				fCallback(pErr);
			});
		});
	}

	/**
	 * Open one page in the supplied browser, navigate to the host page,
	 * wait for the wrapper bundle to finish booting, return a PoolEntry.
	 */
	async _openOnePage(pBrowser, pAssetURL)
	{
		let tmpPage = await pBrowser.newPage();
		tmpPage.on('pageerror', (pErr) =>
		{
			this.log.warn && this.log.warn('[pict-renderer-graph page-error] ' + (pErr && pErr.message));
		});
		tmpPage.on('console', (pMsg) =>
		{
			if (pMsg.type() === 'error')
			{
				this.log.warn && this.log.warn('[pict-renderer-graph page-console] ' + pMsg.text());
			}
		});

		let tmpURL = pAssetURL + '/renderer-host.html';
		await tmpPage.goto(tmpURL, { waitUntil: 'load', timeout: this.options.WarmTimeoutMs });
		await tmpPage.waitForFunction(
			() => window.__pictRendererGraphReady === true,
			{ timeout: this.options.WarmTimeoutMs }
		);
		return {
			page:     tmpPage,
			busy:     false,
			warmedAt: Date.now(),
			lastUsedAt: 0
		};
	}

	// --------------------------------------------------------------------
	// Internal: asset server
	// --------------------------------------------------------------------

	_startAssetServer(pRoot, fCallback)
	{
		let tmpHost = this.options.AssetServer.hostname || '127.0.0.1';
		let tmpPort = (this.options.AssetServer.port !== undefined) ? this.options.AssetServer.port : 0;
		let tmpHostHtmlSrc = libPath.join(__dirname, 'renderer-host.html');

		let tmpHttp = libHttp.createServer((pReq, pRes) =>
		{
			let tmpParsed = libUrl.parse(pReq.url);
			let tmpRel = decodeURIComponent(tmpParsed.pathname || '/').replace(/^\/+/, '');
			let tmpFile;

			if (tmpRel === 'renderer-host.html')
			{
				tmpFile = tmpHostHtmlSrc;
			}
			else
			{
				tmpFile = libPath.join(pRoot, tmpRel);
				let tmpReal;
				try { tmpReal = libFs.realpathSync(libPath.dirname(tmpFile)); }
				catch (pErr) { pRes.writeHead(404); return pRes.end('not found'); }
				let tmpRealRoot = libFs.realpathSync(pRoot);
				if (!tmpReal.startsWith(tmpRealRoot))
				{
					pRes.writeHead(403); return pRes.end('forbidden');
				}
			}

			libFs.readFile(tmpFile, (pErr, pData) =>
			{
				if (pErr) { pRes.writeHead(404); return pRes.end('not found: ' + tmpRel); }
				let tmpExt = libPath.extname(tmpFile).toLowerCase();
				let tmpMime = {
					'.html': 'text/html; charset=utf-8',
					'.js':   'application/javascript; charset=utf-8',
					'.css':  'text/css; charset=utf-8',
					'.json': 'application/json; charset=utf-8',
					'.svg':  'image/svg+xml',
					'.png':  'image/png',
					'.woff2': 'font/woff2',
					'.woff':  'font/woff',
					'.ttf':   'font/ttf',
					'.map':   'application/json; charset=utf-8'
				}[tmpExt] || 'application/octet-stream';
				pRes.writeHead(200, { 'Content-Type': tmpMime, 'Access-Control-Allow-Origin': '*' });
				pRes.end(pData);
			});
		});

		tmpHttp.listen(tmpPort, tmpHost, () =>
		{
			this._assetServer = tmpHttp;
			let tmpActualPort = tmpHttp.address().port;
			let tmpURL = 'http://' + tmpHost + ':' + tmpActualPort;
			fCallback(null, tmpURL);
		});
		tmpHttp.on('error', (pErr) => fCallback(pErr));
	}

	// --------------------------------------------------------------------
	// Internal: drain queue → acquire page → render → release
	// --------------------------------------------------------------------

	_drainQueue()
	{
		if (this._queue.length < 1) return;

		// Find an idle page.  If none, queue stays — _releasePage will retry.
		let tmpIdle = this._findIdlePage();
		if (!tmpIdle)
		{
			// Pool is fully busy — auto-warm if not warm yet, otherwise wait.
			if (!this.isWarm() && this.options.AutoWarmOnRender)
			{
				this.warm((pErr) =>
				{
					if (pErr)
					{
						// Drain the queue with the error so callers don't hang.
						while (this._queue.length > 0)
						{
							let tmpJob = this._queue.shift();
							tmpJob.callback(pErr);
						}
						return;
					}
					this._drainQueue();
				});
			}
			return;
		}

		let tmpJob = this._queue.shift();
		this._executeOnPage(tmpIdle, tmpJob);
	}

	_findIdlePage()
	{
		for (let i = 0; i < this._pages.length; i++)
		{
			if (!this._pages[i].busy) return this._pages[i];
		}
		return null;
	}

	_executeOnPage(pEntry, pJob)
	{
		pEntry.busy = true;
		this._busyCount++;

		let tmpOnDone = (pErr, pResult) =>
		{
			pEntry.busy = false;
			pEntry.lastUsedAt = Date.now();
			this._busyCount--;

			// Per-page crash recovery: if this looks like a dead page, try
			// to rewarm just this one slot.  Don't take down the rest of
			// the pool — the other pages can keep serving.
			if (pErr && this._looksLikeBrowserDied(pErr) &&
				this._consecutiveWarmFailures < this.options.MaxConsecutiveWarmRetries)
			{
				this.log.warn && this.log.warn('[pict-renderer-graph] page died — attempting per-page rewarm');
				this._rewarmOnePage(pEntry, (pRewarmErr) =>
				{
					if (pRewarmErr)
					{
						// Couldn't rewarm; remove this slot so future renders
						// don't try to use a corpse page.
						let tmpIdx = this._pages.indexOf(pEntry);
						if (tmpIdx >= 0) this._pages.splice(tmpIdx, 1);
						this.log.warn && this.log.warn('[pict-renderer-graph] dropped dead page — pool size now ' + this._pages.length);
					}
					// Either way, retry the failed job on whatever idle page
					// is available.
					this._queue.unshift(pJob);   // put it back at head of queue
					this._drainQueue();
				});
				return;
			}

			pJob.callback(pErr, pResult);
			// Continue draining — another job might be queued, and this
			// page is now free.
			this._drainQueue();
		};

		// Dispatch: render scenes go through _renderInPage; arbitrary
		// page.evaluate jobs go through _evaluateInPage.
		if (pJob.__evaluate)
		{
			pEntry.page.evaluate(pJob.fn, pJob.arg).then((pResult) =>
			{
				tmpOnDone(null, pResult);
			}).catch((pErr) =>
			{
				tmpOnDone(pErr, null);
			});
			return;
		}
		this._renderInPage(pEntry.page, pJob.scene, pJob.opts, tmpOnDone);
	}

	_rewarmOnePage(pEntry, fCallback)
	{
		if (!this._browser || !this._assetURL) return fCallback(new Error('browser closed'));
		// Close the old page best-effort, then open a fresh one.
		try { pEntry.page.close().catch(() => {}); } catch (pErr) { /* ignore */ }
		this._openOnePage(this._browser, this._assetURL).then((pNewEntry) =>
		{
			// Replace fields in-place so any external reference (none today,
			// but defensive) sees the new page.
			pEntry.page       = pNewEntry.page;
			pEntry.warmedAt   = pNewEntry.warmedAt;
			pEntry.lastUsedAt = 0;
			pEntry.busy       = false;
			fCallback(null);
		}).catch((pErr) => fCallback(pErr));
	}

	_renderInPage(pPage, pScene, pOpts, fCallback)
	{
		let tmpFormat = (pOpts && pOpts.format) || 'svg';
		let tmpTimeoutMs = this.options.RenderTimeoutMs;

		let tmpEvalFn = async (pSerialized) =>
		{
			let pInScene = pSerialized.scene;
			let pInOpts  = pSerialized.opts;
			let tmpVendor = window.PictSectionExcalidrawVendor;
			if (!tmpVendor || !tmpVendor.exportToSvg)
			{
				throw new Error('PictSectionExcalidrawVendor not available in page');
			}
			let tmpAppState = Object.assign({}, pInScene.appState || {});
			if (pInOpts.exportEmbedScene !== undefined) tmpAppState.exportEmbedScene = pInOpts.exportEmbedScene;
			if (pInOpts.exportPadding    !== undefined) tmpAppState.exportPadding    = pInOpts.exportPadding;
			if (pInOpts.exportScale      !== undefined) tmpAppState.exportScale      = pInOpts.exportScale;
			if (pInOpts.exportBackground !== undefined) tmpAppState.exportBackground = pInOpts.exportBackground;
			if (pInOpts.exportWithDarkMode !== undefined) tmpAppState.exportWithDarkMode = pInOpts.exportWithDarkMode;

			let tmpExportArgs = {
				elements: pInScene.elements || [],
				appState: tmpAppState,
				files:    pInScene.files    || {}
			};

			if (pInOpts.format === 'png')
			{
				let tmpBlob = await tmpVendor.exportToBlob(tmpExportArgs);
				let tmpBuf = await tmpBlob.arrayBuffer();
				let tmpBytes = new Uint8Array(tmpBuf);
				let tmpStr = '';
				let tmpChunk = 0x8000;
				for (let i = 0; i < tmpBytes.length; i += tmpChunk)
				{
					tmpStr += String.fromCharCode.apply(null, tmpBytes.subarray(i, i + tmpChunk));
				}
				return { format: 'png', base64: btoa(tmpStr) };
			}

			let tmpSvgEl = await tmpVendor.exportToSvg(tmpExportArgs);
			let tmpStr = new XMLSerializer().serializeToString(tmpSvgEl);
			return { format: 'svg', svg: tmpStr };
		};

		let tmpRaceTimeout = setTimeout(() =>
		{
			fCallback(new Error('render timed out after ' + tmpTimeoutMs + 'ms'));
		}, tmpTimeoutMs);

		pPage.evaluate(tmpEvalFn, { scene: pScene, opts: pOpts }).then((pResult) =>
		{
			clearTimeout(tmpRaceTimeout);
			if (pResult.format === 'png')
			{
				fCallback(null, {
					png:  Buffer.from(pResult.base64, 'base64'),
					mime: 'image/png'
				});
				return;
			}
			fCallback(null, {
				svg:  pResult.svg,
				mime: 'image/svg+xml'
			});
		}).catch((pErr) =>
		{
			clearTimeout(tmpRaceTimeout);
			fCallback(pErr);
		});
	}

	_looksLikeBrowserDied(pErr)
	{
		if (!pErr) return false;
		let tmpMsg = (pErr.message || String(pErr)).toLowerCase();
		return tmpMsg.includes('target closed') ||
		       tmpMsg.includes('protocol error') ||
		       tmpMsg.includes('session closed') ||
		       tmpMsg.includes('most likely the page has been closed');
	}
}

module.exports = PictRendererGraphBrowser;
