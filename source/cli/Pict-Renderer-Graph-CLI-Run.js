#!/usr/bin/env node
/**
 * Pict-Renderer-Graph CLI.
 *
 *   pict-renderer-graph render <input.json> <output.svg|png>
 *                              [--format svg|png]
 *                              [--scale N]
 *                              [--padding N]
 *                              [--no-embed-scene]
 *                              [--no-source]
 *                              [--style notebook|whiteboard|clean|dark]
 *
 *   pict-renderer-graph serve [--port N] [--host H]
 *
 *   pict-renderer-graph list-types
 *   pict-renderer-graph list-styles
 *   pict-renderer-graph --help
 *
 * Input file may be a path or `-` for stdin.  Output may be `-` for stdout
 * (only meaningful for SVG; PNG to stdout will write a binary blob).
 */

const libFs   = require('fs');
const libPath = require('path');

const libFable = require('fable');
const libPictRendererGraph = require('../Pict-Renderer-Graph.js');
const libConvert = require('../Pict-Renderer-Graph-Convert.js');

const _Help = `pict-renderer-graph — headless Excalidraw renderer

Usage:
  pict-renderer-graph render <input.json|-> <output.svg|.png|->  [options]
  pict-renderer-graph build <dir|file.mmd>  [--style NAME] [--no-theme-variables]
  pict-renderer-graph convert <dir|file.md>  [--dry-run] [--compare <dir>] [--style NAME]
  pict-renderer-graph serve [--port N] [--host H]
  pict-renderer-graph list-types
  pict-renderer-graph list-styles
  pict-renderer-graph --help

build:
  Renders every <name>.mmd under a path into <name>.svg + <name>.excalidraw,
  next to the source. A sibling <name>.hints.json may set { style, emphasis,
  restyle, themeVariables }. SVGs are theme-adaptive (CSS variables) by default.

Options (render):
  --format svg|png        Output format (default: svg, or inferred from filename)
  --scale N               Export scale multiplier (default 1)
  --padding N             Export padding in px (default 16)
  --style NAME            Override style profile (notebook|whiteboard|clean|dark)
  --no-embed-scene        Omit Excalidraw's exportEmbedScene metadata
  --no-source             Omit the pict-renderer-graph:source metadata block

Examples:
  cat svc.json | pict-renderer-graph render - svc.svg
  pict-renderer-graph render flow.json flow.png --format png --scale 2
  pict-renderer-graph serve --port 7790
  pict-renderer-graph list-types
`;

function parseArgs(pArgv)
{
	let tmpArgs =
	{
		_:    [],
		flags: {}
	};
	for (let i = 0; i < pArgv.length; i++)
	{
		let tmpA = pArgv[i];
		if (tmpA === '--help' || tmpA === '-h')
		{
			tmpArgs.flags.help = true;
		}
		else if (tmpA.startsWith('--no-'))
		{
			tmpArgs.flags[tmpA.slice(5)] = false;
		}
		else if (tmpA.startsWith('--'))
		{
			let tmpKey = tmpA.slice(2);
			let tmpNext = pArgv[i + 1];
			if (tmpNext && !tmpNext.startsWith('--'))
			{
				tmpArgs.flags[tmpKey] = tmpNext;
				i++;
			}
			else
			{
				tmpArgs.flags[tmpKey] = true;
			}
		}
		else
		{
			tmpArgs._.push(tmpA);
		}
	}
	return tmpArgs;
}

function readInput(pPath, fCallback)
{
	if (pPath === '-' || pPath === '/dev/stdin')
	{
		let tmpChunks = [];
		process.stdin.on('data', (c) => tmpChunks.push(c));
		process.stdin.on('end', () =>
		{
			try
			{
				let tmpJson = JSON.parse(Buffer.concat(tmpChunks).toString('utf8'));
				fCallback(null, tmpJson);
			}
			catch (pErr) { fCallback(pErr); }
		});
		if (process.stdin.isTTY)
		{
			return fCallback(new Error('stdin is a TTY — pipe JSON in or pass a path'));
		}
		return;
	}
	libFs.readFile(pPath, 'utf8', (pErr, pData) =>
	{
		if (pErr) return fCallback(pErr);
		try { fCallback(null, JSON.parse(pData)); }
		catch (pParseErr) { fCallback(pParseErr); }
	});
}

