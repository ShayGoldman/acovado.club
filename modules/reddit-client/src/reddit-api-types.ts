import type { BasePayload } from '@modules/events';
import type { Identified } from '@modules/types';
import type { RedditReply, RedditSubredditAboutData, RedditThread } from './index';

export type RedditApiRequestType =
  | 'fetch-subreddit-threads'
  | 'fetch-thread-replies'
  | 'fetch-subreddit-about';

export type RedditApiRequest =
  | { type: 'fetch-subreddit-threads'; params: { subreddit: string; limit?: number } }
  | {
      type: 'fetch-thread-replies';
      params: { threadRedditId: string; subreddit: string };
    }
  | { type: 'fetch-subreddit-about'; params: { subreddit: string } };

export type RedditApiResponse<T extends RedditApiRequest> = T extends {
  type: 'fetch-subreddit-threads';
}
  ? RedditThread[]
  : T extends { type: 'fetch-thread-replies' }
    ? RedditReply[]
    : T extends { type: 'fetch-subreddit-about' }
      ? RedditSubredditAboutData
      : never;

// Request event payload
export interface RedditApiRequestData extends Identified<string> {
  requestId: string;
  type: RedditApiRequestType;
  params: RedditApiRequest['params'];
  metadata?: Record<string, unknown>; // Optional metadata to pass through to response
}

// Response event payload
export interface RedditApiResponseData extends Identified<string> {
  requestId: string;
  responseData?: unknown;
  error?: {
    message: string;
    code?: string;
    retryCount?: number;
  };
  metadata?: Record<string, unknown>; // Metadata from original request, passed through
}

// Event payload types following BasePayload pattern
export interface RedditApiRequestEvent
  extends BasePayload<RedditApiRequestData, 'api-call', 'api-call.requested'> {}

export interface RedditApiResponseEvent
  extends BasePayload<
    RedditApiResponseData,
    `api-call.${string}`,
    `api-call.${string}.succeeded` | `api-call.${string}.failed`
  > {}
