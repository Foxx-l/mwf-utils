/**
 * Startup self-heal of the faction embed's button row. Plain fakes for the
 * client/channel/message — no Discord API is touched.
 */

const { refreshFactionButtons } = require('../src/events/ready');

function makeMessage() {
  return {
    author: { id: 'bot-1' },
    embeds: [{ title: 'Choose your side!' }],
    edit: jest.fn().mockResolvedValue(undefined),
  };
}

function makeClient(messages) {
  const channel = {
    isTextBased: () => true,
    messages: { fetch: jest.fn().mockResolvedValue(messages) },
  };
  return {
    user: { id: 'bot-1' },
    channels: { fetch: jest.fn().mockResolvedValue(channel) },
  };
}

describe('refreshFactionButtons', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('re-renders the row as a components array', async () => {
    process.env.FACTION_CHANNEL = 'faction-chan';
    const message = makeMessage();

    await refreshFactionButtons(makeClient([message]));

    expect(message.edit).toHaveBeenCalledTimes(1);
    // discord.js wants the rows *in an array*. Passing the bare row threw
    // "this.options.components?.map is not a function", which the caller
    // swallowed as a warning — the self-heal silently never ran.
    const payload = message.edit.mock.calls[0][0];
    expect(Array.isArray(payload.components)).toBe(true);
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].components).toHaveLength(4); // Allies/Axis × S1/S2
  });

  test('does nothing when the faction embed is not in the channel', async () => {
    process.env.FACTION_CHANNEL = 'faction-chan';
    const other = { ...makeMessage(), embeds: [{ title: 'NODES' }] };

    await refreshFactionButtons(makeClient([other]));

    expect(other.edit).not.toHaveBeenCalled();
  });

  test('is a no-op without FACTION_CHANNEL', async () => {
    delete process.env.FACTION_CHANNEL;
    const client = makeClient([makeMessage()]);

    await refreshFactionButtons(client);

    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});
