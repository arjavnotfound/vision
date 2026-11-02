// Tiny event emitter for the engine's public API (engine.on('state' | 'gesture' | 'click' | 'error' | 'camera', cb)).

export function createEmitter(onListenerError = (error) => console.error("[VISION engine] listener error:", error)) {
	const listeners = new Map();
	return {
		/** @returns {() => void} unsubscribe */
		on(type, callback) {
			if (typeof callback !== "function") {
				throw new TypeError("engine.on: callback must be a function");
			}
			if (!listeners.has(type)) {
				listeners.set(type, new Set());
			}
			listeners.get(type).add(callback);
			return () => listeners.get(type)?.delete(callback);
		},
		off(type, callback) {
			listeners.get(type)?.delete(callback);
		},
		emit(type, payload) {
			const set = listeners.get(type);
			if (!set) {
				return;
			}
			for (const callback of [...set]) {
				try {
					callback(payload);
				} catch (error) {
					// A broken UI listener must never break tracking.
					onListenerError(error);
				}
			}
		},
		listenerCount(type) {
			return listeners.get(type)?.size ?? 0;
		},
	};
}