function writeOutput(pPath, pData, fCallback)
{
	if (pPath === '-' || pPath === '/dev/stdout')
	{
		process.stdout.write(pData);
		return fCallback(null);
	}
	libFs.writeFile(pPath, pData, fCallback);
}

function inferFormat(pPath, pExplicit)
{
	if (pExplicit) return pExplicit;
	if (!pPath || pPath === '-') return 'svg';
	let tmpExt = libPath.extname(pPath).toLowerCase();
	if (tmpExt === '.png') return 'png';
	return 'svg';
}

// ---- Subcommands -----------------------------------------------------

function cmdListTypes()
{
	let tmpFable = new libFable();
	let tmpRenderer = new libPictRendererGraph(tmpFable);
	let tmpList = tmpRenderer.diagrams.list();
	for (let i = 0; i < tmpList.length; i++)
	{
		let tmpD = tmpList[i];
		process.stdout.write(`  ${tmpD.type.padEnd(10)} — ${tmpD.description}\n`);
	}
}

function cmdListStyles()
{
	let tmpFable = new libFable();
	let tmpRenderer = new libPictRendererGraph(tmpFable);
	let tmpList = tmpRenderer.styles.list();
	for (let i = 0; i < tmpList.length; i++)
	{
		let tmpS = tmpList[i];
		process.stdout.write(`  ${tmpS.name.padEnd(12)} — ${tmpS.description}\n`);
	}
}

function cmdRender(pArgs)
{
	let tmpInPath  = pArgs._[1];
	let tmpOutPath = pArgs._[2];
	if (!tmpInPath || !tmpOutPath)
	{
		process.stderr.write('usage: pict-renderer-graph render <input.json|-> <output.svg|.png|->\n');
		process.exit(2);
	}

	let tmpFormat = inferFormat(tmpOutPath, pArgs.flags.format);
	let tmpRenderOpts =
	{
		format:        tmpFormat,
		includeSource: pArgs.flags.source !== false,        // --no-source disables
		embedScene:    pArgs.flags['embed-scene'] !== false // --no-embed-scene disables
	};
	if (pArgs.flags.scale)   tmpRenderOpts.scale   = parseFloat(pArgs.flags.scale);
	if (pArgs.flags.padding) tmpRenderOpts.padding = parseFloat(pArgs.flags.padding);

	readInput(tmpInPath, (pInErr, pGraph) =>
	{
		if (pInErr)
		{
			process.stderr.write('Error reading input: ' + pInErr.message + '\n');
			process.exit(3);
		}
		if (pArgs.flags.style) pGraph.style = pArgs.flags.style;

		let tmpFable = new libFable();
		let tmpRenderer = new libPictRendererGraph(tmpFable);
		tmpRenderer.initialize((pInitErr) =>
		{
			if (pInitErr)
			{
				process.stderr.write('Error initializing renderer: ' + pInitErr.message + '\n');
				process.exit(4);
			}
			tmpRenderer.render(pGraph, tmpRenderOpts, (pRenderErr, pOut) =>
			{
				if (pRenderErr)
				{
					process.stderr.write('Error rendering: ' + pRenderErr.message + '\n');
					tmpRenderer.shutdown(() => process.exit(5));
					return;
				}
				let tmpPayload = (tmpFormat === 'png') ? pOut.png : pOut.svg;
				writeOutput(tmpOutPath, tmpPayload, (pWriteErr) =>
				{
					if (pWriteErr)
					{
						process.stderr.write('Error writing output: ' + pWriteErr.message + '\n');
						tmpRenderer.shutdown(() => process.exit(6));
						return;
					}
					if (tmpOutPath !== '-' && tmpOutPath !== '/dev/stdout')
					{
						process.stderr.write('[pict-renderer-graph] wrote ' + tmpOutPath +
							' (' + (tmpPayload.length || tmpPayload.byteLength) + ' bytes, ' +
							pOut.scene.elements.length + ' Excalidraw elements)\n');
					}
					tmpRenderer.shutdown(() => process.exit(0));
				});
			});
		});
	});
}

