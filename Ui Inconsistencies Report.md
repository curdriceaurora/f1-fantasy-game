# UI Inconsistencies Investigation Report

Based on a thorough evaluation of the F1 Fantasy Game frontend files (`index.html`, `calculator.html`, `rules.html`, `styles.css`, and `ui.js`), several significant UI inconsistencies and poor architectural patterns were identified.

## 1. Massive CSS Duplication & Local Overrides
Instead of relying on the centralized `styles.css`, the developers have pasted large `<style>` blocks into each HTML file. This leads to conflicting definitions and duplication:
* **Site Banner (`.site-banner`)**: Defined in `styles.css` with a background of `var(--bg-dark)`. However, `calculator.html` and `rules.html` redefine it locally using a hardcoded `background: #0a0a0f`, which breaks themes and overrides the main style.
* **Rules & Layout Elements**: `calculator.html` and `rules.html` share over 150 lines of duplicate CSS for classes like `.rules-page`, `.rules-header`, `.back-to-game`, and `.rules-nav`. If one of these classes needs an update, it must be changed in both files.
* **Component Leakage**: `rules.html` literally copy-pastes the entire calculator CSS (e.g., `.calculator-card`, `.calc-grid`) starting at line 332, despite not being the calculator page.

## 2. Divergent Implementations of Shared Components
There are UI components that appear on multiple pages but are implemented and styled differently:
* **Custom Select Dropdowns (`.cs-*`)**: 
  * `index.html` uses `.cs-wrapper` with basic `.cs-option` styling.
  * `calculator.html` and `rules.html` use `.custom-select-wrap` and have expanded the `.cs-*` components to include `.cs-avatar`, `.cs-sel-name`, `.cs-team-badge`, etc. The padding and border colors differ between `index.html`'s version and the others.
* **Prediction Sliders (`.pred-*`)**: The predictions section styling is duplicated in `index.html` and `calculator.html`, with a differing grid setup and slightly different slider thumb aesthetics (e.g., `index` uses `#e10600` while `calculator` sometimes adds `.untouched` animations not fully harmonized).

## 3. Structural & Typographical Details
* **Headers**: `calculator.html` highlights part of its title (`🧮 TEAM COST <span>CALCULATOR</span>`), whereas `rules.html` has plain text (`RULES &amp; FAQ`).
* **Active Navigation State**: The sticky navigation in `calculator.html` successfully uses the `.nav-active` class. `rules.html` lacks this active state indication for its own sticky navbar links (relying entirely on anchor sub-links).

## Recommendations for Remediation
1. **Centralize Styles**: Move all layout (`.rules-page`, `.rules-header`), dropdown (`.cs-*`), and prediction (`.pred-*`) CSS to `styles.css`.
2. **Remove `<style>` Tags**: Strip all local `<style>` tags from the `head` of all three HTML files.
3. **Unify Class Names**: Settle on either `.cs-wrapper` or `.custom-select-wrap` and use it uniformly. Standardize the HTML structure of the dropdowns and sliders so they all inherit from the same CSS master definitions.
