import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const sectionSource = readFileSync(
  new URL("../components/sections/InfoArticleSection.tsx", import.meta.url),
  "utf8",
);
const tools = JSON.parse(
  readFileSync(new URL("./catalog/tools.json", import.meta.url), "utf8"),
);

// remark-gfm turned bare "www.example.com" text in nine Lander articles into
// http:// links that redirect (issue #323).
test("info articles leave bare domains as text instead of linking them", () => {
  assert.doesNotMatch(sectionSource, /from "remark-gfm"/);
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, null, "Videos from www.ladybanana.co.uk play here."),
  );
  assert.match(html, /www\.ladybanana\.co\.uk/);
  assert.doesNotMatch(html, /<a\s/);
});

test("info articles use no GFM-only syntax, which the section doesn't render", () => {
  for (const tool of tools) {
    const markdown = tool.content?.infoArticle?.markdown;
    if (!markdown) continue;
    assert.doesNotMatch(markdown, /^\s*\|.*\|\s*$/m, `${tool.id} has a table`);
    assert.doesNotMatch(markdown, /~~\S/, `${tool.id} has strikethrough`);
    assert.doesNotMatch(markdown, /^\s*[-*] \[[ xX]\]/m, `${tool.id} has a task list`);
    assert.doesNotMatch(markdown, /\[\^[^\]]+\]/, `${tool.id} has a footnote`);
  }
});
