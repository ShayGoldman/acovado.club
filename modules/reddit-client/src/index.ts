import type { Logger } from '@modules/logger';
import { makeLogger } from '@modules/logger';
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
export type { RedditThread as RedditThreadType };

const redditReplySchema = Z.object({
  id: Z.string(),
  author: Z.string().nullish().default('[deleted]'),
  body: Z.string().nullish().default(''),
  parent_id: Z.string().nullish().default(''),
  created_utc: Z.number().nullish().default(0),
  score: Z.number().nullish().default(0),
  permalink: Z.string().nullish().optional(),
  replies: Z.union([Z.string(), Z.any()]).optional(),
}).loose();

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
export type { RedditReply as RedditReplyType };

const commentContributionSettingsSchema = Z.object({
  allowed_media_types: Z.any(),
});

const redditSubredditAboutDataSchema = Z.object({
  user_flair_background_color: Z.any(),
  submit_text_html: Z.any(),
  restrict_posting: Z.boolean(),
  user_is_banned: Z.any(),
  free_form_reports: Z.boolean(),
  wiki_enabled: Z.boolean(),
  user_is_muted: Z.any(),
  user_can_flair_in_sr: Z.any(),
  display_name: Z.string(),
  header_img: Z.string(),
  title: Z.string(),
  original_content_tag_enabled: Z.boolean(),
  allow_galleries: Z.boolean(),
  icon_size: Z.array(Z.number()),
  primary_color: Z.string(),
  icon_img: Z.string(),
  display_name_prefixed: Z.string(),
  public_traffic: Z.boolean(),
  subscribers: Z.number(),
  user_flair_richtext: Z.array(Z.any()),
  name: Z.string(),
  quarantine: Z.boolean(),
  hide_ads: Z.boolean(),
  prediction_leaderboard_entry_type: Z.number(),
  emojis_enabled: Z.boolean(),
  advertiser_category: Z.string(),
  public_description: Z.string(),
  comment_score_hide_mins: Z.number(),
  allow_predictions: Z.boolean(),
  user_has_favorited: Z.any(),
  user_flair_template_id: Z.any(),
  community_icon: Z.string(),
  banner_background_image: Z.string(),
  header_title: Z.string(),
  community_reviewed: Z.boolean(),
  submit_text: Z.string(),
  description_html: Z.string(),
  spoilers_enabled: Z.boolean(),
  comment_contribution_settings: commentContributionSettingsSchema,
  allow_talks: Z.boolean(),
  header_size: Z.array(Z.number()),
  user_flair_position: Z.string(),
  all_original_content: Z.boolean(),
  has_menu_widget: Z.boolean(),
  is_enrolled_in_new_modmail: Z.any(),
  key_color: Z.string(),
  can_assign_user_flair: Z.boolean(),
  created: Z.number(),
  wls: Z.number(),
  show_media_preview: Z.boolean(),
  submission_type: Z.string(),
  user_is_subscriber: Z.any(),
  allowed_media_in_comments: Z.array(Z.any()),
  allow_videogifs: Z.boolean(),
  should_archive_posts: Z.boolean(),
  user_flair_type: Z.string(),
  allow_polls: Z.boolean(),
  collapse_deleted_comments: Z.boolean(),
  emojis_custom_size: Z.any(),
  public_description_html: Z.string(),
  allow_videos: Z.boolean(),
  is_crosspostable_subreddit: Z.boolean(),
  notification_level: Z.any(),
  should_show_media_in_comments_setting: Z.boolean(),
  can_assign_link_flair: Z.boolean(),
  allow_prediction_contributors: Z.boolean(),
  submit_text_label: Z.string(),
  link_flair_position: Z.string(),
  user_sr_flair_enabled: Z.any(),
  user_flair_enabled_in_sr: Z.boolean(),
  allow_discovery: Z.boolean(),
  accept_followers: Z.boolean(),
  user_sr_theme_enabled: Z.boolean(),
  link_flair_enabled: Z.boolean(),
  disable_contributor_requests: Z.boolean(),
  subreddit_type: Z.string(),
  suggested_comment_sort: Z.any(),
  banner_img: Z.string(),
  user_flair_text: Z.any(),
  banner_background_color: Z.string(),
  show_media: Z.boolean(),
  id: Z.string(),
  user_is_moderator: Z.any(),
  over18: Z.boolean(),
  description: Z.string(),
  submit_link_label: Z.string(),
  user_flair_text_color: Z.any(),
  restrict_commenting: Z.boolean(),
  user_flair_css_class: Z.any(),
  allow_images: Z.boolean(),
  lang: Z.string(),
  url: Z.string(),
  created_utc: Z.number(),
  banner_size: Z.any(),
  mobile_banner_image: Z.string(),
  user_is_contributor: Z.any(),
  allow_predictions_tournament: Z.boolean(),
}).loose();

