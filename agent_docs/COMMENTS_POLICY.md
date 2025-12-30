<!-- @fileoverview Commenting rules for the AI coding agent. -->
## Reguli de Comentarii pentru AI Coding Agent

### 1. FILE HEADER (obligatoriu pentru toate fisierele unde se pot face comentarii)

```typescript
/**
 * @fileoverview [Descrie cat mai explicit DE CE există acest fișier]
 */
```

### 2. FUNCȚII/METODE (obligatoriu pentru cele publice/exportate)

```typescript
/**
 * [Descrie cat mai explicit CE PROBLEMĂ rezolvă]
 *
 * @param x - [doar dacă nu e evident din nume]
 * @returns [doar dacă nu e evident din tip]
 * @throws {ErrorType} [doar dacă aruncă excepții]
 */
```

### 3. BLOCURI DE COD (obligatoriu când WHY nu e evident)

```typescript
// WHY: [motivul pentru care există acest cod]
// Ex: "Safari iOS nu suportă smooth scroll în iframe"
// Ex: "API-ul extern returnează date într-un format legacy"
```
