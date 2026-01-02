# Reguli pentru Teste Unitare

## REGULA CRITICĂ: Un singur comportament per test

Fiecare bloc `it()` / `test()` trebuie să conțină **un singur `expect()`** care verifică **un singur comportament**.

```typescript
// ❌ GREȘIT - multiple comportamente într-un test
it("validates file extensions", () => {
  expect(getFileExtension("file.pdf")).toBe(".pdf");
  expect(getFileExtension("FILE.PDF")).toBe(".pdf");
  expect(getFileExtension("archive.tar.gz")).toBe(".gz");
});

// ✅ CORECT - un comportament per test
it("returns extension with leading dot", () => {
  expect(getFileExtension("file.pdf")).toBe(".pdf");
});

it("converts extension to lowercase", () => {
  expect(getFileExtension("FILE.PDF")).toBe(".pdf");
});

it("returns only the last extension for multiple dots", () => {
  expect(getFileExtension("archive.tar.gz")).toBe(".gz");
});
```

**De ce contează:** Când un test cu multiple assertions pică, nu știi care comportament a eșuat fără să inspectezi manual.

---

## Structura AAA obligatorie

Fiecare test urmează Arrange-Act-Assert cu separare vizuală:

```typescript
it("returns empty string when file has no extension", () => {
  // Arrange
  const filename = "README";

  // Act
  const result = getFileExtension(filename);

  // Assert
  expect(result).toBe("");
});
```

Pentru teste simple cu o singură linie, compresia e acceptabilă:

```typescript
it("returns empty string for empty input", () => {
  expect(getFileExtension("")).toBe("");
});
```

---

## Denumirea testelor

Numele descrie **comportamentul**, nu inputul:

```typescript
// ❌ GREȘIT - descrie inputul
it("handles empty string", () => { ... });
it("with .pdf file", () => { ... });

// ✅ CORECT - descrie comportamentul/rezultatul
it("returns empty string when input is empty", () => { ... });
it("extracts pdf extension with leading dot", () => { ... });
```

**Pattern recomandat:** `"<acțiune> when <condiție>"` sau `"<acțiune> for <context>"`

---

## Evită valorile magice

```typescript
// ❌ GREȘIT - de ce exact aceste valori?
expect(id).toHaveLength(36);
expect(result).toBe(0.15);

// ✅ CORECT - constante cu nume descriptive
const DOC_ID_PREFIX_LENGTH = 4;  // "doc_"
const UUID_HEX_LENGTH = 32;      // UUID fără cratime
const EXPECTED_LENGTH = DOC_ID_PREFIX_LENGTH + UUID_HEX_LENGTH;
expect(id).toHaveLength(EXPECTED_LENGTH);
```

---

## Edge cases obligatorii

Pentru orice funcție care procesează stringuri, testează:
- String gol (`""`)
- `null` / `undefined` (dacă tipul permite)
- Caractere speciale / unicode
- Valori la limită (lungime maximă, zero, negative)

Pentru funcții numerice:
- Zero, negative, pozitive
- Valori foarte mari / foarte mici
- `NaN`, `Infinity` (dacă relevant)

---

## Ce să NU faci (Anti-patterns)

### ❌ Logică în teste
```typescript
// ❌ GREȘIT
it("processes all file types", () => {
  const files = ["a.pdf", "b.docx", "c.txt"];
  for (const file of files) {
    expect(getFileExtension(file)).toBeTruthy();
  }
});

// ✅ CORECT - teste separate pentru fiecare caz
it("extracts pdf extension", () => {
  expect(getFileExtension("a.pdf")).toBe(".pdf");
});
```

### ❌ Teste care depind de ordinea execuției
```typescript
// ❌ GREȘIT - al doilea test depinde de primul
let sharedState: string;
it("generates id", () => { sharedState = generateId(); });
it("id is valid", () => { expect(sharedState).toMatch(/^doc_/); });

// ✅ CORECT - fiecare test e complet izolat
it("generates id with doc_ prefix", () => {
  const id = generateId();
  expect(id).toMatch(/^doc_/);
});
```

### ❌ Testarea unicității prin comparare
```typescript
// ❌ FRAGIL - teoretic poate eșua (coliziune)
it("generates unique ids", () => {
  expect(generateId()).not.toBe(generateId());
});

// ✅ ROBUST - testează formatul, nu unicitatea
it("generates id using UUID format", () => {
  const id = generateId();
  expect(id).toMatch(/^doc_[a-f0-9]{32}$/);
});
```

---

## Checklist pre-commit

Înainte de a considera testul complet, verifică:

- [ ] Fiecare `it()` are un singur `expect()` pentru un singur comportament
- [ ] Numele testului descrie comportamentul, nu inputul
- [ ] Nu există `if`, `for`, `while`, `switch` în corpul testului
- [ ] Nu există dependențe între teste (ordine, stare partajată)
- [ ] Edge cases acoperite: string gol, null, valori limită
- [ ] Nicio valoare magică fără constantă explicativă
- [ ] Testul va produce mesaj clar la eșec (știi exact ce a picat)
