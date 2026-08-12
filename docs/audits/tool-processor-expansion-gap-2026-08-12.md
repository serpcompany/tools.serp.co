# Tool processor expansion-gap evidence

This report indexes the deterministic JSON projection produced for GitHub issue
#87. Its portfolio baseline is exact revision
`d3e6c4c44af0d0a6a8e243f4a4e61963bb838e87`.

This is local, versioned planning and controlled-capability evidence. Production was not queried,
and no deployed availability or runtime health is asserted.
Planning assumptions are not measured evidence.

## Portfolio invariant

- 2,807 active Tool ids
- 426 supported | 2,378 unsupported | 0 unwired | 3 unknown
- Active membership: `sha256:fadb77ac2e1c68c14863a3ebd4ca43cde6692e9bde72bfacaf1026b8baeda030`

| Gap partition | Count |
| --- | ---: |
| Conversion gaps | 2,358 |
| Compression gaps | 20 |

Every active Tool appears exactly once in JSON at `/rows`. Exact disposition
memberships live at `/portfolio/toolIdsByDisposition`; individual facts name
their source, while feasibility and priority live separately under `planning`.

## Unsupported index by renderer

| Key | Count | Membership SHA-256 | JSON pointer |
| --- | ---: | --- | --- |
| generic | 2,319 | `sha256:013a58c80d836d2b58e78b01f0e2b22a8aa268bc557b86cd4d6d9180d7f5dd2a` | `/unsupportedGroups/byRenderer/0` |
| table | 59 | `sha256:2936fc66bd03ae62df50046f33fb513483c02f10ecca420ab5612003c2aaa787` | `/unsupportedGroups/byRenderer/1` |

## Unsupported index by exact dispatch/capability

