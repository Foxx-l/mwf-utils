const {
  storePendingEdit,
  consumePendingEdit,
  restorePendingEdit,
  beginApplyInteraction,
  handleCancelInteraction,
} = require('../src/utils/pendingEdits');

describe('pendingEdits store', () => {
  test('consume pops an entry exactly once', () => {
    const nonce = storePendingEdit('kind', { ownerId: 'u1', payload: 1 });
    expect(consumePendingEdit('kind', nonce)).toMatchObject({ ownerId: 'u1', payload: 1 });
    expect(consumePendingEdit('kind', nonce)).toBeNull();
  });

  test('restore puts an entry back for a later consume', () => {
    const nonce = storePendingEdit('kind', { ownerId: 'u1' });
    const entry = consumePendingEdit('kind', nonce);
    restorePendingEdit('kind', nonce, entry);
    expect(consumePendingEdit('kind', nonce)).toMatchObject({ ownerId: 'u1' });
  });

  test('entries expire after the TTL', () => {
    jest.useFakeTimers();
    try {
      const nonce = storePendingEdit('ttl-kind', { ownerId: 'u1' });
      jest.advanceTimersByTime(9 * 60 * 1000);
      expect(consumePendingEdit('ttl-kind', nonce)).not.toBeNull(); // 9 min: alive
      const nonce2 = storePendingEdit('ttl-kind', { ownerId: 'u1' });
      jest.advanceTimersByTime(10 * 60 * 1000 + 1);
      expect(consumePendingEdit('ttl-kind', nonce2)).toBeNull(); // >10 min: expired
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('beginApplyInteraction', () => {
  function makeInteraction(nonce, userId) {
    return {
      customId: `kind_apply:${nonce}`,
      user: { id: userId },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
  }

  test('returns the entry for the owner and expires it', async () => {
    const nonce = storePendingEdit('kind', { ownerId: 'owner-1' });
    const entry = await beginApplyInteraction(makeInteraction(nonce, 'owner-1'), 'kind', 'Edit X');
    expect(entry).toMatchObject({ ownerId: 'owner-1' });
    expect(consumePendingEdit('kind', nonce)).toBeNull();
  });

  test('rejects other users but keeps the entry alive', async () => {
    const nonce = storePendingEdit('kind', { ownerId: 'owner-1' });
    const intruder = makeInteraction(nonce, 'intruder-9');
    expect(await beginApplyInteraction(intruder, 'kind', 'Edit X')).toBeNull();
    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Only the admin') }));
    // Owner can still apply afterwards.
    expect(await beginApplyInteraction(makeInteraction(nonce, 'owner-1'), 'kind', 'Edit X'))
      .toMatchObject({ ownerId: 'owner-1' });
  });

  test('expired previews are reported and not re-consumable', async () => {
    const interaction = makeInteraction('never-was', 'owner-1');
    expect(await beginApplyInteraction(interaction, 'kind', 'Edit X')).toBeNull();
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Preview expired'),
    }));
  });
});

describe('handleCancelInteraction', () => {
  test('owner cancel consumes the entry', async () => {
    const nonce = storePendingEdit('kind', { ownerId: 'owner-1' });
    const interaction = {
      customId: `kind_cancel:${nonce}`,
      user: { id: 'owner-1' },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    await handleCancelInteraction(interaction, 'kind', '❎ Discarded.');
    expect(interaction.update).toHaveBeenCalled();
    expect(consumePendingEdit('kind', nonce)).toBeNull();
  });

  test('non-owner cancel leaves the entry intact', async () => {
    const nonce = storePendingEdit('kind', { ownerId: 'owner-1' });
    const interaction = {
      customId: `kind_cancel:${nonce}`,
      user: { id: 'someone-else' },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    await handleCancelInteraction(interaction, 'kind', '❎ Discarded.');
    expect(interaction.reply).toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(consumePendingEdit('kind', nonce)).toMatchObject({ ownerId: 'owner-1' });
  });
});
