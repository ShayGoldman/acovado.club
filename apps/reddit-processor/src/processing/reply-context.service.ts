import type { DBClient, RedditReply, RedditThread } from '@modules/db';
import { schema } from '@modules/db';
import type { Tracer } from '@modules/tracing';
import { eq } from 'drizzle-orm';

export interface ReplyTree {
  reply: RedditReply;
  parent?: ReplyTree;
  thread?: RedditThread;
}

export interface MakeReplyContextServiceOpts {
  db: DBClient;
  tracer: Tracer;
}

export type ReplyContextService = ReturnType<typeof makeReplyContextService>;

export function makeReplyContextService(opts: MakeReplyContextServiceOpts) {
  const { db, tracer } = opts;

  async function buildReplyTree(replyId: number): Promise<ReplyTree> {
    return tracer.with(`Build reply tree for reply ${replyId}`, async (ctx) => {
      const [reply] = await db
        .select()
        .from(schema.redditReplies)
        .where(eq(schema.redditReplies.id, replyId))
        .limit(1);

      if (!reply) {
        throw new Error(`Reply ${replyId} not found`);
      }

      ctx.log.debug(
        { replyId, parentRedditId: reply.parentRedditId },
        'Building reply tree',
      );

      const tree: ReplyTree = {
        reply: reply as RedditReply,
      };

      if (reply.parentRedditId) {
        const [parentReply] = await db
          .select()
          .from(schema.redditReplies)
          .where(eq(schema.redditReplies.redditId, reply.parentRedditId))
          .limit(1);

        if (parentReply) {
          tree.parent = await buildReplyTree(parentReply.id);
        } else {
          ctx.log.warn(
            { replyId, parentRedditId: reply.parentRedditId },
            'Parent reply not found in database',
          );
        }
      }

      const [thread] = await db
        .select()
        .from(schema.redditThreads)
        .where(eq(schema.redditThreads.id, reply.threadId))
        .limit(1);

      if (thread) {
        if (tree.parent) {
          let current = tree.parent;
          while (current.parent) {
            current = current.parent;
          }
          current.thread = thread as RedditThread;
        } else {
          tree.thread = thread as RedditThread;
        }
      } else {
        ctx.log.warn(
          { replyId, threadId: reply.threadId },
          'Thread not found in database',
        );
      }

      return tree;
    });
  }

  return {
    buildReplyTree(replyId: number) {
      return buildReplyTree(replyId);
    },
  };
}
