# User flows

> Template for `docs/flows.md`. Create one section per user flow. Keep field order explicit. Record decisions as made or pending; do not present assumptions as settled requirements.

## [Flow name]

### Goal and trigger

- **User goal:** [what the user wants to accomplish]
- **Trigger:** [event or entry point]
- **Preconditions:** [required state or permissions]
- **Outcome:** [observable successful result]

### Steps and fields

List fields in the order they appear or are completed. Include validation and conditional visibility.

| Step | Screen or action | Field (order) | Rule / validation | Next step |
|---|---|---|---|---|
| 1 | [Screen/action] | [Field 1] | [Required, format, constraints] | [Decision or step] |
| 2 | [Screen/action] | [Field 2] | [Required, format, constraints] | [Decision or step] |

### Rules and decisions

- **Rules:** [business rules, permissions, validation and error behavior]
- **Decisions made:** [decision and rationale]
- **Decisions pending:** [question, owner and deadline or blocking dependency]

### Components and states

| Component | Purpose | States to cover |
|---|---|---|
| [Component] | [Purpose] | [Default, loading, empty, error, success, disabled as applicable] |

### Build order

1. [Prerequisite or data contract]
2. [Core component or service]
3. [Main flow and validation]
4. [Error, empty and success states]
5. [Tests and accessibility checks]

### Verification

- [ ] Happy path works.
- [ ] Validation and permission failures are covered.
- [ ] Loading, empty, error and success states are defined where relevant.
- [ ] Keyboard and assistive-technology behavior is considered.
- [ ] Tests cover the acceptance criteria.

Repeat this section for each distinct user flow.
