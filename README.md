# decisionmodels.io demos

Three small public demos for [decisionmodels.io](https://decisionmodels.io):

- `speed/` — every chat message of a live stream moderated by **s1-fast** before it is shown (https://dm-speed.app.mintapis.com)
- `smarter/` — **s1-pro** vs Jev 1.14.0 on the public JevBench items, item by item (https://dm-smarter.app.mintapis.com)
- `specialists/` — Jev vs our use-case models on their own held-out tasks (https://dm-specialists.app.mintapis.com)

Node 20, no dependencies. The API key stays on the server (`S1_API_KEY`); each app has a shared per-minute budget, per-IP limits and a daily cap.
Jev is a model by TypeSafe. All Jev numbers here are our own recorded measurements with dates; the apps make no live Jev calls.
Our API uses the same request format as Jev ("Jev-compatible"); our models are not Jev.
