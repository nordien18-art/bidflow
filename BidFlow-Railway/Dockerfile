FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy all source files
COPY . .

# Railway sets PORT automatically
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
