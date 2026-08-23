# Tracefinity product constitution

Tracefinity has one job: turn photos or scans of physical objects into fitted,
printable storage that belongs in the Gridfinity system.
It covers the work around that job too, from correcting a trace to planning a
drawer full of bins.

This is how we test feature requests. It records the project's current
direction, not scripture. Jason maintains that direction and makes the final
scope calls, informed by contributors, community interest, and what people
actually use. These principles can change when the evidence or the needs of the
project change.

The [closed-item precedent audit](docs/scope-precedent-audit.md) records where
these rules came from. It is supporting history; this document is the product
guide.

## What we promise

### Free, open source, and self-hostable

Tracefinity will remain free, open source, and self-hostable. The hosted service
exists for people who would rather not run it themselves and helps fund the
project. It will not reserve product features for subscribers.

Installing Tracefinity may involve downloading container images, model weights,
or dependencies. Once it is installed and its local models are available, the
core workflow must work without an account, API key, cloud service, or ongoing
network connection. Remote services can improve or extend that workflow, but
they cannot become the only way through it.

Self-hostable does not mean every model must run on every machine. CPU, memory,
architecture, and model requirements should be documented plainly so people can
choose suitable hardware, a lighter local model, or an optional remote provider.

### User control

Automation should do the tedious work without trapping the user in a bad
result. Traces and other decisions that affect the physical output must be
inspectable and correctable. Optional enrichment, such as automatic names or
categories, should fail without taking the rest of the workflow down.

Failures must be visible and useful. A partial success must not look like a full
success, and rejecting one invalid change should not silently discard unrelated
valid work. Warn early when a capture or configuration is likely to produce a
poor physical result, without blocking uncertain but potentially valid work.
Where the preview is used to make physical decisions, it must agree with the
geometry that will actually be exported for printing.

Users own their data and must be able to export and delete it. Running locally
must not send photos or project data to another service unless the user chooses
a remote provider. When data does leave the installation, the product must say
where it goes and what is known about retention. Original photos should not be
kept longer than the workflow needs them. Recoverable data must not be silently
discarded or overwritten when a load, save, migration, or restore fails. A
deletion must stay deleted; stale state or an in-flight save must not bring the
data back.

Export and backup do not automatically require dedicated application screens or
APIs. A dependable, documented operation on Tracefinity's plain-file storage can
meet the need with less product machinery.

### Single-user first, not security by obscurity

Most installations will have one user. Native authentication, isolated user
workspaces, and basic site administration are still in scope so that an exposed
or hosted instance can protect people's data. When native users are introduced,
a fresh installation should prompt for its first administrator credentials.

Shared projects, team workspaces, invitations, and fine-grained collaboration
permissions are a different product direction. They need a fresh scope decision.

### Capability over brand coverage

Tracefinity uses the model or service class that fits the job. A request to
support a named AI platform is not valuable by itself. Local and hosted models
are judged on output quality, resource use, data handling, licensing, stability,
cost, demand, and the maintenance cost of their adapter. Hosted providers remain
optional and must fit a capability-oriented interface rather than spreading
provider assumptions through the product.

## The product boundary

A core product feature must deepen the photo-to-Gridfinity workflow without
creating a parallel input or output product. Work needed to keep that product
secure, reliable, accessible, maintainable, documented, and deployable has its
own route into scope.

### Input: a photo or scan of a real object

The intended starting point is an image captured from a real physical object,
normally a camera photo or flatbed scan. The object can be a workshop tool,
electronic component, craft supply, kitchen utensil, or anything else someone
wants to fit into Gridfinity storage.

Calibration methods, manual masks, and extensive outline editing are in scope
when they correct or complete that workflow. We do not need to police the origin
of every uploaded pixel. We do need to avoid building an alternative starting
workflow around authored geometry.

SVG, DXF, STL, and similar outline imports are out. So are blank-canvas drawing
and general 2D-to-3D conversion.

### Output: Gridfinity-native storage

The output must be modelled primarily in Gridfinity terms. It must preserve
interoperability at every interface it claims to support, including baseplate
fit, grid spacing, occupied footprint, clearance from neighbouring bins, and
stacking or mating behaviour where applicable.

Established community extensions such as half-grid and partial-cell layouts are
welcome when they compose predictably with the wider Gridfinity system. The
exact community conventions can evolve without an amendment to this document;
interoperability is the invariant.

An arbitrary object does not become in scope because a Gridfinity base can be
attached to it. Freeform millimetre-sized bins, non-Gridfinity storage systems,
and generic host-model imports create another geometry product and are out.

Export formats are representations, not new product modes. STL, 3MF, SVG, STEP,
or another format can be in scope when it represents an allowed Tracefinity
design. The cost of supporting that representation is a separate decision.

### Workflow: finish the storage job

