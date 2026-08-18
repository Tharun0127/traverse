# Skill: Repository Triage

A skill file for an agent asked to orient itself in an unfamiliar repository before making changes.

## When to use this skill

Use this when you are dropped into a repository you have not seen and asked to make a change. Do not use it for a repository you have already mapped in this session — re-running the full triage wastes context you already hold.

## Step 1: Establish the shape

Read the manifest before any source file. `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, or `pom.xml` tells you the language, the toolchain, the test runner, and the entry points in a few hundred tokens.

Never begin by listing every file recursively. On a large repository this floods context with paths that carry almost no information.

## Step 2: Find the entry points

Entry points are declared, not discovered. Look at the `main`, `bin`, or `scripts` field in the manifest, then the framework convention for the language. A web service has a server bootstrap; a CLI has a command registry; a library has an index module that re-exports the public surface.

Reading the entry point tells you the composition of the system in one file. Reading twenty leaf modules tells you almost nothing about how they connect.

## Step 3: Locate the tests

Tests are the cheapest specification available. A test file for a module tells you the intended behaviour, the edge cases the authors worried about, and the fixtures that represent real data.

If the change you are asked to make has an existing test, read it before reading the implementation.

## Step 4: Map the dependency direction

Determine which modules depend on which. The direction matters more than the count: a module everything imports is a place where a change is expensive, and a leaf module is a place where a change is cheap.

Prefer making changes at the leaves. If a change must be made at a hub, say so explicitly before starting, because the blast radius is a decision the human should make.

## Step 5: Check the conventions

Before writing code, read two or three files adjacent to where you will be working. Match their import style, error handling, naming, and comment density. A change that is correct but stylistically foreign will be rejected in review.

Look for a linter or formatter config. If one exists, its rules are not suggestions.

## Anti-patterns

Do not read files speculatively "for context". Every file you read that does not inform the change is pure cost.

Do not summarise the repository back to the user unless asked. They know their repository. They want the change.

Do not rewrite code you were not asked to rewrite. An unrequested refactor buried in a bug fix makes the diff unreviewable.

Do not assume a test suite passes before your change. Run it first, so you can tell your breakage from pre-existing breakage.

## Budget guidance

Triage should cost under fifteen percent of your total context budget. If you have read more than a dozen files and still cannot state what the system does in two sentences, stop reading and ask a question instead.

The failure mode to avoid is exhausting context on orientation and having nothing left for the actual work.
