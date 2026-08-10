# Issue tracker: GitHub Issues

GitHub Issues is the sole authority for active work in this repository. Plans,
acceptance criteria, blockers, readiness, ownership, and implementation progress
belong in issues rather than duplicate repository plan documents.

## Work relationships

- Use native sub-issues to split a specification into implementation tickets.
- Use native issue dependencies for blocking relationships. A ticket is on the
  implementation frontier only when all of its blockers are closed.
- Use registry Tool ids in work concerning specific Tools. State an explicit
  portfolio scope when work is not limited to named Tools.
- Pull requests and commits provide implementation evidence; they do not replace
  the originating issue or prove that behavior is deployed.

## Authority boundary

Agents may implement and verify ready work within the authority granted by an
issue. Humans retain control of merge, production deployment, secrets, remote
production migrations, and destructive infrastructure or data operations.

When an installed skill says to publish to or fetch from the issue tracker, use
this repository's GitHub Issues tracker.
