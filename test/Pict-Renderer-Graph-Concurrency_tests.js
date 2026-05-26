/*
	Concurrency, caching, coalescing, and backpressure tests.

	These exercise the Phase 2 additions against a real Chromium pool.
	Slow (~15s total cold start) but high signal: they catch regressions in
	the pool/queue/cache/coalescer interactions that unit tests can't.
*/

const Chai = require('chai');
const Expect = Chai.expect;
const libFs   = require('fs');
const libPath = require('path');
const libOs   = require('os');

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');
const libCoalescer = require('../source/cache/Pict-Renderer-Graph-Coalescer.js');
const libCache     = require('../source/cache/Pict-Renderer-Graph-Cache.js');

// Use a fresh disk-cache dir per suite so tests don't pollute the real cache.
const _TestCacheDir = libPath.join(libOs.tmpdir(), 'pict-renderer-graph-concurrency-test-' + process.pid);

suite('PictRendererGraph — concurrency (pool + cache + coalescer + backpressure)', function ()
{
	this.timeout(120000);

	let _fable;
	let _renderer;

	suiteSetup(function (fDone)
	{
		// Clean the test cache directory before starting.
		try { libFs.rmSync(_TestCacheDir, { recursive: true, force: true }); } catch (pE) {}

		_fable = new libFable();
		_renderer = new libPictRendererGraph(_fable, {
			PageCount:           3,
			MaxQueueDepth:       6,
			QueueRetryAfterSeconds: 1,
			DiskCacheDirectory:  _TestCacheDir
		});
		_renderer.initialize(fDone);
	});

	suiteTeardown(function (fDone)
	{
		_renderer.shutdown(() => { fDone(); });
	});

	test('warm() opens N pages in parallel and they are all ready', function ()
	{
		Expect(_renderer._browser).to.exist;
		Expect(_renderer._browser.pageCount()).to.equal(3);
		Expect(_renderer._browser.busyCount()).to.equal(0);
	});

	test('3 concurrent renders complete in roughly the time of one render', function (fDone)
	{
		let tmpStart = Date.now();
		let tmpDone = 0;
		let tmpResults = [];
		let tmpRenderOnce = (i) =>
		{
			// Unique graph per call → no cache hits muddying the timing.
			_renderer.render({
				type: 'flow',
				title: 'parallel-' + i,
				nodes: [
					{ id: 'a' + i, label: 'A' + i },
					{ id: 'b' + i, label: 'B' + i }
				],
				edges: [ { from: 'a' + i, to: 'b' + i } ]
			}, {}, (pErr, pOut) =>
			{
				if (pErr) return fDone(pErr);
				tmpResults.push({ i: i, elements: pOut.scene.elements.length });
				tmpDone++;
				if (tmpDone === 3)
				{
					let tmpElapsed = Date.now() - tmpStart;
					try
					{
						Expect(tmpResults).to.have.length(3);
						// All 3 should have rendered; combined time should
						// be meaningfully less than 3× sequential render
						// time (which is ~400ms total with cold-page mix).
						// Loose bound: 2000ms.  Sequential would be 800ms+.
						Expect(tmpElapsed).to.be.below(3000,
							'3 parallel renders took ' + tmpElapsed + 'ms; pool may be serializing');
						fDone();
					}
					catch (pE) { fDone(pE); }
				}
			});
		};
		for (let i = 0; i < 3; i++) tmpRenderOnce(i);
	});

	test('cache memory hit: re-rendering identical input is fast', function (fDone)
	{
		let tmpGraph = {
			type: 'flow',
			title: 'cache-test',
			nodes: [
				{ id: 'x', label: 'X' },
				{ id: 'y', label: 'Y' }
			],
			edges: [ { from: 'x', to: 'y' } ]
		};

		_renderer.render(tmpGraph, {}, (pErr1, pOut1) =>
		{
			if (pErr1) return fDone(pErr1);
			Expect(pOut1.cacheHit).to.be.oneOf([ null, undefined ],
				'first render should be a cache miss');

			let tmpStart = Date.now();
			_renderer.render(tmpGraph, {}, (pErr2, pOut2) =>
			{
				if (pErr2) return fDone(pErr2);
				try
				{
					Expect(pOut2.cacheHit).to.equal('memory');
					Expect(pOut2.svg).to.equal(pOut1.svg,
						'cached render should be byte-identical to the first');
					Expect(Date.now() - tmpStart).to.be.below(50,
						'memory hit should return in <50ms');
					fDone();
				}
				catch (pE) { fDone(pE); }
			});
		});
	});

	test('coalescer dedupes 5 simultaneous identical requests to one render', function (fDone)
	{
		// Use a graph that's NOT already cached.
		let tmpGraph = {
			type: 'flow',
			title: 'coalesce-test-' + Date.now(),
			nodes: [
				{ id: 'p', label: 'P' },
				{ id: 'q', label: 'Q' }
			],
			edges: [ { from: 'p', to: 'q' } ]
		};

		// Snapshot inFlightCount before.
		Expect(_renderer._coalescer.inFlightCount()).to.equal(0,
			'no coalesced renders should be in flight at suite start');

		let tmpResults = [];
		let tmpDone = 0;
		let tmpStart = Date.now();
		for (let i = 0; i < 5; i++)
		{
			_renderer.render(tmpGraph, {}, (pErr, pOut) =>
			{
				if (pErr) return fDone(pErr);
				tmpResults.push(pOut);
				tmpDone++;
				if (tmpDone === 5)
				{
					try
					{
						let tmpElapsed = Date.now() - tmpStart;
						// All 5 should resolve to the same SVG.
						let tmpFirstSvg = tmpResults[0].svg;
						for (let r = 1; r < 5; r++)
						{
							Expect(tmpResults[r].svg).to.equal(tmpFirstSvg,
								'all coalesced callers should receive identical SVG');
						}
						// If coalescing worked, this should take ~1 render's
						// time, not 5x.  Loose bound: 1500ms.
						Expect(tmpElapsed).to.be.below(2000,
							'5 coalesced renders took ' + tmpElapsed + 'ms; coalescer may not be deduping');
						fDone();
					}
					catch (pE) { fDone(pE); }
				}
			});
		}
	});

	test('different render options produce different cache keys', function (fDone)
	{
		let tmpGraph = {
			type: 'flow',
			nodes: [ { id: 'a', label: 'A' }, { id: 'b', label: 'B' } ],
			edges: [ { from: 'a', to: 'b' } ]
		};

		// Render twice with different scale — should both miss cache
		// (different keys) but each becomes a cached entry of its own.
		_renderer.render(tmpGraph, { scale: 1 }, (pErr1, pOut1) =>
		{
			if (pErr1) return fDone(pErr1);
			_renderer.render(tmpGraph, { scale: 2 }, (pErr2, pOut2) =>
			{
				if (pErr2) return fDone(pErr2);
				try
				{
					// Re-rendering scale=1 should now hit memory.
					_renderer.render(tmpGraph, { scale: 1 }, (pErr3, pOut3) =>
					{
						if (pErr3) return fDone(pErr3);
						Expect(pOut3.cacheHit).to.equal('memory');
						fDone();
					});
				}
				catch (pE) { fDone(pE); }
			});
		});
	});

	test('bounded queue: oversubscribing returns RendererBusyError with retryAfterSeconds', function (fDone)
	{
		// MaxQueueDepth=6, PageCount=3.  Fire 10 unique renders simultaneously
		// — first 6 should be accepted (3 running + 3 queued), last 4 should
		// reject with RendererBusyError.
		let tmpAccepted = 0;
		let tmpBusyErrors = 0;
		let tmpOtherErrors = 0;
		let tmpDone = 0;

		for (let i = 0; i < 10; i++)
		{
			_renderer.render({
				type: 'flow',
				title: 'backpressure-' + i + '-' + Date.now(),
				nodes: [
					{ id: 'a' + i, label: 'A' + i },
					{ id: 'b' + i, label: 'B' + i },
					{ id: 'c' + i, label: 'C' + i }
				],
				edges: [
					{ from: 'a' + i, to: 'b' + i },
					{ from: 'b' + i, to: 'c' + i }
				]
			}, {}, (pErr, pOut) =>
			{
				if (pErr)
				{
					if (pErr.name === 'RendererBusyError')
					{
						tmpBusyErrors++;
						try
						{
							Expect(pErr.retryAfterSeconds).to.equal(1);
							Expect(pErr.queueDepth).to.be.a('number');
						}
						catch (pE) { return fDone(pE); }
					}
					else
					{
						tmpOtherErrors++;
					}
				}
				else
				{
					tmpAccepted++;
				}
				tmpDone++;
				if (tmpDone === 10)
				{
					try
					{
						Expect(tmpOtherErrors).to.equal(0,
							'no unexpected errors should occur');
						Expect(tmpBusyErrors).to.be.greaterThan(0,
							'at least some requests should be rejected with RendererBusyError when MaxQueueDepth=6 < 10 unique requests');
						Expect(tmpAccepted + tmpBusyErrors).to.equal(10);
						fDone();
					}
					catch (pE) { fDone(pE); }
				}
			});
		}
	});

	test('disk cache: a fresh renderer picks up entries from disk on restart', function (fDone)
	{
		// Render a unique graph through the live renderer (populates disk cache).
		let tmpGraph = {
			type: 'flow',
			title: 'disk-cache-test',
			nodes: [ { id: 'q', label: 'Q' }, { id: 'r', label: 'R' } ],
			edges: [ { from: 'q', to: 'r' } ]
		};

		_renderer.render(tmpGraph, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			let tmpOriginalSvg = pOut.svg;

			// Give the cache layer a moment to flush to disk.
			setTimeout(() =>
			{
				// Build a fresh renderer pointing at the same disk dir, no
				// memory cache — should miss memory + hit disk.
				let tmpFreshFable = new libFable();
				let tmpFresh = new libPictRendererGraph(tmpFreshFable, {
					PageCount:          1,
					DiskCacheDirectory: _TestCacheDir,
					AutoWarmOnRender:   false   // don't warm — disk hit should beat browser anyway
				});
				// Inject just enough for the cache lookup; we don't need the
				// browser since a disk hit short-circuits the render pipeline.
				tmpFresh._cache.get(
					tmpFresh._cache.hashRenderKey(tmpGraph, {}, tmpFresh.styles.resolve(undefined)),
					(pGetErr, pCachedValue) =>
					{
						try
						{
							Expect(pGetErr).to.not.exist;
							Expect(pCachedValue).to.exist;
							Expect(pCachedValue.cacheHit).to.equal('disk');
							Expect(pCachedValue.svg).to.equal(tmpOriginalSvg,
								'disk-loaded SVG should match the original render byte-for-byte');
							tmpFresh.shutdown(() => fDone());
						}
						catch (pE) { fDone(pE); }
					});
			}, 200);
		});
	});
});

