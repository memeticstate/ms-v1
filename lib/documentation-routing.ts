const DOCS_HOST = "docs.memeticstate.com";

/** Only rewrites public documentation assets, never premium API requests. */
export function documentationRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (url.hostname === DOCS_HOST && url.pathname === "/") url.pathname = "/docs/";
  else if (url.pathname === "/docs") url.pathname = "/docs/";
  else if (!url.pathname.startsWith("/docs/")) return null;
  // Previously shared links resolve to the same withheld public chapter.
  if (/^\/docs\/meme-surgery(?:\/(?:index\.html)?)?$/.test(url.pathname)) url.pathname = "/docs/classified/";
  return new Request(url, { method: request.method, headers: request.headers });
}
