#!/usr/bin/env node
/**
 * Gallery-Generator.js
 *
 * Renders every fixture in test/fixtures/gallery/<category>/*.json into a
 * paired PNG + SVG in test/gallery/<category>/, then builds an HTML index
 * page (test/gallery/index.html) so the whole catalog can be reviewed
 * visually in a browser.
 *
 * Usage:
 *
 *     npm run test:gallery
 *
 * Output:
 *
 *     test/gallery/
 *       index.html                       — visual grid, one card per diagram
 *       01-flow/three-tier-web-app.png
 *       01-flow/three-tier-web-app.svg
 *       …
 *       08-edges/many-nodes.png
 *
 * `test/gallery/` is gitignored — regenerate on demand, never commit.
 *
 * What gets tested implicitly:
 *   - All 6 diagram types (flow / star / sequence / mindmap / datadict /
 *     mermaid).
 *   - All 4 named styles + an inline-tuned profile.
 *   - DSL edges: empty / single-node / cycles / self-loops / disconnected /
 *     unicode / very-long labels / max-node count / every node kind /
 *     every accent color.
 *   - Standards-oriented "real" diagrams: OAuth 2.0, TCP handshake,
 *     three-tier web app, microservices, ER models, mermaid official docs
 *     samples.
 *
 * If any fixture fails to render, the script exits non-zero with the
 * fixture path + error so it's CI-friendly.
 */

const libFs   = require('fs');
const libPath = require('path');

const libFable = require('fable');
const libPictRendererGraph = require('../../source/Pict-Renderer-Graph.js');

const REPO_ROOT      = libPath.resolve(__dirname, '..', '..');
const FIXTURE_ROOT   = libPath.join(REPO_ROOT, 'test', 'fixtures', 'gallery');
const OUTPUT_ROOT    = libPath.join(REPO_ROOT, 'test', 'gallery');

// ----------------------------------------------------------------------------

function ensureDir(p) { libFs.mkdirSync(p, { recursive: true }); }

function logStep(pMessage) { process.stdout.write('[gallery] ' + pMessage + '\n'); }

/**
 * Walk the fixture tree, returning an array of { category, name, path }.
 * Categories are the immediate subdirectories of FIXTURE_ROOT; names are
 * the .json filenames without the extension.
 */
