# Triage labels

The installed engineering skills use these exact GitHub label names.

| Role               | Tracker label     | Meaning                                                                            |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| Needs triage       | `needs-triage`    | A maintainer must classify the work and choose its next state.                     |
| Needs information  | `needs-info`      | Material information is missing before the work can proceed.                       |
| Ready for agent    | `ready-for-agent` | Decisions and acceptance criteria are complete enough for an implementation agent. |
| Ready for human    | `ready-for-human` | Human judgment or privileged action is the next required step.                     |
| Will not implement | `wontfix`         | The repository has intentionally decided not to pursue the work.                   |

Readiness does not override native blockers. A `ready-for-agent` issue enters the
implementation frontier only when every blocking issue is closed.
