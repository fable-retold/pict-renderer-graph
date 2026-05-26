#!/usr/bin/env node
/**
 * Renderer-Service-Application.js
 *
 * The smallest sensible standalone Orator app that hosts pict-renderer-graph.
 * Drop this pattern into any retold service / app that wants to expose a
 * /render endpoint to the wider system.
 *
 * Boot with:
 *   npm install && npm start
 *   curl -X POST http://127.0.0.1:7790/render -H 'Content-Type: application/json' -d @diagram.json > diagram.svg
 */

const libFable = require('fable');
const libOrator = require('orator');
const libOratorServerRestify = require('orator-serviceserver-restify');
const libPictRendererGraph = require('pict-renderer-graph');

const PORT = parseInt(process.env.PORT || '7790', 10);

// 1.  Fable settings must carry Product before the OratorServiceServer
//     instantiates (its base reads fable.settings.Product in the ctor).
let _fable = new libFable({
	Product:        'pict-renderer-graph-example',
	ProductVersion: require('./package.json').version,
	APIServerPort:  PORT
});

// 2.  Register Orator + the restify service-server with the service
//     manager.  The retold pattern uses serviceManager to compose;
//     mirrors what retold-data-service does.
_fable.serviceManager.addServiceType('OratorServiceServer', libOratorServerRestify);
_fable.serviceManager.addServiceType('Orator',              libOrator);
_fable.serviceManager.instantiateServiceProvider('OratorServiceServer',
{ Name: 'pict-renderer-graph-example', APIServerPort: PORT });
_fable.serviceManager.instantiateServiceProvider('Orator',
{ APIServerPort: PORT });

// 3.  Instantiate the renderer + warm Chromium up front so the first
//     POST doesn't pay the cold-start cost.
let _renderer = new libPictRendererGraph(_fable);
_renderer.initialize((pInitErr) =>
{
	if (pInitErr)
	{
		console.error('Renderer init failed:', pInitErr.message);
		process.exit(1);
	}

	// 4.  Register the routes — POST /render, GET /render/types, GET /render/styles.
	_renderer.connectRoutes(_fable.OratorServiceServer);

	// 5.  Start listening.
	_fable.Orator.startWebServer((pServeErr) =>
	{
		if (pServeErr)
		{
			console.error('Server startup failed:', pServeErr.message);
			_renderer.shutdown(() => process.exit(1));
			return;
		}
		console.log('pict-renderer-graph example service listening on http://127.0.0.1:' + PORT);
		console.log('  POST   /render              (image/svg+xml or image/png)');
		console.log('  POST   /render?format=json  (JSON envelope)');
		console.log('  GET    /render/types');
		console.log('  GET    /render/styles');
	});
});

// Clean shutdown on Ctrl+C / SIGTERM.
let _shuttingDown = false;
function shutdown()
{
	if (_shuttingDown) return;
	_shuttingDown = true;
	console.log('Shutting down…');
	_renderer.shutdown(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
