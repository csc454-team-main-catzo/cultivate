```
npm install
npm run dev
```

```
open http://localhost:3000
```

## Pre-Arrival Quality Gate (Receiving Prep)

Midday step: generate Receiving Brief, risk-score orders, request supplier confirmations (MEDIUM/HIGH), and record deviations when suppliers confirm.

### Run the seed

From repo root (or `pkgs/server`):

```bash
npm run -w server seed:quality-gate
```

This seeds 2 suppliers (one with trust history, one new), 3 orders (including one high-risk perishable + tight window, one from the new supplier), and quality templates for berries/herbs/vegetables. The script prints the `restaurantId` and `date` to use for the API.

### Run the graph endpoint

1. Start the server: `npm run -w server dev`
2. Trigger the Quality Gate (use `restaurantId` and `date` from the seed output):

```bash
curl -X POST "http://localhost:3000/agent/quality-gate/run?restaurantId=YOUR_RESTAURANT_ID&date=YYYY-MM-DD"
```

Response: `{ receivingBriefId, confirmationsRequested, deviationFlags }`.

3. Get the Receiving Brief:

```bash
curl "http://localhost:3000/receiving-brief?restaurantId=YOUR_RESTAURANT_ID&date=YYYY-MM-DD"
```

4. Supplier confirmation (after a confirmation was requested for an order):

```bash
curl -X POST "http://localhost:3000/supplier/confirm" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORDER_ID","supplierId":"SUPPLIER_ID","confirmQty":"10","packSize":"12/1lb","harvestDate":"2025-03-01","deliveryWindow":"14:00-16:00"}'
```

For HIGH risk, include `"photoUrl":"https://..."` in the body.

### Tests

- Unit test (risk scoring): `npm run -w server test` (runs `src/agents/qualityGate/riskScoring.test.ts`)
- Integration test (graph run on seeded orders): requires MongoDB; run `npx vitest run src/agents/qualityGate/graph.integration.test.ts` from `pkgs/server`
