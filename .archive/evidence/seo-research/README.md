# SEO research exports

The CSV files in this directory are retained advisory keyword, file-format,
competitor, and website research. They were collected before GitHub issue #54;
the files do not consistently record observation time, query method, or source
revision.

They may suggest future research but do not establish shipped Tool catalog
intent, implementation capability, verification, runtime health, or active
work. Revalidate source availability and licensing before reuse, and create or
update a GitHub issue before turning a row into implementation work.

`kwr_tools.csv`, 1,634 conversion keywords from a January 2026 Ahrefs export,
was here too. `pnpm -C apps/tools keywords` builds `apps/tools/data/keywords.csv`
from it, so it moved to `apps/tools/data/sources/ahrefs-2026-01-kwr-tools.csv`
(issue #232).