function cmdServe(pArgs)
{
	let tmpPort = parseInt(pArgs.flags.port || '7790', 10);
	let tmpHost = pArgs.flags.host || '127.0.0.1';

	// Lazy-require — only when serving, since this pulls in orator.
	let libOrator = require('orator');
	let libOratorServerRestify = require('orator-serviceserver-restify');

	// fable settings must carry Product before OratorServiceServer is
	// instantiated (its base class reads fable.settings.Product in the
	// constructor).  Mirrors the retold-data-service pattern.
	let tmpFable = new libFable({
		Product:        'pict-renderer-graph',
		ProductVersion: require('../../package.json').version,
		APIServerPort:  tmpPort
	});

	// Register the Orator service-server + Orator itself with the service
	// manager, then instantiate.  This attaches them to fable as
	// fable.OratorServiceServer and fable.Orator.
	tmpFable.serviceManager.addServiceType('OratorServiceServer', libOratorServerRestify);
	tmpFable.serviceManager.addServiceType('Orator', libOrator);
	tmpFable.serviceManager.instantiateServiceProvider('OratorServiceServer',
	{
		Name:          'pict-renderer-graph',
		APIServerPort: tmpPort
	});
	tmpFable.serviceManager.instantiateServiceProvider('Orator', { APIServerPort: tmpPort });

	let tmpRenderer = new libPictRendererGraph(tmpFable);
	tmpRenderer.initialize((pInitErr) =>
	{
		if (pInitErr)
		{
			process.stderr.write('Error initializing renderer: ' + pInitErr.message + '\n');
			process.exit(4);
		}
		// connectRoutes registers handlers on the orator service server.
		tmpRenderer.connectRoutes(tmpFable.OratorServiceServer);
		tmpFable.Orator.startWebServer((pServeErr) =>
		{
			if (pServeErr)
			{
				process.stderr.write('Error starting server: ' + pServeErr.message + '\n');
				tmpRenderer.shutdown(() => process.exit(7));
				return;
			}
			process.stderr.write('[pict-renderer-graph] listening on http://' + tmpHost + ':' + tmpPort + '\n');
			process.stderr.write('  POST /render             (JSON in, image/svg+xml or image/png out)\n');
			process.stderr.write('  POST /render?format=json (JSON envelope: { svg, scene, source })\n');
			process.stderr.write('  GET  /render/types\n');
			process.stderr.write('  GET  /render/styles\n');

			// Clean shutdown on SIGINT/SIGTERM.
			let tmpShuttingDown = false;
			let tmpShutdown = () =>
			{
				if (tmpShuttingDown) return;
				tmpShuttingDown = true;
				process.stderr.write('[pict-renderer-graph] shutting down\n');
				tmpRenderer.shutdown(() => process.exit(0));
			};
			process.on('SIGINT', tmpShutdown);
			process.on('SIGTERM', tmpShutdown);
		});
	});
}

// Find every *.mmd under a path (a single file, or a directory walked
// recursively, skipping dotdirs + node_modules).
function findMmdFiles(pPath)
{
	let tmpStat = libFs.statSync(pPath);
	if (tmpStat.isFile())
	{
		return pPath.endsWith('.mmd') ? [ pPath ] : [];
	}
	let tmpOut = [];
	(function walk(pDir)
	{
		for (let tmpEntry of libFs.readdirSync(pDir, { withFileTypes: true }))
		{
			if (tmpEntry.name === 'node_modules' || tmpEntry.name.startsWith('.')) { continue; }
			let tmpFull = libPath.join(pDir, tmpEntry.name);
			if (tmpEntry.isDirectory()) { walk(tmpFull); }
			else if (tmpEntry.name.endsWith('.mmd')) { tmpOut.push(tmpFull); }
		}
	})(pPath);
	tmpOut.sort();
	return tmpOut;
}

