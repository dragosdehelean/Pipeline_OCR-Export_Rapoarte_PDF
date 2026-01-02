# AGENTS.md - Unit Test Instructions

> This file contains mandatory rules for writing unit tests.
> All instructions are written in the imperative mood and must be followed.

---

## STRUCTURE AND ORGANIZATION

### Use the AAA pattern (Arrange-Act-Assert)

Structure each test into three distinct sections, visually separated:

1. **Arrange** - Prepare the required data and objects
2. **Act** - Execute the single action being tested
3. **Assert** - Verify the expected result

Add `// Arrange`, `// Act`, `// Assert` comments or blank lines for visual separation.

### Name tests after the behavior under test

Use one of these formats:
- `MethodName_Scenario_ExpectedBehavior`
- `should_ExpectedBehavior_When_Scenario`

The name must clearly communicate: what is being tested, under what conditions, and what result is expected. If you need the word "and" in the name, split the test into two.

### Write a single Act per test

Each test verifies a single behavior. Do NOT combine multiple actions or multiple independent assertions in the same test. If you test multiple scenarios, write separate tests.

---

## FUNDAMENTAL CHARACTERISTICS (FIRST)

### Keep tests fast

Unit tests run in milliseconds, not seconds. If a test takes longer than 100ms, identify and eliminate the cause of the delay.

### Completely isolate each test

Each test:
- Runs independently of the others
- Does NOT depend on execution order
- Does NOT share mutable state with other tests
- Produces the same result no matter how many times it is run

### Ensure deterministic repeatability

The test ALWAYS produces the same result for the same input. Remove any source of non-determinism: current dates, random values, global state, race conditions.

### Make tests self-validating

The test automatically determines whether it passed or not. It does NOT require manual inspection of output or logs.

---

## WHAT TO TEST

### Test behaviors, not methods

Do NOT write a test for every method. Write tests for each behavior of the system. Think in terms of: "Given [context], When [action], Then [result]".

A method can have multiple behaviors. A behavior can involve multiple methods.

### Test through public APIs

Invoke the system the same way real consumers use it. Do NOT test private methods, do NOT access internal state, do NOT verify implementation details.

If you feel the need to test a private method, test the public behavior that uses it.

### Test the end state, not interactions

Verify the RESULT of the action (the system state after execution), NOT the sequence of internal calls. Interaction-based tests break during refactoring.

### Test edge cases

Include tests for:
- `null` and undefined values
- Empty strings and whitespace
- Zero, negative values, maximum values
- Empty collections and collections with a single element
- Boundary values (exactly at the boundary, 1 below/above the boundary)

---

## CLARITY AND SIMPLICITY

### Avoid any logic in tests

Do NOT use in the test body:
- Conditional statements (`if`, `switch`)
- Loops (`for`, `while`, `foreach`)
- String concatenations to build expected values
- Arithmetic calculations

The test must be "trivially correct upon inspection"—its correctness is obvious at first glance.

### Prefer DAMP over DRY

Duplication in tests is acceptable if it improves clarity. Each test must be complete and self-contained—the reader understands everything without navigating to other files or methods.

DAMP = Descriptive And Meaningful Phrases

### Write minimal tests

Use the simplest input that verifies the behavior under test. Do NOT add properties, parameters, or values that are irrelevant to the specific scenario. Extra information distracts and obscures intent.

### Avoid "magic" values

Do NOT use hardcoded values without context. Define constants with descriptive names:

```
// WRONG
assert(account.getBalance() == 150);

// CORRECT
const INITIAL_BALANCE = 150;
assert(account.getBalance() == INITIAL_BALANCE);
```

### Write clear failure messages

When a test fails, the message indicates:
- What value was expected
- What value was actually obtained
- The relevant context for diagnosis

An engineer must be able to diagnose the problem without reading the test code.

---

## ISOLATION AND DEPENDENCIES

### Use mocks and stubs sparingly

Prefer real objects when they are fast and deterministic. Use mocks ONLY for:
- Slow external dependencies (databases, network APIs)
- Non-deterministic services (time, random)
- Costly systems or systems unavailable in tests

Do NOT mock internal collaborators that can be instantiated directly.

### Isolate tests from infrastructure

Unit tests do NOT access:
- The file system
- Real databases
- Network services
- External resources

Use dependency injection and interfaces to allow replacing them with stubs.

### Manage static dependencies with seams

For code that depends on static elements (`DateTime.Now`, `Random`, `Environment`), introduce "seam" interfaces that allow injecting controlled values:

```
// Instead of a direct static call
if (DateTime.Now.DayOfWeek == DayOfWeek.Tuesday) { ... }

// Inject the dependency
if (dateTimeProvider.DayOfWeek() == DayOfWeek.Tuesday) { ... }
```

### Prefer helper methods instead of global Setup

Global setup methods (`@Before`, `setUp()`) hide important details. Use explicit helper methods called in each test:

```
// AVOID: global setup with implicit defaults
@Before
void setUp() {
    user = createUser("default");
}

// PREFER: explicit helper in the test
@Test
void shouldRejectInvalidUser() {
    User user = createUser("invalid-state");
    // ... rest of the test
}
```

---

## MAINTENANCE

### Write tests that do not require changes during refactoring

A well-written test does NOT change when:
- You refactor internal implementation
- You add new functionality
- You fix bugs in other code

Only changes in system behavior justify modifying existing tests.

### Aim for 70-90% coverage, not 100%

High code coverage does NOT guarantee quality. 100% coverage is counterproductive—it forces tests for trivial cases and generated code.

Focus on:
- Critical business logic
- Edge and error cases
- Code with high cyclomatic complexity

---

## REFERENCES

These practices are derived from:

- [Google Software Engineering Book - Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html)
- [Microsoft Learn - Unit Testing Best Practices](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices)
- [IBM - Unit Testing Best Practices](https://www.ibm.com/think/insights/unit-testing-best-practices)
- [Martin Fowler - Testing Guide](https://martinfowler.com/testing/)
