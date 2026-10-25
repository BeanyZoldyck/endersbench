# Ender's Bench Actor. bundle/ comes from `npm run actors:build` in world/:
#   bundle/world/main.js     the Actor, with the benchmark bundled in
#   bundle/world/viewer/     the built Ledger Street viewer, for the Live View
#   bundle/crs/              CRS test identities and saved sandbox responses
# The benchmark reads ../crs relative to world/, as it does in the repo.
FROM apify/actor-node:22

COPY package*.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional --no-audit --no-fund \
 && rm -rf ~/.npm

COPY bundle/ ./
WORKDIR /usr/src/app/world
CMD ["node", "main.js"]
