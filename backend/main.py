import logging
import io
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from models import FactCheckRequest, FactCheckResponse, ClaudeFactCheckResponse
from checker import run_fact_check
from claude_checker import fact_check_with_claude
from config import settings
import httpx
from PIL import Image
import pytesseract

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


@app.post("/claude-fact-check", response_model=ClaudeFactCheckResponse)
async def claude_fact_check(req: FactCheckRequest):
    if not settings.claude_api_key:
        raise HTTPException(status_code=503, detail="CLAUDE_API_KEY not configured")
    if not settings.serper_api_key:
        raise HTTPException(status_code=503, detail="SERPER_API_KEY not configured")
    try:
        logger.debug(f"Processing text with Claude: {req.text[:100]}...")
        analysis = await fact_check_with_claude(req.text)
        logger.debug(f"Claude analysis complete (length: {len(analysis)})")
        logger.debug(f"Analysis preview: {analysis[:200]}...")

        if not analysis or len(analysis.strip()) == 0:
            logger.error("Claude returned empty analysis")
            raise Exception("Claude returned empty analysis")

        response = ClaudeFactCheckResponse(
            analysis=analysis,
            post_text_preview=req.text[:100]
        )
        logger.info(f"Returning response with analysis length: {len(response.analysis)}")
        return response
    except Exception as e:
        logger.error(f"Error in claude_fact_check: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ocr")
async def extract_text_from_image(file: UploadFile = File(...)):
    """Extract text from an image using OCR (Tesseract)"""
    try:
        logger.debug(f"Extracting text from image: {file.filename}")

        # Read the uploaded image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))

        # Extract text using Tesseract
        extracted_text = pytesseract.image_to_string(image)

        if not extracted_text or len(extracted_text.strip()) == 0:
            logger.warning("OCR returned empty text")
            raise Exception("No text found in the image")

        logger.debug(f"OCR complete, extracted {len(extracted_text)} characters")
        logger.debug(f"Text preview: {extracted_text[:100]}...")

        return {
            "text": extracted_text,
            "length": len(extracted_text)
        }
    except Exception as e:
        logger.error(f"Error in OCR: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
