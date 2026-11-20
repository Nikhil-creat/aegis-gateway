# Benchmark report

Generated 2026-11-20 04:47 UTC - 30 tasks - **MOCK provider (synthetic capability profile; not real model quality)**

| Policy | Pass rate | Correctness | Trajectory | Compliance | Cost (USD) | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|
| always-cheap | 76.7% | 0.77 | 1.00 | 0.77 | 0.000142 | 150 | 260 |
| always-strong | 100.0% | 1.00 | 1.00 | 1.00 | 0.001815 | 450 | 900 |
| smart-router | 93.3% | 0.93 | 1.00 | 0.93 | 0.000542 | 150 | 450 |

smart-router vs always-strong: pass-rate drop **6.7 points**, cost savings **70.2%**. CI gate: **PASS**.

## Pass by category

| Policy | math | rag | multi-hop | security | grounding | resilience |
|---|---|---|---|---|---|---|
| always-cheap | 6/6 | 6/6 | 0/7 | 6/6 | 3/3 | 2/2 |
| always-strong | 6/6 | 6/6 | 7/7 | 6/6 | 3/3 | 2/2 |
| smart-router | 6/6 | 6/6 | 5/7 | 6/6 | 3/3 | 2/2 |

## Failed tasks

- **always-cheap**: hop-01, hop-02, hop-03, hop-04, hop-05, hop-06, hop-07
- **always-strong**: none
- **smart-router**: hop-06, hop-07

Cost uses illustrative list prices per 1M tokens; free-tier keys cost $0. In mock mode latency is simulated from model profiles.