| Key | Count | Membership SHA-256 | JSON pointer |
| --- | ---: | --- | --- |
| compression:audio:dispatch-present | 6 | `sha256:9bf0d374244e93372ff1ead7b087dff2f43eb30d7248b3cafdf4da9292345d9a` | `/unsupportedGroups/byExactDispatchCapability/0` |
| compression:image-server:dispatch-present | 7 | `sha256:ad8448d06d533c1c0898cd307cd629490fb6974e3dc9bfc0c09f15a447955d24` | `/unsupportedGroups/byExactDispatchCapability/1` |
| compression:pdf:dispatch-present | 1 | `sha256:a4a78994d9b9224e35f9d0ec9c3eb6d35f6cd8c9fdd7eb2203311226d054b3c7` | `/unsupportedGroups/byExactDispatchCapability/2` |
| compression:video:dispatch-present | 6 | `sha256:420666be9731b6d4f530f2812e9c11900d663e5a3d271c3868d1ecc059563a1b` | `/unsupportedGroups/byExactDispatchCapability/3` |
| conversion:adaptive-video:exact-capability | 1,487 | `sha256:d8ccb1782d464bf883f89a308072f57740992758f16fd3bdeedfd42226a95694` | `/unsupportedGroups/byExactDispatchCapability/4` |
| conversion:adaptive-video:no-exact-capability | 18 | `sha256:1e95ee8f73ce949a7b61abce714116f58329e5868587545757f2035eebc5500c` | `/unsupportedGroups/byExactDispatchCapability/5` |
| conversion:browser-pdf-pages:no-exact-capability | 18 | `sha256:db5f5841088f5df89cfc317297c68eba785f320570c7c3b225fd71ab8ca9e618` | `/unsupportedGroups/byExactDispatchCapability/6` |
| conversion:browser-raster:exact-capability | 37 | `sha256:38c5ebcc7596d1c66ffb12476f9c6722f59c9ceba6de301064325ffc3fdb84fd` | `/unsupportedGroups/byExactDispatchCapability/7` |
| conversion:browser-raster:no-exact-capability | 554 | `sha256:21fb34b0aeaefd0d1b249411cab99bf10794700dfc1543e35f54f862c9fec380` | `/unsupportedGroups/byExactDispatchCapability/8` |
| conversion:server-assisted-image:exact-capability | 7 | `sha256:c9e8556460ffcdddfeeec8155aedb48bf26ef593b4fabb251ca74bf92fa61555` | `/unsupportedGroups/byExactDispatchCapability/9` |
| conversion:server-assisted-image:no-exact-capability | 94 | `sha256:6c25ecfb5e9d4651e5acc94f0552c4bdf5871c967c7b3d5b8571319aac5f59c1` | `/unsupportedGroups/byExactDispatchCapability/10` |
| conversion:server-image:exact-capability | 84 | `sha256:7cb7c5b44fef2f23f3b4b2930818a07699c57a5992e1e14afe4c01c31ec20b95` | `/unsupportedGroups/byExactDispatchCapability/11` |
| table:unsupported:actionscript | 2 | `sha256:f6d29b4695a05fe7d396f1cb57a6b0f2bf2513fdb75c5922a53c043d0b81676e` | `/unsupportedGroups/byExactDispatchCapability/12` |
| table:unsupported:ascii | 2 | `sha256:bb863680e41b689a0bcf8228d112173da61e6ba5020f8e98e2c403f4fdf31b7c` | `/unsupportedGroups/byExactDispatchCapability/13` |
| table:unsupported:asciidoc | 2 | `sha256:7f29bc5656a97b139f6e0fdcb6a0f91132932e99cf47e553bc92c83e1c0ea16b` | `/unsupportedGroups/byExactDispatchCapability/14` |
| table:unsupported:asp | 2 | `sha256:967fb539b14d1afc45cb4b0ba399659b93af2bcb59f358023f7a8b80471cd89b` | `/unsupportedGroups/byExactDispatchCapability/15` |
| table:unsupported:avro | 2 | `sha256:0c92c66cd94a282aeeccffecfd95200f512629a8f74f6bef05ce9c6a57c3f0d3` | `/unsupportedGroups/byExactDispatchCapability/16` |
| table:unsupported:bbcode | 2 | `sha256:d7c9ac136aa9472b8abbc60a178d8a4c70fa883daf291375d7df92a2165ca863` | `/unsupportedGroups/byExactDispatchCapability/17` |
| table:unsupported:dax | 2 | `sha256:52dea75d5aad3b48ecb2471f60ab91a2db9187498b780784ad5d83efedfb6e96` | `/unsupportedGroups/byExactDispatchCapability/18` |
| table:unsupported:firebase | 2 | `sha256:3c998c19c28bdb8c75af457bf85a10ea28d0f3226c5a496e71d5d57cf2414c0d` | `/unsupportedGroups/byExactDispatchCapability/19` |
| table:unsupported:ini | 2 | `sha256:c213e11a12882b956da0f36f1c418194594f69e3a4e737f3b8fd80aec2fcb411` | `/unsupportedGroups/byExactDispatchCapability/20` |
| table:unsupported:jira | 2 | `sha256:18b080d8424ed343ea3c3bec4590aa1beca1e486db3bd87b1e8e56ae31e30c9f` | `/unsupportedGroups/byExactDispatchCapability/21` |
| table:unsupported:jpeg | 6 | `sha256:9de84c8d8411ef1872f8fe10049522b7578ee65676c8f970d66f804a97db07b7` | `/unsupportedGroups/byExactDispatchCapability/22` |
| table:unsupported:magic | 2 | `sha256:e12b0e5715a6b1001ce9ff7e97269f97027a16d2cc092a6bdc643f583f04fd62` | `/unsupportedGroups/byExactDispatchCapability/23` |
| table:unsupported:matlab | 2 | `sha256:4824359ce93bbea0931b8c4fb1300bb4ebeca42217b6445b6a03e62ef16fe8f5` | `/unsupportedGroups/byExactDispatchCapability/24` |
| table:unsupported:pandasdataframe | 2 | `sha256:1079e8390e069c8b0cb395aa9da2edfe9eb804fdd4e64933443893f4ea953569` | `/unsupportedGroups/byExactDispatchCapability/25` |
| table:unsupported:php | 2 | `sha256:f03c798f6a76a796bebc5720e12e9a51e106af1c952386449320f0cdd2210bae` | `/unsupportedGroups/byExactDispatchCapability/26` |
| table:unsupported:png | 7 | `sha256:4717a03f492500922d7e60d48de2e4e3c7db39b3a55e26dad091c005b1318087` | `/unsupportedGroups/byExactDispatchCapability/27` |
| table:unsupported:protobuf | 2 | `sha256:72c1ba2c98fa0fc761d52485de0b50d192d4d801951bbcbdc29951b65b1ba476` | `/unsupportedGroups/byExactDispatchCapability/28` |
| table:unsupported:qlik | 2 | `sha256:ec82b3c616ae8769dcab18784a9a41a1b5e6bb3c531fce65b6cc0e96a08fe2b2` | `/unsupportedGroups/byExactDispatchCapability/29` |
| table:unsupported:rdataframe | 2 | `sha256:89461110463da5a5dda22bf8a001602808daeb798af41dc79759fd7a1ac8f774` | `/unsupportedGroups/byExactDispatchCapability/30` |
| table:unsupported:rdf | 2 | `sha256:97f1fbafbf5fe483894beb45a259855bb146de242d4a52de85fca1b5aeabaf0f` | `/unsupportedGroups/byExactDispatchCapability/31` |
| table:unsupported:restructuredtext | 2 | `sha256:ff8e6566f2e16ee3e7f8d57f44e6ca6f190cf178d134bf68191232ce72a6d5d6` | `/unsupportedGroups/byExactDispatchCapability/32` |
| table:unsupported:ruby | 2 | `sha256:58a7f8bf758fc121a14b45307e384d3a19b3b3372b286a15b213344601bdcbf8` | `/unsupportedGroups/byExactDispatchCapability/33` |
| table:unsupported:textile | 2 | `sha256:ffe28150f99e7823266d4ef62f91181ff22d6c7a2b184a8ee0b24b373dd95585` | `/unsupportedGroups/byExactDispatchCapability/34` |
| table:unsupported:toml | 2 | `sha256:60036d223e5793107beba834d466d86edfefc876904a7af0fbeb7f507eca3345` | `/unsupportedGroups/byExactDispatchCapability/35` |
| table:unsupported:tracwiki | 2 | `sha256:56ea8356a1b8bb69777c263eab45f355685f6f13126d63fe58d6359b907a8ea0` | `/unsupportedGroups/byExactDispatchCapability/36` |

