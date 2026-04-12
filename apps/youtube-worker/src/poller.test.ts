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

function makeYouTubeClientMock(videos: VideoSnippet[] = []): YouTubeClient {
  return {
    fetchRecentVideos: mock(async () => videos),
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
    description: '',
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
    const db = makeDb();
    const ytClient = makeYouTubeClientMock([makeVideo()]);
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
    const ytClient = makeYouTubeClientMock([makeVideo()]);
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
// pollChannel — calls fetchRecentVideos with the correct channelId
// ---------------------------------------------------------------------------

describe('pollChannel', () => {
  test('calls fetchRecentVideos with channelId from source.externalId', async () => {
    const db = makeDb();
    const ytClient = makeYouTubeClientMock([makeVideo()]);
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

    await poller.runOnce();

    expect(ytClient.fetchRecentVideos).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'UCchannel1' }),
    );
  });

  test('publishes correct payload shape when videos are found', async () => {
    const db = makeDb();
    const video = makeVideo({ videoId: 'abc123', title: 'My Video' });
    const ytClient = makeYouTubeClientMock([video]);
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
    const ytClient = makeYouTubeClientMock([]);
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
      fetchRecentVideos: mock(async (opts: any) => {
        if (opts.channelId === 'UCchannel1') throw new Error('RSS fetch error');
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
