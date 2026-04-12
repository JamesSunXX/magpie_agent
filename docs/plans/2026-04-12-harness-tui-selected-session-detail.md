# Harness TUI Selected Session Detail

## Summary

When a harness session is selected in TUI, the operator should get a supplementary summary area that explains the latest relevant round without leaving the dashboard.

## In Scope

- latest or selected round action
- participants
- reviewer notes
- arbitration summary
- next-round brief

## Out of Scope

- full transcript browsing
- inline artifact preview
- editing or retry actions from the detail area

## UX Intent

Keep the card compact for scanning. Put richer explanation in the selected-session detail area so the dashboard supports both quick triage and slightly deeper inspection.

## Acceptance

- selecting a harness session reveals a supplementary round summary
- the detail area uses persisted role artifacts as its only source
- the card remains a summary view rather than a full detail surface
