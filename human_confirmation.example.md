# Human Confirmation Queue
curl -u "sunchenhui:123456" -X GET "http://139.9.215.174:8081/rest/api/2/issue/TEST-1"
This file is read by `magpie loop` for human-gated decisions.

Rules for operators:
- Only change `decision` and `rationale`.
- Keep all markers/keys unchanged.
- Supported `decision`: `pending`, `approved`, `rejected`, `revise`.

<!-- MAGPIE_HUMAN_CONFIRMATION_START -->

```yaml
id: hc-example-001
session_id: session-example-001
stage: trd_generation
status: pending
decision: pending
rationale: ""
reason: "Low confidence on cross-domain contract decisions"
artifacts:
  - "/absolute/path/to/.magpie/loop-sessions/session-example-001/trd_generation.md"
  - "/absolute/path/to/checkout.trd.md"
next_action: "Review risks, then set decision to approved/rejected/revise"
created_at: "2026-03-06T00:00:00.000Z"
updated_at: "2026-03-06T00:00:00.000Z"
```

<!-- MAGPIE_HUMAN_CONFIRMATION_END -->