// Render one <name>.mmd (+ optional <name>.hints.json) into <name>.svg +
// <name>.excalidraw next to the source.
function buildOne(pRenderer, pMmdPath, pArgs, fCallback)
{
	let tmpSource;
	try { tmpSource = libFs.readFileSync(pMmdPath, 'utf8'); }
	catch (pErr) { return fCallback(pErr); }

	let tmpHints = {};
	let tmpHintsPath = pMmdPath.replace(/\.mmd$/, '.hints.json');
	if (libFs.existsSync(tmpHintsPath))
	{
		try { tmpHints = JSON.parse(libFs.readFileSync(tmpHintsPath, 'utf8')); }
		catch (pErr) { return fCallback(new Error(tmpHintsPath + ': ' + pErr.message)); }
	}

	// Flowcharts, sequence and entity-relationship diagrams render natively (our
	// own parse + layout + emit); other mermaid types (class/state/gantt) stay on
	// mermaid-to-excalidraw. Force the choice per-diagram with
	// "renderer": "flowgraph" | "seqgraph" | "ergraph" | "mermaid" in the hints.
	let tmpIsFlowchart = /^\s*(?:graph|flowchart)\b/m.test(tmpSource);
	let tmpIsSequence  = /^\s*sequenceDiagram\b/m.test(tmpSource);
	let tmpIsER        = /^\s*erDiagram\b/m.test(tmpSource);
	// A tree sidecar carries box-drawing branch connectors instead of a mermaid
	// header (the .mmd extension is just "diagram source", whatever the dialect).
	let tmpIsTree      = !tmpIsFlowchart && !tmpIsSequence && !tmpIsER && /^[ \t│]*[├└][─-]+/m.test(tmpSource);
	let tmpRenderer = tmpHints.renderer ||
		(tmpIsFlowchart ? 'flowgraph' : tmpIsSequence ? 'seqgraph' : tmpIsER ? 'ergraph' : tmpIsTree ? 'filetree' : 'mermaid');

	let tmpGraph =
	{
		type:    tmpRenderer,
		mermaid: tmpSource,
		style:   tmpHints.style || pArgs.flags.style || 'notebook'
	};
	if (Array.isArray(tmpHints.emphasis)) { tmpGraph.emphasis = tmpHints.emphasis; }
	if (tmpHints.restyle === false)       { tmpGraph.restyle = false; }
	// Layout-intent hints -- the handler translates these into the mermaid.
	if (tmpHints.direction)               { tmpGraph.direction = tmpHints.direction; }
	if (tmpHints.engine)                  { tmpGraph.engine    = tmpHints.engine; }
	if (tmpHints.spacing)                 { tmpGraph.spacing   = tmpHints.spacing; }
	if (Array.isArray(tmpHints.clusters)) { tmpGraph.clusters  = tmpHints.clusters; }
	if (Array.isArray(tmpHints.order))    { tmpGraph.order     = tmpHints.order; }

	// Docs want theme-adaptive output by default; opt out per-diagram with
	// "themeVariables": false in the hints, or globally with --no-theme-variables.
	let tmpThemeVariables = (tmpHints.themeVariables !== false) && (pArgs.flags['theme-variables'] !== false);

	// Docs diagrams default to a transparent background so they blend with the
	// page in any theme (the inlined ink outlines adapt via --diagram-ink);
	// opt back in with "background": true in the hints.
	let tmpBackground = (tmpHints.background === true);

	pRenderer.render(tmpGraph, { format: 'svg', includeSource: true, themeVariables: tmpThemeVariables, background: tmpBackground }, (pErr, pOut) =>
	{
		if (pErr) { return fCallback(pErr); }
		let tmpSvgPath     = pMmdPath.replace(/\.mmd$/, '.svg');
		let tmpExcaliPath  = pMmdPath.replace(/\.mmd$/, '.excalidraw');
		try
		{
			libFs.writeFileSync(tmpSvgPath, pOut.svg);
			libFs.writeFileSync(tmpExcaliPath, JSON.stringify(pOut.scene, null, '\t'));
		}
		catch (pWriteErr) { return fCallback(pWriteErr); }
		process.stderr.write('  ' + libPath.basename(pMmdPath) + ' -> ' + libPath.basename(tmpSvgPath) +
			' + .excalidraw  (' + pOut.scene.elements.length + ' elements' +
			(tmpGraph.emphasis ? ', ' + tmpGraph.emphasis.length + ' emphasis' : '') + ')\n');
		fCallback(null);
	});
}

