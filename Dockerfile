FROM node:22-alpine

WORKDIR /app

# Bağımlılıkları kopyala ve kur
COPY package*.json ./
RUN npm ci --only=production

# Kaynak kodları kopyala
COPY . .

# Port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Başlat
CMD ["node", "server.js"]
