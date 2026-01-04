# E2E Testing Guidelines (Playwright)

This document defines the mandatory practices for writing and maintaining E2E tests with Playwright in this project.

## 1. Test Isolation

Each test MUST be completely isolated from other tests.

**Requirements:**
- Tests run independently with their own local storage, session storage, cookies
- No test should depend on the state created by another test
- Use `beforeEach` hooks for common setup, not shared state between tests

```typescript
// ✅ Correct - isolated setup
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('first test', async ({ page }) => {
  // Fresh state
});

test('second test', async ({ page }) => {
  // Also fresh state, independent of first test
});
```

```typescript
// ❌ Forbidden - shared state between tests
let sharedData;

test('creates data', async ({ page }) => {
  sharedData = await createSomething();
});

test('uses data', async ({ page }) => {
  await useSomething(sharedData); // Depends on previous test
});
```

**Source:** https://playwright.dev/docs/best-practices#make-tests-as-isolated-as-possible

---

## 2. Web-First Assertions

ALWAYS use web-first assertions with `await` before `expect`.

**Requirements:**
- Use `await expect(locator).toBeVisible()` pattern
- NEVER use `expect(await locator.isVisible()).toBe(true)` pattern
- Web-first assertions auto-wait for conditions to be met

```typescript
// ✅ Correct - web-first assertion with auto-wait
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByRole('button')).toBeEnabled();
await expect(page.getByTestId('status')).toHaveText('Success');
```

```typescript
// ❌ Forbidden - manual assertions without auto-wait
expect(await page.getByText('Welcome').isVisible()).toBe(true);
expect(await page.getByRole('button').isEnabled()).toBe(true);
```

**Source:** https://playwright.dev/docs/best-practices#use-web-first-assertions

---

## 3. User-Facing Locators

Prioritize locators that reflect how users interact with the page.

**Priority order (highest to lowest):**
1. `getByRole()` - ARIA roles (buttons, links, checkboxes)
2. `getByLabel()` - Form controls by associated label
3. `getByPlaceholder()` - Inputs by placeholder text
4. `getByText()` - Non-interactive elements by visible text
5. `getByAltText()` - Images by alt attribute
6. `getByTitle()` - Elements by title attribute
7. `getByTestId()` - ONLY as fallback when above options unavailable

```typescript
// ✅ Correct - user-facing locators
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByLabel('Email').fill('user@example.com');
await page.getByRole('link', { name: 'Sign up' }).click();
await page.getByPlaceholder('Search...').fill('query');
```

```typescript
// ❌ Forbidden - implementation-dependent locators
await page.locator('button.btn-primary').click();
await page.locator('#email-input').fill('user@example.com');
await page.locator('div > form > button:nth-child(2)').click();
await page.locator('//button[@class="submit"]').click();
```

**Chaining for precision:**
```typescript
// ✅ Correct - chained locators for specificity
const productRow = page.getByRole('listitem').filter({ hasText: 'Product A' });
await productRow.getByRole('button', { name: 'Add to cart' }).click();
```

**Source:** https://playwright.dev/docs/locators

---

## 4. No Fixed Timeouts

NEVER use `waitForTimeout` or fixed delays. Rely on Playwright's auto-waiting.

**Requirements:**
- Use explicit wait conditions, not arbitrary delays
- Playwright automatically waits for elements to be actionable before interactions
- For loading states, wait for specific UI indicators

```typescript
// ✅ Correct - wait for specific conditions
await page.waitForSelector('[data-testid="content-loaded"]');
await expect(page.getByText('Data loaded')).toBeVisible();
await page.waitForResponse('**/api/data');
await page.waitForLoadState('networkidle');
```

```typescript
// ❌ Forbidden - arbitrary delays
await page.waitForTimeout(2000);
await page.waitForTimeout(500);
await new Promise(resolve => setTimeout(resolve, 1000));
```

**Source:** https://playwright.dev/docs/actionability

---

## 5. Reuse Authentication State

Authenticate once and reuse the signed-in state across tests.

**Setup file:** `auth.setup.ts`
```typescript
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  // Wait for authentication to complete
  await expect(page.getByText('Dashboard')).toBeVisible();
  
  // Save authentication state
  await page.context().storageState({ path: authFile });
});
```

**Configuration:** `playwright.config.ts`
```typescript
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

**Security:** Add to `.gitignore`:
```
playwright/.auth/
```

**Source:** https://playwright.dev/docs/auth

---

## 6. Fully Parallel Mode

Enable parallel execution at test level for optimal distribution.

**Configuration:**
```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined, // 1 worker in CI for stability
});
```

**Per-file parallel mode:**
```typescript
import { test } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

test('test 1', async ({ page }) => { /* ... */ });
test('test 2', async ({ page }) => { /* ... */ });
test('test 3', async ({ page }) => { /* ... */ });
```

**Serial mode for dependent tests (use sparingly):**
```typescript
test.describe.configure({ mode: 'serial' });

test('step 1', async ({ page }) => { /* ... */ });
test('step 2', async ({ page }) => { /* ... */ }); // Runs after step 1
```

**Source:** https://playwright.dev/docs/test-parallel

---

## 7. Trace Viewer for Debugging

Use traces instead of videos/screenshots for CI debugging.

**Configuration:**
```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'on-first-retry', // Capture trace only on retry
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  retries: process.env.CI ? 2 : 0,
});
```

**View traces locally:**
```bash
npx playwright show-report
# Click on failed test → Traces section
```

**Or open trace directly:**
```bash
npx playwright show-trace test-results/trace.zip
```

**Trace provides:**
- Timeline of all actions
- DOM snapshots for each step
- Network requests
- Console logs
- Source code location

**Source:** https://playwright.dev/docs/trace-viewer

---

## 8. Code Organization (DRY)

NEVER duplicate code across spec files. Extract shared logic.

**Required structure for this project:**
```
tests/node/e2e/
├── config/
│   └── test-config.ts      # MANDATORY: All constants, timeouts, fixture paths
├── helpers/
│   └── *.helper.ts         # MANDATORY: Shared functions (upload, wait, etc.)
├── pages/                   # MANDATORY when >3 spec files exist
│   └── *.page.ts
└── specs/
    └── <feature>/
        └── *.spec.ts