Tracefinity may help users select photographed objects, organise them into
projects, arrange bins in a drawer, pack layouts, produce files, locate designs,
and modify or reproduce earlier work. These features complete the storage job
rather than merely converting one image.

Generic inventory, purchasing, asset management, filament tracking, and print
farm orchestration are out. A useful warning sign is that a feature would retain
almost all of its value if both photos and Gridfinity disappeared.

### Enabling work

Security, correctness, data safety, reliability, accessibility, documentation,
deployment, and maintainability do not need to move a photo through the pipeline
to belong here. They qualify when they protect or enable the core product without
introducing a second product mode.

Service-only billing, quotas, monitoring, backups, and abuse controls can exist
around the hosted deployment. They are operating concerns, not a proprietary
feature tier in the core application.

## How we decide

Scope and priority are separate gates.

### Gate 1: does it belong?

Start with the user outcome, not the implementation they requested.

- Does it begin with a photo or scan and end in Gridfinity-native storage, or
  directly help complete that workflow?
- Does it introduce a new input mode based on authored geometry?
- Does it introduce a parallel output geometry or break Gridfinity
  interoperability?
- Does it preserve the free, open-source, self-hosted product and a complete
  local path?
- If it is enabling work, does it protect or operate the core product without
  widening the product itself?

The result is one of four scope decisions:

- `IN SCOPE`: eligible for prioritisation.
- `CONSTITUTIONAL QUESTION`: plausible, but it changes or exposes a boundary
  that Jason needs to decide.
- `OUT OF SCOPE`: conflicts with a settled boundary.
- `NOT A PRODUCT FEATURE`: the need is real, but configuration, documentation,
  deployment, or another existing layer is the better home.

### Gate 2: is it worth doing now?

An in-scope idea is not a promise. Consider:

- demonstrated user value and demand;
- improvement to the core workflow;
- the smallest adequate way to solve the outcome;
- fitness of the proposed technology;
- permanent conceptual, state, API, and maintenance cost;
- architectural duplication and opportunity cost.

Security, correctness, accessibility, and prevention of data loss do not need a
popularity contest. For ordinary features, weak demand is a good reason to wait.
A ready pull request proves feasibility, not demand or product fit.

## Reconsidering a decision

Out-of-scope and low-demand requests should be closed as `Not planned` but left
unlocked. Use one canonical request for each declined theme, link the principle
behind the decision, and say what would make it worth another look.

Emoji reactions, substantive comments, duplicate requests, and reopenings are
all useful signals. There is no vote threshold and no automatic constitutional
amendment. New interest prompts human re-triage; Jason decides whether the
evidence changes the project's direction.

Keep scope and implementation status separate in GitHub:

- `scope:in-scope`
- `scope:needs-decision`
- `scope:out-of-scope`
- `status:needs-demand`
- `status:blocked-by-cost`
- `status:needs-retriage`

`status:needs-retriage` is a prompt for human review when a closed request gets
new interest. It does not change the request's scope verdict or reopen it by
itself.

When this direction changes, update this document through a maintainer-approved
pull request and update the affected precedent or canonical request. Changing
our mind when the facts change is maintenance, not inconsistency.

## Precedents

These examples show how the two gates differ. The linked GitHub threads carry
the full discussion.

| Request | Decision | Why | Reconsider when |
|-|-|-|-|
| [#72: freeform bins](https://github.com/tracefinity/tracefinity/pull/72#issuecomment-4702528306) | `OUT OF SCOPE` | Added arbitrary millimetre-sized output and a parallel bin model | The project deliberately changes its Gridfinity-only output boundary |
| [#134: SVG import](https://github.com/tracefinity/tracefinity/pull/134#issuecomment-4993340069) | `OUT OF SCOPE` | Bypassed raster capture and tracing with authored outlines | Community evidence justifies reconsidering the photographic-input boundary |
| [#45: project planning](https://github.com/tracefinity/tracefinity/pull/45) | `IN SCOPE` | Planning traced tools across bins and drawers completes the core storage workflow | Not applicable |
| [#101: half-grid bins](https://github.com/tracefinity/tracefinity/issues/101) and [#112: partial bins](https://github.com/tracefinity/tracefinity/pull/112) | `IN SCOPE` | Community-compatible extensions keep Gridfinity as the organising model | Not applicable |
| [#56: backup API](https://github.com/tracefinity/tracefinity/pull/56#issuecomment-4702507666) | `NOT A PRODUCT FEATURE` as proposed | Copying the plain-file storage volume and documenting it solved the need without new UI, API, or state | The platform-level approach becomes unsafe or unreasonably difficult |
| [#11: Ollama saliency](https://github.com/tracefinity/tracefinity/issues/11#issuecomment-4085938154) | `NOT A PRODUCT FEATURE` as proposed | A general LLM-serving interface was the wrong tool for pixel-level saliency; dedicated local models met the underlying need | A provider offers a technically suitable and well-supported saliency capability |
