/*
	Mermaid-specific regression tests.

	mermaid-to-excalidraw passes through HTML <br/> tags from note text
	verbatim, leaving them as literal "<br/>" strings in the rendered
	scene.  Diagram-Mermaid post-processes the scene's text elements to
	convert <br>, <br/>, and <br /> to real newlines so Excalidraw's
	multi-line text rendering takes over.
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');

suite('PictRendererGraph — mermaid <br/> handling', function ()
{
	this.timeout(60000);

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

	test('sequence note <br/> tags become newlines, never appear literally', function (fDone)
	{
		let tmpGraph = {
			type:    'mermaid',
			title:   'mermaid sequence with note <br/>',
			mermaid: 'sequenceDiagram\n'
				+ '    Alice->>Bob: Hello Bob, how are you?\n'
				+ '    Bob-->>John: How about you John?\n'
				+ '    Note right of John: Bob thinks a long<br/>long time, so long<br/>that the text does<br/>not fit on a row.\n'
				+ '    Bob-->Alice: Checking with John...\n'
		};

		_renderer.render(tmpGraph, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				Expect(pOut.scene).to.be.an('object');
				Expect(pOut.scene.elements).to.be.an('array').with.length.greaterThan(0);

				let tmpTextElements = pOut.scene.elements.filter(
					(pEl) => pEl && pEl.type === 'text' && typeof pEl.text === 'string'
				);
				Expect(tmpTextElements.length).to.be.greaterThan(0,
					'mermaid sequence should produce at least one text element');

				// No text element should carry a literal <br variant.
				for (let i = 0; i < tmpTextElements.length; i++)
				{
					let tmpText = tmpTextElements[i].text;
					Expect(tmpText.toLowerCase()).to.not.include('<br',
						'text element ' + i + ' still contains a <br tag: "' + tmpText + '"');
				}

				// The note text we care about should now contain newlines.
				// Mermaid wraps long words on its own (e.g. "Bob thinks a long"
				// can be wrapped to "Bob thinks a\nlong"), so match on a short
				// stable prefix rather than the full source phrase.
				let tmpNoteText = tmpTextElements
					.map((pEl) => pEl.text)
					.find((pStr) => pStr.indexOf('Bob thinks') !== -1);
				Expect(tmpNoteText, 'note text element should be present').to.be.a('string');
				Expect(tmpNoteText).to.include('\n',
					'note text should have real newlines after <br/> conversion');
				fDone();
			}
			catch (pAssertErr) { fDone(pAssertErr); }
		});
	});

	test('all three <br> variants (no slash, slash, space-slash) are stripped', function (fDone)
	{
		// Each variant is followed by a token unique enough that mermaid's
		// own word-wrap won't break it.  We then check each token starts a
		// new line in the rendered text — proof the <br variant was
		// converted, not preserved.
		let tmpGraph = {
			type:    'mermaid',
			title:   'br variants',
			mermaid: 'sequenceDiagram\n'
				+ '    A->>B: hi\n'
				+ '    Note right of B: aaa<br>bbb<br/>ccc<br />ddd\n'
		};

		_renderer.render(tmpGraph, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				let tmpTextElements = pOut.scene.elements.filter(
					(pEl) => pEl && pEl.type === 'text' && typeof pEl.text === 'string'
				);
				// Every text element, post-fix, should be <br>-free.
				for (let i = 0; i < tmpTextElements.length; i++)
				{
					Expect(tmpTextElements[i].text.toLowerCase()).to.not.include('<br',
						'text element ' + i + ' still contains a <br tag: "' + tmpTextElements[i].text + '"');
				}
				let tmpNote = tmpTextElements
					.map((pEl) => pEl.text)
					.find((pStr) => pStr.indexOf('aaa') !== -1 && pStr.indexOf('ddd') !== -1);
				Expect(tmpNote, 'multi-variant note text should be present').to.be.a('string');
				// All four tokens survive (mermaid may further word-wrap them,
				// so we don't pin them to exact lines).
				Expect(tmpNote).to.include('aaa');
				Expect(tmpNote).to.include('bbb');
				Expect(tmpNote).to.include('ddd');
				// At minimum, three of the <br variants we passed in should
				// have been converted to newlines.
				let tmpNewlineCount = (tmpNote.match(/\n/g) || []).length;
				Expect(tmpNewlineCount).to.be.greaterThan(2,
					'expected at least 3 newlines from the 3 <br variants, got ' + tmpNewlineCount + ' in: ' + JSON.stringify(tmpNote));
				fDone();
			}
			catch (pAssertErr) { fDone(pAssertErr); }
		});
	});
});
