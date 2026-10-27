## ADDED Requirements

### Requirement: Pix payment

#### Scenario: Paid order
- **WHEN** a POST request reaches /webhooks/pix with a paid event
- **THEN** the system answers 204 and marks the order as paid
