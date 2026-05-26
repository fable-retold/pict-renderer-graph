/*
	Cache-invalidation + runtime style-update tests.

	Covers the Phase 3 additions:
	   invalidateCache({hash})     — drop one exact entry
	   invalidateCache({style})    — drop every entry rendered under that style
	   invalidateCache({type})     — drop every entry of that diagram type
	   invalidateCache()           — drop all (no filter)
	   updateStyle(name, patch)    — patches a profile + invalidates affected entries
*/

const Chai = require('chai');
const Expect = Chai.expect;
const libFs   = require('fs');
const libPath = require('path');
const libOs   = require('os');

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');

const _TestCacheDir = libPath.join(libOs.tmpdir(), 'pict-renderer-graph-invalidate-test-' + process.pid);

suite('PictRendererGraph — cache invalidation + runtime style update', function ()
{
	this.timeout(90000);

	let _fable;
	let _renderer;

	suiteSetup(function (fDone)
	{
		try { libFs.rmSync(_TestCacheDir, { recursive: true, force: true }); } catch (pE) {}

		_fable = new libFable();
		_renderer = new libPictRendererGraph(_fable, {
			PageCount:          2,
			DiskCacheDirectory: _TestCacheDir
		});
		_renderer.initialize(fDone);
	});

	suiteTeardown(function (fDone)
	{
		_renderer.shutdown(() => fDone());
	});

	function renderOnce(pGraph, pOpts, fCallback)
	{
		_renderer.render(pGraph, pOpts || {}, fCallback);
	}

	test('invalidateCache(all) clears every entry; subsequent render is a miss', function (fDone)
	{
		let tmpGraph = {
			type: 'flow', title: 'inv-all',
			nodes: [ { id: 'a', label: 'A' }, { id: 'b', label: 'B' } ],
			edges: [ { from: 'a', to: 'b' } ]
		};
		renderOnce(tmpGraph, {}, (pErr1, pOut1) =>
		{
			if (pErr1) return fDone(pErr1);
			renderOnce(tmpGraph, {}, (pErr2, pOut2) =>
			{
				if (pErr2) return fDone(pErr2);
				try { Expect(pOut2.cacheHit).to.equal('memory'); } catch (pE) { return fDone(pE); }

				_renderer.invalidateCache((pInvErr, pStats) =>
				{
					if (pInvErr) return fDone(pInvErr);
					try
					{
						Expect(pStats.invalidatedMemory).to.be.greaterThan(0);
						renderOnce(tmpGraph, {}, (pErr3, pOut3) =>
						{
							if (pErr3) return fDone(pErr3);
							try
							{
								Expect(pOut3.cacheHit).to.be.oneOf([ null, undefined ],
									'after invalidate, render should be a fresh miss');
								fDone();
							}
							catch (pE) { fDone(pE); }
						});
					}
					catch (pE) { fDone(pE); }
				});
			});
		});
	});

	test('invalidateCache({hash}) drops exactly one entry, leaving others intact', function (fDone)
	{
		let tmpGraphA = {
			type: 'flow', title: 'inv-byhash-A',
			nodes: [ { id: 'a', label: 'A' }, { id: 'b', label: 'B' } ],
			edges: [ { from: 'a', to: 'b' } ]
		};
		let tmpGraphB = {
			type: 'flow', title: 'inv-byhash-B',
			nodes: [ { id: 'x', label: 'X' }, { id: 'y', label: 'Y' } ],
			edges: [ { from: 'x', to: 'y' } ]
		};
		renderOnce(tmpGraphA, {}, (pErrA, pOutA) =>
		{
			if (pErrA) return fDone(pErrA);
			renderOnce(tmpGraphB, {}, (pErrB, pOutB) =>
			{
				if (pErrB) return fDone(pErrB);
				// Compute graphA's cache key.
				let tmpHashA = _renderer._cache.hashRenderKey(tmpGraphA, {}, _renderer.styles.resolve(undefined));
				_renderer.invalidateCache({ hash: tmpHashA }, (pInvErr, pStats) =>
				{
					if (pInvErr) return fDone(pInvErr);
					try { Expect(pStats.invalidatedMemory).to.equal(1); }
					catch (pE) { return fDone(pE); }

					// A should now miss, B should still hit.
					renderOnce(tmpGraphA, {}, (pErrA2, pOutA2) =>
					{
						if (pErrA2) return fDone(pErrA2);
						renderOnce(tmpGraphB, {}, (pErrB2, pOutB2) =>
						{
							if (pErrB2) return fDone(pErrB2);
							try
							{
								Expect(pOutA2.cacheHit).to.be.oneOf([ null, undefined ], 'A was invalidated → miss');
								Expect(pOutB2.cacheHit).to.equal('memory', 'B was NOT invalidated → still in cache');
								fDone();
							}
							catch (pE) { fDone(pE); }
						});
					});
				});
			});
		});
	});

	test('invalidateCache({style}) drops only entries rendered under that style', function (fDone)
	{
		let tmpNotebookGraph = {
			type: 'flow', title: 'inv-bystyle-nb',
			style: 'notebook',
			nodes: [ { id: 'n', label: 'N' }, { id: 'm', label: 'M' } ],
			edges: [ { from: 'n', to: 'm' } ]
		};
		let tmpCleanGraph = {
			type: 'flow', title: 'inv-bystyle-cn',
			style: 'clean',
			nodes: [ { id: 'p', label: 'P' }, { id: 'q', label: 'Q' } ],
			edges: [ { from: 'p', to: 'q' } ]
		};
		renderOnce(tmpNotebookGraph, {}, (pErrN) =>
		{
			if (pErrN) return fDone(pErrN);
			renderOnce(tmpCleanGraph, {}, (pErrC) =>
			{
				if (pErrC) return fDone(pErrC);
				_renderer.invalidateCache({ style: 'notebook' }, (pInvErr, pStats) =>
				{
					if (pInvErr) return fDone(pInvErr);
					// Should drop the notebook entry (memory + maybe disk).
					try { Expect(pStats.invalidatedMemory).to.be.greaterThan(0); }
					catch (pE) { return fDone(pE); }

					renderOnce(tmpNotebookGraph, {}, (pErrN2, pOutN2) =>
					{
						if (pErrN2) return fDone(pErrN2);
						renderOnce(tmpCleanGraph, {}, (pErrC2, pOutC2) =>
						{
							if (pErrC2) return fDone(pErrC2);
							try
							{
								Expect(pOutN2.cacheHit).to.be.oneOf([ null, undefined ], 'notebook was invalidated');
								Expect(pOutC2.cacheHit).to.equal('memory', 'clean was NOT invalidated');
								fDone();
							}
							catch (pE) { fDone(pE); }
						});
					});
				});
			});
		});
	});

	test('invalidateCache({type}) drops only entries of that diagram type', function (fDone)
	{
		let tmpFlowGraph = {
			type: 'flow', title: 'inv-bytype-flow',
			style: 'whiteboard',
			nodes: [ { id: 'f1', label: 'F1' }, { id: 'f2', label: 'F2' } ],
			edges: [ { from: 'f1', to: 'f2' } ]
		};
		let tmpStarGraph = {
			type: 'star', title: 'inv-bytype-star',
			style: 'whiteboard',
			nodes: [
				{ id: 'h', label: 'Hub', kind: 'ellipse' },
				{ id: 's1', label: 'S1' }, { id: 's2', label: 'S2' }
			],
			edges: [ { from: 'h', to: 's1' }, { from: 'h', to: 's2' } ]
		};
		renderOnce(tmpFlowGraph, {}, () =>
		{
			renderOnce(tmpStarGraph, {}, () =>
			{
				_renderer.invalidateCache({ type: 'flow' }, (pInvErr, pStats) =>
				{
					if (pInvErr) return fDone(pInvErr);
					try { Expect(pStats.invalidatedMemory).to.be.greaterThan(0); }
					catch (pE) { return fDone(pE); }
					renderOnce(tmpFlowGraph, {}, (pErrF2, pOutF2) =>
					{
						if (pErrF2) return fDone(pErrF2);
						renderOnce(tmpStarGraph, {}, (pErrS2, pOutS2) =>
						{
							if (pErrS2) return fDone(pErrS2);
							try
							{
								Expect(pOutF2.cacheHit).to.be.oneOf([ null, undefined ], 'flow was invalidated');
								Expect(pOutS2.cacheHit).to.equal('memory', 'star was NOT invalidated');
								fDone();
							}
							catch (pE) { fDone(pE); }
						});
					});
				});
			});
		});
	});

	test('updateStyle() patches the profile AND auto-invalidates affected entries — next render produces different output', function (fDone)
	{
		// Use a custom registered style so we don't pollute the bundled ones
		// across the rest of the suite.
		_renderer.styles.register('test-restyle', Object.assign({}, _renderer.styles.get('notebook'), {
			Name: 'test-restyle',
			Palette: Object.assign({}, _renderer.styles.get('notebook').Palette)
		}));

		let tmpGraph = {
			type: 'flow', title: 'restyle-test',
			style: 'test-restyle',
			nodes: [ { id: 'r', label: 'Rectangle' }, { id: 'e', label: 'Ellipse' } ],
			edges: [ { from: 'r', to: 'e' } ]
		};

		renderOnce(tmpGraph, {}, (pErr1, pOut1) =>
		{
			if (pErr1) return fDone(pErr1);
			let tmpOriginalSvg = pOut1.svg;

			// Update the style with a markedly different stroke color and
			// re-roll the wobble seed so the SVG output is structurally
			// different.
			_renderer.updateStyle('test-restyle',
			{
				Palette: { ink: '#FF00FF', accent: '#00FFFF' },
				RandomSeedSalt: 99999
			}, (pUpdErr, pUpdResult) =>
			{
				if (pUpdErr) return fDone(pUpdErr);
				try
				{
					Expect(pUpdResult.profile.Palette.ink).to.equal('#FF00FF');
					Expect(pUpdResult.profile.RandomSeedSalt).to.equal(99999);
					Expect(pUpdResult.invalidatedMemory).to.be.greaterThan(0,
						'updateStyle should have invalidated at least the one cached entry');
				}
				catch (pE) { return fDone(pE); }

				renderOnce(tmpGraph, {}, (pErr2, pOut2) =>
				{
					if (pErr2) return fDone(pErr2);
					try
					{
						Expect(pOut2.cacheHit).to.be.oneOf([ null, undefined ],
							'render after updateStyle should be a cache miss');
						Expect(pOut2.svg).to.not.equal(tmpOriginalSvg,
							'after style update, the SVG should be different');
						Expect(pOut2.svg).to.include('#FF00FF',
							'the new ink color should appear in the new SVG');
						fDone();
					}
					catch (pE) { fDone(pE); }
				});
			});
		});
	});

	test('updateStyle() on an unknown style returns a helpful error', function (fDone)
	{
		_renderer.updateStyle('does-not-exist', { Roughness: 0 }, (pErr) =>
		{
			try
			{
				Expect(pErr).to.be.an('error');
				Expect(pErr.message).to.include('does-not-exist');
				fDone();
			}
			catch (pE) { fDone(pE); }
		});
	});
});
