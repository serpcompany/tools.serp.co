// The type of gone-tool-routes.generated.js, which scripts/gone-tool-routes.mjs
// writes before every build and dev run and git ignores (issue #322): the
// canonical routes of the retired Tools that answer 410 Gone. Typecheck reads
// this file, so it passes before the list exists; a build without the list
// fails to resolve the import instead of serving no 410s.
declare const goneToolRoutes: readonly string[];
export default goneToolRoutes;
