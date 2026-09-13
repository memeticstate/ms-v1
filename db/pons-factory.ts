import { getD1 } from "@/db";
import type { PonsFactoryFeed } from "@/lib/pons/model";

export async function loadFactoryFeed(): Promise<PonsFactoryFeed | null> {
  const row = await getD1().prepare(`SELECT f.payload_json,
    (SELECT json_group_array(json_object('token_address', token_address, 'token_symbol', token_symbol, 'pair_symbol', pair_symbol))
     FROM pons_launches WHERE token_address IN
       (SELECT json_extract(value, '$.tokenAddress') FROM json_each(f.payload_json, '$.events'))) AS identities_json
    FROM pons_factory_feed f WHERE f.id = 'v2'`).first<{ payload_json: string; identities_json: string }>();
  if (!row) return null;
  const feed = JSON.parse(row.payload_json) as PonsFactoryFeed;
  const identities = new Map<string, { token_symbol: string | null; pair_symbol: string }>();
  const rows = JSON.parse(row.identities_json) as Array<{ token_address: string; token_symbol: string | null; pair_symbol: string }>;
  rows.forEach(identity => identities.set(identity.token_address, identity));
  return { ...feed, events: feed.events.map((event) => ({ ...event,
    tokenSymbol: identities.get(event.tokenAddress)?.token_symbol || event.tokenSymbol,
    pairSymbol: identities.get(event.tokenAddress)?.pair_symbol || event.pairSymbol,
  })) };
}

export async function storeFactoryFeed(feed: PonsFactoryFeed) {
  await getD1().prepare(`INSERT INTO pons_factory_feed (id, payload_json) VALUES ('v2', ?)
    ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`).bind(JSON.stringify(feed)).run();
}
