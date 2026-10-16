import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "../components/Markdown";

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

test("release notes never become raw HTML", () => {
  const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)">');
  assert.ok(!out.includes("<script"), out);
  assert.ok(!out.includes("<img"), out);
  assert.ok(out.includes("&lt;script&gt;"), out);
});

test("only http(s) links are clickable", () => {
  const out = html("[ok](https://example.com/a_(b)) [bad](javascript:alert(1)) [data](data:text/html,x)");
  assert.ok(out.includes('href="https://example.com/a_(b)"'), out);
  assert.ok(out.includes('rel="noopener noreferrer"'), out);
  assert.ok(!out.includes("javascript:"), out);
  assert.ok(!out.includes("data:text"), out);
  assert.ok(out.includes("bad") && out.includes("data"), "link text is kept");
});

test("common release-note formatting is rendered", () => {
  const out = html("## Added\n\n- **Bold** item\n- `code` item\n\n1. first\n2. second\n\n```\nnpm run build\n```\n\nPlain *text*.");
  assert.ok(out.includes("<h4"), "## is shown below the page's own headings");
  assert.ok(out.includes("<ul") && out.includes("<strong>Bold</strong>"), out);
  assert.ok(out.includes("<code"), out);
  assert.ok(out.includes("<ol") && out.includes("<li>second</li>"), out);
  assert.ok(out.includes("<pre") && out.includes("npm run build"), out);
  assert.ok(out.includes("<em>text</em>"), out);
});
