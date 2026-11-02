// De-duplication of optical-flow points onto a coarse grid.
//
// Behaviour is identical to the original prunePoints() in vision.js:
//   grid[`${~~(x / g)},${~~(y / g)}`] = pointIndex;      // last point in a cell wins
//   keep = Object.values(grid); filter(i => keep.includes(i))
// but without per-frame string keys or the O(N²) `includes` scan.

const KEY_RANGE = 32768; // cells per axis on each side of zero that get a numeric key

/**
 * Creates a reusable pruner. Reuses its Map and mask between frames.
 * @param {number} gridSize cell size in pixels
 */
export function createPruner(gridSize) {
	const lastIndexInCell = new Map();
	let mask = new Uint8Array(0);

	/**
	 * @param {Float32Array|number[]} curXY interleaved x,y coordinates
	 * @param {number} pointCount
	 * @returns {Uint8Array} mask; mask[i] === 1 means keep point i (valid for i < pointCount)
	 */
	return function computeKeepMask(curXY, pointCount) {
		if (mask.length < pointCount) {
			mask = new Uint8Array(Math.max(pointCount, mask.length * 2, 16));
		}
		lastIndexInCell.clear();
		for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
			const offset = pointIndex * 2;
			// `~~` truncates toward zero (and maps NaN/Infinity to 0), exactly like the original key.
			const cx = ~~(curXY[offset] / gridSize);
			const cy = ~~(curXY[offset + 1] / gridSize);
			const key = (cx > -KEY_RANGE && cx < KEY_RANGE && cy > -KEY_RANGE && cy < KEY_RANGE) ?
				(cx + KEY_RANGE) * (KEY_RANGE * 2) + (cy + KEY_RANGE) :
				`${cx},${cy}`; // out-of-range fallback; strings never collide with numeric keys
			lastIndexInCell.set(key, pointIndex);
		}
		mask.fill(0, 0, pointCount);
		for (const pointIndex of lastIndexInCell.values()) {
			mask[pointIndex] = 1;
		}
		return mask;
	};
}

/** The original implementation, kept for reference and equivalence tests. */
export function legacyPruneIndexes(curXY, pointCount, gridSize) {
	const grid = {};
	for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
		const pointOffset = pointIndex * 2;
		grid[`${~~(curXY[pointOffset] / gridSize)},${~~(curXY[pointOffset + 1] / gridSize)}`] = pointIndex;
	}
	return Object.values(grid);
}
