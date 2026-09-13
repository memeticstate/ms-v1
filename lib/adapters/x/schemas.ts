import { z } from "zod";

const isoTimestamp = z.string().datetime({ offset: true });

export const RawTweetSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  author_id: z.string().min(1).optional(),
  created_at: isoTimestamp,
  public_metrics: z.object({
    retweet_count: z.number().int().nonnegative(),
    reply_count: z.number().int().nonnegative(),
    like_count: z.number().int().nonnegative(),
    quote_count: z.number().int().nonnegative(),
    impression_count: z.number().int().nonnegative().optional(),
    bookmark_count: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const RawUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  username: z.string().min(1),
  created_at: isoTimestamp.optional(),
  public_metrics: z.object({
    followers_count: z.number().int().nonnegative(),
    following_count: z.number().int().nonnegative(),
    tweet_count: z.number().int().nonnegative(),
    listed_count: z.number().int().nonnegative(),
  }).optional(),
});

export const XApiProblemSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  status: z.number().int().optional(),
  value: z.string().optional(),
  parameter: z.string().optional(),
  resource_type: z.string().optional(),
});

export const XSearchApiResponseSchema = z.object({
  data: z.array(RawTweetSchema).optional().default([]),
  includes: z.object({
    users: z.array(RawUserSchema).optional().default([]),
  }).optional(),
  errors: z.array(XApiProblemSchema).optional().default([]),
  meta: z.object({
    result_count: z.number().int().nonnegative().optional(),
    next_token: z.string().optional(),
    newest_id: z.string().optional(),
    oldest_id: z.string().optional(),
  }).optional(),
});

export const NormalizedAuthorSchema = z.object({
  id: z.string(),
  resolved: z.boolean(),
  name: z.string().nullable(),
  handle: z.string().nullable(),
  createdAt: isoTimestamp.nullable(),
  publicMetrics: z.object({
    followersCount: z.number().int().nonnegative(),
    followingCount: z.number().int().nonnegative(),
    tweetCount: z.number().int().nonnegative(),
    listedCount: z.number().int().nonnegative(),
  }).nullable(),
});

export const NormalizedObservationSchema = z.object({
  provider: z.literal("x"),
  observationId: z.string(),
  postId: z.string(),
  content: z.string(),
  sourceUrl: z.string().url(),
  publishedAt: isoTimestamp,
  observedAt: isoTimestamp,
  publicMetrics: z.object({
    retweetCount: z.number().int().nonnegative(),
    replyCount: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative(),
    quoteCount: z.number().int().nonnegative(),
    impressionCount: z.number().int().nonnegative().nullable(),
    bookmarkCount: z.number().int().nonnegative().nullable(),
  }),
  author: NormalizedAuthorSchema,
  provenance: z.object({
    endpoint: z.literal("/2/tweets/search/recent"),
    query: z.string(),
    rateLimitLimit: z.number().int().nullable(),
    rateLimitRemaining: z.number().int().nullable(),
    rateLimitReset: z.number().int().nullable(),
    batchNewestId: z.string().nullable(),
    batchOldestId: z.string().nullable(),
    nextToken: z.string().nullable(),
  }),
});

export type XSearchApiResponse = z.infer<typeof XSearchApiResponseSchema>;
export type NormalizedObservation = z.infer<typeof NormalizedObservationSchema>;
