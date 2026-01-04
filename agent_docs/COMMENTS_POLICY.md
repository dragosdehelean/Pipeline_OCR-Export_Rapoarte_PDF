<!-- @fileoverview Commenting rules for the AI coding agent. -->
## Reguli de Comentarii pentru AI Coding Agent

## APLICABILITATE

Aceste reguli se aplică pentru **TOATE** fișierele din proiect:
- ✅ Cod sursă (.ts, .tsx, .js, .jsx)
- ✅ Teste (.spec.ts, .test.ts)
- ✅ Configurări (.config.ts)
- ✅ Helpers și utilities
- ✅ Python (.py)

**NU EXISTĂ EXCEPȚII.**

---

### 1. FILE HEADER (obligatoriu - toate fisierele)

```typescript
/**
 * @fileoverview [Descrie DE CE există acest fișier și CE PROBLEMĂ rezolvă]
 */
```

**Exemple din acest proiect:**
```typescript
// ✅ CORECT - pentru un spec file
/**
 * @fileoverview Teste E2E pentru fluxul de upload PDF.
 * Acoperă: validare fișiere, upload success/failure, feedback UI.
 */

// ✅ CORECT - pentru un helper
/**
 * @fileoverview Funcții helper pentru operațiuni de upload în teste E2E.
 * Centralizează logica comună pentru a evita duplicarea în spec files.
 */

// ❌ GREȘIT - prea generic
/**
 * @fileoverview Test file
 */

// ❌ GREȘIT - descrie CE face, nu DE CE există
/**
 * @fileoverview Contains uploadFile and waitForStatus functions
 */
```

---

### 2. FUNCȚII/METODE (OBLIGATORIU pentru publice/exportate)

```typescript
/**
 * [CE PROBLEMĂ rezolvă - în termeni de business/user, nu implementare]
 *
 * @param x - [doar dacă nu e evident din nume]
 * @returns [doar dacă nu e evident din tip]
 * @throws {ErrorType} [doar dacă aruncă excepții]
 * 
 * @example
 * [Exemplu de utilizare - OBLIGATORIU pentru funcții complexe]
 */
```

**Exemple din acest proiect:**
```typescript
// ✅ CORECT
/**
 * Navighează la homepage și așteaptă ca upload form-ul să fie ready.
 * 
 * Fail-fast: Aruncă eroare explicită dacă health check eșuează,
 * oferind debugging info mai bun decât un timeout generic.
 *
 * @param page - Playwright page object
 * @throws Error dacă health check returnează ok: false
 * 
 * @example
 * await gotoAndWaitForUploadReady(page);
 * // Acum page e gata pentru operațiuni de upload
 */
async function gotoAndWaitForUploadReady(page: Page): Promise

// ❌ GREȘIT - fără comentarii
async function gotoAndWaitForUploadReady(page: Page): Promise

// ❌ GREȘIT - descrie implementare, nu scop
/**
 * Goes to / and waits for health response then waits for file input
 */
```

---

### 3. BLOCURI DE COD - WHY Comments (OBLIGATORIU când motivul nu e evident)

Format: `// WHY: [motivul pentru care există acest cod]`

**OBLIGATORIU pentru:**
- Timeout-uri custom
- Mock-uri și interceptări
- Workarounds pentru bug-uri
- Validări/verificări non-evidente
- Orice cod care ar face pe cineva să întrebe "de ce?"

**Exemple din acest proiect:**
```typescript
// ✅ CORECT
// WHY: Double timeout pentru că include procesare completă + navigare
test.setTimeout(uploadTimeoutMs * 2);

// WHY: Mock clipboard API - Playwright nu expune clipboard nativ în contexte izolate
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", { /* ... */ });
});

// WHY: API poate returna fie "id" fie "docId" - suportăm ambele pentru backward compat
const docId = payload?.id ?? payload?.docId ?? "";

// WHY: Fail-fast cu eroare descriptivă - mai util decât timeout generic
if (!healthPayload?.ok) {
  throw new Error(`Health check failed: ${JSON.stringify(healthPayload)}`);
}

// ❌ GREȘIT - fără explicație
test.setTimeout(uploadTimeoutMs * 2);
await page.addInitScript(() => { /* ... */ });
```

---

## 4. TESTE - Reguli Specifice (OBLIGATORIU)

### 4.1 Test Docstrings (pentru teste >20 linii sau complexe)
```typescript
/**
 * [Ce verifică testul în termeni de user behavior]
 * 
 * WHY: [De ce e important - business value]
 * Pre-conditions: [Ce trebuie să existe/ruleze]
 */
test('upload valid PDF shows success notification', async ({ page }) => {
```

### 4.2 Setup Complex (OBLIGATORIU să fie comentat)
```typescript
test('copy button copies markdown to clipboard', async ({ page }) => {
  // WHY: Mock clipboard - browser security previne accesul direct în teste
  // Implementare: Stocăm local și expunem prin __getClipboardText
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => { clipboardText = text; },
        readText: async () => clipboardText
      }
    });
    (window as any).__getClipboardText = () => clipboardText;
  });
```

### 4.3 Aserții Non-Evidente (OBLIGATORIU să fie comentate)
```typescript
// ✅ CORECT
// WHY: 420px max-height e design requirement pentru preview area
expect(previewStyles?.maxHeight).toBe("420px");

// WHY: Verificăm absența horizontal scroll - regression test pentru layout bug
const hasHorizontalScroll = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);
expect(hasHorizontalScroll).toBeFalsy();

// ❌ GREȘIT - de ce 420px? de ce verificăm scroll?
expect(previewStyles?.maxHeight).toBe("420px");
expect(hasHorizontalScroll).toBeFalsy();
```

---

## 5. ENFORCEMENT

**Aceste reguli sunt OBLIGATORII, nu sugestii.**

Înainte de a considera codul complet, verifică:
- [ ] Fișierul are `@fileoverview`
- [ ] Funcțiile exportate au docstrings
- [ ] Codul non-evident are comentarii WHY
- [ ] Testele complexe sunt documentate
- [ ] Mock-urile și workaround-urile sunt explicate

**Dacă nu poți explica DE CE există un cod, probabil nu ar trebui să existe.**