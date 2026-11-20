# Learned router study

CNN: 4161 parameters, NumPy, trained on 3000 synthetic prompts; evaluated on 1000 held-out prompts built from disjoint phrase pools.

| Router | Accuracy | Precision (strong) | Recall (strong) |
|---|---|---|---|
| heuristic | 61.4% | 100.0% | 22.8% |
| char-CNN | 91.9% | 87.5% | 97.8% |

p(strong) on the two hidden multi-hop benchmark prompts: {'hop-06': 0.946, 'hop-07': 0.996}

30-task benchmark with policy learned-router (mock provider): pass 96.7%, cost $0.000800, failed ['hop-02'].
Caveat: the router was designed after the benchmark exposed the hidden multi-hop weakness, so this run is optimistic, not a held-out result.

Labels are defined by construction (see evals/router_data.py); this is a synthetic distribution, not production traffic.
