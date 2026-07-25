import logging
import io
import html
import json
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from models import FactCheckRequest, FactCheckResponse, ClaudeFactCheckResponse
from checker import run_fact_check
from claude_checker import fact_check_with_claude
from config import settings
from database import init_db, get_db, User
from auth import google_oauth_manager, jwt_manager, UserManager
from rate_limit import rate_limiter
from schemas import (
    OAuthStartResponse, OAuthCallbackRequest, TokenResponse, RefreshTokenRequest,
    UserProfile, QuotaInfo, UsageInfo, HealthResponse
)
import httpx
from PIL import Image
import pytesseract
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI(title="Fact Checker Backend")

# Temporary storage for OAuth tokens (keyed by state)
# In production, use Redis or a database.
# Each entry is {state: {"tokens": {...}, "created_at": datetime}}.
oauth_tokens_cache = {}

# Server-issued OAuth states for CSRF protection (state -> issued datetime).
# The callback rejects any state we did not issue.
oauth_pending_states = {}

# How long an OAuth state / cached token bundle stays valid.
OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes

# OCR upload limits (defend against DoS / decompression bombs)
OCR_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
OCR_ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
# Cap total decoded pixels so a small file can't expand into gigabytes of memory
Image.MAX_IMAGE_PIXELS = 40_000_000  # ~40 MP


def _purge_expired_oauth(now: datetime = None):
    """Drop expired pending states and cached token bundles."""
    now = now or datetime.utcnow()
    ttl = timedelta(seconds=OAUTH_STATE_TTL_SECONDS)
    for state in [s for s, t in oauth_pending_states.items() if now - t > ttl]:
        oauth_pending_states.pop(state, None)
    for state in [
        s for s, v in oauth_tokens_cache.items()
        if now - v.get("created_at", now) > ttl
    ]:
        oauth_tokens_cache.pop(state, None)

# Initialize database
init_db()

# Security

def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    """Dependency to get authenticated user from JWT token in Authorization header"""
    # Extract Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    # Extract token
    token = auth_header[7:]  # Remove "Bearer " prefix

    # Verify token
    payload = jwt_manager.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    user_id = int(payload.get("sub"))
    user = UserManager.get_user_by_id(user_id, db)

    if not user or not user.active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


# Starlette matches allow_origins as exact strings — wildcard patterns like
# "chrome-extension://*" silently never match. Use allow_origin_regex so the
# extension origins and Facebook (sub)domains are actually permitted.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^("
        r"chrome-extension://[a-z]+"
        r"|moz-extension://[0-9a-f-]+"
        r"|https?://localhost(:\d+)?"
        r"|https://([a-z0-9-]+\.)*facebook\.com"
        r")$"
    ),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)


# ==================== Auth Endpoints ====================

# ==================== Google OAuth Endpoints ====================

@app.post("/auth/google/start-oauth", response_model=OAuthStartResponse)
async def start_google_oauth():
    """Initiate OAuth flow with Google"""
    try:
        # Generate state for CSRF protection
        state = google_oauth_manager.generate_state()

        # Record the state server-side so the callback can verify we issued it
        _purge_expired_oauth()
        oauth_pending_states[state] = datetime.utcnow()

        # Get authorization URL
        oauth_url = google_oauth_manager.get_authorization_url(state)

        logger.info("Google OAuth flow initiated")

        return OAuthStartResponse(
            oauth_url=oauth_url,
            state=state,
            code_challenge=""  # Google doesn't use PKCE, return empty string
        )
    except Exception as e:
        logger.error(f"Error in start_google_oauth: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to start OAuth flow")


