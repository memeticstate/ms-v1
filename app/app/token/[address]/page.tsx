import { TokenBrief } from '@/components/token-brief';

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <TokenBrief address={address} />;
}