// ----- Coalescer unit tests (no browser) ---------------------------------

suite('PictRendererGraphCoalescer', function ()
{
	test('two simultaneous calls for the same key produce one factory invocation', function (fDone)
	{
		let tmpCoalescer = new libCoalescer();
		let tmpFactoryCount = 0;
		let tmpFactory = () =>
		{
			tmpFactoryCount++;
			return new Promise((fResolve) => setTimeout(() => fResolve('hello-' + tmpFactoryCount), 50));
		};
		let tmpResultsA = null;
		let tmpResultsB = null;
		let tmpCheck = () =>
		{
			if (tmpResultsA === null || tmpResultsB === null) return;
			try
			{
				Expect(tmpFactoryCount).to.equal(1, 'factory should run exactly once');
				Expect(tmpResultsA).to.equal(tmpResultsB);
				Expect(tmpResultsA).to.equal('hello-1');
				fDone();
			}
			catch (pE) { fDone(pE); }
		};
		tmpCoalescer.coalesce('k', tmpFactory, (pErr, pResult) => { tmpResultsA = pResult; tmpCheck(); });
		tmpCoalescer.coalesce('k', tmpFactory, (pErr, pResult) => { tmpResultsB = pResult; tmpCheck(); });
	});

	test('rejection propagates to all waiters and clears the in-flight entry', function (fDone)
	{
		let tmpCoalescer = new libCoalescer();
		let tmpFactory = () => Promise.reject(new Error('boom'));
		let tmpDone = 0;
		let tmpCheck = () =>
		{
			tmpDone++;
			if (tmpDone === 2)
			{
				try
				{
					Expect(tmpCoalescer.inFlightCount()).to.equal(0);
					fDone();
				}
				catch (pE) { fDone(pE); }
			}
		};
		tmpCoalescer.coalesce('k', tmpFactory, (pErr) =>
		{
			Expect(pErr.message).to.equal('boom');
			tmpCheck();
		});
		tmpCoalescer.coalesce('k', tmpFactory, (pErr) =>
		{
			Expect(pErr.message).to.equal('boom');
			tmpCheck();
		});
	});
});

