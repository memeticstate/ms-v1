import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const textOnly = (html) => html.replace(/<[^>]*>/g, "").trim();
const pagePath = (slug) => `/docs/${slug ? slug + "/" : ""}`;
const redactedLabel = '<span class="redaction" role="img" aria-label="Redacted chapter" style="--redaction-width:7em"></span>';
const chevron = '<svg class="menu-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const groups = [
  { label: "Getting started", start: 0, end: 5 },
  { label: "Access and token", start: 5, end: 11 },
  { label: "Reference", start: 11, end: 14 },
];

function chapterLabel(chapter) {
  return chapter[1] === "classified" ? redactedLabel : escape(chapter[2]);
}

function navigation(chapters, currentSlug, label) {
  return `<nav aria-label="${label}">${groups.map((group) => `<div class="nav-group"><p class="nav-group-title">${group.label}</p>${chapters.slice(group.start, group.end).map((chapter) => `<a href="${pagePath(chapter[1])}"${chapter[1] === currentSlug ? ' aria-current="page"' : ""}>${chapterLabel(chapter)}</a>`).join("")}</div>`).join("")}</nav>`;
}

function prepareArticle(article) {
  article = article
    .replaceAll("Open full image ↗", "View full image")
    .replaceAll("Open full image", "View full image")
    .replace(/<span aria-hidden="true">↓<\/span>/g, '<span class="flow-connector" aria-hidden="true"></span>')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3]/gu, "");
  // A table scrolls within the reading column instead of widening the page.
  article = article.replace(/<div class="table-wrap"[^>]*>([\s\S]*?<\/table>)<\/div>/g, "$1");
  return article.replace(/<table>[\s\S]*?<\/table>/g, (table) => {
    const headers = [...table.matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)].map((match) => textOnly(match[1])).filter(Boolean);
    return `<div class="table-wrap" role="region" aria-label="${escape(headers.length ? 'Table: ' + headers.join(', ') : 'Table')}" tabindex="0">${table}</div>`;
  });
}

// Restyle the reviewed public HTML as well as fresh optional Markdown builds.
// The article is reused; private notes are never needed or republished here.
export async function refreshDocumentationLayout(output, chapters) {
  for (let index = 0; index < chapters.length; index++) {
    const [, slug, title] = chapters[index];
    const file = path.join(output, slug, "index.html");
    const previous = await readFile(file, "utf8");
    const matchedArticle = previous.match(/<article(?:\s[^>]*)?>([\s\S]*?)<\/article>/);
    if (!matchedArticle) throw new Error(`Documentation article is missing: ${file}`);
    const article = prepareArticle(matchedArticle[1]);
    const toc = [...article.matchAll(/<h2\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)]
      .filter((match) => textOnly(match[2]))
      .map(([, id, heading]) => `<a href="#${escape(id)}">${heading}</a>`).join("");
    const group = groups.find((item) => index >= item.start && index < item.end);
    const neighbor = (offset, label) => {
      const next = chapters[index + offset];
      return next ? `<a href="${pagePath(next[1])}"><small>${label}</small><span>${chapterLabel(next)}</span></a>` : "<span></span>";
    };
    const holder = '<a class="holder" href="https://memeticstate.com/app/research"><span>Premium access</span><span class="holder-threshold">0.1% holding</span></a>';
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
<title>${escape(title)} · Memetic State Docs</title>
<meta name="description" content="Memetic State field guide, premium research access, token purpose, and creator fees.">
<link rel="icon" type="image/svg+xml" href="/favicon-compass.svg?v=20260909">
<link rel="stylesheet" href="/docs/styles.css?v=20260916-v64">
<script src="/docs/theme.js"></script>
<link rel="canonical" href="https://docs.memeticstate.com${pagePath(slug)}">
</head>
<body data-doc-page="${slug || "welcome"}">
<a class="skip" href="#content">Skip to content</a>
<header class="site-header"><div class="header-inner">
<a class="brand" href="/docs/" aria-label="Memetic State documentation"><img src="/logo-mark.svg" width="28" height="28" alt=""><span class="brand-title">Memetic State</span><span class="brand-context">Docs</span></a>
<a class="back" href="https://memeticstate.com/app">Open app</a>
</div></header>
<details class="mobile-chapters"><summary><span>Chapters</span><span class="current-chapter">${chapterLabel(chapters[index])}</span>${chevron}</summary><div class="mobile-menu-body">${navigation(chapters, slug, "Mobile documentation chapters")}${holder}</div></details>
<div class="layout">
<aside class="chapters">${navigation(chapters, slug, "Documentation chapters")}${holder}</aside>
<main id="content" tabindex="-1"><p class="section-label">${group.label}</p><article${slug === "classified" ? ' class="classified-record"' : ""}>${article}</article><nav class="neighbors" aria-label="Previous and next chapter">${neighbor(-1, "Previous")}${neighbor(1, "Next")}</nav><footer>Updated 9 September 2026<span>Plans and live features are identified within each page.</span></footer></main>
${toc ? `<aside class="contents"><p>On this page</p><nav aria-label="On this page">${toc}</nav></aside>` : ""}
</div>
</body>
</html>
`;
    if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u.test(page)) throw new Error(`Emoji found in documentation: ${file}`);
    if (slug === "classified") {
      const visible = article.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (visible !== "Holder benefit A practical release path Step What it needs to establish How it is funded") throw new Error("Unexpected visible text in the restricted chapter.");
    }
    await writeFile(file, page);
  }
  console.log(`Refreshed ${chapters.length} documentation layouts without changing their article content.`);
}
