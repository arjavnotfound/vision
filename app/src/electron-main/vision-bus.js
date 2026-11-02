// The VISION bus: a tiny localhost HTTP channel between Face Control and the voice
// assistant (its overlay and its agent worker). The launcher (C:\VISION\VISION.bat)
// sets VISION_BUS_PORT and VISION_BUS_TOKEN for every process it starts.
//
//   POST /assistant  {connected, live}     overlay heartbeat: session connected, mic live
//   POST /command    {cmd, value?}         voice control of VISION (pause, recalibrate, ...)
//   GET  /state                            Face Control status for the assistant
//
// Every request must carry the header `x-vision-token`. Browsers cannot send that header
// cross-origin without a CORS preflight, which this server never approves, so a web page
// (including the agent's own Playwright browser) cannot drive the mouse through it.

const http = require('http');

const MAX_BODY_BYTES = 4096;

function createVisionBus({ port, token, host = '127.0.0.1', onAssistant, onCommand, getState, log = console.log }) {
	if (!token) {
		throw new TypeError('createVisionBus: a token is required');
	}
	const send = (res, status, body) => {
		res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		res.end(JSON.stringify(body));
	};
	const readJson = (req) => new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error('body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on('error', reject);
	});

	const server = http.createServer(async (req, res) => {
		if (req.headers['x-vision-token'] !== token) {
			send(res, 403, { ok: false, error: 'forbidden' });
			return;
		}
		try {
			if (req.method === 'GET' && req.url === '/state') {
				send(res, 200, { ok: true, state: getState ? await getState() : {} });
			} else if (req.method === 'POST' && req.url === '/assistant') {
				const body = await readJson(req);
				onAssistant?.({ connected: Boolean(body.connected), live: Boolean(body.live) });
				send(res, 200, { ok: true });
			} else if (req.method === 'POST' && req.url === '/command') {
				const body = await readJson(req);
				if (typeof body.cmd !== 'string' || !body.cmd) {
					send(res, 400, { ok: false, error: 'missing cmd' });
					return;
				}
				const result = await onCommand?.(body.cmd, body.value);
				send(res, 200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
			} else {
				send(res, 404, { ok: false, error: 'not found' });
			}
		} catch (error) {
			send(res, 400, { ok: false, error: String(error?.message ?? error) });
		}
	});

	return {
		server,
		start: () => new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, host, () => {
				server.off('error', reject);
				log(`[VISION] Bus listening on ${host}:${server.address().port}`);
				resolve(server.address().port);
			});
		}),
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

module.exports = { createVisionBus };
