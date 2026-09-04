export const ENTITLEMENT_CAPABILITIES = [
  "server_watch_slots",
  "alert_routes",
  "reports_monthly",
  "export_rows_monthly",
  "api_requests_monthly",
  "team_seats",
] as const;

export type EntitlementCapability = (typeof ENTITLEMENT_CAPABILITIES)[number];
export type EntitlementAllowances = Record<EntitlementCapability, number>;
export type EntitlementPlan = "field" | "founding" | "researcher" | "team";
export type EntitlementSource = "public" | "founding" | "paid" | "token" | "admin";

export type EntitlementGrantInput = {
  id: string;
  source: EntitlementSource;
  plan: EntitlementPlan;
  status: string;
  startsAt: number;
  endsAt: number | null;
  allowances: Partial<EntitlementAllowances>;
};

export type EntitlementProfile = {
  plan: EntitlementPlan;
  allowances: EntitlementAllowances;
  used: EntitlementAllowances;
  remaining: EntitlementAllowances;
  sources: Array<{ id: string; source: EntitlementSource; plan: EntitlementPlan }>;
  periodKey: string;
};

export const PLAN_ALLOWANCES: Record<EntitlementPlan, EntitlementAllowances> = {
  field: {
    server_watch_slots: 5,
    alert_routes: 0,
    reports_monthly: 0,
    export_rows_monthly: 0,
    api_requests_monthly: 0,
    team_seats: 1,
  },
  founding: {
    server_watch_slots: 50,
    alert_routes: 2,
    reports_monthly: 8,
    export_rows_monthly: 25_000,
    api_requests_monthly: 10_000,
    team_seats: 3,
  },
  researcher: {
    server_watch_slots: 100,
    alert_routes: 3,
    reports_monthly: 20,
    export_rows_monthly: 100_000,
    api_requests_monthly: 50_000,
    team_seats: 1,
  },
  team: {
    server_watch_slots: 500,
    alert_routes: 10,
    reports_monthly: 100,
    export_rows_monthly: 1_000_000,
    api_requests_monthly: 500_000,
    team_seats: 5,
  },
};

const PLAN_ORDER: EntitlementPlan[] = ["field", "founding", "researcher", "team"];

function zeroAllowances(): EntitlementAllowances {
  return Object.fromEntries(ENTITLEMENT_CAPABILITIES.map((key) => [key, 0])) as EntitlementAllowances;
}

export function entitlementPeriodKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseEntitlementAllowances(value: string): Partial<EntitlementAllowances> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(ENTITLEMENT_CAPABILITIES.flatMap((capability) => {
      const amount = parsed[capability];
      return typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0
        ? [[capability, amount]]
        : [];
    })) as Partial<EntitlementAllowances>;
  } catch {
    return {};
  }
}

export function resolveEntitlementProfile(
  grants: EntitlementGrantInput[],
  usage: Partial<EntitlementAllowances> = {},
  nowSeconds = Math.floor(Date.now() / 1_000),
): EntitlementProfile {
  const active = grants.filter((grant) => grant.status === "active"
    && grant.startsAt <= nowSeconds
    && (grant.endsAt === null || grant.endsAt > nowSeconds));
  const allowances = { ...PLAN_ALLOWANCES.field };
  let plan: EntitlementPlan = "field";

  for (const grant of active) {
    const grantPlan = PLAN_ALLOWANCES[grant.plan] ?? PLAN_ALLOWANCES.field;
    for (const capability of ENTITLEMENT_CAPABILITIES) {
      const amount = grant.allowances[capability] ?? grantPlan[capability];
      allowances[capability] = Math.max(allowances[capability], amount);
    }
    if (PLAN_ORDER.indexOf(grant.plan) > PLAN_ORDER.indexOf(plan)) plan = grant.plan;
  }

  const used = zeroAllowances();
  const remaining = zeroAllowances();
  for (const capability of ENTITLEMENT_CAPABILITIES) {
    used[capability] = Math.max(0, Math.floor(usage[capability] ?? 0));
    remaining[capability] = Math.max(0, allowances[capability] - used[capability]);
  }

  return {
    plan,
    allowances,
    used,
    remaining,
    periodKey: entitlementPeriodKey(new Date(nowSeconds * 1_000)),
    sources: [
      { id: "public-field", source: "public", plan: "field" },
      ...active.map(({ id, source, plan: grantPlan }) => ({ id, source, plan: grantPlan })),
    ],
  };
}

export function capabilityIsPublic(capability: string): boolean {
  return ["canonical_events", "methodology", "integrity", "rankings"].includes(capability);
}
