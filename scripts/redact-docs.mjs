import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Redactions contain no underlying copy. This runs for both optional Markdown
// builds and checkouts that use the reviewed, published HTML directly.
const related = /\b(?:surgery|surgical|games?|gaming|gameplay|competition|competitive|compete|agents?|nfts?|collectibles?|minting|tournaments?|players?|playable)\b/i;
const visibleHeadings = new Map([
  ["Holder benefit", "holder-benefit"],
  ["A practical release path", "a-practical-release-path"],
  ["How it is funded", "how-it-is-funded"],
]);
const plain = (html) => html.replace(/<[^>]*>/g, "").trim();
const bar = (width = "7em", label = "Redacted") => `<span class="redaction" role="img" aria-label="${label}" style="--redaction-width:${width}"></span>`;
const paragraph = () => `<p class="redacted-copy" role="img" aria-label="Redacted paragraph"><span aria-hidden="true" style="width:96%"></span><span aria-hidden="true" style="width:88%"></span><span aria-hidden="true" style="width:62%"></span></p>`;

function redactChapter(html) {
  let hiddenHeading = 0;
  return html.replace(/<(h[1-6]|p|td|th)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g, (match, tag, body) => {
    const text = plain(body).replace(/^A possible holder benefit$/, "Holder benefit");
    if (tag === "h2" && visibleHeadings.has(text)) return `<h2 id="${visibleHeadings.get(text)}">${text}</h2>`;
    if (tag === "th" && ["Step", "What it needs to establish"].includes(text)) return `<th scope="col">${text}</th>`;
    if (/^h/.test(tag)) {
      const id = tag === "h1" ? "classified-chapter" : `withheld-section-${++hiddenHeading}`;
      return `<${tag} id="${id}" aria-label="Redacted heading">${bar(tag === "h1" ? "8em" : "9em")}</${tag}>`;
    }
    if (tag === "p") return paragraph();
    return `<${tag}>${bar("8em")} ${bar("5em")}</${tag}>`;
  });
}

function redactReferences(html) {
  // Withhold complete roadmap rows, including their descriptive status cells.
  html = html.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, body) => related.test(plain(body))
    ? `<tr>${body.replace(/<td>([\s\S]*?)<\/td>/g, () => `<td>${bar("8em")} ${bar("5em")}</td>`)}</tr>`
    : row);
  html = html.replace(/<p>([\s\S]*?)<\/p>/g, (match, body) => {
    if (/^(?:Meme Surgery|If game services)/i.test(plain(body))) return paragraph();
    // Preserve current research, financial terms, and risk disclosures while
    // removing sentences that explain the unreleased experience.
    body = body.replace(/A later role could connect holders[\s\S]*$/, bar("12em"));
    body = body.replace(/The social direction is[\s\S]*?return and contribute\./, bar("12em"));
    body = body.replace(/Meme Surgery could turn[\s\S]*$/, bar("12em"));
    body = body.replace(/Paid game features[\s\S]*$/, bar("12em"));
    return `<p>${body}</p>`;
  });
  html = html.replace(/<li>See how <a href="\/docs\/classified\/">[\s\S]*?<\/li>/g,
    `<li><a href="/docs/classified/" aria-label="Redacted chapter">${bar("12em")}</a></li>`);
  // Only replace text nodes: never put markup inside attributes or metadata.
  return html.replace(/(^|>)([^<]+)(?=<|$)/g, (match, prefix, text) => prefix + text.replace(
    /\b(?:Meme Surgery(?: and agents)?|(?:potentially future )?game and agent experiences|(?:potential )?game costs|game (?:integrations|development|work)|(?:surgery|surgical|games?|gaming|gameplay|competition|competitive|compete|agents?|nfts?|collectibles?|minting|tournaments?|players?|playable))\b/gi,
    () => bar(),
  ));
}

export async function applyDocumentationRedactions(output) {
  const legacy = path.join(output, "meme-surgery");
  const classified = path.join(output, "classified");
  try {
    await access(path.join(legacy, "index.html"));
    await mkdir(classified, { recursive: true });
    await rename(path.join(legacy, "index.html"), path.join(classified, "index.html"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let count = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.name.endsWith(".html")) continue;
      let html = await readFile(file, "utf8");
      html = html.replaceAll("/docs/meme-surgery/", "/docs/classified/");
      html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Memetic State field guide, premium research access, token purpose, and creator fees.">');
      html = html.replace(/<link rel="icon" href="[^"]*">/, '<link rel="icon" type="image/svg+xml" href="/favicon-compass.svg?v=20260909">');
      html = html.replace(/href="\/docs\/styles\.css(?:\?[^"]*)?"/, 'href="/docs/styles.css?v=20260909-redacted"');
      if (file === path.join(classified, "index.html")) {
        html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>Classified · Memetic State Docs</title>");
        html = html.replace(/<article(?:\s[^>]*)?>([\s\S]*?)<\/article>/, (_, article) => `<article class="classified-record">${redactChapter(article)}</article>`);
        html = html.replace(/(<aside class="contents">[\s\S]*?<nav[^>]*>)[\s\S]*?(<\/nav>)/,
          (_, start, end) => start + [...visibleHeadings].map(([text, id]) => `<a href="#${id}">${text}</a>`).join("") + end);
      }
      html = html.replace(/(<a[^>]*href="\/docs\/classified\/"[^>]*>)(?:Classified|Meme Surgery and agents)(<\/a>)/g,
        (_, start, end) => start + bar("8em", "Redacted chapter") + end);
      html = html.replace(/<span>(?:Classified|Meme Surgery and agents)<\/span>/g, `<span>${bar("8em", "Redacted chapter")}</span>`);
      html = redactReferences(html);
      if (related.test(html)) throw new Error(`Unredacted restricted reference in ${file}`);
      await writeFile(file, html);
      count++;
    }
  }
  await visit(output);
  console.log(`Checked source-level redactions across ${count} public documentation pages.`);
}
