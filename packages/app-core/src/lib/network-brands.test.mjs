import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const moduleUrl = new URL("./network-brands.ts", import.meta.url);
const networkBrandsDataUrl = new URL("../data/network-brands.json", import.meta.url);
const networkBrandsData = existsSync(networkBrandsDataUrl)
  ? JSON.parse(readFileSync(networkBrandsDataUrl, "utf8"))
  : { brandGroups: { mainGroup: [], serpxxxGroup: [] } };

async function loadNetworkBrandsModule() {
  try {
    return await import(moduleUrl.href);
  } catch (error) {
    throw new assert.AssertionError({
      message: "network brands module should exist and be importable",
      actual: error,
    });
  }
}

function buildFixture(overrides = {}) {
  return {
    brands: {
      "serp-co": {
        name: "SERP",
        url: "https://serp.co",
      },
      "tools-serp-co": {
        name: "SERP Tools",
        url: "https://tools.serp.co",
      },
      "serp-xxx": {
        name: "SERP XXX",
        url: "https://serp.xxx",
      },
    },
    brandGroups: {
      mainGroup: ["serp-co", "tools-serp-co"],
      serpxxxGroup: ["serp-xxx"],
    },
    ...overrides,
  };
}

test("getNetworkBrands returns the main group only", async () => {
  const { getNetworkBrands } = await loadNetworkBrandsModule();
  const brands = getNetworkBrands();
  const mainGroup = networkBrandsData.brandGroups.mainGroup;

  assert.deepEqual(
    brands.map((brand) => brand.slug),
    mainGroup,
  );
  assert.equal(brands.length, mainGroup.length);
});

test("network brand group order is preserved", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();
  const brands = getNetworkBrandsFromData(buildFixture());

  assert.deepEqual(
    brands.map((brand) => brand.slug),
    ["serp-co", "tools-serp-co"],
  );
});

test("network brands include hostnames extracted from valid URLs", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();
  const brands = getNetworkBrandsFromData(buildFixture());

  assert.deepEqual(
    brands.map((brand) => brand.hostname),
    ["serp.co", "tools.serp.co"],
  );
});

test("unknown group slugs throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () => getNetworkBrandsFromData(buildFixture(), "missingGroup"),
    /Unknown network brand group: missingGroup/,
  );
});

test("missing brand slugs throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () =>
      getNetworkBrandsFromData(
        buildFixture({
          brandGroups: {
            mainGroup: ["serp-co", ""],
          },
        }),
      ),
    /Network brand group mainGroup contains an empty brand slug/,
  );
});

test("missing brand names throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () =>
      getNetworkBrandsFromData(
        buildFixture({
          brands: {
            "serp-co": {
              name: "",
              url: "https://serp.co",
            },
          },
          brandGroups: {
            mainGroup: ["serp-co"],
          },
        }),
      ),
    /Network brand serp-co is missing a name/,
  );
});

test("missing brand URLs throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () =>
      getNetworkBrandsFromData(
        buildFixture({
          brands: {
            "serp-co": {
              name: "SERP",
              url: "",
            },
          },
          brandGroups: {
            mainGroup: ["serp-co"],
          },
        }),
      ),
    /Network brand serp-co is missing a URL/,
  );
});

test("invalid brand URLs throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () =>
      getNetworkBrandsFromData(
        buildFixture({
          brands: {
            "serp-co": {
              name: "SERP",
              url: "ftp://serp.co",
            },
          },
          brandGroups: {
            mainGroup: ["serp-co"],
          },
        }),
      ),
    /Network brand serp-co must use an http or https URL/,
  );
});

test("duplicate normalized brand URLs throw", async () => {
  const { getNetworkBrandsFromData } = await loadNetworkBrandsModule();

  assert.throws(
    () =>
      getNetworkBrandsFromData(
        buildFixture({
          brands: {
            "serp-co": {
              name: "SERP",
              url: "https://serp.co",
            },
            "serp-co-copy": {
              name: "SERP Copy",
              url: "https://SERP.co/",
            },
          },
          brandGroups: {
            mainGroup: ["serp-co", "serp-co-copy"],
          },
        }),
      ),
    /Duplicate network brand URL https:\/\/serp.co/,
  );
});
