import logging
import io
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
# In production, use Redis or a database
oauth_tokens_cache = {}

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


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://localhost:*",
        "https://localhost:*",
        "https://www.facebook.com",
        "https://*.facebook.com",
        "https://facebook.com"
    ],
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
    try:
        # Exchange authorization code for Google token
        google_token_data = await google_oauth_manager.exchange_code_for_token(code)

        # Get user info from Google
        user_info = await google_oauth_manager.get_user_info(google_token_data['access_token'])

        # Create or update user
        refresh_token = jwt_manager.create_refresh_token()
        user = UserManager.create_or_update_user(
            google_id=user_info['id'],
            google_email=user_info['email'],
            display_name=user_info.get('name', user_info['email']),
            google_access_token=google_token_data['access_token'],
            jwt_refresh_token=refresh_token,
            db=db
        )

        # Create access token
        access_token = jwt_manager.create_access_token(user.id, user_info['email'])

        logger.info(f"User authenticated via Google: {user_info['email']}")

        # Store tokens in cache for popup to retrieve
        oauth_tokens_cache[state] = {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'token_type': 'bearer',
            'expires_in': 3600
        }

        # Return HTML page that closes the window
        html_content = f"""
        <html>
        <head><title>Authentication Successful</title></head>
        <body>
            <script>
                // Tell popup to fetch tokens
                if (window.opener) {{
                    window.opener.postMessage({{
                        action: 'oauthCallback',
                        state: '{state}'
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
        html_content = f"""
        <html>
        <head><title>Authentication Failed</title></head>
        <body>
            <script>
                // Send error to popup
                window.opener.postMessage({{
                    action: 'oauthCallback',
                    success: false,
                    error: '{str(e)}'
                }}, '*');

                // Close this window
                window.close();
            </script>
            <p>Authentication failed: {str(e)}</p>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content, status_code=401)


@app.get("/auth/google/get-tokens")
async def get_oauth_tokens(state: str):
    """Retrieve tokens that were stored during OAuth callback"""
    if state not in oauth_tokens_cache:
        raise HTTPException(status_code=404, detail="Tokens not found. Please try logging in again.")

    tokens = oauth_tokens_cache.pop(state)  # Remove from cache after retrieval
    return TokenResponse(**tokens)


@app.post("/auth/refresh", response_model=TokenResponse)
async def refresh_access_token(
    req: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """Refresh access token using refresh token"""
    try:
        # Find user by refresh token
        from database import SessionLocal
        db_session = SessionLocal()
        user = db_session.query(User).filter(
            User.jwt_refresh_token == req.refresh_token
        ).first()

        if not user:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

        # Validate refresh token expiration
        if user.jwt_refresh_token_expiry < datetime.utcnow():
            raise HTTPException(status_code=401, detail="Refresh token expired")

        # Create new tokens
        new_refresh_token = jwt_manager.create_refresh_token()
        access_token = jwt_manager.create_access_token(user.id, user.google_email)

        # Update user's refresh token
        UserManager.refresh_user_token(user, new_refresh_token, db_session)
        db_session.close()

        logger.info(f"Token refreshed for user: {user.google_email}")

        return TokenResponse(
            access_token=access_token,
            refresh_token=new_refresh_token,
            expires_in=settings.jwt_expiration_minutes * 60
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout user by invalidating refresh token"""
    try:
        UserManager.logout_user(user, db)
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
    """Extract text from image using OCR (protected, not rate-limited)"""
    try:
        logger.debug(f"[{user.google_email}] Extracting text from image: {file.filename}")

        # Read the uploaded image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))

        # Extract text using Tesseract
        extracted_text = pytesseract.image_to_string(image)

        if not extracted_text or len(extracted_text.strip()) == 0:
            logger.warning(f"[{user.google_email}] OCR returned empty text")
            raise Exception("No text found in the image")

        logger.debug(f"[{user.google_email}] OCR complete, extracted {len(extracted_text)} characters")

        return {
            "text": extracted_text,
            "length": len(extracted_text)
        }
    except Exception as e:
        logger.error(f"Error in OCR: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
