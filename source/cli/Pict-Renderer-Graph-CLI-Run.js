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

const _Help = `pict-renderer-graph — headless Excalidraw renderer

Usage:
  pict-renderer-graph render <input.json|-> <output.svg|.png|->  [options]
  pict-renderer-graph serve [--port N] [--host H]
  pict-renderer-graph list-types
  pict-renderer-graph list-styles
  pict-renderer-graph --help

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
	case 'serve':        cmdServe(_args);      break;
	case 'list-types':   cmdListTypes();       process.exit(0); break;
	case 'list-styles':  cmdListStyles();      process.exit(0); break;
	default:
		process.stderr.write('Unknown subcommand: "' + _subcommand + '"\n\n');
		cmdHelp();
		process.exit(2);
}