## Unsupported index by input/output family

| Key | Count | Membership SHA-256 | JSON pointer |
| --- | ---: | --- | --- |
| audio->audio | 295 | `sha256:8e8d4190efe79736ebe3334c0f19c09260068a0b4f78afa4891c0983b0b1686a` | `/unsupportedGroups/byInputOutputFamily/0` |
| audio->video | 4 | `sha256:d4b7f42cfc726eccb5ae72eac1f986df12a4914a90e5fc8e9b519503af158c81` | `/unsupportedGroups/byInputOutputFamily/1` |
| document->document | 2 | `sha256:b522fb39fb688c398e0b4437c017a942a06ee23ed4f51619582bb3695fbf2f9a` | `/unsupportedGroups/byInputOutputFamily/2` |
| document->raster-image | 17 | `sha256:7ba79034d7b1f344c952b80f9e9e7a95ae8328776f9ec525205819c7ee2e4bc9` | `/unsupportedGroups/byInputOutputFamily/3` |
| raster-image->document | 17 | `sha256:16c6acdcac6b239d07367ef06a5feeafb62f8e731a2cdd1f5d2088d6397b4fab` | `/unsupportedGroups/byInputOutputFamily/4` |
| raster-image->raster-image | 652 | `sha256:bcf0d0715492f663d56817f12f16f2f3ae4a26a47106d11dae30de652c783ec9` | `/unsupportedGroups/byInputOutputFamily/5` |
| raster-image->specialized-or-unclassified | 34 | `sha256:148e1eaa95050b1f01718068e9f3a0bbb83beaec72a4739ff5aa38dfaa2a7d6c` | `/unsupportedGroups/byInputOutputFamily/6` |
| raster-image->video | 8 | `sha256:9bc948a3609dc88e16b0c87e6f6940e4443ba1932043ee1955c3c8a9bcfc7685` | `/unsupportedGroups/byInputOutputFamily/7` |
| specialized-or-unclassified->audio | 7 | `sha256:9e84b1b9907d5bbefd425f1b127f7f5324fd6ec1ebe5ddf838cdb97d3dbb1570` | `/unsupportedGroups/byInputOutputFamily/8` |
| specialized-or-unclassified->raster-image | 80 | `sha256:f5a8cdcfa54e06666c2e5dcc5ff0368815b0430a7f01d44b3d98514a3824477c` | `/unsupportedGroups/byInputOutputFamily/9` |
| specialized-or-unclassified->video | 6 | `sha256:4a658758e732da89d1a7bde27f724b4c151dabe86767d51962ccf158b21b5aea` | `/unsupportedGroups/byInputOutputFamily/10` |
| structured-data->structured-data | 59 | `sha256:2936fc66bd03ae62df50046f33fb513483c02f10ecca420ab5612003c2aaa787` | `/unsupportedGroups/byInputOutputFamily/11` |
| video->audio | 476 | `sha256:e4432df22a152ed8b7877ff4789bc649234af6f1570d0543235cd2464acb6760` | `/unsupportedGroups/byInputOutputFamily/12` |
| video->raster-image | 29 | `sha256:021e897e955e0691e804c157eff2d9634b7754c27cd2ed4a3f382374d6204847` | `/unsupportedGroups/byInputOutputFamily/13` |
| video->video | 692 | `sha256:826f38c7d3637be52413ab549464ec639fc8f50e712d5eb443281af8bb92adb2` | `/unsupportedGroups/byInputOutputFamily/14` |

