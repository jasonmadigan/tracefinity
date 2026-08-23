# Closed-item scope precedent audit

This audit checks the product constitution against decisions Jason has already
made in public. It deliberately uses **closed issues and closed pull requests
only**. No currently open request is treated as precedent, even when an open
request was discussed while the constitution was being drafted.

This is supporting evidence, not a second source of product policy.
[`CONSTITUTION.md`](../CONSTITUTION.md) remains the canonical guide.

Audit date: 2026-08-23. Repository: [tracefinity/tracefinity](https://github.com/tracefinity/tracefinity).

## Method and coverage

The authenticated GitHub account and repository administrator was confirmed as
[`jasonmadigan`](https://github.com/jasonmadigan). The audit then paginated the
complete closed-issue and closed-pull-request sets through the GitHub API. It
screened ordinary conversation comments, formal pull-request reviews, inline
review comments, and maintainer-authored bodies where a merge or closure needed
that context.

| Surface | Closed items or maintainer-authored material screened |
|-|-:|
| Closed issues (pull requests excluded) | 69 |
| Closed pull requests | 104 |
| Ordinary comments on closed issues | 43 |
| Ordinary comments on closed pull requests | 41 |
| Formal reviews on closed pull requests | 56 (35 with a non-empty body) |
| Inline review comments on closed pull requests | 57 |
| Closed issue bodies authored by the maintainer | 28 |
| Closed pull requests authored by the maintainer | 51 |

All 69 closed issues currently have GitHub's `COMPLETED` state reason. That
includes requests whose proposed mechanism was redirected or declined. The
constitution's `Not planned` reason and scope/status labels are therefore a new,
prospective bookkeeping policy, not a description of how old decisions were
recorded.

The tables below omit thanks, scheduling, merge logistics, routine debugging,
copy edits, and ordinary line-level defects that do not establish a reusable
product or contribution principle. Multiple comments from one review are
grouped when they express one rationale; every linked item was closed at the
audit cutoff.

## Substantive closed-issue evidence

| Closed item | Maintainer evidence | Rationale | Theme |
|-|-|-|-|
| [#47: photo station](https://github.com/tracefinity/tracefinity/issues/47) | [Comment](https://github.com/tracefinity/tracefinity/issues/47#issuecomment-4547557691) | Direct capture and reusable paper calibration deepen the photographic workflow; the contributor was invited to proceed from an issue to a PR. | Photo-originated input; issue-first contribution |
| [#61: symmetric modelling](https://github.com/tracefinity/tracefinity/issues/61) | [Comment](https://github.com/tracefinity/tracefinity/issues/61#issuecomment-4625648623) | Configurable snapping had a clear outcome and was split into its own request; symmetry needed a concrete use case before implementation. | Outcome-first triage; focused slices |
| [#101: half-grid bins](https://github.com/tracefinity/tracefinity/issues/101) | [Comment](https://github.com/tracefinity/tracefinity/issues/101#issuecomment-4779692238) | Half-grid support was explicitly welcomed and then implemented. | Compatible Gridfinity extension |
| [#11: Ollama support](https://github.com/tracefinity/tracefinity/issues/11) | [Comment](https://github.com/tracefinity/tracefinity/issues/11#issuecomment-4085938154) | VLMs can understand images but do not provide the pixel-accurate masks tracing needs; a dedicated local saliency model met the underlying local-only outcome. | Capability over brand; right outcome, wrong mechanism |
| [#13: InSPyReNet](https://github.com/tracefinity/tracefinity/issues/13) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/13) | A local saliency implementation was selected on measured accuracy, latency, local operation, and failure behaviour. | Complete local path; evidence-based model choice |
| [#21: saliency-model evaluation](https://github.com/tracefinity/tracefinity/issues/21) | [Issue](https://github.com/tracefinity/tracefinity/issues/21), [benchmark and decision](https://github.com/tracefinity/tracefinity/issues/21#issuecomment-4187296005) | Models were compared on quality, CPU time, memory, maturity, and licence; non-commercial and unsuitable options were rejected. The preferred default changed when evidence changed. | Model/provider fitness; licensing; resources |
| [#96: local AI models](https://github.com/tracefinity/tracefinity/issues/96) | [Comment](https://github.com/tracefinity/tracefinity/issues/96#issuecomment-4767446016) | Existing local segmentation models already met the need; general-purpose models lacked the operation and precision required. | Capability over brand; smallest adequate mechanism |
| [#81: model memory management](https://github.com/tracefinity/tracefinity/issues/81) | [Comment](https://github.com/tracefinity/tracefinity/issues/81#issuecomment-4711562551) | Loading/unloading policy, cooldown, and cold-start complexity were avoided in favour of selecting the existing lower-memory tracer. | Right outcome, simpler mechanism |
| [#82: backup documentation](https://github.com/tracefinity/tracefinity/issues/82) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/82) | Documented copying of the plain-file storage volume replaced application-level backup/restore code. | Data portability at the correct layer |
| [#5: STL preview performance](https://github.com/tracefinity/tracefinity/issues/5) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/5) | Twenty-to-thirty-second previews on weaker hosts made geometry performance a product concern, not merely an internal optimisation. | Architectural and performance cost |
| [#50: non-root container](https://github.com/tracefinity/tracefinity/issues/50) | [Comment](https://github.com/tracefinity/tracefinity/issues/50#issuecomment-4613328737) | Root-owned bind-mount files harmed self-hosted users; non-root operation and UID/GID handling were accepted enabling work. | Secure, usable self-hosting |
| [#63: pnpm migration](https://github.com/tracefinity/tracefinity/issues/63) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/63) | Dependency isolation and lifecycle-script controls justified non-feature work. | Supply-chain security; maintainability |
| [#84: hardware question](https://github.com/tracefinity/tracefinity/issues/84) | [Comment](https://github.com/tracefinity/tracefinity/issues/84#issuecomment-4746048656) | The answer stated realistic architecture and combined RAM floors; remote tracing did not remove the local paper-detection requirement. | Honest self-hosting requirements |
| [#87: multi-arch images](https://github.com/tracefinity/tracefinity/issues/87) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/87) | Platform support was widened while retaining explicit hardware minimums. | Self-hosting enablement |
| [#88: resource documentation](https://github.com/tracefinity/tracefinity/issues/88) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/88) | CPU, RAM, disk, model, Docker, and Helm requirements became a canonical documentation concern. | Honest resource disclosure |
| [#94: NAS volume permissions](https://github.com/tracefinity/tracefinity/issues/94) | [Comment](https://github.com/tracefinity/tracefinity/issues/94#issuecomment-4752698558) | Optional PUID/PGID mapping supported NAS deployments while leaving the default path unchanged. | Deployment adaptability; safe defaults |
| [#125: Helm defaults](https://github.com/tracefinity/tracefinity/issues/125) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/125) | An RWO upgrade deadlock and a fresh-install-breaking secret default were treated as product-operability defects. | Deployment correctness; safe defaults |
| [#174: STL concurrency](https://github.com/tracefinity/tracefinity/issues/174) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/174) | An optional environment control addressed resource pressure while retaining existing unlimited behaviour by default. | Operational policy through configuration |
| [#189: frontend tests not running](https://github.com/tracefinity/tracefinity/issues/189) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/189) | Green-looking output hid that component tests did not load and CI did not run them. | Honest verification; maintainability |
| [#66: store load failures](https://github.com/tracefinity/tracefinity/issues/66) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/66) | Permission failures were converted into empty cached stores and successful empty API responses; failures needed to remain visible and retryable. | Non-destructive, visible data failure |
| [#98: trace-editor navigation](https://github.com/tracefinity/tracefinity/issues/98) | [Detailed specification](https://github.com/tracefinity/tracefinity/issues/98#issuecomment-5083550682) | Zoom and pan were specified to preserve coordinate accuracy, hit targets, undo semantics, and touch editing during fine correction. | Inspectable and correctable automation |
| [#107: paper-alignment zoom](https://github.com/tracefinity/tracefinity/issues/107) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/107) | Small corner-placement errors become millimetre-scale errors in every output dimension. | Physical fidelity; correction tooling |
| [#118: cutouts crossing walls](https://github.com/tracefinity/tracefinity/issues/118) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/118) | Oversized tools must leave structurally intact walls and the preview must match the exported STL. | Structural safety; preview/export parity |
| [#121: labels in disabled cells](https://github.com/tracefinity/tracefinity/issues/121) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/121) | Floating label geometry was rejected and preview/output agreement was required. | Printable geometry; representation fidelity |
| [#141: fractional label rows](https://github.com/tracefinity/tracefinity/issues/141) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/141) | Physical cell indexing had to match UI/layout meaning for fractional Gridfinity bins, with regression coverage. | Cross-layer physical fidelity |
| [#150: photo warnings](https://github.com/tracefinity/tracefinity/issues/150) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/150) | Quantified, non-blocking warnings should appear before users invest in tracing or printing and degrade gracefully when evidence is unavailable. | Early, actionable user control |
| [#151: camera-distance guide](https://github.com/tracefinity/tracefinity/issues/151) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/151) | Documentation was the adequate remedy for predictable perspective oversizing. | Physical accuracy; smallest adequate mechanism |
| [#156: project cache eviction](https://github.com/tracefinity/tracefinity/issues/156) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/156) | Deleted data could be rewritten from stale memory; deletion had to remain effective. | Data deletion integrity |
| [#160: deletion/write race](https://github.com/tracefinity/tracefinity/issues/160) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/160) | In-flight references could resurrect deleted user data; the fix required synchronisation and regression proof. | Data deletion integrity; concurrency safety |
| [#184: smoothing straight edges](https://github.com/tracefinity/tracefinity/issues/184) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/184) | Cosmetic smoothing introduced millimetre-scale physical error and prevented tools fitting; frontend/backend parity was required. | Fit and physical fidelity |
| [#185: invisible traced outlines](https://github.com/tracefinity/tracefinity/issues/185) | [Maintainer-authored issue](https://github.com/tracefinity/tracefinity/issues/185) | Invisible results and misleading instructions dead-ended the core workflow after tracing. | Inspectability; accessible recovery |
| [#186: silently discarded bin edits](https://github.com/tracefinity/tracefinity/issues/186) | [Issue](https://github.com/tracefinity/tracefinity/issues/186), [root cause](https://github.com/tracefinity/tracefinity/issues/186#issuecomment-5368199105), [mitigation and remaining decision](https://github.com/tracefinity/tracefinity/issues/186#issuecomment-5368427234) | The editor showed success while rejecting a whole save for a state it had allowed. The mitigation stopped the rejection but explicitly left the product boundary as a separate decision. | Visible failure; preserve valid work; bug versus design decision |

## Substantive closed-pull-request evidence

| Closed item | Maintainer evidence | Rationale | Theme |
|-|-|-|-|
| [#6: replace OCCT with manifold3d](https://github.com/tracefinity/tracefinity/pull/6) | [Maintainer-authored merged PR](https://github.com/tracefinity/tracefinity/pull/6) | The geometry backend was replaced for a measured 10–100x boolean speedup and to remove a heavy dependency. | Architecture and permanent backend cost |
| [#31: surface insert failures](https://github.com/tracefinity/tracefinity/pull/31) | [Initial assessment](https://github.com/tracefinity/tracefinity/pull/31#issuecomment-4305685490), [review](https://github.com/tracefinity/tracefinity/pull/31#pullrequestreview-4163840234) | Observability was useful, but it did not solve the reported missing-insert outcome; the PR changed from `Closes` to `Ref` and left the issue open. User-facing errors also had to be actionable rather than point at inaccessible server logs. | Honest scope; partial work must not claim closure |
| [#38: GPU BiRefNet](https://github.com/tracefinity/tracefinity/pull/38) | [Do not make GPU runtime default](https://github.com/tracefinity/tracefinity/pull/38#discussion_r3184885325), [keep GPU model opt-in](https://github.com/tracefinity/tracefinity/pull/38#discussion_r3184888369), [validate lazy configuration](https://github.com/tracefinity/tracefinity/pull/38#discussion_r3219407014) | A default that breaks macOS and pulls gigabytes of irrelevant NVIDIA libraries was rejected; specialised acceleration stayed opt-in and bad configuration still needed early failure. | Safe defaults; platform support; model fitness |
| [#42: paper-corner performance](https://github.com/tracefinity/tracefinity/pull/42) | [Review](https://github.com/tracefinity/tracefinity/pull/42#pullrequestreview-4271378904) | A local, standard interaction pattern was accepted as a clean and well-scoped performance improvement. | Focused contribution; interaction quality |
| [#45: project planning](https://github.com/tracefinity/tracefinity/pull/45) | [Direction comment](https://github.com/tracefinity/tracefinity/pull/45#issuecomment-4491597987), [manual rebase merge note](https://github.com/tracefinity/tracefinity/pull/45#issuecomment-4547206283) | Planning tools across multiple bins and a drawer was explicitly welcomed and integrated. | Completing the storage workflow |
| [#51: automatic tool naming](https://github.com/tracefinity/tracefinity/pull/51) | [Architecture review](https://github.com/tracefinity/tracefinity/pull/51#pullrequestreview-4419377753), [timeout review](https://github.com/tracefinity/tracefinity/pull/51#discussion_r3451548035) | Optional naming should sit behind a small capability interface, not bake four providers and their lifecycle into the core. Provider timeout mechanisms should not race one another. | Capability-oriented adapters; proportional complexity |
| [#52: default bin settings](https://github.com/tracefinity/tracefinity/pull/52) | [Review](https://github.com/tracefinity/tracefinity/pull/52#pullrequestreview-4419314626) | Explicit project choices must beat broader local defaults; unrelated developer tooling should not ride in a feature PR; new persistence paths need failure and round-trip coverage. | User choice precedence; focused PRs; persistence safety |
| [#53: photo-station workflow](https://github.com/tracefinity/tracefinity/pull/53) | [Review](https://github.com/tracefinity/tracefinity/pull/53#pullrequestreview-4419360003) | A good feature was declined in a 2,926-line, four-concern form because review and rollback were unsafe; deletion ordering, state sprawl, duplication, and silent corrupt-data reset also needed correction. | Contribution scope; reversible architecture; data safety |
| [#54: filleted cutouts](https://github.com/tracefinity/tracefinity/pull/54) | [Review](https://github.com/tracefinity/tracefinity/pull/54#pullrequestreview-4419313778) | A frontend/backend radius mismatch meant the preview would not match the print, and geometry orientation could not rely on an unverified implicit correction. | Preview/export parity; geometry correctness |
| [#56: backup and restore](https://github.com/tracefinity/tracefinity/pull/56) | [Product decision](https://github.com/tracefinity/tracefinity/pull/56#issuecomment-4702507666), [safety review](https://github.com/tracefinity/tracefinity/pull/56#pullrequestreview-4419361128) | Plain-file copying and documentation solved the user need without new APIs and state. The submitted restore also risked data loss on partial failure and accepted unbounded uploads. | Right outcome, wrong layer; atomic data replacement |
| [#69: reduced motion](https://github.com/tracefinity/tracefinity/pull/69) | [Maintainer-authored merged PR](https://github.com/tracefinity/tracefinity/pull/69) | Operating-system reduced-motion preference was honoured without removing the static explanation. | Accessibility as enabling work |
| [#72: freeform bins](https://github.com/tracefinity/tracefinity/pull/72) | [Closure rationale](https://github.com/tracefinity/tracefinity/pull/72#issuecomment-4702528306) | Non-Gridfinity bins created a parallel sizing model and recurring double reasoning without serving the tracing-to-Gridfinity workflow. | Output boundary; permanent conceptual cost |
| [#77: remote saliency providers](https://github.com/tracefinity/tracefinity/pull/77) | [Maintainer-authored merged PR](https://github.com/tracefinity/tracefinity/pull/77) | Hosted saliency swapped only the capability step, kept OpenCV local, disclosed photo transit and retention, mapped provider failures, and remained optional. | Provider adapters; privacy; local path |
| [#79: Helm and Compose](https://github.com/tracefinity/tracefinity/pull/79) | [Single-writer warning](https://github.com/tracefinity/tracefinity/pull/79#discussion_r3409996732), [realistic memory](https://github.com/tracefinity/tracefinity/pull/79#discussion_r3434332156), [preserve PVC data](https://github.com/tracefinity/tracefinity/pull/79#discussion_r3451025854), [avoid RWO upgrade deadlock](https://github.com/tracefinity/tracefinity/pull/79#discussion_r3451025856) | Deployment support had to respect the application's single-writer architecture, real model resources, persistent user data, and storage upgrade semantics. | Operable self-hosting; data safety; honest defaults |
| [#111: optional auth middleware](https://github.com/tracefinity/tracefinity/pull/111) | [Maintainer-authored merged PR](https://github.com/tracefinity/tracefinity/pull/111) | A standalone install without a proxy secret should still start, while configured middleware should enforce authentication. | Single-user-first self-hosting |
| [#112: partial bins](https://github.com/tracefinity/tracefinity/pull/112) | [Review](https://github.com/tracefinity/tracefinity/pull/112#pullrequestreview-4586116487) | The Gridfinity extension was accepted only with correct bed-fit semantics, a guard against all-disabled invalid geometry, and awareness of floating labels. | Compatible extension; valid physical states |
| [#127: label handling](https://github.com/tracefinity/tracefinity/pull/127) | [Scope review](https://github.com/tracefinity/tracefinity/pull/127#pullrequestreview-4639308985), [false-positive test finding](https://github.com/tracefinity/tracefinity/pull/127#discussion_r3531709284) | A narrow disabled-cell fix was preferred over rewriting every label surface. The broader rewrite silently destroyed recessed labels while weak tests still passed. | Smallest safe slice; tests must prove the physical outcome |
| [#134: SVG import](https://github.com/tracefinity/tracefinity/pull/134) | [Closure rationale](https://github.com/tracefinity/tracefinity/pull/134#issuecomment-4993340069) | SVG import would turn the product into a general outline-to-bin converter; the boundary could be revisited if community demand appeared. | Photographic-input boundary; evidence can change direction |
| [#135: photo-station backend](https://github.com/tracefinity/tracefinity/pull/135) | [Orphaned-upload finding](https://github.com/tracefinity/tracefinity/pull/135#discussion_r3652426291), [backward-compatibility finding](https://github.com/tracefinity/tracefinity/pull/135#discussion_r3652426294), [copy-failure test](https://github.com/tracefinity/tracefinity/pull/135#discussion_r3652426299), [corrupt-store warning](https://github.com/tracefinity/tracefinity/pull/135#discussion_r3652426301) | A core-aligned feature still had to avoid leaked files, preserve old sessions, prove source survival on copy failure, and retain evidence of corrupt long-lived data. | Data lifecycle; compatibility; failure-path testing |
| [#136: photo-station UI](https://github.com/tracefinity/tracefinity/pull/136) | [Partial-fetch resilience](https://github.com/tracefinity/tracefinity/pull/136#discussion_r3652450711), [contrast requirement](https://github.com/tracefinity/tracefinity/pull/136#discussion_r3652450713), [race guard](https://github.com/tracefinity/tracefinity/pull/136#discussion_r3652450719) | One failed optional request must not blank unrelated dashboard data; status UI must remain accessible; repeat and stale requests must not overwrite newer choices. | Partial failure; accessibility; async user control |
| [#138: dashboard defaults](https://github.com/tracefinity/tracefinity/pull/138) | [Closure analysis](https://github.com/tracefinity/tracefinity/pull/138#issuecomment-5083473084) | The submitted change did not alter fresh-install defaults as claimed; its actual effect was wiping saved collapse choices once. | A contribution must deliver its stated outcome and disclose side effects |
| [#146: OpenRouter naming](https://github.com/tracefinity/tracefinity/pull/146) | [Review](https://github.com/tracefinity/tracefinity/pull/146#pullrequestreview-4755803588), [bounded provider delay](https://github.com/tracefinity/tracefinity/pull/146#discussion_r3631367809), [fallback semantics](https://github.com/tracefinity/tracefinity/pull/146#discussion_r3631367812) | Provider fallthrough was useful, but needed working tests, documented image transit, bounded server-controlled delay, and deliberate fallback behaviour. | Provider fitness; privacy; resilience; verification |
| [#162: tool filters](https://github.com/tracefinity/tracefinity/pull/162) | [Review](https://github.com/tracefinity/tracefinity/pull/162#pullrequestreview-4954169954) | A visible count-semantic change was acceptable but should be identified even though it was outside the PR summary. | Honest contribution description |
| [#164: manifold export repair](https://github.com/tracefinity/tracefinity/pull/164) | [Review](https://github.com/tracefinity/tracefinity/pull/164#pullrequestreview-5002085485) | The non-manifold export was reproduced and the proposed physical fix confirmed before approval. | Outcome-based verification |
| [#179: proxy namespaces](https://github.com/tracefinity/tracefinity/pull/179) | [Maintainer-authored merged PR](https://github.com/tracefinity/tracefinity/pull/179) | Standalone requests remained simple, but a client could not select another user's namespace without a configured trusted-proxy secret. | Single-user-first without security by obscurity |

## Themes already captured in the constitution

The current `CONSTITUTION.md` agrees with the closed history on the major
product decisions:

- **One photo-to-Gridfinity product, not a general converter.** PRs #72 and
  #134 directly establish the output and input boundaries. PR #45 shows that
  drawer and multi-bin planning can complete the same job rather than create a
  second product.
- **Compatible Gridfinity extensions are welcome.** Issue #101 and merged PR
  #112 support half-grid and partial-cell variants while their reviews insist
  on valid geometry and ecosystem interoperability.
- **Self-hosting is a complete path, not a universal hardware promise.** Issues
  #84, #87, and #88, PRs #38, #79, #93, and #124, and the local model work all
  support plain resource requirements, graceful degradation, and safe defaults.
- **Capabilities outrank provider brands.** Issues #11, #21, and #96 and PRs
  #51, #77, and #146 support capability adapters, technically suitable model
  classes, optional remote providers, transit disclosure, and licensing as a
  selection criterion.
- **Users must be able to see and correct consequential results.** The current
  early-warning, partial-failure, and preview/export language is strongly
  supported by issues #98, #107, #118, #121, #150, #184, #185, and #186.
- **Security, accessibility, deployment, data safety, and maintainability have
  their own route into scope.** Issues #50, #63, #66, #125, and #189 and PRs
  #69, #79, #111, and #179 show that these do not need feature-demand evidence.
- **Scope and implementation quality are separate.** PRs #53, #54, #112,
  #127, #135, and #136 concern aligned features whose submitted shape still
  needed to become focused, safe, compatible, and verifiable.
- **Use the smallest adequate mechanism.** Issue #81 and the #56/#82 backup
  sequence support configuration or documentation when new application state
  is unnecessary.
- **Direction can change with evidence.** PR #134 expressly left room to
  reconsider if demand emerged, and issue #21 shows defaults changing after
  measurement. Neither says that demand automatically overrides a boundary.

The branch's updated `CONTRIBUTING.md` and `DESIGN.md` also correctly keep
several repeated engineering precedents out of the product constitution:
focused PRs, honest `Closes` semantics, changed-behaviour tests, atomic data
replacement, preservation of corrupt files, safe configuration defaults, and
provider adapters are implementation and contribution rules rather than new
product modes.

## Changes made after the audit

The review found two small data-lifecycle ambiguities, both now addressed in the
constitution.

### 1. Make deletion non-resurrection explicit

The current data paragraph prevents silent discard or overwrite, but issues
#156 and #160 establish a different invariant: once a user deletes data, stale
caches and in-flight work must not recreate it.

The constitution now says that a deletion must stay deleted and stale state or
in-flight saves must not bring the data back.

### 2. Clarify what fulfils the data-export promise

“Users ... must be able to export” could be read as promising an application
API or button, while the closed #56/#82 decision deliberately chose documented
plain-file copying. The outcome is practical portability, not a mandated UI.

The constitution now says that a dependable, documented operation on the
plain-file storage can meet the need without dedicated application screens or
APIs.

### Precedent-link precision

This was a citation improvement rather than a policy change. The partial-bin
issue #106 is closed but contains no maintainer-authored rationale. In the
precedent table, the implemented and reviewed closed PR #112 now replaces issue
#106. The #72, #134, #56, and #11 entries now land directly on their decisive
comments.

## Contradictions, changed positions, and caveats

- **The proposed GitHub taxonomy is new.** Old declined or redirected issues
  #11, #81, and #96 are all closed as `Completed`. Calling them `NOT A PRODUCT
  FEATURE as proposed` is a useful retrospective constitutional classification,
  not a label that existed when Jason closed them.
- **Corrupt-data handling became stricter.** PR #67 distinguished unreadable
  storage from corrupt JSON but still tolerated some corrupt-data resets. The
  later #53 review asked that long-lived corrupt station data be preserved, and
  the current design rules adopt that safer position. This is an evolved rule,
  not an unresolved constitutional conflict.
- **Specific model defaults have changed.** Issue #21 records a historical
  preferred local model, while later resource and provider work changed the
  available/default set. That is consistent with capability-over-brand and
  evidence-based defaults; the constitution should not freeze a model name.
- **The paid-hosting history is ambiguous.** Closed issue
  [#14](https://github.com/tracefinity/tracefinity/issues/14) and its
  [support comment](https://github.com/tracefinity/tracefinity/issues/14#issuecomment-4093626330)
  show that a “Pro Subscription” and “free tier” existed, but do not show
  whether the distinction was hosted quota/capacity or subscriber-only product
  functionality. Quotas fit the constitution; withholding core product
  features would not. #14 supplies no product rationale and must not be cited as
  precedent for either interpretation without further first-party evidence.
- **Demand mechanics are more formal than the history.** PR #134 supports
  reconsideration when demand appears, but the exact reactions/comments/
  duplicates workflow in the constitution is a new operating convention. It is
  compatible with precedent, not derived from an old threshold.

## Bottom line

The constitution is faithful to the maintainer's closed-item record. Its central
boundaries are not newly invented: #72 and #134 state them directly, and the
accepted work consistently deepens the same photo-to-Gridfinity job. The main
historical material missing from the first draft—physical fidelity, visible
partial failure, realistic self-hosting requirements, and contribution safety—
is now present across the constitution, design principles, and contribution
guide. The two data-lifecycle clarifications above close the remaining
ambiguities without widening the product.
