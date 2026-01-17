FROM node:20-alpine

WORKDIR /app

# Install Python and required packages
RUN apk add --no-cache python3 py3-pip py3-requests

# Create Python symlink for compatibility
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Install Python dependencies
RUN pip3 install --break-system-packages python-dotenv

# Install Node.js dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Create directories
RUN mkdir -p uploads logs

# Expose port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
