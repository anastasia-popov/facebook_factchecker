import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import FactCheckRequest, FactCheckResponse
from checker import run_fact_check
from config import settings

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

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
    if not settings.google_api_key:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY not configured")
    try:
        logger.debug(f"Processing text: {req.text[:100]}...")
        result = await run_fact_check(req.text)
        logger.debug(f"Result: {len(result.claims)} claims found")
        return result
    except Exception as e:
        logger.error(f"Error in fact_check: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
