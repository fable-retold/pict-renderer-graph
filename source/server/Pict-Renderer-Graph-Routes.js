/**
 * Pict-Renderer-Graph-Routes.js
 *
 * Orator routes that wrap the renderer's public surface as HTTP.
 *
 *   POST /render                  body: GraphInput  →  image/svg+xml (or image/png)
 *   POST /render?format=json      body: GraphInput  →  { svg, scene, source } JSON
 *   GET  /render/types
 *   GET  /render/styles
 *
 * Follows the same shape as the data-cloner route files in
 * modules/meadow/retold-data-service/source/services/data-cloner/
 * DataCloner-Command-*.js — a single `module.exports = (service, server) => { ... }`
 * registering handlers on the supplied Orator service server.
 */

// Restify's default config doesn't enable queryParser — and we don't want
// to mutate the orator service-server's plugin list — so parse the query
// string ourselves from pRequest.url.
function _parseQuery(pUrl)
{
	let tmpOut = {};
	let tmpQ = (pUrl || '').indexOf('?');
	if (tmpQ === -1) return tmpOut;
	let tmpStr = pUrl.slice(tmpQ + 1);
	let tmpPairs = tmpStr.split('&');
	for (let i = 0; i < tmpPairs.length; i++)
	{
		let tmpEq = tmpPairs[i].indexOf('=');
		if (tmpEq === -1) tmpOut[decodeURIComponent(tmpPairs[i])] = '';
		else tmpOut[decodeURIComponent(tmpPairs[i].slice(0, tmpEq))] = decodeURIComponent(tmpPairs[i].slice(tmpEq + 1));
	}
	return tmpOut;
}

const { RendererBusyError } = require('../Pict-Renderer-Graph-Errors.js');

