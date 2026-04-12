import { describe, expect, mock, test } from 'bun:test';
import { makePoller } from './poller';
import type { PollerDb } from './poller';
import type { YouTubeClient, VideoSnippet } from './youtube-client';
import type { Producer } from '@modules/events';
import type { Logger } from '@modules/logger';

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeNullLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => makeNullLogger(),
    setBindings: () => {},
    level: 'silent',
    isLevelEnabled: () => false,
  } as unknown as Logger;
}

function makeDb(rows: Array<Record<string, unknown>> = []): PollerDb {
  return { execute: mock(async () => rows) };
}

function makeYouTubeClientMock(opts: {
  playlistId?: string;
  videos?: VideoSnippet[];
  failFetch?: boolean;
}): YouTubeClient {
  return {
    fetchUploadPlaylistId: mock(async () => {
      if (opts.failFetch) throw new Error('API error');
      return opts.playlistId ?? 'PLmock123';
    }),
    fetchRecentVideos: mock(async () => opts.videos ?? []),
  };
}

function makeProducerMock(): Producer {
  return {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    send: mock(async () => {}),
  } as unknown as Producer;
}

function makeVideo(overrides: Partial<VideoSnippet> = {}): VideoSnippet {
  return {
    videoId: 'vid1',
    title: 'Test Video',
    description: 'desc',
    publishedAt: '2025-01-15T10:00:00Z',
    channelId: 'UCchannel1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getCheckpoint (tested via pollChannel — checkpoint drives publishedAfter)
// ---------------------------------------------------------------------------

describe('checkpoint logic', () => {
  test('first run: no checkpoint → fetchRecentVideos called without publishedAfter', async () => {
    // DB returns a row with max = null (PostgreSQL MAX on empty set → NULL)
    const db = makeDb();
    const ytClient = makeYouTubeClientMock({ videos: [makeVideo()] });
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) return [{ id: 'src-uuid-1', external_id: 'UCchannel1' }];
      return [{ max: null }]; // content_items checkpoint query → no checkpoint
    });

    await poller.resolvePlaylistIds();
    await poller.runOnce();

    // With exactOptionalPropertyTypes, publishedAfter is simply absent when null checkpoint
    expect(ytClient.fetchRecentVideos).toHaveBeenCalledWith(
      expect.not.objectContaining({ publishedAfter: expect.any(Date) }),
    );
    expect(producer.send).toHaveBeenCalled();
  });

  test('subsequent runs: getCheckpoint passes publishedAfter from max published_at', async () => {
    const checkpoint = new Date('2025-01-10T00:00:00Z');
    const db = makeDb();
    const ytClient = makeYouTubeClientMock({ videos: [makeVideo()] });
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) return [{ id: 'src-uuid-1', external_id: 'UCchannel1' }];
      return [{ max: checkpoint.toISOString() }];
    });

    await poller.resolvePlaylistIds();
    await poller.runOnce();

    expect(ytClient.fetchRecentVideos).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAfter: expect.any(Date) }),
    );
    const call = (ytClient.fetchRecentVideos as ReturnType<typeof mock>).mock
      .calls[0]![0];
    expect((call as any).publishedAfter?.getTime()).toBe(checkpoint.getTime());
  });
});

// ---------------------------------------------------------------------------
// pollChannel — skips when no playlist cached
// ---------------------------------------------------------------------------

describe('pollChannel', () => {
  test('skips channel with no cached playlist ID', async () => {
    const db = makeDb();
    const ytClient = makeYouTubeClientMock({});
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    // Don't call resolvePlaylistIds — cache stays empty
    (db.execute as ReturnType<typeof mock>).mockImplementation(async () => [
      { id: 'src-uuid-1', external_id: 'UCchannel1' },
    ]);

    await poller.runOnce();

    expect(ytClient.fetchRecentVideos).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
  });

  test('publishes correct payload shape when videos are found', async () => {
    const db = makeDb();
    const video = makeVideo({ videoId: 'abc123', title: 'My Video' });
    const ytClient = makeYouTubeClientMock({ videos: [video] });
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) return [{ id: 'src-uuid-1', external_id: 'UCchannel1' }];
      return [{ max: null }];
    });

    await poller.resolvePlaylistIds();
    await poller.runOnce();

    expect(producer.send).toHaveBeenCalledWith(
      'youtube',
      'video.collected',
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'src-uuid-1',
          externalId: 'abc123',
          title: 'My Video',
          url: 'https://www.youtube.com/watch?v=abc123',
        }),
      ]),
    );
  });

  test('does not publish when no new videos', async () => {
    const db = makeDb();
    const ytClient = makeYouTubeClientMock({ videos: [] });
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) return [{ id: 'src-uuid-1', external_id: 'UCchannel1' }];
      return [{ max: null }];
    });

    await poller.resolvePlaylistIds();
    await poller.runOnce();

    expect(producer.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runOnce — error isolation per channel
// ---------------------------------------------------------------------------

describe('runOnce', () => {
  test('continues polling remaining channels when one channel throws', async () => {
    const db = makeDb();
    const videos = [makeVideo({ videoId: 'ok1', channelId: 'UCchannel2' })];
    const ytClient: YouTubeClient = {
      fetchUploadPlaylistId: mock(async (channelId: string) => {
        return channelId === 'UCchannel1' ? 'PLfails' : 'PLgood';
      }),
      fetchRecentVideos: mock(async (opts: any) => {
        if (opts.uploadPlaylistId === 'PLfails') throw new Error('API 403');
        return videos;
      }),
    };
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      youtubeClient: ytClient,
      logger: makeNullLogger(),
      fetchLimit: 10,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) {
        return [
          { id: 'src-1', external_id: 'UCchannel1' },
          { id: 'src-2', external_id: 'UCchannel2' },
        ];
      }
      return [{ max: null }];
    });

    await poller.resolvePlaylistIds();
    await poller.runOnce();

    // Second channel still published despite first channel throwing
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledWith(
      'youtube',
      'video.collected',
      expect.arrayContaining([expect.objectContaining({ externalId: 'ok1' })]),
    );
  });
});
