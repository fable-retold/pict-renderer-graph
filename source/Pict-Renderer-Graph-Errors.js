/**
 * Pict-Renderer-Graph-Errors.js
 *
 * Typed errors that consumers can identify by class.  Currently:
 *   - RendererBusyError — backpressure fired (queue full).  Carries the
 *     suggested retryAfterSeconds value so HTTP and library callers can
 *     each pick their own back-off strategy.
 *
 * The renderer never throws a generic Error for backpressure — always
 * an instance of RendererBusyError.  The HTTP layer's `instanceof`
 * check is how it produces a 503 instead of a 500.
 */

class RendererBusyError extends Error
{
	constructor(pRetryAfterSeconds, pQueueDepth)
	{
		super('renderer queue full; try again in ' + (pRetryAfterSeconds || 1) + 's');
		this.name = 'RendererBusyError';
		this.retryAfterSeconds = pRetryAfterSeconds || 1;
		this.queueDepth = (typeof pQueueDepth === 'number') ? pQueueDepth : null;
	}
}

module.exports =
{
	RendererBusyError: RendererBusyError
};
