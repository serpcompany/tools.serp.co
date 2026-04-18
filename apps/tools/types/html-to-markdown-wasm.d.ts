declare module "@kreuzberg/html-to-markdown-wasm/dist-web" {
  export type HtmlToMarkdownResult = {
    content: string | null;
  };

  export type HtmlToMarkdownConverter = (
    html: string,
    options: null,
  ) => HtmlToMarkdownResult;

  const init: () => Promise<void>;
  export const convert: HtmlToMarkdownConverter;
  export default init;
}