module.exports = function connectRoutes(pService, pServer)
{
	// ----- POST /render --------------------------------------------------
	// Use postWithBodyParser so restify's bodyParser plugin populates
	// pRequest.body from the JSON payload — base `post()` leaves body raw.
	pServer.postWithBodyParser('/render',
		function (pRequest, pResponse, fNext)
		{
			let tmpGraph = pRequest.body;
			if (!tmpGraph || typeof tmpGraph !== 'object')
			{
				pResponse.send(400, { Success: false, Error: 'request body must be a JSON object' });
				return fNext();
			}

			// Content-type negotiation.
			//   ?format=png      → PNG bytes
			//   ?format=json     → JSON envelope { svg, scene, source }
			//   Accept: image/png → PNG bytes
			//   default          → SVG with two metadata blocks
			let tmpQuery = _parseQuery(pRequest.url);
			let tmpQueryFormat = tmpQuery.format || null;
			let tmpAcceptsPng = (pRequest.headers && pRequest.headers.accept || '').indexOf('image/png') !== -1;
			let tmpFormat;
			if (tmpQueryFormat === 'png' || tmpAcceptsPng) tmpFormat = 'png';
			else if (tmpQueryFormat === 'json')            tmpFormat = 'json';
			else                                            tmpFormat = 'svg';

			let tmpRenderOpts =
			{
				format:        (tmpFormat === 'json') ? 'svg' : tmpFormat,
				includeSource: true,
				embedScene:    true
			};
			if (tmpQuery.scale)   tmpRenderOpts.scale   = parseFloat(tmpQuery.scale);
			if (tmpQuery.padding) tmpRenderOpts.padding = parseFloat(tmpQuery.padding);

			pService.render(tmpGraph, tmpRenderOpts, function (pErr, pOut)
			{
				if (pErr)
				{
					// Backpressure: queue full.  HTTP layer returns 503 +
					// Retry-After so well-behaved clients back off rather
					// than retry-storm.
					if (pErr instanceof RendererBusyError)
					{
						pResponse.setHeader('Retry-After', String(pErr.retryAfterSeconds || 1));
						pResponse.send(503,
						{
							Success:    false,
							Error:      pErr.message,
							RetryAfter: pErr.retryAfterSeconds || 1,
							QueueDepth: pErr.queueDepth
						});
						return fNext();
					}
					pResponse.send(500, { Success: false, Error: pErr.message || String(pErr) });
					return fNext();
				}

				// Diagnostic headers — apply to every successful response
				// regardless of format.
				let tmpCacheHit = pOut.cacheHit ? ('hit-' + pOut.cacheHit) : 'miss';
				pResponse.setHeader('X-PictRendererGraph-Cache',      tmpCacheHit);
				pResponse.setHeader('X-PictRendererGraph-Elements',   String((pOut.scene && pOut.scene.elements || []).length));
				if (pService._browser && typeof pService._browser.busyCount === 'function')
				{
					pResponse.setHeader('X-PictRendererGraph-Pool-Depth',
						String(pService._browser.busyCount() + '/' + pService._browser.pageCount()));
				}

				if (tmpFormat === 'json')
				{
					pResponse.send(200,
					{
						Success:  true,
						svg:      pOut.svg,
						scene:    pOut.scene,
						source:   pOut.source,
						cacheHit: pOut.cacheHit || null
					});
					return fNext();
				}
				if (tmpFormat === 'png')
				{
					// pass content-type as the second arg to writeHead so
					// restify's body-formatter doesn't overwrite it.
					pResponse.writeHead(200, { 'Content-Type': 'image/png' });
					pResponse.end(pOut.png);
					return fNext();
				}
				// SVG path: restify's pResponse.send() auto-detects body
				// type and overrides our Content-Type setHeader.  Use the
				// lower-level writeHead+end so the content-type sticks.
				pResponse.writeHead(200,
				{
					'Content-Type':                       'image/svg+xml; charset=utf-8',
					'X-PictRendererGraph-Cache':          tmpCacheHit,
					'X-PictRendererGraph-Elements':       String((pOut.scene && pOut.scene.elements || []).length),
					'X-PictRendererGraph-Pool-Depth':     pService._browser ? (pService._browser.busyCount() + '/' + pService._browser.pageCount()) : 'n/a'
				});
				pResponse.end(pOut.svg);
				return fNext();
			});
		});

	// ----- Cache management ---------------------------------------------

	// DELETE /cache  — drop everything (memory + disk).  Convenient when
	// debugging or after a style refactor; in production prefer the
	// scoped POST /cache/invalidate below.
	pServer.del('/cache', function (pRequest, pResponse, fNext)
	{
		pService.invalidateCache({ all: true }, function (pErr, pStats)
		{
			if (pErr) { pResponse.send(500, { Success: false, Error: pErr.message }); return fNext(); }
			pResponse.send(200, Object.assign({ Success: true }, pStats));
			return fNext();
		});
	});

	// POST /cache/invalidate  — filtered invalidation.
	//   body: { hash?, style?, type?, all? }
	pServer.postWithBodyParser('/cache/invalidate', function (pRequest, pResponse, fNext)
	{
		let tmpFilter = pRequest.body || {};
		pService.invalidateCache(tmpFilter, function (pErr, pStats)
		{
			if (pErr) { pResponse.send(500, { Success: false, Error: pErr.message }); return fNext(); }
			pResponse.send(200, Object.assign({ Success: true, Filter: tmpFilter }, pStats));
			return fNext();
		});
	});

	// PATCH /styles/:name  — update a named style profile + auto-invalidate
	//   body: a style-profile patch (Palette / Roughness / FontFamily / etc.)
	pServer.patch('/styles/:name', pServer.bodyParser(), function (pRequest, pResponse, fNext)
	{
		let tmpName = pRequest.params && pRequest.params.name;
		if (!tmpName) { pResponse.send(400, { Success: false, Error: 'style name required in path' }); return fNext(); }
		let tmpPatch = pRequest.body || {};
		pService.updateStyle(tmpName, tmpPatch, function (pErr, pResult)
		{
			if (pErr) { pResponse.send(400, { Success: false, Error: pErr.message }); return fNext(); }
			pResponse.send(200, Object.assign({ Success: true }, pResult));
			return fNext();
		});
	});

	// ----- GET /render/types ---------------------------------------------
	pServer.get('/render/types',
		function (pRequest, pResponse, fNext)
		{
			pResponse.send(200, pService.diagrams.list());
			return fNext();
		});

	// ----- GET /render/styles --------------------------------------------
	pServer.get('/render/styles',
		function (pRequest, pResponse, fNext)
		{
			pResponse.send(200, pService.styles.list());
			return fNext();
		});

	// ----- GET / (a tiny landing page) -----------------------------------
	// Convenience so curl-ing the bare service hostname gives a hint.
	pServer.get('/',
		function (pRequest, pResponse, fNext)
		{
			pResponse.send(200,
			{
				service:  'pict-renderer-graph',
				version:  require('../../package.json').version,
				endpoints:
				[
					'POST   /render             (body: graph JSON; returns image/svg+xml)',
					'POST   /render?format=png  (returns image/png)',
					'POST   /render?format=json (returns { svg, scene, source })',
					'GET    /render/types',
					'GET    /render/styles',
					'DELETE /cache              (drop all cache entries)',
					'POST   /cache/invalidate   (body: {hash?, style?, type?, all?})',
					'PATCH  /styles/:name       (body: style-profile patch; auto-invalidates)'
				]
			});
			return fNext();
		});
};
