# Ender's Bench site Actor. bundle/ comes from `npm run actors:build` in world/:
#   bundle/world/main.js     the web server and run starter
#   bundle/world/viewer/     the whole built viewer, recordings included
FROM apify/actor-node:22

COPY package*.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional --no-audit --no-fund \
 && rm -rf ~/.npm

COPY bundle/ ./
WORKDIR /usr/src/app/world
CMD ["node", "main.js"]
