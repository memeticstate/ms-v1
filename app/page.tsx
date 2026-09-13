import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemeticLanding } from "@/components/memetic-landing";
import { legacyAppHref } from "@/lib/pons/landing";

export const metadata: Metadata = {
  title: "Memetic State — See what’s moving. Understand why.",
  description: "Track new tokens, understand changes in participation, and inspect the onchain evidence on Robinhood Chain.",
};

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Preserve already-shared observatory links when the front door changes.
  const destination = legacyAppHref(await searchParams);
  if (destination) redirect(destination);
  return <MemeticLanding />;
}
