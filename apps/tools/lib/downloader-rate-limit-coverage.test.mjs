import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { selectToolRenderer } from './tool-renderer.ts';
const downloaderTemplateSource = readFileSync(
  new URL('../components/DownloaderPageTemplate.tsx', import.meta.url),
  'utf8',
);
const downloaderHeroSource = readFileSync(
  new URL('../components/DownloaderPageHero.tsx', import.meta.url),
  'utf8',
);
const videoDownloaderToolSource = readFileSync(
  new URL('../components/VideoDownloaderTool.tsx', import.meta.url),
  'utf8',
);
const transcribeToolSource = readFileSync(
  new URL('../components/TranscribeTool.tsx', import.meta.url),
  'utf8',
);
const mediaFetchEndpointSource = readFileSync(
  new URL('../lib/media-fetch-endpoint.ts', import.meta.url),
  'utf8',
);
const sharedToolRouteSource = readFileSync(
  new URL('../app/(convert)/[tool]/page.tsx', import.meta.url),
  'utf8',
);
const mediaFetchRouteSource = readFileSync(
  new URL('../app/api/media-fetch/route.ts', import.meta.url),
  'utf8',
);

test('all active download tools use the shared rate-limited downloader path', () => {
  const activeDownloadTools = toolCatalog.activeTools.filter(
    (tool) => tool.operation === 'download',
  );
  assert.ok(
    activeDownloadTools.length > 0,
    'expected at least one active download tool',
  );

  assert.match(downloaderTemplateSource, /DownloaderPageHero/);
  assert.match(downloaderTemplateSource, /DownloaderExtensionCTA/);
  assert.match(downloaderHeroSource, /VideoDownloaderTool/);
  assert.match(sharedToolRouteSource, /DownloaderPageRenderer/);
  assert.match(
    videoDownloaderToolSource,
    /consumer:\s*DOWNLOADER_CONSUMER|consumer:\s*"downloader"/,
  );
  assert.match(
    videoDownloaderToolSource,
    /createDownloaderRequestHeaders|DOWNLOADER_CLIENT_ID_HEADER|x-serp-downloader-client-id/,
  );
  assert.match(
    videoDownloaderToolSource,
    /getDownloaderMediaFetchEndpoint\(\)/,
  );
  assert.doesNotMatch(videoDownloaderToolSource, /fetch\("\/api\/media-fetch"/);
  assert.match(
    mediaFetchRouteSource,
    /payload\.consumer === DOWNLOADER_CONSUMER|consumer === DOWNLOADER_CONSUMER/,
  );
  assert.match(
    mediaFetchRouteSource,
    /createDownloaderCooldownCookieCodec|DOWNLOADER_RATE_LIMIT_COOKIE/,
  );

  for (const tool of activeDownloadTools) {
    assert.equal(selectToolRenderer(tool), 'downloader');
    assert.match(
      tool.route,
      /^\/(video-downloader|download-[a-z0-9-]+-videos)$/,
      `expected downloader route naming convention for ${tool.id}`,
    );
  }
});

test('media fetch calls support a public endpoint override', () => {
  assert.match(mediaFetchEndpointSource, /NEXT_PUBLIC_MEDIA_FETCH_ENDPOINT/);
  assert.match(
    mediaFetchEndpointSource,
    /NEXT_PUBLIC_DOWNLOADER_MEDIA_FETCH_ENDPOINT/,
  );
  assert.match(
    mediaFetchEndpointSource,
    /DEFAULT_MEDIA_FETCH_ENDPOINT = "\/api\/media-fetch"/,
  );
  assert.match(videoDownloaderToolSource, /getDownloaderMediaFetchEndpoint/);
  assert.match(transcribeToolSource, /getMediaFetchEndpoint/);
  assert.doesNotMatch(transcribeToolSource, /fetch\("\/api\/media-fetch"/);
});

test('downloader media fetches can be disabled before expensive server work', () => {
  assert.match(
    mediaFetchRouteSource,
    /FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY_ENABLED/,
  );
  assert.match(mediaFetchRouteSource, /FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY/);
  assert.doesNotMatch(
    mediaFetchRouteSource,
    /NEXT_PUBLIC_FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY/,
  );
  assert.match(mediaFetchRouteSource, /buildDownloaderExtensionOnlyResponse/);
  assert.match(mediaFetchRouteSource, /extensionRequired: true/);
  assert.match(
    mediaFetchRouteSource,
    /shouldRateLimitDownloader\(payload\) && FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY_ENABLED/,
  );
  assert.match(
    mediaFetchRouteSource,
    /This website requires a browser extension to download from\./,
  );
});
