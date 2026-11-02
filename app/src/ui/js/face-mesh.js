// Dot-mesh face for --preview (no camera): the prototype's FACE builder + proj().
// A sparse 3D point cloud (jaw oval, eyes, brows, nose, lips, cheek scatter) projected with
// yaw / pitch / roll. Never an illustrated face.

function seeded(seed) {
	let s = seed;
	return () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
}

export function buildFace() {
	const rnd = seeded(7);
	const FACE = { pts: [], lines: [] };
	const add = (x, y, z, k) => {
		FACE.pts.push({ x, y, z, k });
		return FACE.pts.length - 1;
	};
	const zOf = (x, y) => Math.sqrt(Math.max(0, 1 - (x * x) / (0.78 * 0.78) - (y * y) / (1.02 * 1.02))) * 0.62;
	const loop = (arr, closed) => {
		for (let i = 0; i < arr.length - (closed ? 0 : 1); i++) FACE.lines.push([arr[i], arr[(i + 1) % arr.length]]);
	};
	// jaw / face oval
	const ov = [];
	for (let i = 0; i < 36; i++) {
		const a = i / 36 * Math.PI * 2;
		const x = Math.cos(a) * 0.74;
		const y = Math.sin(a) * (a > 0 && a < Math.PI ? 0.98 : 0.92);
		ov.push(add(x, y, zOf(x * 0.9, y * 0.9) * 0.4, "o"));
	}
	loop(ov, true);
	// eyes
	for (const sd of [-1, 1]) {
		const e = [];
		for (let i = 0; i < 10; i++) {
			const a = i / 10 * Math.PI * 2;
			const x = sd * 0.3 + Math.cos(a) * 0.13;
			const y = -0.16 + Math.sin(a) * 0.05;
			e.push(add(x, y, zOf(x, y), "e" + (sd < 0 ? "L" : "R")));
		}
		loop(e, true);
	}
	// brows
	for (const sd of [-1, 1]) {
		const b = [];
		for (let i = 0; i < 5; i++) {
			const t = i / 4;
			const x = sd * (0.14 + t * 0.3);
			const y = -0.34 - Math.sin(t * Math.PI) * 0.06;
			b.push(add(x, y, zOf(x, y), "b"));
		}
		loop(b);
	}
	// nose
	const nb = [];
	for (let i = 0; i < 5; i++) {
		const y = -0.14 + i * 0.08;
		nb.push(add(0, y, zOf(0, y) + i * 0.04, "n"));
	}
	loop(nb);
	const nt = nb[4];
	FACE.nose = nt;
	loop([add(-0.11, 0.2, zOf(0.1, 0.2) + 0.04, "n"), add(-0.05, 0.22, zOf(0, 0.22) + 0.09, "n"), nt, add(0.05, 0.22, zOf(0, 0.22) + 0.09, "n"), add(0.11, 0.2, zOf(0.1, 0.2) + 0.04, "n")]);
	// lips
	const lipO = [];
	for (let i = 0; i < 14; i++) {
		const a = i / 14 * Math.PI * 2;
		const x = Math.cos(a) * 0.22;
		const y = 0.44 + Math.sin(a) * 0.07;
		lipO.push(add(x, y, zOf(x, y), "m"));
	}
	loop(lipO, true);
	const lipI = [];
	for (let i = 0; i < 10; i++) {
		const a = i / 10 * Math.PI * 2;
		const x = Math.cos(a) * 0.14;
		const y = 0.44 + Math.sin(a) * 0.015;
		lipI.push(add(x, y, zOf(x, y), "mi"));
	}
	loop(lipI, true);
	// cheek scatter
	for (let i = 0; i < 70; i++) {
		const x = (rnd() * 2 - 1) * 0.66;
		const y = (rnd() * 2 - 1) * 0.86;
		if (x * x / 0.44 + y * y / 0.74 > 1) continue;
		add(x, y, zOf(x, y), "s");
	}
	FACE.base = FACE.pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
	return FACE;
}

/** Gestures deform the base mesh (0..1 each), as in the prototype. */
export function deformFace(FACE, { leftWink = 0, rightWink = 0, mouth = 0, brow = 0 } = {}) {
	FACE.pts.forEach((p, i) => {
		const b = FACE.base[i];
		p.x = b.x;
		p.y = b.y;
		p.z = b.z;
		if (p.k === "eL") p.y = -0.16 + (b.y + 0.16) * (1 - leftWink * 0.9);
		if (p.k === "eR") p.y = -0.16 + (b.y + 0.16) * (1 - rightWink * 0.9);
		if (p.k === "b") p.y = b.y - brow * 0.07;
		if (p.k === "mi") p.y = 0.44 + (b.y - 0.44) * (1 + mouth * 9);
		if (p.k === "m" && b.y > 0.44) p.y = b.y + mouth * 0.08;
	});
}

/** Project a mesh point with the head pose (degrees). Returns [x, y, depth]. */
export function proj(p, pose, cx, cy, sc) {
	const rad = Math.PI / 180;
	const cyw = Math.cos(pose.yaw * rad), syw = Math.sin(pose.yaw * rad);
	const cp = Math.cos(pose.pitch * rad), sp = Math.sin(pose.pitch * rad);
	const cr = Math.cos(pose.roll * rad), sr = Math.sin(pose.roll * rad);
	let x = p.x * cyw + p.z * syw;
	let z = -p.x * syw + p.z * cyw;
	let y = p.y;
	const y2 = y * cp - z * sp;
	z = y * sp + z * cp;
	y = y2;
	const x2 = x * cr - y * sr;
	y = x * sr + y * cr;
	x = x2;
	const f = 3.2 / (3.2 - z);
	return [cx + x * sc * f, cy + y * sc * f, z];
}

/** Key points (eyes, nose, mouth) draw in ember; the rest in bone. */
export const isKeyKind = (k) => k[0] === "e" || k === "n" || k === "m" || k === "mi";
