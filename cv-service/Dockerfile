# python:3.11-slim omits compilers and dev headers, keeping the image small.
# Full PyTorch/CV libraries would require a GPU-enabled base image — this
# service is currently mocked, so slim is appropriate.
FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8000

# Cloud Run injects PORT; uvicorn is told to bind to it via the shell expansion.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