function cmdBuild(pArgs)
{
	let tmpPath = pArgs._[1];
	if (!tmpPath)
	{
		process.stderr.write('usage: pict-renderer-graph build <dir|file.mmd> [--style NAME] [--no-theme-variables]\n');
		process.exit(2);
	}
	let tmpFiles;
	try { tmpFiles = findMmdFiles(tmpPath); }
	catch (pErr) { process.stderr.write('Error scanning ' + tmpPath + ': ' + pErr.message + '\n'); process.exit(3); }

	if (!tmpFiles.length)
	{
		process.stderr.write('[pict-renderer-graph] build: no .mmd files found under ' + tmpPath + '\n');
		process.exit(0);
	}

	let tmpRenderer = new libPictRendererGraph(new libFable());
	tmpRenderer.initialize((pInitErr) =>
	{
		if (pInitErr)
		{
			process.stderr.write('Error initializing renderer: ' + pInitErr.message + '\n');
			process.exit(4);
		}
		process.stderr.write('[pict-renderer-graph] build: ' + tmpFiles.length + ' diagram(s)\n');
		let tmpIndex = 0, tmpOk = 0, tmpFail = 0;
		let tmpNext = () =>
		{
			if (tmpIndex >= tmpFiles.length)
			{
				process.stderr.write('[pict-renderer-graph] build done: ' + tmpOk + ' ok, ' + tmpFail + ' failed\n');
				return tmpRenderer.shutdown(() => process.exit(tmpFail ? 8 : 0));
			}
			let tmpMmd = tmpFiles[tmpIndex++];
			buildOne(tmpRenderer, tmpMmd, pArgs, (pErr) =>
			{
				if (pErr) { tmpFail++; process.stderr.write('  FAILED ' + libPath.basename(tmpMmd) + ': ' + pErr.message + '\n'); }
				else { tmpOk++; }
				tmpNext();
			});
		};
		tmpNext();
	});
}

// Find every *.md under a path (single file or a directory walked recursively),
// skipping node_modules / dist / dotdirs and the generated diagrams/ folders.
function findMarkdownFiles(pPath)
{
	let tmpStat = libFs.statSync(pPath);
	if (tmpStat.isFile())
	{
		return pPath.endsWith('.md') ? [ pPath ] : [];
	}
	let tmpOut = [];
	(function walk(pDir)
	{
		for (let tmpEntry of libFs.readdirSync(pDir, { withFileTypes: true }))
		{
			// Skip build/output + generated dirs, and vendored third-party trees
			// (e.g. a mirrored upstream repo) -- we don't rewrite code we don't own.
			if (tmpEntry.name === 'node_modules' || tmpEntry.name === 'dist' || tmpEntry.name === 'diagrams' || tmpEntry.name === 'vendor' || tmpEntry.name.startsWith('.')) { continue; }
			let tmpFull = libPath.join(pDir, tmpEntry.name);
			if (tmpEntry.isDirectory()) { walk(tmpFull); }
			else if (tmpEntry.name.endsWith('.md')) { tmpOut.push(tmpFull); }
		}
	})(pPath);
	tmpOut.sort();
	return tmpOut;
}

