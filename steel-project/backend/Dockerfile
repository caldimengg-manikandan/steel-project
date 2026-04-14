# Use a Node.js base image
FROM node:20-slim

# Install Python and system dependencies for PDF/OCR
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    poppler-utils \
    libmupdf-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Create a virtual environment for Python
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV PYTHON_BIN=python3

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "src/app.js"]
