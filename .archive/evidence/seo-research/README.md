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
is the first source of `apps/tools/data/keywords.csv`, which
`pnpm -C apps/tools keywords` builds from it (issue #232). Keep it unchanged so
that file can be rebuilt.
