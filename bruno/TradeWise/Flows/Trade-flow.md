# Register → login → place order → timeline → replay

Use the Local environment and run the **Flows / Trade-flow** folder in Bruno, or run these requests in order:

1. **1 Register** — creates a funded paper account. For subsequent runs, change the example email to a new address in both register and login requests.
2. **2 Login** — signs in with that account and saves `token`.
3. **3 Place order** — submits an ALFA market buy with an idempotency key and saves `orderId` from the response.
4. **4 Order timeline** — reads the order events using the saved `orderId`.
5. **5 Order replay** — replays the order and account projection frames.

The server and mock market feed should be running (`npm run dev`). All prices and balances are virtual; amounts are paise.
