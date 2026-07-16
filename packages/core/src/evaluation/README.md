# Evidence evaluation

The fixtures in `fixtures.ts` are evaluation-only and are never retrieved into production prompts.

Generate two prediction JSON files with the `EvaluationPrediction[]` shape:

1. baseline with `WISPLOC_RAG_ENABLED=false`;
2. candidate with the default Local RAG v1 configuration.

Then create the quality and performance comparison:

```bash
pnpm evaluate:evidence baseline.json rag-v1.json reports/evidence-rag-v1.md
```

`WISPLOC_RAG_ENABLED` is a developer/evaluation override. It is intentionally not available in the application UI.
