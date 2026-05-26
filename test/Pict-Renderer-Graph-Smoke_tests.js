/*
	Pict-Renderer-Graph end-to-end smoke test.

	This is a real test: boots the service (real Chromium, real wrapper bundle,
	real exportToSvg), renders the smallest possible flow + star diagram,
	asserts the SVG carries both metadata blocks (Excalidraw scene embed +
	our pict-renderer-graph:source), and shuts down cleanly.

	If this passes, the architecture is sound — every other diagram type
	plus CLI / HTTP modes are variations on the same pipeline.
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');

suite('PictRendererGraph end-to-end smoke', function ()
{
	this.timeout(60000); // chromium cold-start budget

	let _fable;
	let _renderer;

	suiteSetup(function (fDone)
	{
		_fable = new libFable();
		_renderer = new libPictRendererGraph(_fable);
		_renderer.initialize(fDone);
	});

	suiteTeardown(function (fDone)
	{
		if (!_renderer) return fDone();
		_renderer.shutdown(() => fDone());
	});

	test('renders a flow diagram and round-trips both metadata blocks', function (fDone)
	{
		let tmpGraph = {
			type: 'flow',
			title: 'smoke',
			style: 'notebook',
			nodes:
			[
				{ id: 'a', label: 'Alpha',   kind: 'rectangle' },
				{ id: 'b', label: 'Bravo',   kind: 'rectangle' },
				{ id: 'c', label: 'Charlie', kind: 'ellipse' }
			],
			edges:
			[
				{ from: 'a', to: 'b', label: 'next' },
				{ from: 'b', to: 'c', label: 'end' }
			]
		};

		_renderer.render(tmpGraph, { format: 'svg', includeSource: true }, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				Expect(pOut.mime).to.equal('image/svg+xml');
				Expect(pOut.svg).to.be.a('string');
				Expect(pOut.svg.length).to.be.greaterThan(500);

				// Excalidraw's embed sentinels
				Expect(pOut.svg).to.include('payload-version:',
					'Excalidraw exportEmbedScene should embed scene metadata');
				Expect(pOut.svg).to.include('payload-type:application/vnd.excalidraw+json');

				// Our source-metadata block
				Expect(pOut.svg).to.include('<pict-renderer-graph:source',
					'should carry the original graph JSON in a pict-renderer-graph:source element');
				Expect(pOut.svg).to.include('"type":"flow"');
				Expect(pOut.svg).to.include('"title":"smoke"');

				// Scene + source returned alongside
				Expect(pOut.scene).to.be.an('object');
				Expect(pOut.scene.elements).to.be.an('array').with.length.greaterThan(0);
				Expect(pOut.source).to.deep.equal(tmpGraph);
				fDone();
			}
			catch (pAssertErr) { fDone(pAssertErr); }
		});
	});

	test('renders a star diagram with the same renderer instance', function (fDone)
	{
		let tmpGraph = {
			type: 'star',
			title: 'hub + spokes',
			style: 'whiteboard',
			nodes:
			[
				{ id: 'hub', label: 'Hub', kind: 'ellipse', accent: 'accent' },
				{ id: 'a',   label: 'A',   kind: 'rectangle' },
				{ id: 'b',   label: 'B',   kind: 'rectangle' },
				{ id: 'c',   label: 'C',   kind: 'rectangle' },
				{ id: 'd',   label: 'D',   kind: 'rectangle' }
			],
			edges:
			[
				{ from: 'hub', to: 'a' },
				{ from: 'hub', to: 'b' },
				{ from: 'hub', to: 'c' },
				{ from: 'hub', to: 'd' }
			]
		};

		_renderer.render(tmpGraph, { format: 'svg' }, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				Expect(pOut.svg).to.be.a('string');
				Expect(pOut.svg).to.include('payload-version:');
				Expect(pOut.svg).to.include('<pict-renderer-graph:source');
				Expect(pOut.svg).to.include('"type":"star"');
				// Whiteboard style sets viewBackgroundColor to #F4F7F9
				Expect(pOut.scene.appState.viewBackgroundColor).to.equal('#F4F7F9');
				fDone();
			}
			catch (pAssertErr) { fDone(pAssertErr); }
		});
	});

	test('unknown diagram type returns a helpful error', function (fDone)
	{
		_renderer.render({ type: 'wat', nodes: [], edges: [] }, {}, (pErr, pOut) =>
		{
			Expect(pErr).to.be.an('error');
			Expect(pErr.message).to.include('unknown diagram type "wat"');
			fDone();
		});
	});
});
