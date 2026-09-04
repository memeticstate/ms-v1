export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function rejectCrossSiteMutation(request: Request) {
  if (isSameOriginMutation(request)) return null;
  return Response.json({ accepted: false, error: "same_origin_required" }, {
    status: 403,
    headers: { "cache-control": "no-store" },
  });
}