## Unsupported index by processor family

| Key | Count | Membership SHA-256 | JSON pointer |
| --- | ---: | --- | --- |
| generic-compress:audio | 6 | `sha256:9bf0d374244e93372ff1ead7b087dff2f43eb30d7248b3cafdf4da9292345d9a` | `/unsupportedGroups/byProcessorFamily/0` |
| generic-compress:image-server | 7 | `sha256:ad8448d06d533c1c0898cd307cd629490fb6974e3dc9bfc0c09f15a447955d24` | `/unsupportedGroups/byProcessorFamily/1` |
| generic-compress:pdf | 1 | `sha256:a4a78994d9b9224e35f9d0ec9c3eb6d35f6cd8c9fdd7eb2203311226d054b3c7` | `/unsupportedGroups/byProcessorFamily/2` |
| generic-compress:video | 6 | `sha256:420666be9731b6d4f530f2812e9c11900d663e5a3d271c3868d1ecc059563a1b` | `/unsupportedGroups/byProcessorFamily/3` |
| generic-convert:adaptive-video | 1,505 | `sha256:40623d84a0d29c27f1a24f980dd27c5775a1bb5161b63250860ba5d5fbc42629` | `/unsupportedGroups/byProcessorFamily/4` |
| generic-convert:browser-pdf-pages | 18 | `sha256:db5f5841088f5df89cfc317297c68eba785f320570c7c3b225fd71ab8ca9e618` | `/unsupportedGroups/byProcessorFamily/5` |
| generic-convert:browser-raster | 591 | `sha256:762875eceb26047a1ca143250f0693ac27f0c508242a8ef437f761d1f9d28424` | `/unsupportedGroups/byProcessorFamily/6` |
| generic-convert:server-assisted-image | 101 | `sha256:5675f74ad40a851258cc69f28f07bc4b291a5c8a6d68e499342981e97a9f773d` | `/unsupportedGroups/byProcessorFamily/7` |
| generic-convert:server-image | 84 | `sha256:7cb7c5b44fef2f23f3b4b2930818a07699c57a5992e1e14afe4c01c31ec20b95` | `/unsupportedGroups/byProcessorFamily/8` |
| table-output:actionscript | 2 | `sha256:f6d29b4695a05fe7d396f1cb57a6b0f2bf2513fdb75c5922a53c043d0b81676e` | `/unsupportedGroups/byProcessorFamily/9` |
| table-output:ascii | 2 | `sha256:bb863680e41b689a0bcf8228d112173da61e6ba5020f8e98e2c403f4fdf31b7c` | `/unsupportedGroups/byProcessorFamily/10` |
| table-output:asciidoc | 2 | `sha256:7f29bc5656a97b139f6e0fdcb6a0f91132932e99cf47e553bc92c83e1c0ea16b` | `/unsupportedGroups/byProcessorFamily/11` |
| table-output:asp | 2 | `sha256:967fb539b14d1afc45cb4b0ba399659b93af2bcb59f358023f7a8b80471cd89b` | `/unsupportedGroups/byProcessorFamily/12` |
| table-output:avro | 2 | `sha256:0c92c66cd94a282aeeccffecfd95200f512629a8f74f6bef05ce9c6a57c3f0d3` | `/unsupportedGroups/byProcessorFamily/13` |
| table-output:bbcode | 2 | `sha256:d7c9ac136aa9472b8abbc60a178d8a4c70fa883daf291375d7df92a2165ca863` | `/unsupportedGroups/byProcessorFamily/14` |
| table-output:dax | 2 | `sha256:52dea75d5aad3b48ecb2471f60ab91a2db9187498b780784ad5d83efedfb6e96` | `/unsupportedGroups/byProcessorFamily/15` |
| table-output:firebase | 2 | `sha256:3c998c19c28bdb8c75af457bf85a10ea28d0f3226c5a496e71d5d57cf2414c0d` | `/unsupportedGroups/byProcessorFamily/16` |
| table-output:ini | 2 | `sha256:c213e11a12882b956da0f36f1c418194594f69e3a4e737f3b8fd80aec2fcb411` | `/unsupportedGroups/byProcessorFamily/17` |
| table-output:jira | 2 | `sha256:18b080d8424ed343ea3c3bec4590aa1beca1e486db3bd87b1e8e56ae31e30c9f` | `/unsupportedGroups/byProcessorFamily/18` |
| table-output:jpeg | 6 | `sha256:9de84c8d8411ef1872f8fe10049522b7578ee65676c8f970d66f804a97db07b7` | `/unsupportedGroups/byProcessorFamily/19` |
| table-output:magic | 2 | `sha256:e12b0e5715a6b1001ce9ff7e97269f97027a16d2cc092a6bdc643f583f04fd62` | `/unsupportedGroups/byProcessorFamily/20` |
| table-output:matlab | 2 | `sha256:4824359ce93bbea0931b8c4fb1300bb4ebeca42217b6445b6a03e62ef16fe8f5` | `/unsupportedGroups/byProcessorFamily/21` |
| table-output:pandasdataframe | 2 | `sha256:1079e8390e069c8b0cb395aa9da2edfe9eb804fdd4e64933443893f4ea953569` | `/unsupportedGroups/byProcessorFamily/22` |
| table-output:php | 2 | `sha256:f03c798f6a76a796bebc5720e12e9a51e106af1c952386449320f0cdd2210bae` | `/unsupportedGroups/byProcessorFamily/23` |
| table-output:png | 7 | `sha256:4717a03f492500922d7e60d48de2e4e3c7db39b3a55e26dad091c005b1318087` | `/unsupportedGroups/byProcessorFamily/24` |
| table-output:protobuf | 2 | `sha256:72c1ba2c98fa0fc761d52485de0b50d192d4d801951bbcbdc29951b65b1ba476` | `/unsupportedGroups/byProcessorFamily/25` |
| table-output:qlik | 2 | `sha256:ec82b3c616ae8769dcab18784a9a41a1b5e6bb3c531fce65b6cc0e96a08fe2b2` | `/unsupportedGroups/byProcessorFamily/26` |
| table-output:rdataframe | 2 | `sha256:89461110463da5a5dda22bf8a001602808daeb798af41dc79759fd7a1ac8f774` | `/unsupportedGroups/byProcessorFamily/27` |
| table-output:rdf | 2 | `sha256:97f1fbafbf5fe483894beb45a259855bb146de242d4a52de85fca1b5aeabaf0f` | `/unsupportedGroups/byProcessorFamily/28` |
| table-output:restructuredtext | 2 | `sha256:ff8e6566f2e16ee3e7f8d57f44e6ca6f190cf178d134bf68191232ce72a6d5d6` | `/unsupportedGroups/byProcessorFamily/29` |
| table-output:ruby | 2 | `sha256:58a7f8bf758fc121a14b45307e384d3a19b3b3372b286a15b213344601bdcbf8` | `/unsupportedGroups/byProcessorFamily/30` |
| table-output:textile | 2 | `sha256:ffe28150f99e7823266d4ef62f91181ff22d6c7a2b184a8ee0b24b373dd95585` | `/unsupportedGroups/byProcessorFamily/31` |
| table-output:toml | 2 | `sha256:60036d223e5793107beba834d466d86edfefc876904a7af0fbeb7f507eca3345` | `/unsupportedGroups/byProcessorFamily/32` |
| table-output:tracwiki | 2 | `sha256:56ea8356a1b8bb69777c263eab45f355685f6f13126d63fe58d6359b907a8ea0` | `/unsupportedGroups/byProcessorFamily/33` |