function discoverFixtures()
{
	let tmpCats = libFs.readdirSync(FIXTURE_ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	let tmpFixtures = [];
	for (let i = 0; i < tmpCats.length; i++)
	{
		let tmpCat = tmpCats[i];
		let tmpDir = libPath.join(FIXTURE_ROOT, tmpCat);
		let tmpFiles = libFs.readdirSync(tmpDir)
			.filter((f) => f.endsWith('.json'))
			.sort();
		for (let j = 0; j < tmpFiles.length; j++)
		{
			let tmpName = tmpFiles[j].replace(/\.json$/, '');
			tmpFixtures.push({
				category: tmpCat,
				name:     tmpName,
				path:     libPath.join(tmpDir, tmpFiles[j])
			});
		}
	}
	return tmpFixtures;
}

function categoryLabel(pCategory)
{
	// "01-flow" → "flow"
	return pCategory.replace(/^\d+-/, '').replace(/-/g, ' ');
}

function escapeHTML(pStr)
{
	return String(pStr).replace(/[&<>"']/g, (c) =>
	(
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]
	));
}

/**
 * Build the index.html dashboard.  Cards are grouped by category, sized
 * uniformly, and clickable for full-size view.  Each card carries a
 * collapsible <details> block with the source-fixture JSON so reviewers
 * can see what produced the diagram.
 */
function writeIndex(pResults)
{
	let tmpByCategory = {};
	for (let i = 0; i < pResults.length; i++)
	{
		let tmpR = pResults[i];
		if (!tmpByCategory[tmpR.category]) tmpByCategory[tmpR.category] = [];
		tmpByCategory[tmpR.category].push(tmpR);
	}

	let tmpHtml = [];
	tmpHtml.push('<!doctype html>');
	tmpHtml.push('<html lang="en">');
	tmpHtml.push('<head>');
	tmpHtml.push('<meta charset="utf-8">');
	tmpHtml.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
	tmpHtml.push('<title>pict-renderer-graph gallery</title>');
	tmpHtml.push('<style>');
	tmpHtml.push(`
		* { box-sizing: border-box; }
		body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #FAF8F4; color: #2A2520; }
		h1 { margin: 0 0 4px 0; font-weight: 700; font-size: 1.5rem; }
		.subtitle { color: #8A7F72; font-size: 0.85rem; margin-bottom: 28px; }
		.subtitle code { background: #F0E8DA; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
		h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.08em; color: #5A4A3C; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid #D4C4A8; padding-bottom: 4px; }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
		.card { background: #FFFFFF; border: 1px solid #D4C4A8; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
		.card-name { padding: 10px 12px; background: #F4EEE2; font-family: 'SFMono-Regular', 'SF Mono', Menlo, monospace; font-size: 0.78rem; font-weight: 600; color: #3D3229; border-bottom: 1px solid #D4C4A8; }
		.card-image { padding: 12px; background: #FBF7EE; text-align: center; min-height: 200px; display: flex; align-items: center; justify-content: center; }
		.card-image img { max-width: 100%; max-height: 320px; object-fit: contain; }
		.card-image.error { color: #B43B3B; font-style: italic; font-size: 0.85rem; }
		.card-meta { padding: 8px 12px; font-size: 0.72rem; color: #8A7F72; display: flex; gap: 12px; flex-wrap: wrap; border-top: 1px solid #E8E1D2; background: #FBF7EE; }
		.card-meta strong { color: #5A4A3C; font-weight: 600; }
		.card-meta a { color: #2E7D74; text-decoration: none; }
		.card-meta a:hover { text-decoration: underline; }
		details { padding: 8px 12px; border-top: 1px solid #E8E1D2; font-size: 0.72rem; }
		details summary { cursor: pointer; color: #5A4A3C; }
		details pre { font-family: 'SFMono-Regular', monospace; font-size: 0.72rem; background: #F8F4E9; padding: 10px; border-radius: 4px; margin: 8px 0 0; overflow: auto; max-height: 240px; white-space: pre-wrap; word-break: break-word; }
		.failed { background: #FBE3DC; border-color: #E8B2A0; }
		.failed .card-name { background: #F5C6B6; color: #8C2E1A; }
		.stats { background: #FFFFFF; border: 1px solid #D4C4A8; border-radius: 6px; padding: 16px; margin-bottom: 24px; font-size: 0.85rem; }
		.stats span { display: inline-block; margin-right: 18px; }
		.stats strong { color: #3D3229; }
	`);
	tmpHtml.push('</style>');
	tmpHtml.push('</head>');
	tmpHtml.push('<body>');
	tmpHtml.push('<h1>pict-renderer-graph — gallery</h1>');
	tmpHtml.push('<div class="subtitle">Visual catalog of fixtures rendered by the pict-renderer-graph service. Regenerate with <code>npm run test:gallery</code>.</div>');

	// Summary stats
	let tmpTotal     = pResults.length;
	let tmpSuccesses = pResults.filter((r) => !r.error).length;
	let tmpFailures  = tmpTotal - tmpSuccesses;
	let tmpTotalMs   = pResults.reduce((a, b) => a + (b.renderMs || 0), 0);
	tmpHtml.push('<div class="stats">');
	tmpHtml.push('<span>Total fixtures: <strong>' + tmpTotal + '</strong></span>');
	tmpHtml.push('<span>Rendered: <strong>' + tmpSuccesses + '</strong></span>');
	tmpHtml.push('<span>Failed: <strong>' + tmpFailures + '</strong></span>');
	tmpHtml.push('<span>Total render time: <strong>' + tmpTotalMs + ' ms</strong></span>');
	tmpHtml.push('<span>Generated: <strong>' + new Date().toISOString() + '</strong></span>');
	tmpHtml.push('</div>');

	let tmpCats = Object.keys(tmpByCategory).sort();
	for (let i = 0; i < tmpCats.length; i++)
	{
		let tmpCat = tmpCats[i];
		let tmpItems = tmpByCategory[tmpCat];
		tmpHtml.push('<h2>' + escapeHTML(categoryLabel(tmpCat)) + ' (' + tmpItems.length + ')</h2>');
		tmpHtml.push('<div class="grid">');
		for (let j = 0; j < tmpItems.length; j++)
		{
			let tmpItem = tmpItems[j];
			let tmpClass = tmpItem.error ? 'card failed' : 'card';
			let tmpPng   = tmpItem.error ? null : (tmpCat + '/' + tmpItem.name + '.png');
			let tmpSvg   = tmpItem.error ? null : (tmpCat + '/' + tmpItem.name + '.svg');
			tmpHtml.push('<div class="' + tmpClass + '">');
			tmpHtml.push('<div class="card-name">' + escapeHTML(tmpItem.name) + '</div>');
			tmpHtml.push('<div class="card-image' + (tmpItem.error ? ' error' : '') + '">');
			if (tmpItem.error)
			{
				tmpHtml.push(escapeHTML(tmpItem.error));
			}
			else
			{
				tmpHtml.push('<a href="' + tmpPng + '" target="_blank"><img src="' + tmpPng + '" alt="' + escapeHTML(tmpItem.name) + '"></a>');
			}
			tmpHtml.push('</div>');
			tmpHtml.push('<div class="card-meta">');
			tmpHtml.push('<span><strong>type:</strong> ' + escapeHTML(tmpItem.type || '?') + '</span>');
			if (tmpItem.style)   tmpHtml.push('<span><strong>style:</strong> ' + escapeHTML(tmpItem.style) + '</span>');
			if (tmpItem.elements != null) tmpHtml.push('<span><strong>elements:</strong> ' + tmpItem.elements + '</span>');
			if (tmpItem.renderMs != null) tmpHtml.push('<span><strong>render:</strong> ' + tmpItem.renderMs + 'ms</span>');
			if (tmpSvg) tmpHtml.push('<span><a href="' + tmpSvg + '" target="_blank">.svg</a></span>');
			tmpHtml.push('</div>');
			if (tmpItem.description)
			{
				tmpHtml.push('<details><summary>about</summary><pre>' + escapeHTML(tmpItem.description) + '</pre></details>');
			}
			tmpHtml.push('<details><summary>fixture JSON</summary><pre>' + escapeHTML(JSON.stringify(tmpItem.fixture, null, 2)) + '</pre></details>');
			tmpHtml.push('</div>');
		}
		tmpHtml.push('</div>');
	}

	tmpHtml.push('</body></html>');

	libFs.writeFileSync(libPath.join(OUTPUT_ROOT, 'index.html'), tmpHtml.join('\n'));
}

// ----------------------------------------------------------------------------

async function main()
{
	if (!libFs.existsSync(FIXTURE_ROOT))
	{
		process.stderr.write('No fixtures directory at ' + FIXTURE_ROOT + '\n');
		process.exit(2);
	}

	// Wipe + recreate the output directory.  Gallery is regenerated wholesale
	// every run — it's a snapshot, not an append-only log.
	libFs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
	ensureDir(OUTPUT_ROOT);

	let tmpFixtures = discoverFixtures();
	logStep('found ' + tmpFixtures.length + ' fixtures across ' +
		Object.keys(tmpFixtures.reduce((a, f) => (a[f.category] = 1, a), {})).length + ' categories');

	let tmpFable = new libFable();
	let tmpRenderer = new libPictRendererGraph(tmpFable, {
		PageCount: 4,
		CacheEnabled: false   // gallery is supposed to actually re-render every fixture
	});

	logStep('warming 4-page pool…');
	await new Promise((fResolve, fReject) =>
	{
		tmpRenderer.initialize((pErr) => pErr ? fReject(pErr) : fResolve());
	});

	let tmpResults = [];
	let tmpAllStart = Date.now();

	for (let i = 0; i < tmpFixtures.length; i++)
	{
		let tmpFx = tmpFixtures[i];
		let tmpFixture;
		try { tmpFixture = JSON.parse(libFs.readFileSync(tmpFx.path, 'utf8')); }
		catch (pErr)
		{
			logStep('  ✗ ' + tmpFx.category + '/' + tmpFx.name + ' — invalid JSON: ' + pErr.message);
			tmpResults.push({
				category: tmpFx.category, name: tmpFx.name,
				error: 'invalid JSON: ' + pErr.message
			});
			continue;
		}

		let tmpStart = Date.now();
		let tmpOutDir = libPath.join(OUTPUT_ROOT, tmpFx.category);
		ensureDir(tmpOutDir);

		// Render PNG (the gallery's visual) + SVG (linked for full-fidelity inspection).
		await new Promise((fResolve) =>
		{
			tmpRenderer.render(tmpFixture, { format: 'png', scale: 2 }, (pErrPng, pOutPng) =>
			{
				if (pErrPng)
				{
					let tmpMs = Date.now() - tmpStart;
					logStep('  ✗ ' + tmpFx.category + '/' + tmpFx.name + ' — ' + pErrPng.message);
					tmpResults.push({
						category: tmpFx.category, name: tmpFx.name,
						fixture: tmpFixture,
						description: tmpFixture._description,
						type: tmpFixture.type,
						style: typeof tmpFixture.style === 'string' ? tmpFixture.style : (tmpFixture.style && tmpFixture.style.name) || null,
						renderMs: tmpMs,
						error: pErrPng.message
					});
					return fResolve();
				}
				libFs.writeFileSync(libPath.join(tmpOutDir, tmpFx.name + '.png'), pOutPng.png);

				// Also drop an SVG alongside (separate render — the cache is
				// off, this is a fresh pass).
				tmpRenderer.render(tmpFixture, { format: 'svg' }, (pErrSvg, pOutSvg) =>
				{
					let tmpMs = Date.now() - tmpStart;
					if (!pErrSvg && pOutSvg.svg)
					{
						libFs.writeFileSync(libPath.join(tmpOutDir, tmpFx.name + '.svg'), pOutSvg.svg);
					}
					let tmpElements = (pOutPng.scene && pOutPng.scene.elements && pOutPng.scene.elements.length) || 0;
					logStep('  ✓ ' + tmpFx.category + '/' + tmpFx.name + ' (' + tmpElements + ' elements, ' + tmpMs + 'ms)');
					tmpResults.push({
						category: tmpFx.category, name: tmpFx.name,
						fixture: tmpFixture,
						description: tmpFixture._description,
						type: tmpFixture.type,
						style: typeof tmpFixture.style === 'string' ? tmpFixture.style : (tmpFixture.style && tmpFixture.style.name) || null,
						elements: tmpElements,
						renderMs: tmpMs
					});
					return fResolve();
				});
			});
		});
	}

	let tmpTotalMs = Date.now() - tmpAllStart;
	logStep('rendered ' + tmpResults.filter((r) => !r.error).length + '/' + tmpResults.length +
		' fixtures in ' + tmpTotalMs + 'ms');

	logStep('writing index.html');
	writeIndex(tmpResults);

	tmpRenderer.shutdown(() =>
	{
		let tmpFailures = tmpResults.filter((r) => r.error);
		if (tmpFailures.length > 0)
		{
			process.stderr.write('\n[gallery] ' + tmpFailures.length + ' fixture(s) failed:\n');
			for (let i = 0; i < tmpFailures.length; i++)
			{
				process.stderr.write('  - ' + tmpFailures[i].category + '/' + tmpFailures[i].name + ': ' + tmpFailures[i].error + '\n');
			}
			process.exit(1);
		}
		logStep('done — open test/gallery/index.html');
		process.exit(0);
	});
}

main().catch((pErr) =>
{
	process.stderr.write('[gallery] FAILED: ' + (pErr && pErr.stack || pErr) + '\n');
	process.exit(2);
});
