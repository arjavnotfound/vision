// LiveKit connection details for the assistant window. Was the console's /api/token
// route; now the main process mints the token, so there is no HTTP endpoint at all.

const { AccessToken } = require('livekit-server-sdk');
const { RoomConfiguration } = require('@livekit/protocol');

async function createConnectionDetails(keys, { agentName } = {}) {
	for (const name of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
		if (!keys[name]) throw new Error(`${name} is not set`);
	}
	const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
	const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;
	const at = new AccessToken(keys.LIVEKIT_API_KEY, keys.LIVEKIT_API_SECRET, {
		identity: participantIdentity,
		name: 'user',
		ttl: '15m',
	});
	at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });
	if (agentName) {
		at.roomConfig = RoomConfiguration.fromJson({ agents: [{ agent_name: agentName }] }, { ignoreUnknownFields: true });
	}
	return {
		serverUrl: keys.LIVEKIT_URL,
		roomName,
		participantName: 'user',
		participantToken: await at.toJwt(),
	};
}

module.exports = { createConnectionDetails };
