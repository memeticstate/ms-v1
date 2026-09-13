import type { FetchResult } from "./client";
import { NormalizedObservationSchema, type NormalizedObservation } from "./schemas";

export class XObservationNormalizer {
  static normalizeSearch(result: FetchResult, query: string): NormalizedObservation[] {
    const users = new Map((result.response.includes?.users ?? []).map(user => [user.id, user]));
    const meta = result.response.meta;

    return result.response.data.map(tweet => {
      const rawUser = tweet.author_id ? users.get(tweet.author_id) : undefined;
      const metrics = tweet.public_metrics;
      const observedAt = result.fetchedAt;
      const observation: NormalizedObservation = {
        provider: "x",
        // A Post is canonical, while engagement is a time-varying observation. Keep both identities.
        observationId: `x:${tweet.id}:${Date.parse(observedAt)}`,
        postId: tweet.id,
        content: tweet.text,
        sourceUrl: `https://x.com/i/web/status/${tweet.id}`,
        publishedAt: tweet.created_at,
        observedAt,
        publicMetrics: {
          retweetCount: metrics?.retweet_count ?? 0,
          replyCount: metrics?.reply_count ?? 0,
          likeCount: metrics?.like_count ?? 0,
          quoteCount: metrics?.quote_count ?? 0,
          impressionCount: metrics?.impression_count ?? null,
          bookmarkCount: metrics?.bookmark_count ?? null,
        },
        author: {
          id: tweet.author_id ?? "unresolved",
          resolved: Boolean(rawUser),
          name: rawUser?.name ?? null,
          handle: rawUser?.username ?? null,
          createdAt: rawUser?.created_at ?? null,
          publicMetrics: rawUser?.public_metrics ? {
            followersCount: rawUser.public_metrics.followers_count,
            followingCount: rawUser.public_metrics.following_count,
            tweetCount: rawUser.public_metrics.tweet_count,
            listedCount: rawUser.public_metrics.listed_count,
          } : null,
        },
        provenance: {
          endpoint: "/2/tweets/search/recent",
          query,
          rateLimitLimit: result.rateLimits.limit,
          rateLimitRemaining: result.rateLimits.remaining,
          rateLimitReset: result.rateLimits.reset,
          batchNewestId: meta?.newest_id ?? null,
          batchOldestId: meta?.oldest_id ?? null,
          nextToken: meta?.next_token ?? null,
        },
      };
      return NormalizedObservationSchema.parse(observation);
    });
  }
}