@app.get("/auth/google/callback")
async def google_oauth_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db)
):
    """Handle Google OAuth callback (GET request from Google)"""
    logger.info(f"Google OAuth callback received with state: {state}")
    try:
        # CSRF protection: reject any state we did not issue (or that has expired)
        _purge_expired_oauth()
        if oauth_pending_states.pop(state, None) is None:
            logger.warning(f"Rejected OAuth callback with unknown/expired state: {state}")
            raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

        # Exchange authorization code for Google token
        logger.info(f"Exchanging code for token...")
        google_token_data = await google_oauth_manager.exchange_code_for_token(code)
        logger.info(f"Token exchange successful")

        # Get user info from Google
        logger.info(f"Getting user info from Google...")
        user_info = await google_oauth_manager.get_user_info(google_token_data['access_token'])
        logger.info(f"Got user info: {user_info['email']}")

        # Create or update user
        user = UserManager.create_or_update_user(
            google_id=user_info['id'],
            google_email=user_info['email'],
            display_name=user_info.get('name', user_info['email']),
            google_access_token=google_token_data['access_token'],
            db=db
        )

        # Create a new session for this browser/device - a separate row per
        # login means signing in elsewhere never invalidates this session.
        refresh_token = jwt_manager.create_refresh_token()
        UserManager.create_session(user.id, refresh_token, db)

        # Create access token
        access_token = jwt_manager.create_access_token(user.id, user_info['email'])

        logger.info(f"User authenticated via Google: {user_info['email']}")

        # Store tokens in cache for popup to retrieve (short-lived, single-use)
        logger.info(f"Storing tokens in cache with state: {state}")
        oauth_tokens_cache[state] = {
            'tokens': {
                'access_token': access_token,
                'refresh_token': refresh_token,
                'token_type': 'bearer',
                'expires_in': 3600,
                'refresh_token_expires_in': 31536000
            },
            'created_at': datetime.utcnow()
        }
        logger.info(f"Tokens stored. Cache keys: {list(oauth_tokens_cache.keys())}")

        # Return HTML page that closes the window.
        # state is JSON-encoded to safely embed it in the JS context (prevents XSS).
        safe_state_js = json.dumps(state)
        html_content = f"""
        <html>
        <head><title>Authentication Successful</title></head>
        <body>
            <script>
                // Tell popup to fetch tokens
                if (window.opener) {{
                    window.opener.postMessage({{
                        action: 'oauthCallback',
                        state: {safe_state_js}
                    }}, '*');
                }}

                // Close this window after a short delay
                setTimeout(() => {{
                    window.close();
                }}, 500);
            </script>
            <p>Authentication successful. This window should close automatically.</p>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content)
    except Exception as e:
        logger.error(f"Error in google_oauth_callback: {e}", exc_info=True)
        # Encode error safely for both JS (json.dumps) and HTML (html.escape) contexts.
        safe_error_js = json.dumps(str(e))
        safe_error_html = html.escape(str(e))
        html_content = f"""
        <html>
        <head><title>Authentication Failed</title></head>
        <body>
            <script>
                // Send error to popup
                if (window.opener) {{
                    window.opener.postMessage({{
                        action: 'oauthCallback',
                        success: false,
                        error: {safe_error_js}
                    }}, '*');
                }}

                // Close this window
                window.close();
            </script>
            <p>Authentication failed: {safe_error_html}</p>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content, status_code=401)


@app.get("/auth/google/get-tokens")
async def get_oauth_tokens(state: str):
    """Retrieve tokens that were stored during OAuth callback (single-use, short-lived)"""
    logger.info(f"get_oauth_tokens called with state: {state}")

    # Drop any expired entries first so stale token bundles can't be retrieved
    _purge_expired_oauth()

    entry = oauth_tokens_cache.pop(state, None)  # Remove from cache after retrieval
    if entry is None:
        logger.warning(f"State {state} not found or expired in cache")
        raise HTTPException(status_code=404, detail="Tokens not found. Please try logging in again.")

    logger.info(f"Found tokens for state {state}, returning")
    return TokenResponse(**entry['tokens'])


