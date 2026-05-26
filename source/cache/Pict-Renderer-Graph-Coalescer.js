/**
 * Pict-Renderer-Graph-Coalescer.js
 *
 * In-flight request deduplication.  When N callers ask for the same key at
 * the same time, the underlying factory function runs once and all N
 * callers receive the same eventual result.
 *
 * Typical use:
 *
 *     coalescer.coalesce('sha256...', () =>
 *     {
 *         return new Promise((fResolve, fReject) =>
 *         {
 *             expensiveRenderFunction((pErr, pResult) =>
 *             {
 *                 if (pErr) return fReject(pErr);
 *                 return fResolve(pResult);
 *             });
 *         });
 *     }, (pErr, pResult) => { ... });
 *
 * Behavior contract:
 *   - First call for a key: factoryFn runs immediately.  The returned
 *     Promise is stored in this._inFlight under that key.  callback fires
 *     when the Promise settles.
 *   - Second call (and beyond) for the same key while the first is still
 *     in flight: callback is queued; factoryFn does NOT run again.
 *   - On settle (success or failure): every queued callback fires with the
 *     same (err, result), then the key is removed from _inFlight.  A later
 *     call for the same key starts a fresh factory invocation.
 *
 * No timeouts.  If the underlying factory hangs, all coalesced waiters
 * hang together.  Callers needing a deadline should wrap factoryFn in a
 * timeout themselves.
 */

class PictRendererGraphCoalescer
{
	constructor()
	{
		this._inFlight = new Map();   // key → { promise, waiters: [callback] }
	}

	/**
	 * @param {string}   pKey         - dedup key (typically a SHA hash)
	 * @param {Function} fFactory     - () => Promise<result>
	 * @param {Function} fCallback    - (err, result) => void
	 */
	coalesce(pKey, fFactory, fCallback)
	{
		let tmpCb = (typeof fCallback === 'function') ? fCallback : () => {};

		// Already in flight — attach a waiter and return.
		if (this._inFlight.has(pKey))
		{
			this._inFlight.get(pKey).waiters.push(tmpCb);
			return;
		}

		// Fresh call — invoke factory, store the in-flight entry.
		let tmpEntry = { promise: null, waiters: [ tmpCb ] };
		this._inFlight.set(pKey, tmpEntry);

		let tmpPromise;
		try { tmpPromise = fFactory(); }
		catch (pSyncErr)
		{
			this._dispatch(pKey, pSyncErr, null);
			return;
		}

		// Defensive: factories that don't return a promise still produce
		// a value the waiters need.  Wrap in Promise.resolve() so .then is
		// always available.
		tmpEntry.promise = Promise.resolve(tmpPromise)
			.then(  (pResult) => this._dispatch(pKey, null,    pResult),
			        (pErr)    => this._dispatch(pKey, pErr,    null));
	}

	/**
	 * Number of distinct keys currently in flight.  Useful for tests +
	 * diagnostics.
	 */
	inFlightCount()
	{
		return this._inFlight.size;
	}

	/**
	 * Drop all in-flight tracking — does NOT reject pending waiters; the
	 * factory's promise will still settle and the waiters will still fire.
	 * Intended for shutdown only.
	 */
	clear()
	{
		this._inFlight.clear();
	}

	_dispatch(pKey, pErr, pResult)
	{
		let tmpEntry = this._inFlight.get(pKey);
		if (!tmpEntry) return;
		this._inFlight.delete(pKey);
		// Fire callbacks in registration order.  Use setImmediate so the
		// dispatch happens on a fresh microtask — keeps stack traces clean
		// when a waiter callback synchronously enqueues another render.
		let tmpWaiters = tmpEntry.waiters;
		setImmediate(() =>
		{
			for (let i = 0; i < tmpWaiters.length; i++)
			{
				try { tmpWaiters[i](pErr, pResult); }
				catch (pCbErr)
				{
					// Don't let one waiter's callback throw drown the others.
					// We log via console here because the coalescer is fable-
					// agnostic (intentionally) — it's reusable as a plain util.
					if (typeof console !== 'undefined' && console.warn)
					{
						console.warn('[pict-renderer-graph coalescer] waiter callback threw: ' + (pCbErr && pCbErr.message));
					}
				}
			}
		});
	}
}

module.exports = PictRendererGraphCoalescer;
