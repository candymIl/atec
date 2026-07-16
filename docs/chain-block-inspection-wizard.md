# Chain Block / Lever Hoist Wizard

## Scope

The Chain Block / Lever Hoist wizard is preserved and now uses the shared inspection wizard framework configuration.

No workflow redesign was done.

## Resolution

The current family resolver identifies Chain Block / Lever Hoist assets from equipment text including:

- Manual chain hoist
- Manual lever hoist
- Chain block
- Lever hoist

Unsupported equipment continues to use the generic inspection form.

## Sections

The existing sections are preserved:

- Identification
- Hooks
- Load Chain
- Body / Casing
- Brake / Load Holding
- Markings
- Functional Test
- Final Result

Criteria remain database-driven. The config only controls display grouping.

## Shared Framework Usage

The wizard uses:

- `chainBlockWizardConfig.js`
- `groupCriteriaRows`
- Existing measurement row renderer
- Existing visual PASS/FAIL row renderer
- Existing inspection save route
- Existing certificate renderer

## Safety And Tags

Critical safety and optional inspection tag behavior are shared with the generic and crane flows. Blank tags save as `NULL`, and supplied tags remain unique.

## Generic Fallback

The generic form remains available through the shared fallback path when the resolver does not select this wizard.
