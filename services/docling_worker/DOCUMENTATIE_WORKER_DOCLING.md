# Comunicarea Next.js ↔ Worker Python

## Schema completă a fluxului

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                    │
│                                                                         │
│  1. POST /api/docs/upload  ──────────────────────────────────────────┐  │
│     (trimite PDF)                                                    │  │
│                                                                      │  │
│  2. Primește instant: { id: "abc123", status: "PENDING" }  ◄─────────┤  │
│                                                                      │  │
│  3. Polling: GET /api/docs/abc123 (la fiecare 1-2 sec)               │  │
│              ↓                                                       │  │
│     Primește: { status: "PENDING", progress: 25 }                    │  │
│     Primește: { status: "PENDING", progress: 55 }                    │  │
│     Primește: { status: "PENDING", progress: 85 }                    │  │
│     Primește: { status: "SUCCESS", progress: 100 }  ✓                │  │
│                                                                      │  │
└──────────────────────────────────────────────────────────────────────┼──┘
                                                                       │
┌──────────────────────────────────────────────────────────────────────┼──┐
│                            NEXT.JS                                   │  │
│                                                                      │  │
│  route.ts (API Route)                                                │  │
│  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │ 1. Primește fișier                                             │  │  │
│  │ 2. Salvează pe disc                                            │  │  │
│  │ 3. spawn(python, [convert.py, ...])  ─────────────────────┐    │  │  │
│  │ 4. return { status: "PENDING" }  ◄────────────────────────┼────┼──┘  │
│  │                                                           │    │     │
│  │ 5. Ascultă stdout ◄───────────────────────────────────────┼────┼─┐   │
│  │ 6. Scrie progress.json                                    │    │ │   │
│  │ 7. La final: scrie meta.json                              │    │ │   │
│  └───────────────────────────────────────────────────────────┼────┘ │   │
│                                                              │      │   │
└──────────────────────────────────────────────────────────────┼──────┼───┘
                                                               │      │
┌──────────────────────────────────────────────────────────────┼──────┼───┐
│                       WORKER PYTHON                          │      │   │
│                                                              │      │   │
│  convert.py                                                  │      │   │
│  ┌───────────────────────────────────────────────────────────┴──┐   │   │
│  │ 1. Primește argumente CLI                                    │   │   │
│  │ 2. Încarcă PDF cu Docling                                    │   │   │
│  │ 3. print({"event":"progress", "progress":25})  ──────────────┼───┘   │
│  │ 4. Convertește document                                      │       │
│  │ 5. print({"event":"progress", "progress":55})                │       │
│  │ 6. Scrie output.md, output.json                              │       │
│  │ 7. print({"event":"progress", "progress":100})               │       │
│  │ 8. Exit code 0                                               │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Componenta cheie: `spawn`

`spawn` este o funcție built-in în Node.js care pornește un program extern ca **proces copil**.

```
┌─────────────────────────────────────────────────────────────┐
│                    PROCESUL NEXT.JS                         │
│                                                             │
│   spawn("python", ["convert.py", "--input", ...])           │
│         │                                                   │
│         │ creează                                           │
│         ▼                                                   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              PROCES COPIL (Python)                  │   │
│   │                                                     │   │
│   │   python convert.py --input /path/to/file.pdf ...   │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│         │                                                   │
│         │ stdout (JSON progress)                            │
│         ▼                                                   │
│   Next.js citește și actualizează UI                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Codul relevant

### Next.js pornește worker-ul (route.ts)

```typescript
void runProcess({
  command: pythonBin,           // "python"
  args: [
    workerPath,                 // "convert.py"
    "--input", uploadPath,      // "--input", "/data/uploads/abc123.pdf"
    "--doc-id", id,             // "--doc-id", "abc123"
    "--data-dir", getDataDir(), // "--data-dir", "./data"
    "--gates", getGatesConfigPath()
  ],
  timeoutMs: timeoutSec * 1000,
  onStdoutLine: handleProgressLine
});
```

### processRunner.ts folosește spawn

```typescript
import { spawn } from "node:child_process";

const child = spawn(command, args, {
  cwd,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

child.stdout?.on("data", (chunk: Buffer) => {
  // Citește output-ul worker-ului
});
```

### Worker-ul Python trimite progres (convert.py)

```python
def emit_progress(stage: str, message: str, progress: int) -> None:
    payload = {
        "event": "progress",
        "stage": stage,
        "message": message,
        "progress": progress,
    }
    print(json.dumps(payload), flush=True)
```

## Concepte cheie

| Concept | Ce înseamnă | În cod |
|---------|-------------|--------|
| **spawn** | Funcție Node.js care pornește un proces extern | `spawn(command, args)` |
| **Child process** | Programul extern care rulează | `python convert.py ...` |
| **stdio pipes** | Canale de comunicare între procese | `stdout` pentru progres |
| **Non-blocking** | Next.js nu așteaptă să termine worker-ul | `void runProcess(...)` |
| **Polling** | Browser-ul întreabă periodic „gata?" | `GET /api/docs/{id}` |

## De ce e făcut așa?

1. **Răspuns rapid** — utilizatorul nu stă blocat 30 secunde
2. **Scalabilitate** — serverul Next.js poate servi alți utilizatori
3. **Feedback în timp real** — bara de progres funcționează
4. **Reziliență** — dacă worker-ul crapă, Next.js știe (exit code ≠ 0)