export type TableData = {
  headers: string[];
  rows: string[][];
};

export type FormatOption = { value: string; label: string };

export type InputFormat =
  | "csv"
  | "excel"
  | "json"
  | "markdown"
  | "html"
  | "sql"
  | "latex"
  | "xml"
  | "yaml"
  | "mysql"
  | "mediawiki";

export type OutputFormat =
  | "json"
  | "csv"
  | "jsonlines"
  | "markdown"
  | "html"
  | "sql"
  | "mysql"
  | "xml"
  | "yaml"
  | "latex"
  | "mediawiki"
  | "ascii"
  | "asciidoc"
  | "actionscript"
  | "asp"
  | "avro"
  | "bbcode"
  | "dax"
  | "firebase"
  | "ini"
  | "jira"
  | "matlab"
  | "pandasdataframe"
  | "php"
  | "protobuf"
  | "qlik"
  | "rdataframe"
  | "rdf"
  | "restructuredtext"
  | "ruby"
  | "magic"
  | "textile"
  | "toml"
  | "tracwiki"
  | "excel"
  | "pdf"
  | "png"
  | "jpeg";

export type ViewMode = "raw" | "preview";
