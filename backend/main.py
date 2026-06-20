from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import FactCheckRequest, FactCheckResponse
from checker import run_fact_check
from config import settings

app = FastAPI(title="Fact Checker Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://localhost:*",
        "https://www.facebook.com",
        "https://*.facebook.com",
        "https://facebook.com"
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    allow_credentials=True,
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/fact-check", response_model=FactCheckResponse)
async def fact_check(req: FactCheckRequest):
    if not settings.claimbuster_api_key:
        raise HTTPException(status_code=503, detail="CLAIMBUSTER_API_KEY not configured")
    if not settings.google_api_key:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY not configured")
    try:
        return await run_fact_check(req.text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