const redditSubredditAboutResponseSchema = Z.object({
  kind: Z.string(),
  data: redditSubredditAboutDataSchema,
});

export type RedditSubredditAboutData = Z.infer<typeof redditSubredditAboutDataSchema>;
export type RedditSubredditAboutResponse = Z.infer<
  typeof redditSubredditAboutResponseSchema
>;

export interface RedditClientOpts {
  userAgent?: string;
  logger?: Logger;
}

export class RedditApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: Response,
  ) {
    super(message);
    this.name = 'RedditApiError';
  }
}

function extractRateLimitHeaders(response: Response): Record<string, string> {
  const rateLimitHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase().startsWith('x-ratelimit-')) {
      rateLimitHeaders[key] = value;
    }
  }
  return rateLimitHeaders;
}

function logRateLimitError(logger: Logger, response: Response, context: string): void {
  const rateLimitHeaders = extractRateLimitHeaders(response);

  const rateLimitEntries = Object.entries(rateLimitHeaders)
    .filter(([key]) => key.toLowerCase().startsWith('x-ratelimit-'))
    .map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      const normalizedKey = lowerKey.replace('x-ratelimit-', '');
      return [normalizedKey, value] as const;
    });

  const logData = Object.fromEntries(rateLimitEntries) as Record<string, any>;

  logger.error(
    { ...logData, context, status: response.status },
    'Received 429 rate limit error from Reddit API',
  );
}

export function makeRedditClient(opts: RedditClientOpts = {}) {
  const userAgent =
    opts.userAgent ||
    'Mozilla/5.0 (compatible; reddit-client/0.1; +https://acovado.club)';
  const logger = opts.logger || makeLogger({ name: 'reddit-client' });

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
      if (response.status === 429) {
        logRateLimitError(logger, response, `fetchSubredditThreads: /r/${subreddit}`);
      }
      throw new RedditApiError(
        `Failed to fetch threads from /r/${subreddit}: ${response.status} ${response.statusText}`,
        response.status,
        response,
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
      if (response.status === 429) {
        logRateLimitError(logger, response, `fetchThreadReplies: ${threadRedditId}`);
      }
      throw new RedditApiError(
        `Failed to fetch replies for thread ${threadRedditId}: ${response.status} ${response.statusText}`,
        response.status,
        response,
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

  async function fetchSubredditAbout(
    subreddit: string,
  ): Promise<RedditSubredditAboutData> {
    const url = `https://www.reddit.com/r/${subreddit}/about.json`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        logRateLimitError(logger, response, `fetchSubredditAbout: /r/${subreddit}`);
      }
      throw new RedditApiError(
        `Failed to fetch subreddit about for /r/${subreddit}: ${response.status} ${response.statusText}`,
        response.status,
        response,
      );
    }

    const json = await response.json();
    const about = redditSubredditAboutResponseSchema.parse(json);

    return about.data;
  }

  return {
    fetchSubredditThreads,
    fetchThreadReplies,
    fetchSubredditAbout,
  };
}

export type RedditClient = ReturnType<typeof makeRedditClient>;

export * from './reddit-api-types';
export * from './reddit-api-client';
export * from './reddit-api-response-handler';
