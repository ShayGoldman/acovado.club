import Z from 'zod';

const redditPostSchema = Z.object({
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
        data: redditPostSchema,
      }),
    ),
  }),
});

export type RedditPost = Z.infer<typeof redditPostSchema>;

export interface RedditClientOpts {
  userAgent?: string;
}

export function makeRedditClient(opts: RedditClientOpts = {}) {
  const userAgent =
    opts.userAgent ||
    'Mozilla/5.0 (compatible; RedditScraper/1.0; +https://acovado.club)';

  async function fetchSubredditPosts(
    subreddit: string,
    limit = 25,
  ): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch posts from /r/${subreddit}: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    const listing = redditListingSchema.parse(json);

    return listing.data.children.map((child) => child.data);
  }

  return {
    fetchSubredditPosts,
  };
}

export type RedditClient = ReturnType<typeof makeRedditClient>;
