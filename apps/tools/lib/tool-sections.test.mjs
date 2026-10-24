import test from "node:test";
import assert from "node:assert/strict";

import { activeTools } from "./catalog/catalog.ts";
import { OUTPUT_EXTENSIONS } from "./convert/output-name.ts";
import { converterAccept } from "./tool-sections.ts";

test("a converter page accepts the extension our Tools save its format under (owner, #373)", () => {
  assert.equal(converterAccept("mpeg2"), ".mpeg2,.mpg");
  assert.equal(converterAccept("avchd"), ".avchd,.m2ts");
  assert.equal(converterAccept("alac"), ".alac,.m4a");
  assert.equal(converterAccept("mjpeg"), ".mjpeg,.avi");
});

test("every other format's page accepts its own extension", () => {
  assert.equal(converterAccept("mp4"), ".mp4");
  assert.equal(converterAccept("cdda"), ".cdda");
  assert.equal(converterAccept("jpg"), ".jpg,.jpeg");
  assert.equal(converterAccept("tiff"), ".tif,.tiff");
});

test("a curated page's stored file filter also accepts the saved extension", () => {
  let checked = 0;
  for (const tool of activeTools()) {
    const saved = OUTPUT_EXTENSIONS[tool.from];
    const accept = tool.content?.tool?.accept;
    if (!saved || accept === undefined) continue;
    assert.ok(accept.split(",").includes(`.${saved}`), `${tool.id} accepts ${accept}, not .${saved}`);
    checked += 1;
  }
  assert.ok(checked > 0, "some curated page stores a filter for one of these formats");
});
