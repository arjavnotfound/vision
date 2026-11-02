// LiveKit tokens minted by the main process (was the console's /api/token route).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConnectionDetails } = require('../app/src/electron-main/livekit-token');

const KEYS = { LIVEKIT_URL: 'wss://example.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 's'.repeat(32) };
const payload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

describe('livekit token', () => {
	it('dispatches the named agent and lets the user join and publish', async () => {
		const details = await createConnectionDetails(KEYS, { agentName: 'my-agent' });
		const claims = payload(details.participantToken);
		assert.equal(details.serverUrl, KEYS.LIVEKIT_URL);
		assert.equal(claims.video.room, details.roomName);
		assert.equal(claims.video.roomJoin, true);
		assert.equal(claims.video.canPublish, true);
		assert.deepEqual(claims.roomConfig.agents.map((a) => a.agentName), ['my-agent']);
		assert.ok(claims.exp - Date.now() / 1000 <= 15 * 60 + 5, "token lives at most 15 minutes");
	});
	it('refuses to mint without keys', async () => {
		await assert.rejects(createConnectionDetails({}, {}), /LIVEKIT_URL/);
	});
	// The console's livekit-client rejects a token whose roomConfig has fields its own
	// protocol version does not know ("restartPolicy" broke voice once): keep them equal.
	it('uses the same @livekit/protocol version as the console client', (t) => {
		const clientPkg = path.join(__dirname, '../console/node_modules/livekit-client/package.json');
		if (!fs.existsSync(clientPkg)) return t.skip('console dependencies not installed');
		const clientWants = JSON.parse(fs.readFileSync(clientPkg, 'utf8')).dependencies['@livekit/protocol'];
		const appPins = require('../app/package.json').dependencies['@livekit/protocol'];
		assert.equal(appPins, clientWants);
	});
});
