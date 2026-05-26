#!/usr/bin/env node
/**
 * loadtest.js — manual concurrency probing for pict-renderer-graph.
 *
 * Boots the service in-process, fires N concurrent renders, prints
 * latency stats.  Two flavors:
 *
 *   --identical  — every render uses the same input.  Cache + coalescer
 *                  should reduce the work to ~1 render no matter how
 *                  high --concurrency goes.
 *   --unique     — every render uses a unique input (different node label).
 *                  Stresses the page pool.  Throughput should scale with
 *                  PageCount up to the pool size.
 *
 * Usage:
 *
 *   node test/loadtest.js --concurrency 8 --total 32 --unique
 *   node test/loadtest.js --concurrency 16 --total 100 --identical
 */

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');

function parseArgs()
{
	let tmpOut = { concurrency: 4, total: 16, mode: 'unique', pageCount: 4 };
	let tmpArgs = process.argv.slice(2);
	for (let i = 0; i < tmpArgs.length; i++)
	{
		let tmpA = tmpArgs[i];
		if (tmpA === '--concurrency' || tmpA === '-c') tmpOut.concurrency = parseInt(tmpArgs[++i], 10);
		else if (tmpA === '--total' || tmpA === '-n')  tmpOut.total       = parseInt(tmpArgs[++i], 10);
		else if (tmpA === '--unique')                  tmpOut.mode        = 'unique';
		else if (tmpA === '--identical')               tmpOut.mode        = 'identical';
		else if (tmpA === '--pages' || tmpA === '-p')  tmpOut.pageCount   = parseInt(tmpArgs[++i], 10);
	}
	return tmpOut;
}

async function main()
{
	let tmpCfg = parseArgs();
	let tmpFable = new libFable();
	let tmpRenderer = new libPictRendererGraph(tmpFable, { PageCount: tmpCfg.pageCount });

	process.stdout.write('[loadtest] warming ' + tmpCfg.pageCount + '-page pool…\n');
	await new Promise((fResolve, fReject) =>
	{
		tmpRenderer.initialize((pErr) => pErr ? fReject(pErr) : fResolve());
	});
	process.stdout.write('[loadtest] running ' + tmpCfg.total + ' renders, ' + tmpCfg.concurrency + ' concurrent, mode=' + tmpCfg.mode + '\n');

	let tmpStart = Date.now();
	let tmpLatencies = [];
	let tmpErrors = 0;
	let tmpBusy = 0;
	let tmpInFlight = 0;
	let tmpDone = 0;

	let tmpRender = (pIndex) =>
	{
		tmpInFlight++;
		let tmpRenderStart = Date.now();
		let tmpGraph = (tmpCfg.mode === 'identical')
			? {
				type: 'flow',
				title: 'loadtest-identical',
				nodes: [ { id: 'a', label: 'A' }, { id: 'b', label: 'B' } ],
				edges: [ { from: 'a', to: 'b' } ]
			}
			: {
				type: 'flow',
				title: 'loadtest-' + pIndex,
				nodes: [
					{ id: 'a' + pIndex, label: 'A' + pIndex },
					{ id: 'b' + pIndex, label: 'B' + pIndex }
				],
				edges: [ { from: 'a' + pIndex, to: 'b' + pIndex } ]
			};

		tmpRenderer.render(tmpGraph, {}, (pErr, pOut) =>
		{
			tmpInFlight--;
			let tmpLatency = Date.now() - tmpRenderStart;
			if (pErr)
			{
				if (pErr.name === 'RendererBusyError') tmpBusy++;
				else tmpErrors++;
			}
			else
			{
				tmpLatencies.push(tmpLatency);
			}
			tmpDone++;
			if (tmpDone >= tmpCfg.total) finishReport();
		});
	};

	// Drive concurrency via a token bucket: at most --concurrency in flight.
	let tmpFired = 0;
	let tmpInterval = setInterval(() =>
	{
		while (tmpInFlight < tmpCfg.concurrency && tmpFired < tmpCfg.total)
		{
			tmpRender(tmpFired++);
		}
		if (tmpFired >= tmpCfg.total) clearInterval(tmpInterval);
	}, 5);

	function finishReport()
	{
		let tmpElapsed = Date.now() - tmpStart;
		tmpLatencies.sort((a, b) => a - b);
		let tmpP50 = tmpLatencies[Math.floor(tmpLatencies.length * 0.50)] || 0;
		let tmpP95 = tmpLatencies[Math.floor(tmpLatencies.length * 0.95)] || 0;
		let tmpP99 = tmpLatencies[Math.floor(tmpLatencies.length * 0.99)] || 0;
		let tmpAvg = tmpLatencies.length
			? Math.round(tmpLatencies.reduce((a, b) => a + b, 0) / tmpLatencies.length)
			: 0;
		let tmpRps = (tmpLatencies.length / (tmpElapsed / 1000)).toFixed(2);
		process.stdout.write('\n[loadtest] results:\n');
		process.stdout.write('  total renders        : ' + tmpCfg.total + '\n');
		process.stdout.write('  successful           : ' + tmpLatencies.length + '\n');
		process.stdout.write('  busy (503-equivalent): ' + tmpBusy + '\n');
		process.stdout.write('  errors               : ' + tmpErrors + '\n');
		process.stdout.write('  wall-clock time      : ' + tmpElapsed + 'ms\n');
		process.stdout.write('  throughput           : ' + tmpRps + ' req/s\n');
		process.stdout.write('  latency avg          : ' + tmpAvg + 'ms\n');
		process.stdout.write('  latency p50          : ' + tmpP50 + 'ms\n');
		process.stdout.write('  latency p95          : ' + tmpP95 + 'ms\n');
		process.stdout.write('  latency p99          : ' + tmpP99 + 'ms\n');
		tmpRenderer.shutdown(() => process.exit(0));
	}
}

main().catch((pErr) => { process.stderr.write('FAILED: ' + pErr.message + '\n'); process.exit(1); });
