# E2E Test Strategy

Testele E2E sunt organizate pe **feature** si **scenariu**, cu shared helpers si page objects.

## Structura

```
tests/node/e2e/
  config/
    test-config.ts         # Constante si config quality-gates
  helpers/
    *.helper.ts            # Fluxuri si utilitare shared
  pages/
    *.page.ts              # Page objects pentru locatori user-facing
  specs/
    smoke/
      smoke-*.spec.ts      # Smoke tests rapide
    upload/
      upload-*.spec.ts     # Upload flows + validari
    processing/
      processing-*.spec.ts # Procesare, engine overrides, delete
    export/
      export-*.spec.ts     # Export preview/download UI
    ux-audit/
      ux-*.spec.ts         # Audit vizual (optional)
```

**Naming Convention**: `<feature>-<scenario>.spec.ts`

## Slow tests

Testele >60s sunt marcate cu `test.slow()` si tag `@slow` in titlu.

Rulare fara slow tests:
```
npx playwright test --grep-invert @slow
```

## Comenzi recomandate

### Smoke (feedback rapid)
```
npx playwright test tests/node/e2e/specs/smoke
```

### Upload / Processing / Export (coverage pe feature)
```
npx playwright test tests/node/e2e/specs/upload
npx playwright test tests/node/e2e/specs/processing
npx playwright test tests/node/e2e/specs/export
```

### Suite completa (exclus UX audit)
```
npm run test:e2e
```

### UX audit (optional)
```
npm run test:ux
```

## Tips

1. `test-config.ts` este sursa unica pentru fixtures si timeouts.
2. `helpers/` contine fluxurile comune (upload, health, doc status).
3. `pages/` trebuie folosit pentru locatori user-facing.
4. Pentru debugging UI: `npx playwright test <path> --headed`
