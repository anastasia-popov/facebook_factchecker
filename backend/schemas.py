from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# OAuth Request/Response Models
class OAuthStartRequest(BaseModel):
    """Request to start OAuth flow"""
    pass


class OAuthStartResponse(BaseModel):
    """Response with OAuth URL and PKCE challenge"""
    oauth_url: str
    state: str
    code_challenge: str


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request with authorization code"""
    code: str
    state: str
    code_verifier: str


class TokenResponse(BaseModel):
    """Response with tokens"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


class RefreshTokenRequest(BaseModel):
    """Request to refresh access token"""
    refresh_token: str


class QuotaInfo(BaseModel):
    """User quota information"""
    monthly_limit: int
    monthly_used: int
    monthly_remaining: int
    daily_limit: int
    daily_used: int
    daily_remaining: int


class UsageInfo(BaseModel):
    """User usage statistics"""
    total_requests: int
    total_ocr_requests: int
    total_fact_checks: int
    last_request: Optional[datetime]


class UserProfile(BaseModel):
    """User profile and quota information"""
    id: int
    google_email: str
    created_at: datetime
    last_login: datetime
    quotas: QuotaInfo
    usage: UsageInfo


class FactCheckRequest(BaseModel):
    """Request body for fact-check endpoint"""
    text: str

    class Config:
        max_anystr_length = 5000


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    message: str