@app.post("/auth/refresh", response_model=TokenResponse)
async def refresh_access_token(
    req: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """Refresh access token using refresh token"""
    try:
        # Find this browser/device's session by its refresh token
        session = UserManager.get_session_by_token(req.refresh_token, db)

        if not session:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

        if session.expires_at < datetime.utcnow():
            raise HTTPException(status_code=401, detail="Refresh token expired")

        user = UserManager.get_user_by_id(session.user_id, db)
        if not user or not user.active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

        # Create new tokens
        new_refresh_token = jwt_manager.create_refresh_token()
        access_token = jwt_manager.create_access_token(user.id, user.google_email)

        # Rotate this session's refresh token in place
        UserManager.rotate_session(session, new_refresh_token, db)

        logger.info(f"Token refreshed for user: {user.google_email}")

        return TokenResponse(
            access_token=access_token,
            refresh_token=new_refresh_token,
            expires_in=settings.jwt_expiration_minutes * 60,
            refresh_token_expires_in=31536000
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in refresh_access_token: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail="Token refresh failed")


@app.get("/auth/profile", response_model=UserProfile)
async def get_user_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get authenticated user's profile and quota information"""
    try:
        # Get quota info
        quota_info = rate_limiter.get_quota_info(user, db)

        # Get usage stats
        from database import UsageTracking
        total_requests = db.query(UsageTracking).filter(
            UsageTracking.user_id == user.id
        ).count()

        ocr_requests = db.query(UsageTracking).filter(
            UsageTracking.user_id == user.id,
            UsageTracking.endpoint == '/ocr'
        ).count()

        fact_check_requests = db.query(UsageTracking).filter(
            UsageTracking.user_id == user.id,
            UsageTracking.endpoint.in_(['/fact-check', '/claude-fact-check'])
        ).count()

        last_request = db.query(UsageTracking).filter(
            UsageTracking.user_id == user.id
        ).order_by(UsageTracking.request_timestamp.desc()).first()

        return UserProfile(
            id=user.id,
            google_email=user.google_email,
            created_at=user.created_at,
            last_login=user.last_login,
            quotas=QuotaInfo(
                monthly_limit=quota_info['monthly_limit'],
                monthly_used=quota_info['monthly_used'],
                monthly_remaining=quota_info['monthly_remaining']
            ),
            usage=UsageInfo(
                total_requests=total_requests,
                total_ocr_requests=ocr_requests,
                total_fact_checks=fact_check_requests,
                last_request=last_request.request_timestamp if last_request else None
            )
        )
    except Exception as e:
        logger.error(f"Error in get_user_profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get profile")


@app.post("/auth/logout")
async def logout(
    req: RefreshTokenRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Log out of this one browser/device by revoking its session.

    Other devices/browsers logged in as the same user are unaffected.
    """
    try:
        UserManager.revoke_session(req.refresh_token, db)
        logger.info(f"User logged out: {user.google_email}")
        return {"message": "Logged out successfully"}
    except Exception as e:
        logger.error(f"Error in logout: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Logout failed")


# ==================== Public Endpoints ====================

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint (public)"""
    return HealthResponse(status="ok", message="Fact Checker Backend is running")


# ==================== Protected Endpoints ====================

@app.post("/fact-check", response_model=FactCheckResponse)
async def fact_check(
    req: FactCheckRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fact-check with Google API (protected, rate-limited)"""
    if not settings.google_api_key:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY not configured")

    # Check rate limit
    allowed, quota_info = rate_limiter.check_and_record_usage(
        user, "/fact-check", tokens_required=1, db=db
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Daily: {quota_info['daily_used']}/{quota_info['daily_limit']}, "
                   f"Monthly: {quota_info['monthly_used']}/{quota_info['monthly_limit']}"
        )

    try:
        logger.debug(f"[{user.google_email}] Processing text: {req.text[:100]}...")
        result = await run_fact_check(req.text)
        logger.debug(f"[{user.google_email}] Result: {len(result.claims)} claims found")
        return result
    except Exception as e:
        logger.error(f"Error in fact_check: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/claude-fact-check", response_model=ClaudeFactCheckResponse)
async def claude_fact_check(
    req: FactCheckRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fact-check with Claude and web search (protected, rate-limited)"""
    if not settings.claude_api_key:
        raise HTTPException(status_code=503, detail="CLAUDE_API_KEY not configured")
    if not settings.serper_api_key:
        raise HTTPException(status_code=503, detail="SERPER_API_KEY not configured")

    # Check rate limit
    allowed, quota_info = rate_limiter.check_and_record_usage(
        user, "/claude-fact-check", tokens_required=1, db=db
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Daily: {quota_info['daily_used']}/{quota_info['daily_limit']}, "
                   f"Monthly: {quota_info['monthly_used']}/{quota_info['monthly_limit']}"
        )

    try:
        logger.debug(f"[{user.google_email}] Processing text with Claude: {req.text[:100]}...")
        analysis = await fact_check_with_claude(req.text)
        logger.debug(f"[{user.google_email}] Claude analysis complete (length: {len(analysis)})")

        if not analysis or len(analysis.strip()) == 0:
            logger.error("Claude returned empty analysis")
            raise Exception("Claude returned empty analysis")

        response = ClaudeFactCheckResponse(
            analysis=analysis,
            post_text_preview=req.text[:100]
        )
        logger.info(f"[{user.google_email}] Returning response with analysis length: {len(response.analysis)}")
        return response
    except Exception as e:
        logger.error(f"Error in claude_fact_check: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ocr")
async def extract_text_from_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Extract text from image using OCR (protected, rate-limited on separate OCR quota)"""
    # Rate limit OCR against its own monthly quota (independent of fact-check quota)
    allowed, quota_info = rate_limiter.check_and_record_ocr_usage(
        user, tokens_required=1, db=db
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"OCR rate limit exceeded. Monthly: {quota_info['monthly_used']}/{quota_info['monthly_limit']}"
        )

    # Validate declared content type before reading the body
    if file.content_type not in OCR_ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {sorted(OCR_ALLOWED_CONTENT_TYPES)}"
        )

    # Read the uploaded image with a hard size cap to prevent memory-exhaustion DoS
    contents = await file.read(OCR_MAX_UPLOAD_BYTES + 1)
    if len(contents) > OCR_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Maximum size is {OCR_MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )

    try:
        logger.debug(f"[{user.google_email}] Extracting text from image: {file.filename}")

        # Open and verify the image is a real, decodable image within pixel limits
        try:
            image = Image.open(io.BytesIO(contents))
            image.verify()  # detects truncated/malformed images & decompression bombs
            # verify() leaves the image unusable; reopen for actual processing
            image = Image.open(io.BytesIO(contents))
        except Image.DecompressionBombError:
            raise HTTPException(status_code=413, detail="Image exceeds maximum allowed dimensions.")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid or corrupted image file.")

        # Extract text using Tesseract
        extracted_text = pytesseract.image_to_string(image)

        if not extracted_text or len(extracted_text.strip()) == 0:
            logger.warning(f"[{user.google_email}] OCR returned empty text")
            raise HTTPException(status_code=422, detail="No text found in the image")

        logger.debug(f"[{user.google_email}] OCR complete, extracted {len(extracted_text)} characters")

        return {
            "text": extracted_text,
            "length": len(extracted_text)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in OCR: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ==================== Settings Endpoints ====================

@app.get("/settings/model")
async def get_model_setting(user: User = Depends(get_current_user)):
    """Get current Claude model setting (protected)"""
    from claude_checker import CURRENT_MODEL, AVAILABLE_MODELS
    return {
        "current_model": CURRENT_MODEL,
        "available_models": AVAILABLE_MODELS
    }


@app.post("/settings/model")
async def set_model_setting(
    request_body: dict,
    user: User = Depends(get_current_user)
):
    """Set Claude model setting (protected)"""
    from claude_checker import AVAILABLE_MODELS
    import claude_checker

    model_key = request_body.get('model_key')
    if not model_key:
        raise HTTPException(status_code=400, detail="model_key is required")

    if model_key not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available: {list(AVAILABLE_MODELS.keys())}"
        )

    claude_checker.CURRENT_MODEL = AVAILABLE_MODELS[model_key]
    logger.info(f"Model changed to: {AVAILABLE_MODELS[model_key]}")

    return {
        "current_model": AVAILABLE_MODELS[model_key],
        "message": f"Model changed to {model_key}"
    }
