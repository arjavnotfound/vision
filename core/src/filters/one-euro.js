// One Euro Filter (Casiez, Roussel, Vogel 2012).
// Readable port of core/lib/OneEuroFilter.js (@david18284/one-euro-filter), with
// identical arithmetic so outputs match the bundled library bit-for-bit.

export class LowPassFilter {
	constructor(alpha, initialValue = 0) {
		this.y = this.s = initialValue;
		this.setAlpha(alpha);
		this.initialized = false;
	}
	setAlpha(alpha) {
		this.a = alpha;
	}
	filter(value) {
		let result;
		if (this.initialized) {
			result = this.a * value + (1 - this.a) * this.s;
		} else {
			result = value;
			this.initialized = true;
		}
		this.y = value;
		this.s = result;
		return result;
	}
	filterWithAlpha(value, alpha) {
		this.setAlpha(alpha);
		return this.filter(value);
	}
	hasLastRawValue() {
		return this.initialized;
	}
	lastRawValue() {
		return this.y;
	}
	reset() {
		this.initialized = false;
	}
}

export class OneEuroFilter {
	/**
	 * @param {number} freq expected update frequency in Hz (updated from timestamps)
	 * @param {number} [mincutoff] minimum cutoff frequency
	 * @param {number} [beta] speed coefficient
	 * @param {number} [dcutoff] derivative cutoff
	 */
	constructor(freq, mincutoff = 1, beta = 0, dcutoff = 1) {
		this.freq = freq;
		this.mincutoff = mincutoff;
		this.beta_ = beta;
		this.dcutoff = dcutoff;
		this.x = new LowPassFilter(this.alpha(mincutoff));
		this.dx = new LowPassFilter(this.alpha(dcutoff));
		this.lasttime = undefined;
	}
	alpha(cutoff) {
		const te = 1 / this.freq;
		return 1 / (1 + 1 / (2 * Math.PI * cutoff) / te);
	}
	reset() {
		this.x.reset();
		this.dx.reset();
		this.lasttime = undefined;
	}
	/**
	 * @param {number} value
	 * @param {number} [timestamp] in seconds
	 */
	filter(value, timestamp = undefined) {
		if (this.lasttime != null && timestamp != null) {
			this.freq = 1 / (timestamp - this.lasttime);
		}
		this.lasttime = timestamp;
		const derivative = this.x.hasLastRawValue() ? (value - this.x.lastRawValue()) * this.freq : 0;
		const smoothedDerivative = this.dx.filterWithAlpha(derivative, this.alpha(this.dcutoff));
		const cutoff = this.mincutoff + this.beta_ * Math.abs(smoothedDerivative);
		return this.x.filterWithAlpha(value, this.alpha(cutoff));
	}
}
