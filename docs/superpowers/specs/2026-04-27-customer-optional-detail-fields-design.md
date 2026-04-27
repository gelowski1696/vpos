# Customer Optional Detail Fields Design

Date: 2026-04-27
Owner: Codex
Scope: API + Web + Mobile + Desktop
Status: Drafted for review

## Goal
Add four optional customer fields across VPOS:
- `contact number`
- `gas`
- `province`
- `city`

These fields must appear only in:
- customer create forms
- customer edit forms
- customer detail views

They must not be added to:
- customer list rows
- POS customer selection
- sales list/details
- receipts

`gas` is an optional free-text field.

## Why This Scope
This is the smallest change that adds the requested customer profile detail without widening the customer UI everywhere.

It keeps the rollout low-risk by:
- extending the existing customer model directly
- avoiding search/filter/list changes
- avoiding dropdown taxonomies for province/city/gas
- preserving current customer selection and sales flows

## Current State
### Existing customer fields
Current customer records already support core fields such as:
- code
- name
- type
- tier
- address
- contract price
- active state

`address` already exists end-to-end in API, web, mobile, and desktop.

### Current customer UI
- Web has customer create/edit and detail management
- Mobile has customer detail and newly added offline customer creation entry points
- Desktop has customer detail and newly added offline customer creation entry points
- POS customer pickers on mobile and desktop use shared local customer loaders

## Proposed Data Model
Add these nullable customer fields:
- `contactNumber: string | null`
- `gas: string | null`
- `province: string | null`
- `city: string | null`

### Database rules
- all four fields are nullable
- existing rows remain valid
- empty inputs are normalized to `null`
- no backfill is required

## API Design
### Prisma schema
Extend the `Customer` model with nullable columns:
- `contactNumber`
- `gas`
- `province`
- `city`

### Master data types
Update customer record and create/update DTO shapes to include the new optional properties.

### Controller/service behavior
Customer create/update should:
- accept the four fields if present
- trim incoming strings
- convert empty strings to `null`
- persist them directly

Customer read/list responses should include them so all clients can render detail views without special handling.

### Sync/offline compatibility
Offline customer create payloads on mobile and desktop must also carry these fields.
When synced, API should accept and persist them with the same normalization rules.

## Web Design
### Create/edit form
Add optional inputs:
- Contact Number
- Gas
- Province
- City

Placement:
- grouped with other customer profile inputs
- below `Address` is the simplest, most readable layout

### Customer detail view
Show these fields only when present.
Recommended order:
1. Address
2. Contact Number
3. Gas
4. Province
5. City

### No changes
Do not change:
- customer list row layout
- list columns
- search behavior
- POS-related customer displays

## Mobile Design
### Customer create/edit
Add optional inputs for:
- Contact Number
- Gas
- Province
- City

This applies to:
- customer management create/edit flow if present
- offline customer create modal in Customers screen
- offline customer create modal in POS customer selection

### Customer detail view
Show these fields only when present in the customer detail/transactions modal.

### No changes
Do not change:
- customer list cards
- POS customer picker row density
- sales screens

## Desktop Design
### Customer create/edit
Add optional inputs for:
- Contact Number
- Gas
- Province
- City

This applies to:
- customer management create/edit flow if present
- offline customer create modal in Customers screen
- offline customer create modal in POS customer selection

### Customer detail view
Show these fields only when present in the customer detail modal.

### No changes
Do not change:
- customer list rows
- POS customer picker layout
- sales views

## Validation Rules
All four fields are optional.

Recommended first-pass validation:
- trim whitespace
- store blank values as `null`
- preserve user-entered free text

### Contact Number
Do not enforce strict telecom formatting in this pass.
Reason:
- keeps input flexible for mobile numbers, landlines, and local formatting preferences
- avoids avoidable sync rejections from over-validation

## Migration Strategy
Use a single additive migration:
- add four nullable columns to customer storage

No data migration/backfill required.
Rollback impact is low because the new fields are isolated and optional.

## Compatibility and Risk
### Low-risk areas
- nullable columns only
- no search/index dependency in this pass
- no list-row layout changes
- no pricing or sales logic dependency

### Main risk
The only meaningful risk is incomplete field propagation in offline/local customer payloads.
That is why the same four fields must be wired through:
- API create/update/read
- web customer forms/details
- mobile local/offline customer create payloads
- desktop local/offline customer create payloads

## Out of Scope
Not included in this pass:
- search/filter by contact number, gas, province, or city
- customer list row display for the new fields
- POS picker display for the new fields
- receipts/sales detail display of the new fields
- province/city dropdown datasets
- LPG/gas controlled vocabulary or product linkage
- customer import/export template changes unless explicitly requested later

## Acceptance Criteria
### API
- customer create accepts the four optional fields
- customer update accepts the four optional fields
- customer read/list returns the four optional fields
- blank values are stored as `null`

### Web
- create/edit form shows the four optional fields
- customer detail shows them when present
- list rows remain unchanged

### Mobile
- offline customer create flows can capture the four optional fields
- customer detail shows them when present
- list rows and POS picker remain unchanged

### Desktop
- offline customer create flows can capture the four optional fields
- customer detail shows them when present
- list rows and POS picker remain unchanged

## Recommended Implementation Order
1. Prisma schema + migration
2. API customer type/controller/service propagation
3. Web create/edit + detail rendering
4. Mobile create/detail propagation including offline payloads
5. Desktop create/detail propagation including offline payloads
6. Verification across create, edit, offline create, and detail display
