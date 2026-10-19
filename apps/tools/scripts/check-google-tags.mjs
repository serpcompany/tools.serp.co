// Checks that each Google tag the site's GTM container loads answers 200
// (lib/google-tags.mjs). It exits 1 on a failure and 0 on a pass or warning.
// The Deploy workflow runs it as its own step, after the deploy's smoke
// tests: the container changes in Tag Manager, not in a deploy, so a broken
// tag mustn't skip them.
import { GTM_CONTAINER, checkGoogleTags, outcomeReport } from "./lib/google-tags.mjs";

const outcome = await checkGoogleTags(GTM_CONTAINER, {
  headers: { "user-agent": "tools-serp-google-tag-check/1.0" },
});
const { lines, exitCode } = outcomeReport(outcome, {
  githubActions: Boolean(process.env.GITHUB_ACTIONS),
});
for (const line of lines) console.log(line);
process.exitCode = exitCode;
