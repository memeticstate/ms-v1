import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { applyDocumentationRedactions } from "./redact-docs.mjs";
import { refreshDocumentationLayout } from "./docs-layout.mjs";

const source = path.resolve("content/gitbook");
const output = path.resolve("public/docs");
export const chapters = [
  ["README.md", "", "Welcome"],
  ["01-field-guide/README.md", "field-guide", "The Field Guide"],
  ["02-using-the-site/README.md", "website", "Website tour"],
  ["02-using-the-site/data-freshness.md", "coverage", "Coverage and freshness"],
  ["03-methodology/README.md", "methodology", "Reading the evidence"],
  ["04-premium/premium-field-operator.md", "premium", "Premium Field Operator"],
  ["05-tokenomics/README.md", "token", "Token and flywheel"],
  ["05-tokenomics/supply-and-utility.md", "supply-and-access", "Supply and access"],
  ["05-tokenomics/revenue-buyback-burn.md", "creator-fees", "Creator fees and buybacks"],
  ["05-tokenomics/fee-vault.md", "fee-vault", "Proposed fee vault"],
  ["05-tokenomics/launch-and-claim-record.md", "launch-record", "Launch disclosures"],
  ["06-roadmap/meme-surgery.md", "classified", "Classified"],
  ["references/disclosures.md", "disclosures", "Disclosures"],
  ["references/glossary.md", "glossary", "Glossary"],
];

// Private Markdown inputs are optional in a source checkout. The reviewed public
// pages remain ordinary website assets so an app build does not need those notes.
try {
  await access(source);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await applyDocumentationRedactions(output);
  await refreshDocumentationLayout(output, chapters);
  await Promise.all([
    path.join(output, "styles.css"),
    ...chapters.map(([, slug]) => path.join(output, slug, "index.html")),
  ].map((file) => access(file)));
  console.log(`Using ${chapters.length} published documentation pages; private Markdown inputs are not present.`);
  process.exit(0);
}

const routes = new Map(chapters.map(([file, slug]) => [path.resolve(source, file), `/docs/${slug ? slug + "/" : ""}`]));
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const anchor = (value) => value.replace(/<[^>]+>/g, "").replace(/[*`]/g, "").toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
const flow = `<figure class="flow" aria-label="Proposed fee reinvestment flow"><div class="flow-start">Eligible token trading</div><span aria-hidden="true">↓</span><div class="flow-start">Creator fees received</div><span aria-hidden="true">↓</span><div class="flow-start">Project treasury</div><div class="flow-branches"><div><strong>Product and game budget</strong><p>Fund useful experiences</p></div><div><strong>Buyback budget</strong><p>Execute token purchases</p></div><div><strong>Retained balance</strong><p>Keep funds available</p></div></div><figcaption>Useful experiences may encourage further participation. Trading and income are not guaranteed.</figcaption></figure>`;

await mkdir(output, { recursive: true });
for (let index = 0; index < chapters.length; index++) {
  const [file, slug, title] = chapters[index];
  const fullPath = path.resolve(source, file);
  const markdown = (await readFile(fullPath, "utf8")).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    if (/^\/docs\/images\/[a-z0-9-]+\.(?:jpg|png|webp)(?:\s+"[^"]*")?$/.test(href)) return match;
    if (/^https:\/\//.test(href) || href.startsWith("#")) return match;
    const [relative, fragment] = href.split("#");
    const target = routes.get(path.resolve(path.dirname(fullPath), relative));
    if (!target) throw new Error(`Unresolved documentation link: ${file} -> ${href}`);
    return `[${label}](${target}${fragment ? "#" + fragment : ""})`;
  });
  const headingCounts = new Map();
  const toc = [];
  const marked = new Marked({ gfm: true, renderer: {
    paragraph(token) {
      const meaningful = token.tokens.filter((child) => child.type !== "text" || child.text.trim());
      if (meaningful.length === 1 && meaningful[0].type === "image") {
        const shot = meaningful[0];
        if (!/^\/docs\/images\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(shot.href)) throw new Error(`Invalid documentation screenshot: ${shot.href}`);
        return `<figure class="screenshot"><a href="${escape(shot.href)}" aria-label="Enlarge: ${escape(shot.text)}"><img src="${escape(shot.href)}" alt="${escape(shot.text)}" loading="lazy" decoding="async"></a><figcaption>${escape(shot.title || shot.text)} <a href="${escape(shot.href)}">Open full image ↗</a></figcaption></figure>\n`;
      }
      return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
    },
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      const key = anchor(text);
      const count = headingCounts.get(key) ?? 0; headingCounts.set(key, count + 1);
      const id = key + (count ? `-${count}` : "");
      if (token.depth === 2) toc.push([id, text]);
      return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
    },
    code(token) {
      if (token.lang === "mermaid") return flow;
      return `<pre><code>${escape(token.text)}</code></pre>`;
    },
    html(token) { return escape(token.text); },
  } });
  const html = marked.parse(markdown);
  for (const [, imagePath] of html.matchAll(/<img src="(\/docs\/images\/[^"]+)"/g)) {
    await access(path.resolve("public", imagePath.slice(1)));
  }
  const navigation = chapters.map(([chapter, chapterSlug, chapterTitle]) => `<a ${chapter === file ? 'aria-current="page"' : ""} href="/docs/${chapterSlug ? chapterSlug + "/" : ""}">${escape(chapterTitle)}</a>`).join("");
  const neighbor = (offset, label) => { const next = chapters[index + offset]; return next ? `<a href="/docs/${next[1] ? next[1] + "/" : ""}"><small>${label}</small><span>${escape(next[2])}</span></a>` : "<span></span>"; };
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Memetic State Docs</title><meta name="description" content="Memetic State field guide, premium research access, token purpose, creator fees, and game roadmap."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/docs/styles.css"><link rel="canonical" href="https://docs.memeticstate.com/docs/${slug ? slug + "/" : ""}"></head><body><a class="skip" href="#content">Skip to content</a><header><a class="brand" href="/docs/">MEMETIC <i>STATE</i><span>Documentation</span></a><a class="back" href="https://memeticstate.com">Open the atlas ↗</a></header><div class="layout"><aside class="chapters"><p class="eyebrow">Field notes / 01</p><nav aria-label="Documentation chapters">${navigation}</nav><a class="holder" href="https://memeticstate.com/app/research">Premium access · 0.1%</a></aside><main id="content" tabindex="-1"><p class="eyebrow">Memetic State / ${String(index + 1).padStart(2, "0")}</p><article>${html}</article><nav class="neighbors" aria-label="Previous and next chapter">${neighbor(-1, "Previous")}${neighbor(1, "Next")}</nav><footer>Updated 9 September 2026 · Plans and live features are identified within each page.</footer></main><aside class="contents"><p class="eyebrow">On this page</p><nav aria-label="On this page">${toc.map(([id, text]) => `<a href="#${id}">${text}</a>`).join("")}</nav></aside></div></body></html>`;
  await mkdir(path.join(output, slug), { recursive: true });
  await writeFile(path.join(output, slug, "index.html"), page);
}
console.log(`Built ${chapters.length} documentation pages from GitBook Markdown.`);
await applyDocumentationRedactions(output);
await refreshDocumentationLayout(output, chapters);
