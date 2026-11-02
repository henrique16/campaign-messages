# Estágio de build: instalação limpa (com devDependencies) e compilação do TypeScript.
FROM node:18-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Estágio final: só dependências de produção + dist compilado.
FROM node:18-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY fakeProvider.js ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