// Names already taken in a diagrams/ folder (so the converter doesn't collide
// with hand-authored or previously-converted diagrams).
function _existingDiagramNames(pDiagramsDir)
{
	let tmpUsed = {};
	try
	{
		for (let tmpFile of libFs.readdirSync(pDiagramsDir))
		{
			let tmpMatch = tmpFile.match(/^(.+?)\.(?:mmd|svg|excalidraw|hints\.json)$/);
			if (tmpMatch) { tmpUsed[tmpMatch[1]] = true; }
		}
	}
	catch (pErr) { /* folder may not exist yet */ }
	return tmpUsed;
}

function _relpath(pP) { let tmpR = libPath.relative(process.cwd(), pP); return tmpR || '.'; }

// Convert inline ```mermaid fences (flow / sequence / er) into rendered native
// SVG sidecars + image references, leaving unsupported types inline.
function cmdConvert(pArgs)
{
	let tmpPath = pArgs._[1];
	if (!tmpPath)
	{
		process.stderr.write('usage: pict-renderer-graph convert <dir|file.md> [--dry-run] [--compare <dir>] [--style NAME]\n');
		process.exit(2);
	}
	let tmpDryRun     = (pArgs.flags['dry-run'] === true) || (pArgs.flags.report === true);
	let tmpCompareDir = (typeof pArgs.flags.compare === 'string') ? libPath.resolve(pArgs.flags.compare) : null;
	let tmpStyle      = pArgs.flags.style || 'notebook';

	let tmpFiles;
	try { tmpFiles = findMarkdownFiles(libPath.resolve(tmpPath)); }
	catch (pErr) { process.stderr.write('Error scanning ' + tmpPath + ': ' + pErr.message + '\n'); process.exit(3); }

	// ---- Plan ----
	let tmpUsedByDir = {};
	let tmpJobs = [];
	let tmpSkip = {};
	let tmpFilesTouched = {};
	for (let f = 0; f < tmpFiles.length; f++)
	{
		let tmpMdPath = tmpFiles[f];
		let tmpText;
		try { tmpText = libFs.readFileSync(tmpMdPath, 'utf8'); }
		catch (pErr) { continue; }
		let tmpFences = libConvert.extractMermaidFences(tmpText);
		let tmpTrees  = (pArgs.flags.trees !== false) ? libConvert.extractTreeBlocks(tmpText) : [];
		if (!tmpFences.length && !tmpTrees.length) { continue; }
		let tmpDir = libPath.dirname(tmpMdPath);
		let tmpDiagramsDir = libPath.join(tmpDir, 'diagrams');
		if (!tmpUsedByDir[tmpDiagramsDir]) { tmpUsedByDir[tmpDiagramsDir] = _existingDiagramNames(tmpDiagramsDir); }
		let tmpUsed = tmpUsedByDir[tmpDiagramsDir];
		let tmpBase = libPath.basename(tmpMdPath, '.md');
		for (let i = 0; i < tmpFences.length; i++)
		{
			let tmpFence = tmpFences[i];
			if (!tmpFence.class.supported)
			{
				tmpSkip[tmpFence.class.bucket] = (tmpSkip[tmpFence.class.bucket] || 0) + 1;
				continue;
			}
			let tmpName = libConvert.deriveDiagramName(tmpFence.heading, tmpUsed, tmpBase, i);
			tmpJobs.push({ mdPath: tmpMdPath, dir: tmpDir, diagramsDir: tmpDiagramsDir, fence: tmpFence, name: tmpName, alt: tmpFence.heading, type: tmpFence.class.type, bucket: tmpFence.class.bucket });
			tmpFilesTouched[tmpMdPath] = true;
		}
		// Directory-tree blocks (plain ``` fences, not mermaid) -> the filetree
		// renderer.  Named + de-duped from the same diagrams/ pool as the fences.
		for (let i = 0; i < tmpTrees.length; i++)
		{
			let tmpTree = tmpTrees[i];
			let tmpName = libConvert.deriveDiagramName(tmpTree.heading, tmpUsed, tmpBase, tmpFences.length + i);
			tmpJobs.push({ mdPath: tmpMdPath, dir: tmpDir, diagramsDir: tmpDiagramsDir, fence: tmpTree, name: tmpName, alt: tmpTree.heading, type: 'filetree', bucket: 'tree' });
			tmpFilesTouched[tmpMdPath] = true;
		}
	}

	let tmpByBucket = {};
	for (let j = 0; j < tmpJobs.length; j++) { tmpByBucket[tmpJobs[j].bucket] = (tmpByBucket[tmpJobs[j].bucket] || 0) + 1; }
	process.stderr.write('[convert] ' + tmpJobs.length + ' convertible (' + JSON.stringify(tmpByBucket) + ') across ' +
		Object.keys(tmpFilesTouched).length + ' file(s); skipping ' + JSON.stringify(tmpSkip) + ' (unsupported, left inline)\n');

	if (tmpDryRun)
	{
		for (let j = 0; j < tmpJobs.length; j++)
		{
			let tmpJob = tmpJobs[j];
			process.stdout.write('  ' + tmpJob.bucket.padEnd(8) + ' ' + tmpJob.name.padEnd(40) + ' <- ' + _relpath(tmpJob.mdPath) + (tmpJob.alt ? '  ("' + tmpJob.alt + '")' : '') + '\n');
		}
		process.exit(0);
	}
	if (!tmpJobs.length) { process.stderr.write('[convert] nothing to convert.\n'); process.exit(0); }

	if (tmpCompareDir) { try { libFs.mkdirSync(tmpCompareDir, { recursive: true }); } catch (pErr) { /* ignore */ } }

	let tmpRenderer = new libPictRendererGraph(new libFable());
	tmpRenderer.initialize((pInitErr) =>
	{
		if (pInitErr) { process.stderr.write('Error initializing renderer: ' + pInitErr.message + '\n'); process.exit(4); }

		let tmpIndex = 0, tmpOk = 0, tmpFail = 0, tmpRendered = 0;
		let tmpReplByFile = {};
		let tmpCompareLines = [];

		let tmpFinish = () =>
		{
			let tmpFilesRewritten = 0;
			let tmpKeys = Object.keys(tmpReplByFile);
			for (let k = 0; k < tmpKeys.length; k++)
			{
				try
				{
					let tmpText = libFs.readFileSync(tmpKeys[k], 'utf8');
					libFs.writeFileSync(tmpKeys[k], libConvert.applyReplacements(tmpText, tmpReplByFile[tmpKeys[k]]));
					tmpFilesRewritten++;
				}
				catch (pErr) { process.stderr.write('  rewrite FAILED ' + _relpath(tmpKeys[k]) + ': ' + pErr.message + '\n'); }
			}
			if (tmpCompareDir && tmpCompareLines.length)
			{
				try { libFs.writeFileSync(libPath.join(tmpCompareDir, 'INDEX.txt'), tmpCompareLines.join('\n') + '\n'); } catch (pErr) { /* ignore */ }
			}
			process.stderr.write('[convert] done: ' + tmpOk + ' converted, ' + tmpFail + ' failed; rewrote ' + tmpFilesRewritten + ' file(s)' +
				(tmpCompareDir ? '; before/after images in ' + tmpCompareDir : '') + '\n');
			tmpRenderer.shutdown(() => process.exit(tmpFail ? 8 : 0));
		};

		let tmpNext = () =>
		{
			if (tmpIndex >= tmpJobs.length) { return tmpFinish(); }
			let tmpJob = tmpJobs[tmpIndex++];
			let tmpGraph = { type: tmpJob.type, mermaid: tmpJob.fence.body, style: tmpStyle };
			tmpRenderer.render(tmpGraph, { format: 'svg', includeSource: true, themeVariables: true, background: false }, (pErr, pOut) =>
			{
				if (pErr)
				{
					tmpFail++;
					process.stderr.write('  FAILED ' + tmpJob.name + ' (' + _relpath(tmpJob.mdPath) + '): ' + pErr.message + '\n');
					return tmpNext();
				}
				try
				{
					libFs.mkdirSync(tmpJob.diagramsDir, { recursive: true });
					libFs.writeFileSync(libPath.join(tmpJob.diagramsDir, tmpJob.name + '.mmd'), tmpJob.fence.body.trim() + '\n');
					libFs.writeFileSync(libPath.join(tmpJob.diagramsDir, tmpJob.name + '.svg'), pOut.svg);
					libFs.writeFileSync(libPath.join(tmpJob.diagramsDir, tmpJob.name + '.excalidraw'), JSON.stringify(pOut.scene, null, '\t'));
				}
				catch (pWriteErr)
				{
					tmpFail++;
					process.stderr.write('  WRITE FAILED ' + tmpJob.name + ': ' + pWriteErr.message + '\n');
					return tmpNext();
				}
				tmpOk++;
				(tmpReplByFile[tmpJob.mdPath] = tmpReplByFile[tmpJob.mdPath] || []).push({
					start: tmpJob.fence.start, end: tmpJob.fence.end,
					text: libConvert.buildImageReference(tmpJob.name, tmpJob.alt, _relpath(tmpJob.dir), tmpJob.fence.indent)
				});
				process.stderr.write('  ' + tmpJob.bucket.padEnd(8) + ' ' + tmpJob.name + ' <- ' + _relpath(tmpJob.mdPath) + '\n');

				if (!tmpCompareDir) { return tmpNext(); }
				// Before (mermaid fallback) + after (native) PNGs for side-by-side QA.
				let tmpTag = String(++tmpRendered).padStart(3, '0') + '-' + tmpJob.name;
				tmpRenderer.render({ type: 'mermaid', mermaid: tmpJob.fence.body, style: tmpStyle }, { format: 'png' }, (pBErr, pBOut) =>
				{
					if (!pBErr && pBOut && pBOut.png) { try { libFs.writeFileSync(libPath.join(tmpCompareDir, tmpTag + '.before.png'), pBOut.png); } catch (e) { /* ignore */ } }
					tmpRenderer.render({ type: tmpJob.type, mermaid: tmpJob.fence.body, style: tmpStyle }, { format: 'png' }, (pAErr, pAOut) =>
					{
						if (!pAErr && pAOut && pAOut.png) { try { libFs.writeFileSync(libPath.join(tmpCompareDir, tmpTag + '.after.png'), pAOut.png); } catch (e) { /* ignore */ } }
						tmpCompareLines.push(tmpTag + '  [' + tmpJob.bucket + ']  <- ' + _relpath(tmpJob.mdPath) + (tmpJob.alt ? '  ("' + tmpJob.alt + '")' : ''));
						tmpNext();
					});
				});
			});
		};
		tmpNext();
	});
}

function cmdHelp() { process.stdout.write(_Help); }

// ---- Main ------------------------------------------------------------

let _args = parseArgs(process.argv.slice(2));
let _subcommand = _args._[0];

if (_args.flags.help || !_subcommand)
{
	cmdHelp();
	process.exit(0);
}
switch (_subcommand)
{
	case 'render':       cmdRender(_args);     break;
	case 'build':        cmdBuild(_args);      break;
	case 'convert':      cmdConvert(_args);    break;
	case 'serve':        cmdServe(_args);      break;
	case 'list-types':   cmdListTypes();       process.exit(0); break;
	case 'list-styles':  cmdListStyles();      process.exit(0); break;
	default:
		process.stderr.write('Unknown subcommand: "' + _subcommand + '"\n\n');
		cmdHelp();
		process.exit(2);
}
