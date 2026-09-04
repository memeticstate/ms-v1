import { env } from "cloudflare:workers";

import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";

const PERSONAS = new Set(["researcher", "launch-team", "ecosystem-builder"]);

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ accepted: false, error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  if (text(payload.website, 120)) {
    return Response.json({ accepted: true }, { status: 202, headers: { "cache-control": "no-store" } });
  }

  const contact = text(payload.contact, 120);
  const persona = text(payload.persona, 40);
  const workflow = text(payload.workflow, 800);
  if (contact.length < 3 || !PERSONAS.has(persona) || workflow.length < 12) {
    return Response.json({ accepted: false, error: "missing_fields" }, { status: 422, headers: { "cache-control": "no-store" } });
  }

  const contactNormalized = contact.toLowerCase();
  await env.DB.prepare(`
    INSERT INTO research_partner_applications
      (id, contact, contact_normalized, persona, workflow, source_view, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'network', 'new', unixepoch())
    ON CONFLICT(contact_normalized) DO UPDATE SET
      contact = excluded.contact,
      persona = excluded.persona,
      workflow = excluded.workflow,
      status = 'new',
      created_at = unixepoch()
  `).bind(crypto.randomUUID(), contact, contactNormalized, persona, workflow).run();

  return Response.json({ accepted: true }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
