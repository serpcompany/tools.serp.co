# SVG compression preview proof — 2026-08-14

This is historical owner-review evidence for GitHub issue #136. Current
behavior remains authoritative only through retained Tool Journey evidence and
its Tool Factory projection.

- Preview revision: `057ea26d0e391ca82d648676c2092b5a2f327a6a`
- Preview Tool: <https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev/compress-svg>
- Browser run: `20260814T163951Z_057ea26_pull-request_browser-smoke-preview-subset`
- Result: passed with all eight required journey checks
- Downloadable output: [optimized SVG](./svg-compression-preview-output-2026-08-14.svg)
- Raw browser output SHA-256: `19d525f25a7a218e0cc491d39338797fa30faa5182846ed7938e7a3f82d6f187`
- Review copy SHA-256: `1ef20aca8b17e86577e20d5ec4a4e9a62f523d7194de15b17cf614d0d1e9a54d`
- Captured preview screenshot SHA-256: `84932973a3dfcf4776dc2d772242abedb062d8d059165f129ddcef31f4cf0bd7`

The output was captured by the browser proof through its caller-owned
`GOLDEN_OUTPUT_DIR`; it was not appended to the structured run-artifact store.
The review copy adds one final newline for repository text-file hygiene; its
SVG content is otherwise byte-for-byte identical to the raw browser output.
The independent proof parsed the input and output without SVGO, rendered both
at two bounded viewports, compared pixels and referenced identifiers, confirmed
one dedicated same-origin Worker, reran deterministically, and exercised the
honest no-op fixture. The retained negative-path proof separately rejected
malformed and spoofed input, wrong-format and unsafe processor output, released
the active Worker once, ignored its late result, cancelled in-flight browser
delivery, released its object URL once, and produced no delivery click.

This proves one fixed Tool Journey. It is not a claim about arbitrary SVG safety
or the remaining unsupported Tool portfolio.
