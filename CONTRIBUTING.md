# Contributing to Tracefinity

Thanks for helping with Tracefinity. The project stays useful by doing one job
well, so substantial features need a quick product check before anyone spends a
week building them.

## Read before changing things

- [CONSTITUTION.md](CONSTITUTION.md) defines the product boundary and how feature
  requests are classified.
- [DESIGN.md](DESIGN.md) contains the engineering principles that apply once a
  change belongs in the product.
- [README.md](README.md) covers setup and day-to-day development.
- The relevant file under [docs/](docs/) carries deeper architecture, API,
  geometry, and workflow details.

## Before building a feature

Open or find an issue before implementing a substantial feature, new workflow,
integration, input mode, or output mode. Describe the outcome you need, not only
the implementation you have in mind. This gives us a chance to check the
constitution, find a smaller solution, and avoid wasting a contributor's time.

Small bug fixes and clearly aligned refinements do not need ceremony. If the
boundary is unclear, opening an issue is enough; you are not expected to argue a
legal case for the feature.

Agents should use the repository's `scope-triage` skill when evaluating feature
requests. The skill advises; Jason makes the final call.

## Scope and backlog state

Scope says whether an idea belongs in Tracefinity. Open or closed says whether
we currently plan to work on it. Those are different decisions.

| Label | Meaning |
|-|-|
| `scope:in-scope` | Eligible for prioritisation, not promised |
| `scope:needs-decision` | Exposes or changes a constitutional boundary |
| `scope:out-of-scope` | Conflicts with a settled boundary |
| `status:needs-demand` | Fits, but current interest does not justify the work |
| `status:blocked-by-cost` | Fits, but the implementation or maintenance burden is disproportionate |

An issue can be in scope and still be closed as `Not planned`. Closed canonical
requests stay unlocked so reactions, concrete use cases, and related requests
can provide evidence for re-triage.

## Pull requests

Keep a pull request focused on one concern. Split unrelated UI polish, developer
tooling, or opportunistic cleanup into separate changes. A feature can fit the
constitution and still be declined if the implementation is unsafe, too broad,
or too expensive to maintain.

Before submitting:

```bash
make lint

cd backend
venv/bin/python -m pytest

cd ../frontend
pnpm test
```

If your local environment differs, run the equivalent complete backend and
frontend suites and say exactly what you ran in the pull request. Compilation or
`py_compile` alone is not test evidence.
