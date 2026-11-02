// Geometry helpers for facial gesture measurement.

/** Distance between a point and the line through a and b, signed by side. */
export function signedDistancePointLine(point, a, b) {
	const [px, py] = point;
	const [x1, y1] = a;
	const [x2, y2] = b;

	const dx = x2 - x1;
	const dy = y2 - y1;

	// Perpendicular (normal) vector
	const nx = -dy;
	const ny = dx;

	return ((px - x1) * nx + (py - y1) * ny) / Math.hypot(nx, ny);
}

/**
 * Aspect metrics of an eye or mouth from its upper and lower contours.
 * `heightRatio` is the EAR (eyes) or MAR (mouth): opening height / corner-to-corner width.
 * The lower contour's first and last points are the corners.
 */
export function getAspectMetrics(upperContour, lowerContour) {
	const corners = [lowerContour[0], lowerContour[lowerContour.length - 1]];
	// Excluding the corners isn't really important since their measures will be 0.
	const otherPoints = upperContour.concat(lowerContour).filter(point => !corners.includes(point));
	let highest = 0;
	let lowest = 0;
	for (const point of otherPoints) {
		const distance = signedDistancePointLine(point, corners[0], corners[1]);
		if (distance < lowest) {
			lowest = distance;
		}
		if (distance > highest) {
			highest = distance;
		}
	}

	const width = Math.hypot(
		corners[0][0] - corners[1][0],
		corners[0][1] - corners[1][1]
	);
	const height = highest - lowest;
	return {
		corners,
		upperContour,
		lowerContour,
		highest,
		lowest,
		heightRatio: height / width,
	};
}