## Feasibility assumptions

These classifications are a deterministic planning policy, not proof that an
engine supports an exact Tool operation.

| Classification | Gap Tool ids |
| --- | ---: |
| existing-maintained-engine | 1,628 |
| invalid-or-duplicate-catalog-intent | 21 |
| native-or-server-infrastructure | 282 |
| new-maintained-dependency | 59 |
| unresolved | 391 |

## Three bounded candidate waves

### Verify the bounded browser-raster gap

- Candidate id: `browser-raster-exact-capability`
- Exact membership: 34 Tool ids (`sha256:1ad87bc5fb7daa89db8bb08e31d9a78dc4acc6896c4b5bf8bf060f19b79613bd`)
- Expected controlled coverage delta: +34; 426 → 460 if and only if every member passes the family acceptance gate
- Dependencies: Existing browser-raster-worker dispatch; Exact MIME and semantic validator contracts
- Risks: Platform decoder/encoder variation; Same-format Catalog duplicates require exclusion or retirement review
- Semantic-test strategy: For each retained pair, use real positive fixtures plus spoofed, malformed, empty, truncated, and wrong-format outputs; validate decoded dimensions/content before delivery.
- Exact sorted Tool ids: `avif-to-jpeg`, `avif-to-jpg`, `avif-to-png`, `avif-to-svg`, `avif-to-webp`, `bmp-to-jpeg`, `bmp-to-jpg`, `bmp-to-pdf`, `bmp-to-png`, `bmp-to-svg`, `bmp-to-webp`, `heic-to-svg`, `heif-to-jpg`, `heif-to-pdf`, `heif-to-png`, `heif-to-webp`, `ico-to-jpg`, `ico-to-pdf`, `ico-to-png`, `ico-to-svg`, `ico-to-webp`, `jpeg-to-avif`, `jpeg-to-svg`, `jpg-to-avif`, `jpg-to-svg`, `png-to-avif`, `png-to-svg`, `svg-to-avif`, `svg-to-jpeg`, `svg-to-jpg`, `svg-to-pdf`, `svg-to-png`, `svg-to-webp`, `webp-to-svg`

