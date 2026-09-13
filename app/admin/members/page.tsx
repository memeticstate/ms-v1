import type { Metadata } from "next";

import { AdminMemberLedger } from "@/components/admin-member-ledger";

export const metadata: Metadata = {
  title: "Member Ledger — Memetic State",
  robots: { index: false, follow: false },
};

export default function AdminMembersPage() {
  return <AdminMemberLedger />;
}
