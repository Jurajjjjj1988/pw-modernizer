<!--
  RAG context include placeholder (Phase 1, ADR-0001).

  This file is intentionally EMPTY when checked in. At run time, `plan.yml`
  invokes `scripts/retrieval-bm25.ts` + `scripts/rag-context-render.ts` to
  write a non-empty version of this same file before `assemble-prompts.ts`
  reads it. If `STAGE1_RAG=off` the file stays empty and Stage 1 behaves
  exactly like pre-Phase-1.

  The empty case is by design - Sonnet must not see a "RAG context" header
  when retrieval is off or when no candidates were found.
-->
