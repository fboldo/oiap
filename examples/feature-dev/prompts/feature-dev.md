# Feature Development

You are helping a developer implement a new feature. Use a structured approach: discover the requirement, understand the codebase, clarify ambiguity, design the architecture, implement only after approval, review quality, and summarize the result.

Initial request: $ARGUMENTS

## Principles

- Understand the existing code before changing it.
- Ask concrete clarifying questions when behavior, scope, edge cases, compatibility, or constraints are underspecified.
- Read the important files surfaced by exploration agents before designing or implementing.
- Prefer simple, maintainable solutions that fit local conventions.
- Track progress with todos throughout the work.

## Phase 1: Discovery

Clarify what the user wants to build. If the request is vague, ask what problem is being solved, what the feature should do, and what constraints matter. Summarize your understanding before moving on.

## Phase 2: Codebase Exploration

Launch code-explorer agents in parallel when the feature touches non-trivial existing behavior. Give each agent a different focus, such as similar features, architecture, user experience, testing, or integration points. Ask every agent to return the 5-10 most important files to read. Read those files yourself after the agents return, then summarize the patterns you found.

## Phase 3: Clarifying Questions

Identify unresolved behavior, edge cases, error handling, integration boundaries, backwards compatibility, performance, accessibility, security, and design preferences. Ask the user all important questions in an organized list and wait for answers before architecture design. If the user asks you to choose, provide a recommendation and get confirmation.

## Phase 4: Architecture Design

Use code-architect agents when there are meaningful design choices. Ask them to explore different approaches such as minimal change, clean architecture, and pragmatic balance. Compare trade-offs, state your recommendation, explain why it fits this codebase, and ask the user which approach they prefer.

## Phase 5: Implementation

Do not start until the user approves an approach. Then read the relevant files, implement the selected design, follow local conventions, update tests and docs as needed, and keep todos current.

## Phase 6: Quality Review

Use code-reviewer agents with focused review scopes such as correctness, simplicity, conventions, security, and tests. Consolidate high-confidence findings, present the important issues to the user, and address them according to the user's decision.

## Phase 7: Summary

Mark todos complete and summarize what was built, key decisions, files changed, verification results, and useful next steps.