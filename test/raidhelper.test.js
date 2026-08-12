describe('raidhelper client', () => {
  let raidhelper;

  beforeEach(() => {
    process.env.RAIDHELPER_API_KEY = 'test-key';
    jest.resetModules();
    raidhelper = require('../src/utils/raidhelper');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete process.env.RAIDHELPER_API_KEY;
    delete global.fetch;
  });

  const ok = payload => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
  const status = (code, body) => ({ ok: false, status: code, text: async () => body });

  test('createEvent posts to the channel endpoint and returns the event', async () => {
    fetch.mockResolvedValueOnce(ok({ event: { id: 'ev1' } }));
    const event = await raidhelper.createEvent({
      serverId: 'g', channelId: 'c', leaderId: 'l', date: '2026-08-19', time: '20:00',
      advancedSettings: { create_discordevent: false },
    });
    expect(event.id).toBe('ev1');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${raidhelper.API_BASE}/servers/g/channels/c/event`);
    expect(JSON.parse(init.body).advancedSettings).toEqual({ create_discordevent: false });
    expect(init.headers.Authorization).toBe('test-key');
  });

  test('a 429 is retried after the wait the API asks for', async () => {
    fetch
      .mockResolvedValueOnce(status(429, '{"reason":"Rate limit encountered: 10 / 5s. Try again in 0.01s"}'))
      .mockResolvedValueOnce(ok({ event: { id: 'ev2' } }));
    const event = await raidhelper.createEvent({
      serverId: 'g', channelId: 'c', leaderId: 'l', date: '2026-08-19', time: '20:00',
    });
    expect(event.id).toBe('ev2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('a persistent 429 eventually surfaces as an error', async () => {
    fetch.mockResolvedValue(status(429, 'Try again in 0.01s'));
    await expect(raidhelper.deleteEvent('ev')).rejects.toThrow('429');
  });

  test('deleteEvent treats 404 as already gone', async () => {
    fetch.mockResolvedValueOnce(status(404, 'not found'));
    await expect(raidhelper.deleteEvent('ev')).resolves.toBe(true);
  });
});