```

**Rules:**
- If a function appears in 2+ spec files → MUST move to `helpers/`
- If a constant appears in 2+ spec files → MUST move to `config/test-config.ts`
- Spec files should contain ONLY test definitions and minimal setup

```typescript
// ❌ Forbidden - duplicated in multiple files
const goodPdf = path.join(process.cwd(), "tests", "fixtures", "docs", "one_page_report.pdf");

// ✅ Correct - imported from central config
import { FIXTURES } from '../config/test-config';
await page.setInputFiles("input[type=file]", FIXTURES.goodPdf);
```

---

## 9. Test Documentation 

Every spec file and complex test MUST be documented.

**Spec file header (MANDATORY):**
```typescript
/**
 * @fileoverview [CE testează acest fișier - în termeni de business/user]
 * 
 * Coverage: [ce funcționalitate/pagină acoperă]
 * Dependencies: [ce trebuie să ruleze înainte - ex: server, worker]
 * Run time: [aproximativ - ex: ~2 min, ~30 sec]
 */
```

**Complex test documentation (MANDATORY pentru teste >20 linii):**
```typescript
/**
 * [Ce verifică testul în termeni de user behavior]
 * 
 * WHY: [De ce e important acest test - business value]
 * Pre-conditions: [Ce trebuie să existe înainte]
 */
test('descriptive name here', async ({ page }) => {
  // WHY: [pentru orice setup non-evident]
  await page.addInitScript(() => { /* ... */ });
});
```

**Inline comments (MANDATORY pentru):**
- Mock-uri și interceptări de rețea
- Timeout-uri custom
- Workarounds pentru bug-uri cunoscute
- Aserții non-evidente

---

## 10. Test Naming and File Organization ← ADAUGĂ SECȚIUNE NOUĂ

**File naming convention:**
```
<feature>-<scenario>.spec.ts

Examples:
✅ upload-success.spec.ts
✅ upload-validation.spec.ts  
✅ export-markdown.spec.ts
❌ standard.spec.ts (ce e "standard"?)
❌ comprehensive.spec.ts (nu descrie CE testează)
```

**Test naming convention:**
```typescript
// Pattern: [action] [object] [expected result]
✅ test('upload valid PDF creates document with SUCCESS status')
✅ test('upload unsupported file shows validation error')
❌ test('test 1')
❌ test('full upload flow with UI validation') // prea generic
```

**Folder organization by feature:**
```
specs/
├── upload/           # Toate testele legate de upload
├── export/           # Toate testele legate de export
├── processing/       # Toate testele legate de procesare
└── smoke/            # Health checks rapide
```

---

## 11. Slow Tests Handling ← ADAUGĂ SECȚIUNE NOUĂ

Tests that take >60 seconds MUST be marked and documented.

**Marking slow tests:**
```typescript
test('processes all docling profiles', async ({ page }) => {
  test.slow(); // MANDATORY pentru teste >60s
  // ...
});
```

**Running without slow tests:**
```bash
npx playwright test --grep-invert @slow
```

**Documentation for slow tests (MANDATORY):**
```typescript
/**
 * @slow ~5 minutes
 * WHY SLOW: Iterează prin toate profilele docling cu procesare reală
 * WHEN TO RUN: Nightly builds, pre-release validation
 */
```

---

## 12. Enforcement

**These rules are MANDATORY, not suggestions.**

Before merging any PR with E2E tests, verify:
- [ ] No duplicated helpers across spec files
- [ ] All spec files have @fileoverview
- [ ] All tests >20 lines have documentation
- [ ] No CSS class or ID selectors (use getByRole, getByLabel, etc.)
- [ ] Slow tests are marked with test.slow() or @slow tag
- [ ] File names follow `<feature>-<scenario>.spec.ts` pattern

**Violations will be flagged in code review.**

---

## Quick Reference

### Locator Cheat Sheet
```typescript
// Buttons
page.getByRole('button', { name: 'Submit' })
page.getByRole('button', { name: /submit/i }) // Case insensitive

// Links
page.getByRole('link', { name: 'Home' })

// Form inputs
page.getByLabel('Email')
page.getByPlaceholder('Enter your email')

// Text content
page.getByText('Welcome back')
page.getByText('Welcome', { exact: true })

// Headings
page.getByRole('heading', { name: 'Dashboard' })
page.getByRole('heading', { level: 1 })

// Lists
page.getByRole('listitem').filter({ hasText: 'Item 1' })

// Tables
page.getByRole('row').filter({ hasText: 'John' })

// Fallback only
page.getByTestId('custom-element')
```

### Assertion Cheat Sheet
```typescript
await expect(locator).toBeVisible();
await expect(locator).toBeHidden();
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toHaveText('exact text');
await expect(locator).toContainText('partial');
await expect(locator).toHaveValue('input value');
await expect(locator).toHaveAttribute('href', '/path');
await expect(locator).toHaveCount(3);
await expect(page).toHaveURL('/dashboard');
await expect(page).toHaveTitle('Page Title');
```