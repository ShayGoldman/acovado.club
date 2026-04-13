import { describe, expect, mock, test } from 'bun:test';
import { makePoller } from './poller';
import type { PollerDb } from './poller';
import type { RedditClient } from '@modules/reddit-client';
import type { RedditThread } from '@modules/reddit-client';
import type { Producer } from '@modules/events';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';

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

function makeRedditClientMock(threads: RedditThread[] = []): RedditClient {
  return {
    fetchSubredditThreads: mock(async () => threads),
    fetchThreadReplies: mock(async () => []),
    fetchSubredditAbout: mock(async () => ({}) as any),
  };
}

function makeProducerMock(): Producer {
  return {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    send: mock(async () => {}),
  } as unknown as Producer;
}

function makeNullTracer(): Tracer {
  const nullCtx: any = {
    log: makeNullLogger(),
    annotations: new Map(),
    annotate: () => {},
    setName: () => {},
    with: async (_name: string, fnOrOpts: any, maybeFn?: any) => {
      const fn = typeof fnOrOpts === 'function' ? fnOrOpts : maybeFn;
      return fn(nullCtx);
    },
  };
  return {
    with: async (_name: string, fnOrOpts: any, maybeFn?: any) => {
      const fn = typeof fnOrOpts === 'function' ? fnOrOpts : maybeFn;
      return fn(nullCtx);
    },
    shutdown: async () => {},
  } as unknown as Tracer;
}

function makeThread(overrides: Partial<RedditThread> = {}): RedditThread {
  return {
    id: 'post1',
    title: 'Test Post',
    author: 'testuser',
    subreddit: 'wallstreetbets',
    selftext: 'some body text',
    score: 100,
    num_comments: 42,
    url: 'https://www.reddit.com/r/wallstreetbets/comments/post1/',
    created_utc: 1700000000,
    permalink: '/r/wallstreetbets/comments/post1/test_post/',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkpoint logic
// ---------------------------------------------------------------------------

describe('checkpoint logic', () => {
  test('first run: no checkpoint → all fetched posts are published', async () => {
    const db = makeDb();
    const thread = makeThread();
    const redditClient = makeRedditClientMock([thread]);
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      redditClient,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      fetchLimit: 25,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources'))
        return [{ id: 'src-uuid-1', external_id: 'wallstreetbets' }];
      return [{ max: null }]; // no checkpoint
    });

    await poller.runOnce();

    expect(producer.send).toHaveBeenCalled();
  });

  test('subsequent run: posts older than checkpoint are filtered out', async () => {
    const checkpointDate = new Date('2024-01-15T00:00:00Z');
    // created_utc before checkpoint
    const oldThread = makeThread({
      id: 'old1',
      created_utc: checkpointDate.getTime() / 1000 - 3600,
    });
    // created_utc after checkpoint
    const newThread = makeThread({
      id: 'new1',
      created_utc: checkpointDate.getTime() / 1000 + 3600,
    });

    const db = makeDb();
    const redditClient = makeRedditClientMock([oldThread, newThread]);
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      redditClient,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      fetchLimit: 25,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources'))
        return [{ id: 'src-uuid-1', external_id: 'wallstreetbets' }];
      return [{ max: checkpointDate.toISOString() }];
    });

    await poller.runOnce();

    expect(producer.send).toHaveBeenCalledWith(
      'reddit',
      'post.collected',
      expect.arrayContaining([expect.objectContaining({ externalId: 'new1' })]),
    );
    // old post should not be in the payload
    const sendCall = (producer.send as ReturnType<typeof mock>).mock
      .calls[0]![2] as any[];
    expect(sendCall.find((p: any) => p.externalId === 'old1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pollSubreddit — publishes correct payload shape
// ---------------------------------------------------------------------------

describe('pollSubreddit', () => {
  test('publishes correct payload shape', async () => {
    const db = makeDb();
    const thread = makeThread({
      id: 'abc123',
      title: 'Big gains today',
      subreddit: 'wallstreetbets',
    });
    const redditClient = makeRedditClientMock([thread]);
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      redditClient,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      fetchLimit: 25,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources'))
        return [{ id: 'src-uuid-1', external_id: 'wallstreetbets' }];
      return [{ max: null }];
    });

    await poller.runOnce();

    expect(producer.send).toHaveBeenCalledWith(
      'reddit',
      'post.collected',
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'src-uuid-1',
          subreddit: 'wallstreetbets',
          externalId: 'abc123',
          title: 'Big gains today',
          body: 'some body text',
          score: 100,
          numComments: 42,
        }),
      ]),
    );
  });

  test('does not publish when no new posts', async () => {
    const db = makeDb();
    const redditClient = makeRedditClientMock([]);
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      redditClient,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      fetchLimit: 25,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources'))
        return [{ id: 'src-uuid-1', external_id: 'wallstreetbets' }];
      return [{ max: null }];
    });

    await poller.runOnce();

    expect(producer.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runOnce — error isolation per subreddit
// ---------------------------------------------------------------------------

describe('runOnce', () => {
  test('continues polling remaining subreddits when one throws', async () => {
    const db = makeDb();
    const thread = makeThread({ id: 'ok1', subreddit: 'investing' });
    const redditClient: RedditClient = {
      fetchSubredditThreads: mock(async (subreddit: string) => {
        if (subreddit === 'wallstreetbets') throw new Error('rate limited');
        return [thread];
      }),
      fetchThreadReplies: mock(async () => []),
      fetchSubredditAbout: mock(async () => ({}) as any),
    };
    const producer = makeProducerMock();

    const poller = makePoller({
      db,
      producer,
      redditClient,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      fetchLimit: 25,
    });

    (db.execute as ReturnType<typeof mock>).mockImplementation(async (q: string) => {
      if (q.includes('sources')) {
        return [
          { id: 'src-1', external_id: 'wallstreetbets' },
          { id: 'src-2', external_id: 'investing' },
        ];
      }
      return [{ max: null }];
    });

    await poller.runOnce();

    // Second subreddit still published despite first throwing
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledWith(
      'reddit',
      'post.collected',
      expect.arrayContaining([expect.objectContaining({ externalId: 'ok1' })]),
    );
  });
});