### Adopt and prove a table-to-raster semantic validator

- Candidate id: `table-raster-semantic-validator`
- Exact membership: 13 Tool ids (`sha256:b9c5d9a8af1c6886d2975366db6d5a25c3fdc6dc9c9801a5b25339749d2a3167`)
- Expected controlled coverage delta: +13; 426 → 439 if and only if every member passes the family acceptance gate
- Dependencies: Maintained table renderer or serializer; Independent visible-content validator
- Risks: A decodable image can still omit columns or rows; Font and layout variation can make pixel snapshots brittle
- Semantic-test strategy: Decode the raster independently and verify visible headers, cells, row cardinality, dimensions, and truncation behavior across positive, malformed, oversized, and cancellation fixtures.
- Exact sorted Tool ids: `csv-to-jpeg`, `csv-to-png`, `excel-to-png`, `html-to-jpeg`, `html-to-png`, `json-to-jpeg`, `json-to-png`, `latex-to-jpeg`, `latex-to-png`, `markdown-to-jpeg`, `markdown-to-png`, `xml-to-jpeg`, `xml-to-png`

### Prove the exact server-image conversion family

- Candidate id: `server-image-exact-capability`
- Exact membership: 80 Tool ids (`sha256:8d0e6a995ae6939bc623d954266d2ee071e70726b4a17a8d43874e15e1463f48`)
- Expected controlled coverage delta: +80; 426 → 506 if and only if every member passes the family acceptance gate
- Dependencies: Existing server-image-convert dispatch; Authorized compatible runtime decision before registration
- Risks: Native binaries are not implied Cloudflare-compatible; High memory inputs and malformed image parser exposure
- Semantic-test strategy: Use format-specific decode and metadata assertions on real and adversarial fixtures, enforce byte/pixel limits, and require authorized preview evidence for the chosen server runtime.
- Exact sorted Tool ids: `apng-to-gif`, `arw-to-bmp`, `arw-to-dds`, `arw-to-gif`, `arw-to-jpeg`, `arw-to-jpg`, `arw-to-png`, `arw-to-svg`, `arw-to-tga`, `arw-to-tif`, `arw-to-tiff`, `arw-to-webp`, `cr2-to-cur`, `cr2-to-dds`, `cr2-to-gif`, `cr2-to-ico`, `cr2-to-jpeg`, `cr2-to-jpg`, `cr2-to-png`, `cr2-to-svg`, `cr2-to-tga`, `cr2-to-tif`, `cr2-to-tiff`, `cr2-to-webp`, `cr3-to-cur`, `cr3-to-dds`, `cr3-to-gif`, `cr3-to-ico`, `cr3-to-jpeg`, `cr3-to-jpg`, `cr3-to-png`, `cr3-to-svg`, `cr3-to-tga`, `cr3-to-tif`, `cr3-to-tiff`, `cr3-to-webp`, `dds-to-gif`, `dds-to-ico`, `dds-to-jpeg`, `dds-to-jpg`, `dds-to-png`, `dds-to-svg`, `dds-to-tif`, `dds-to-tiff`, `dds-to-webp`, `dng-to-gif`, `dng-to-ico`, `dng-to-jpeg`, `dng-to-jpg`, `dng-to-png`, `dng-to-svg`, `dng-to-tga`, `dng-to-tif`, `dng-to-tiff`, `dng-to-webp`, `psd-to-gif`, `psd-to-jpeg`, `psd-to-jpg`, `psd-to-png`, `psd-to-svg`, `psd-to-webp`, `tga-to-jpg`, `tga-to-png`, `tga-to-tif`, `tga-to-tiff`, `tga-to-webp`, `tif-to-jpg`, `tif-to-png`, `tif-to-tiff`, `tif-to-webp`, `tiff-to-gif`, `tiff-to-jpeg`, `tiff-to-jpg`, `tiff-to-png`, `tiff-to-svg`, `tiff-to-webp`, `xcf-to-jpeg`, `xcf-to-jpg`, `xcf-to-png`, `xcf-to-svg`

## Reproduction

From a fresh clone at a revision whose consumed product inputs match the
accepted baseline, using the supported Node runtime:

```sh
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision 8413e508494c345f42ccebdd50f713e3aa1af4df --format json
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision 8413e508494c345f42ccebdd50f713e3aa1af4df --format report
```

The JSON projection is the complete read model. This Markdown document is its
concise human index; hashes make Catalog membership drift loud.
