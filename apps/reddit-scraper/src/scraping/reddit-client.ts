import Z from 'zod';

const redditThreadSchema = Z.object({
  id: Z.string(),
  title: Z.string(),
  author: Z.string(),
  subreddit: Z.string(),
  selftext: Z.string(),
  score: Z.number(),
  num_comments: Z.number(),
  url: Z.string(),
  created_utc: Z.number(),
  permalink: Z.string(),
});

const redditListingSchema = Z.object({
  kind: Z.string(),
  data: Z.object({
    children: Z.array(
      Z.object({
        kind: Z.string(),
        data: redditThreadSchema,
      }),
    ),
  }),
});

export type RedditThread = Z.infer<typeof redditThreadSchema>;

const redditReplySchema = Z.object({
  id: Z.string(),
  author: Z.string().nullish().default('[deleted]'),
  body: Z.string().nullish().default(''),
  parent_id: Z.string().nullish().default(''),
  created_utc: Z.number().nullish().default(0),
  score: Z.number().nullish().default(0),
  permalink: Z.string().nullish().optional(),
  replies: Z.union([Z.string(), Z.any()]).optional(),
}).passthrough();

const redditCommentChildSchema = Z.object({
  kind: Z.string(),
  data: Z.any(),
});

const redditCommentListingSchema = Z.object({
  kind: Z.string(),
  data: Z.object({
    children: Z.array(redditCommentChildSchema),
  }),
});

export type RedditReply = Z.infer<typeof redditReplySchema>;

export interface RedditClientOpts {
  userAgent?: string;
}

export function makeRedditClient(opts: RedditClientOpts = {}) {
  const userAgent =
    opts.userAgent ||
    'Mozilla/5.0 (compatible; RedditScraper/1.0; +https://acovado.club)';

  async function fetchSubredditThreads(
    subreddit: string,
    limit = 25,
  ): Promise<RedditThread[]> {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch threads from /r/${subreddit}: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    const listing = redditListingSchema.parse(json);

    return listing.data.children.map((child) => child.data);
  }

  async function fetchThreadReplies(
    threadRedditId: string,
    subreddit: string,
  ): Promise<RedditReply[]> {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${threadRedditId}.json`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch replies for thread ${threadRedditId}: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    const listings = Z.array(redditCommentListingSchema).parse(json);

    const replies: RedditReply[] = [];

    function extractReplies(children: unknown[], parentId?: string) {
      if (!Array.isArray(children)) {
        return;
      }

      for (const child of children) {
        if (
          typeof child !== 'object' ||
          child === null ||
          !('kind' in child) ||
          !('data' in child)
        ) {
          continue;
        }

        if (child.kind === 't1' && child.data && typeof child.data === 'object') {
          const data = child.data as {
            id?: string;
            author?: string | null;
            body?: string | null;
            parent_id?: string;
            created_utc?: number;
            score?: number;
            permalink?: string;
            replies?: unknown;
          };

          if (!data.id || typeof data.id !== 'string') {
            continue;
          }

          const parsed = redditReplySchema.safeParse({
            id: data.id,
            author: data.author ?? '[deleted]',
            body: data.body ?? '',
            parent_id: parentId || data.parent_id || '',
            created_utc: data.created_utc ?? 0,
            score: data.score ?? 0,
            permalink: data.permalink,
            replies: data.replies,
          });

          if (!parsed.success) {
            continue;
          }

          const replyData: RedditReply = parsed.data;
          replies.push(replyData);

          if (data.replies && typeof data.replies === 'object' && data.replies !== null) {
            const repliesData = data.replies as {
              data?: { children?: unknown[] };
            };
            if (repliesData.data?.children) {
              extractReplies(repliesData.data.children, data.id);
            }
          }
        }
      }
    }

    if (listings.length > 1 && listings[1]?.data?.children) {
      extractReplies(listings[1]!.data.children);
    }

    return replies;
  }

  return {
    fetchSubredditThreads,
    fetchThreadReplies,
  };
}

export type RedditClient = ReturnType<typeof makeRedditClient>;