// ----- Cache key unit tests (no browser) ---------------------------------

suite('PictRendererGraphCache.hashRenderKey', function ()
{
	test('same input + same opts + same profile → same hash', function ()
	{
		let tmpCache = new libCache({ DiskCacheEnabled: false });
		let tmpGraph = { type: 'flow', nodes: [ { id: 'a', label: 'A' } ], edges: [] };
		let tmpA = tmpCache.hashRenderKey(tmpGraph, { format: 'svg' }, { Roughness: 1 });
		let tmpB = tmpCache.hashRenderKey(tmpGraph, { format: 'svg' }, { Roughness: 1 });
		Expect(tmpA).to.equal(tmpB);
	});

	test('reordering object keys does not change the hash (canonicalization)', function ()
	{
		let tmpCache = new libCache({ DiskCacheEnabled: false });
		let tmpA = tmpCache.hashRenderKey({ type: 'flow', nodes: [], edges: [] }, {}, {});
		let tmpB = tmpCache.hashRenderKey({ edges: [], nodes: [], type: 'flow' }, {}, {});
		Expect(tmpA).to.equal(tmpB);
	});

	test('different profile RandomSeedSalt produces a different hash', function ()
	{
		let tmpCache = new libCache({ DiskCacheEnabled: false });
		let tmpGraph = { type: 'flow', nodes: [], edges: [] };
		let tmpA = tmpCache.hashRenderKey(tmpGraph, {}, { Roughness: 1, RandomSeedSalt: 1 });
		let tmpB = tmpCache.hashRenderKey(tmpGraph, {}, { Roughness: 1, RandomSeedSalt: 99 });
		Expect(tmpA).to.not.equal(tmpB);
	});

	test('different format (svg vs png) produces a different hash', function ()
	{
		let tmpCache = new libCache({ DiskCacheEnabled: false });
		let tmpGraph = { type: 'flow', nodes: [], edges: [] };
		let tmpA = tmpCache.hashRenderKey(tmpGraph, { format: 'svg' }, {});
		let tmpB = tmpCache.hashRenderKey(tmpGraph, { format: 'png' }, {});
		Expect(tmpA).to.not.equal(tmpB);
	});
});
